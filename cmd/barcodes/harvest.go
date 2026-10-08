package main

import (
	"context"
	"errors"
	"fmt"
	"slices"
	"strings"

	"github.com/rflpazini/retroheat/internal/budget"
	"github.com/rflpazini/retroheat/internal/catalog"
	"github.com/rflpazini/retroheat/internal/provider"
	"github.com/rflpazini/retroheat/internal/provider/ebay"
)

// source is the part of the eBay client the harvest uses, so the tests can
// answer for eBay without a server.
type source interface {
	TallyProducts(ctx context.Context, g catalog.Game) (ebay.Tally, error)
	Product(ctx context.Context, itemID string) (ebay.Product, error)
	KeptForCode(ctx context.Context, g catalog.Game, gtin string) (kept, total int, err error)
}

// errBudget stops the harvest between games when the day's share is spent.
var errBudget = errors.New("call budget spent")

// found is what the harvest learned about one game. Query is the entry's
// query when it was harvested: a changed query asks again. Retry marks an
// answer spoiled by a failed read (an ended item, a server error); it is used
// for this run but not remembered, so the next run asks again.
type found struct {
	Query    string            `json:"query"`
	Kept     int               `json:"kept"`
	Codes    []catalog.Barcode `json:"codes,omitempty"`
	Rejected []string          `json:"rejected,omitempty"`
	Retry    bool              `json:"-"`
}

type settings struct {
	minListings int
	maxProducts int
}

// harvestGame runs the entry's search and one search per reprint it keeps
// out of its prices, then reads each well-attested product once. Products
// already read, by this game or another, come from products. Only codes
// printed for the entry's own region are kept.
func harvestGame(ctx context.Context, src source, g catalog.Game, b *budget.Budget, products map[string]ebay.Product, s settings) (found, error) {
	f := found{Query: g.Ebay.Query}
	have := map[string]bool{}
	for i, search := range append([]catalog.Game{g}, ebay.ReprintSearches(g)...) {
		if !b.Allow(1) {
			return f, errBudget
		}
		t, err := src.TallyProducts(ctx, search)
		if err != nil {
			return f, err
		}
		if i == 0 {
			f.Kept = t.Kept
		}
		for _, pc := range t.Attested(s.minListings, s.maxProducts) {
			p, ok := products[pc.EPID]
			if !ok {
				p, err = readProduct(ctx, src, pc, b)
				if errors.Is(err, errBudget) || errors.Is(err, provider.ErrRateLimited) {
					return f, err
				}
				if err != nil {
					// An item can end between the search and the read, and a
					// server can fail; neither says anything about the product.
					f.Rejected = append(f.Rejected, fmt.Sprintf("epid %s: %v", pc.EPID, err))
					f.Retry = true
					continue
				}
				// A product that came back bare is asked for again next time.
				if p.Title != "" {
					products[pc.EPID] = p
				}
			}
			// Every listing tried came back without its product: that says
			// nothing about the product either, so the game is asked again.
			if p.Title == "" {
				f.Retry = true
			}
			variant, reason, ok := ebay.Judge(search, p)
			if !ok {
				f.Rejected = append(f.Rejected, fmt.Sprintf("epid %s %q: %s", p.EPID, p.Title, reason))
				continue
			}
			// The entry's own edition is written without a variant; only a
			// reprint of it says which reprint.
			if variant == catalog.VariantNone || variant == g.Variant {
				variant = ""
			}
			for _, gtin := range p.GTINs {
				code, printed, ok := printedCode(gtin)
				if !ok || have[code] {
					continue
				}
				if reason, ok := usableFor(g, code); !ok {
					f.Rejected = append(f.Rejected, fmt.Sprintf("epid %s %q: code %s %s", p.EPID, p.Title, printed, reason))
					continue
				}
				have[code] = true
				f.Codes = append(f.Codes, catalog.Barcode{Code: printed, Variant: variant})
			}
		}
	}
	return f, nil
}

// usableFor turns down a code that cannot be on this entry's box. eBay's
// product for a US game sometimes lists only the European or Japanese box;
// that code would never scan a US copy, and the entry's prices are for the US
// one. Some old products carry a filler code, one six-digit half printed
// twice (911448911448), that is on no box at all.
func usableFor(g catalog.Game, key string) (string, bool) {
	if key[1:7] == key[7:13] {
		return "is a filler code", false
	}
	region := g.Region
	if region == "" {
		region = catalog.RegionNTSCU
	}
	if r := regionOfCode(key); r != region {
		return "is a " + string(r) + " box", false
	}
	return "", true
}

// carriedBy indexes remembered products by the codes they carry.
func carriedBy(products map[string]ebay.Product) map[string][]ebay.Product {
	out := map[string][]ebay.Product{}
	for _, p := range products {
		for _, gtin := range p.GTINs {
			if key, _, ok := printedCode(gtin); ok {
				out[key] = append(out[key], p)
			}
		}
	}
	return out
}

// vouched says whether a code still holds for an entry under today's rules,
// judged from the products remembered as carrying it. A code no remembered
// product carries (paired by hand, or typed in) is not the harvest's to judge.
func vouched(g catalog.Game, key string, carrying map[string][]ebay.Product) (string, bool) {
	ps := carrying[key]
	if len(ps) == 0 {
		return "", true
	}
	if reason, ok := usableFor(g, key); !ok {
		return reason, false
	}
	for _, s := range append([]catalog.Game{g}, ebay.ReprintSearches(g)...) {
		for _, p := range ps {
			if _, _, ok := ebay.Judge(s, p); ok {
				return "", true
			}
		}
	}
	return "no product for it passes", false
}

// stillVouched keeps the codes that hold under today's rules.
func stillVouched(g catalog.Game, codes []catalog.Barcode, carrying map[string][]ebay.Product) []catalog.Barcode {
	var keep []catalog.Barcode
	for _, b := range codes {
		if key, ok := catalog.NormalizeGTIN(b.Code); ok {
			if _, ok := vouched(g, key, carrying); ok {
				keep = append(keep, b)
			}
		}
	}
	return keep
}

// rejudge checks every code the catalog lists against what the products
// eBay attached it to say now, with no calls, and returns each entry that
// loses a code with what it keeps.
func rejudge(games []catalog.Game, products map[string]ebay.Product) (map[string][]catalog.Barcode, []string) {
	carrying := carriedBy(products)
	out := map[string][]catalog.Barcode{}
	var dropped []string
	for _, g := range games {
		var keep []catalog.Barcode
		for _, b := range g.Barcodes {
			key, ok := catalog.NormalizeGTIN(b.Code)
			if !ok {
				continue
			}
			if reason, ok := vouched(g, key, carrying); !ok {
				dropped = append(dropped, fmt.Sprintf("%s: dropped %s (%s)", g.ID, b.Code, reason))
				continue
			}
			keep = append(keep, b)
		}
		if len(keep) != len(g.Barcodes) {
			out[g.ID] = keep
		}
	}
	return out, dropped
}

// pruneCache applies today's rules to the answers the cache remembers, so a
// code -rejudge took out of the catalog does not come back from the cache.
func pruneCache(c cacheFile, games []catalog.Game) {
	carrying := carriedBy(c.Products)
	for _, g := range games {
		if f, ok := c.Games[g.ID]; ok {
			f.Codes = stillVouched(g, f.Codes, carrying)
			c.Games[g.ID] = f
		}
	}
}

// readProduct reads a product through its listings in turn until one brings
// it back with a title: eBay's search can attach a product to a listing whose
// own page then comes back without it.
func readProduct(ctx context.Context, src source, pc ebay.ProductCount, b *budget.Budget) (ebay.Product, error) {
	var last ebay.Product
	var lastErr error
	for _, itemID := range pc.ItemIDs {
		if !b.Allow(1) {
			return ebay.Product{}, errBudget
		}
		p, err := src.Product(ctx, itemID)
		if errors.Is(err, provider.ErrRateLimited) {
			return ebay.Product{}, err
		}
		if err != nil {
			lastErr = err
			continue
		}
		p.EPID = pc.EPID
		if p.Title != "" {
			return p, nil
		}
		last, lastErr = p, nil
	}
	return last, lastErr
}

// regionOfCode reads the market a box was printed for from its GS1 prefix:
// 000–139 is the United States and Canada, 450–459 and 490–499 Japan, and
// everything else is treated as PAL.
func regionOfCode(key string) catalog.Region {
	prefix := (int(key[0]-'0')*10+int(key[1]-'0'))*10 + int(key[2]-'0')
	switch {
	case prefix <= 139:
		return catalog.RegionNTSCU
	case prefix >= 450 && prefix <= 459, prefix >= 490 && prefix <= 499:
		return catalog.RegionNTSCJ
	}
	return catalog.RegionPAL
}

// printedCode turns a GTIN as eBay reports it (13 or 14 digits, zero-padded)
// into the 13-digit lookup key and the code as the box prints it: twelve
// digits for a UPC-A, thirteen for an EAN or JAN.
func printedCode(gtin string) (key, printed string, ok bool) {
	gtin = strings.TrimSpace(gtin)
	if len(gtin) == 14 && gtin[0] == '0' {
		gtin = gtin[1:]
	}
	key, ok = catalog.NormalizeGTIN(gtin)
	if !ok {
		return "", "", false
	}
	if key[0] == '0' {
		return key, key[1:], true
	}
	return key, key, true
}

// assign decides which entry every harvested code goes to, and returns each
// entry that gains a code with its full new list. A harvest only ever adds:
// a code the catalog already lists stays with its entry (taking it away is
// -rejudge's job), and a claim on it from another entry is reported. A code
// two entries both found goes to the one whose own edition it is (the
// Greatest Hits code belongs to a Greatest Hits entry before the base game's
// reprint list); when that does not settle it, nobody gets it and it is
// reported, because a scan must land on exactly one game.
func assign(games []catalog.Game, harvested map[string]found) (map[string][]catalog.Barcode, []string) {
	owner := map[string]string{}
	existing := map[string][]catalog.Barcode{}
	for _, g := range games {
		existing[g.ID] = g.Barcodes
		for _, b := range g.Barcodes {
			if key, ok := catalog.NormalizeGTIN(b.Code); ok {
				owner[key] = g.ID
			}
		}
	}

	type claim struct {
		id string
		bc catalog.Barcode
	}
	claims := map[string][]claim{}
	for id, f := range harvested {
		for _, bc := range f.Codes {
			key, _ := catalog.NormalizeGTIN(bc.Code)
			claims[key] = append(claims[key], claim{id, bc})
		}
	}

	added := map[string][]catalog.Barcode{}
	var conflicts []string
	keys := make([]string, 0, len(claims))
	for k := range claims {
		keys = append(keys, k)
	}
	slices.Sort(keys)
	for _, key := range keys {
		cs := claims[key]
		if prev, taken := owner[key]; taken {
			others := slices.DeleteFunc(slices.Clone(cs), func(c claim) bool { return c.id == prev })
			if len(others) > 0 {
				conflicts = append(conflicts, fmt.Sprintf("%s: already belongs to %s, also found for %s", key, prev, idsOf(others, func(c claim) string { return c.id })))
			}
			continue
		}
		winner := -1
		if len(cs) == 1 {
			winner = 0
		} else {
			for i, c := range cs {
				if c.bc.Variant == "" {
					if winner >= 0 {
						winner = -1
						break
					}
					winner = i
				}
			}
		}
		if winner < 0 {
			conflicts = append(conflicts, fmt.Sprintf("%s: found for %s; left out", key, idsOf(cs, func(c claim) string { return c.id })))
			continue
		}
		added[cs[winner].id] = append(added[cs[winner].id], cs[winner].bc)
	}

	out := map[string][]catalog.Barcode{}
	for id, bcs := range added {
		out[id] = append(slices.Clone(existing[id]), bcs...)
	}
	return out, conflicts
}

func idsOf[T any](xs []T, id func(T) string) string {
	ids := make([]string, 0, len(xs))
	for _, x := range xs {
		ids = append(ids, id(x))
	}
	slices.Sort(ids)
	return strings.Join(ids, ", ")
}
