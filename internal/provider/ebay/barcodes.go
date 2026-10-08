package ebay

import (
	"cmp"
	"context"
	"fmt"
	"net/http"
	"net/url"
	"regexp"
	"slices"
	"strings"
	"time"

	json "encoding/json/v2"

	"github.com/rflpazini/retroheat/internal/catalog"
	"github.com/rflpazini/retroheat/internal/classify"
	"github.com/rflpazini/retroheat/internal/provider"
)

/*
  Barcodes come from eBay's own catalog. Many listings are attached to an eBay
  product (an epid), one per edition of a game, and the product carries the
  codes printed on that edition's box. A game's barcodes are therefore found
  by tallying the epids of the listings the classifier keeps for it, then
  reading each well-attested product once. Only kept listings count, so a
  sequel or bundle the classifier already throws out cannot donate its code.

  None of this touches pricing: the price path never asks for epids, and the
  raw archive does not record them.
*/

// ProductCount is one eBay product a game's kept listings point at, with a
// few of those listings to read it through: reading a listing does not always
// bring its product back, even when the search said it had one.
type ProductCount struct {
	EPID     string   `json:"epid"`
	Listings int      `json:"listings"`
	ItemIDs  []string `json:"item_ids"`
}

// readThrough is how many of a product's listings are kept to read it by.
const readThrough = 3

// Tally is what one search says about a game's products.
type Tally struct {
	Query    string         `json:"query"`
	Kept     int            `json:"kept"`
	Products []ProductCount `json:"products"`
}

// TallyProducts runs the game's search and counts, over the listings judged
// to be this game, how many point at each eBay product, most-attested first.
func (c *Client) TallyProducts(ctx context.Context, g catalog.Game) (Tally, error) {
	query := BuildQuery(g)
	items, err := c.search(ctx, query)
	if err != nil {
		return Tally{}, err
	}
	t := Tally{Query: query}
	media := mediaOf(g)
	byEPID := map[string]*ProductCount{}
	for _, it := range items {
		cents, _ := parseCents(it.Price.Value)
		l := provider.Listing{ItemID: it.ItemID, Title: it.Title, PriceCents: cents, Currency: it.Price.Currency}
		if !judge(l, g, media).keep {
			continue
		}
		t.Kept++
		if it.EPID == "" {
			continue
		}
		pc := byEPID[it.EPID]
		if pc == nil {
			pc = &ProductCount{EPID: it.EPID}
			byEPID[it.EPID] = pc
		}
		pc.Listings++
		if len(pc.ItemIDs) < readThrough {
			pc.ItemIDs = append(pc.ItemIDs, it.ItemID)
		}
	}
	for _, pc := range byEPID {
		t.Products = append(t.Products, *pc)
	}
	slices.SortFunc(t.Products, func(a, b ProductCount) int {
		return cmp.Or(cmp.Compare(b.Listings, a.Listings), cmp.Compare(a.EPID, b.EPID))
	})
	return t, nil
}

// Attested keeps the products enough listings agree on: three, or two for
// the game's best-attested product, since a quiet game may only ever show a
// couple of listings on its own product. At most max are returned, to bound
// the calls one game can spend.
func (t Tally) Attested(minListings, maxProducts int) []ProductCount {
	var out []ProductCount
	for i, p := range t.Products {
		if p.Listings >= minListings || (i == 0 && p.Listings >= 2) {
			out = append(out, p)
		}
		if len(out) == maxProducts {
			break
		}
	}
	return out
}

// Product is an eBay catalog product: its title, which names the edition,
// and the codes printed on it.
type Product struct {
	EPID  string   `json:"epid"`
	Title string   `json:"title"`
	GTINs []string `json:"gtins"`
}

// Product reads the eBay product a listing is attached to.
func (c *Client) Product(ctx context.Context, itemID string) (Product, error) {
	var item struct {
		EPID    string `json:"epid"`
		Product struct {
			Title string   `json:"title"`
			GTINs []string `json:"gtins"`
		} `json:"product"`
	}
	path := "/buy/browse/v1/item/" + url.PathEscape(itemID)
	if err := c.getJSON(ctx, path, url.Values{"fieldgroups": {"PRODUCT"}}, &item); err != nil {
		return Product{}, fmt.Errorf("ebay item %s: %w", itemID, err)
	}
	return Product{EPID: item.EPID, Title: item.Product.Title, GTINs: item.Product.GTINs}, nil
}

// KeptForCode searches by barcode and counts the listings judged to be this
// game: the check a code someone paired by hand has to pass before it joins
// the catalog. Zero with no error means eBay US has no listing with the code,
// which is normal for a box printed for another region.
func (c *Client) KeptForCode(ctx context.Context, g catalog.Game, gtin string) (kept, total int, err error) {
	params := url.Values{
		"gtin":         {gtin},
		"category_ids": {videoGamesCategory},
		"limit":        {"50"},
	}
	var sr searchResponse
	if err := c.getJSON(ctx, "/buy/browse/v1/item_summary/search", params, &sr); err != nil {
		return 0, 0, fmt.Errorf("ebay search by code %s: %w", gtin, err)
	}
	media := mediaOf(g)
	for _, it := range sr.ItemSummaries {
		cents, _ := parseCents(it.Price.Value)
		l := provider.Listing{ItemID: it.ItemID, Title: it.Title, PriceCents: cents, Currency: it.Price.Currency}
		if judge(l, g, media).keep {
			kept++
		}
	}
	return kept, len(sr.ItemSummaries), nil
}

// CallsLeft reads how many Browse calls the application has left today and
// when the count resets. Searches and item reads draw on the same quota as
// the collector, so a harvest has to leave the next run its share.
func (c *Client) CallsLeft(ctx context.Context) (int, time.Time, error) {
	var rl struct {
		RateLimits []struct {
			Resources []struct {
				Name  string `json:"name"`
				Rates []struct {
					Remaining int    `json:"remaining"`
					Reset     string `json:"reset"`
				} `json:"rates"`
			} `json:"resources"`
		} `json:"rateLimits"`
	}
	params := url.Values{"api_name": {"browse"}, "api_context": {"buy"}}
	if err := c.getJSON(ctx, "/developer/analytics/v1_beta/rate_limit/", params, &rl); err != nil {
		return 0, time.Time{}, fmt.Errorf("ebay rate limits: %w", err)
	}
	for _, l := range rl.RateLimits {
		for _, r := range l.Resources {
			if r.Name == "buy.browse" && len(r.Rates) > 0 {
				// An unreadable reset is reported as the zero time; the
				// count is what matters.
				reset, err := time.Parse(time.RFC3339, r.Rates[0].Reset)
				if err != nil {
					reset = time.Time{}
				}
				return r.Rates[0].Remaining, reset, nil
			}
		}
	}
	return 0, time.Time{}, fmt.Errorf("ebay rate limits: no buy.browse quota in the answer")
}

// productPlatform names each platform the way eBay's product titles do, e.g.
// "Silent Hill 2 (PlayStation 2, 2001)". The Game Boy family is told apart
// by what follows "game boy".
var productPlatform = map[catalog.Platform]*regexp.Regexp{
	catalog.PS2:       regexp.MustCompile(`\b(playstation 2|ps2)\b`),
	catalog.PS3:       regexp.MustCompile(`\b(playstation 3|ps3)\b`),
	catalog.GameCube:  regexp.MustCompile(`\bgame ?cube\b`),
	catalog.PSP:       regexp.MustCompile(`\b(psp|playstation portable)\b`),
	catalog.Vita:      regexp.MustCompile(`\bvita\b`),
	catalog.N64:       regexp.MustCompile(`\b(nintendo 64|n64)\b`),
	catalog.Dreamcast: regexp.MustCompile(`\bdreamcast\b`),
	catalog.GB:        regexp.MustCompile(`\bgame ?boy\b`),
	catalog.GBC:       regexp.MustCompile(`\bgame ?boy colou?r\b`),
	catalog.GBA:       regexp.MustCompile(`\bgame ?boy advance\b`),
}

var gameBoyFamily = regexp.MustCompile(`\bgame ?boy (colou?r|advance)\b`)

var editions = []struct {
	re      *regexp.Regexp
	variant catalog.Variant
}{
	{regexp.MustCompile(`\bgreatest hits\b`), catalog.VariantGreatestHits},
	{regexp.MustCompile(`\bplayer'?s choice\b`), catalog.VariantPlayersChoice},
	{regexp.MustCompile(`\bplatinum\b`), catalog.VariantPlatinum},
	{regexp.MustCompile(`\bblack label\b`), catalog.VariantBlackLabel},
}

// Judge decides whether a product is this game on this platform, and which
// edition its box is. It applies the checks a listing title gets: the game's
// words and numbers, its exclusions (minus the reprint being looked for), its
// region, and the platform named the way eBay names it.
func Judge(g catalog.Game, p Product) (catalog.Variant, string, bool) {
	title := strings.ToLower(p.Title)
	switch {
	case p.Title == "":
		return "", "no product title", false
	case len(p.GTINs) == 0:
		return "", "no codes on the product", false
	case excluded(p.Title, g.Ebay.Negative):
		return "", "excluded by the entry's negatives", false
	case foreign(p.Title, g):
		return "", "another region", false
	case !classify.Mentions(withoutPlatforms(title), withoutPlatformNumber(g)):
		return "", "does not name the game", false
	case !platformNamed(g.Platform, title):
		return "", "does not name the platform", false
	}
	gameTitle := strings.ToLower(g.Title)
	for _, e := range editions {
		// "Platinum" in a game's own title is not a reprint.
		if e.re.MatchString(title) && !e.re.MatchString(gameTitle) {
			return e.variant, "", true
		}
	}
	return catalog.VariantNone, "", true
}

// platformOrder strips the longer Game Boy names before the plain one, or
// "Game Boy Advance" would leave a stray "advance" behind.
var platformOrder = []catalog.Platform{
	catalog.GBA, catalog.GBC, catalog.GB, catalog.PS2, catalog.PS3, catalog.PSP,
	catalog.Vita, catalog.GameCube, catalog.N64, catalog.Dreamcast,
}

// withoutPlatforms removes every platform's name from a product title before
// the game's words are looked for, so the platform cannot supply them: the
// "Advance" of "Game Boy Advance" is not the first word of Advance Wars, and
// the "64" of "Nintendo 64" is not the number in Super Mario 64.
func withoutPlatforms(lowerTitle string) string {
	for _, p := range platformOrder {
		lowerTitle = productPlatform[p].ReplaceAllString(lowerTitle, " ")
	}
	return lowerTitle
}

var sixtyFour = regexp.MustCompile(`\b64\b`)

// withoutPlatformNumber drops the 64 an N64 game carries for its console:
// eBay names "Harvest Moon 64" "Harvest Moon (Nintendo 64)", and the platform
// is checked on its own. The rest of the title still has to be there, so
// Paper Mario's product cannot pass for Super Mario 64.
func withoutPlatformNumber(g catalog.Game) string {
	if g.Platform != catalog.N64 {
		return g.Title
	}
	return strings.Join(strings.Fields(sixtyFour.ReplaceAllString(g.Title, " ")), " ")
}

func platformNamed(p catalog.Platform, lowerTitle string) bool {
	re, ok := productPlatform[p]
	if !ok || !re.MatchString(lowerTitle) {
		return false
	}
	// A plain Game Boy game must not be a Color or Advance product.
	return p != catalog.GB || !gameBoyFamily.MatchString(lowerTitle)
}

// reprintTerms are the negatives that keep a reprint out of a game's prices.
// The harvest looks for each one an entry carries with its own search, so a
// Greatest Hits box still scans to the game.
var reprintTerms = map[string]catalog.Variant{
	"greatest hits":   catalog.VariantGreatestHits,
	"players choice":  catalog.VariantPlayersChoice,
	"player's choice": catalog.VariantPlayersChoice,
	"platinum":        catalog.VariantPlatinum,
}

// ReprintSearches returns, for each reprint the entry keeps out of its prices,
// a copy of the entry that searches for that reprint instead: the term added
// to the query in quotes and dropped from the negatives.
func ReprintSearches(g catalog.Game) []catalog.Game {
	var out []catalog.Game
	seen := map[catalog.Variant]bool{}
	for _, n := range g.Ebay.Negative {
		v, ok := reprintTerms[strings.ToLower(n)]
		if !ok || seen[v] || v == g.Variant {
			continue
		}
		seen[v] = true
		r := g
		r.Ebay.Query = g.Ebay.Query + ` "` + n + `"`
		r.Ebay.Negative = slices.DeleteFunc(slices.Clone(g.Ebay.Negative), func(m string) bool {
			return reprintTerms[strings.ToLower(m)] == v
		})
		out = append(out, r)
	}
	return out
}

// getJSON is one authenticated, rate-limited GET against the Browse family of
// APIs, decoding the answer into into.
func (c *Client) getJSON(ctx context.Context, path string, params url.Values, into any) error {
	token, err := c.token(ctx)
	if err != nil {
		return err
	}
	if err := c.limiter.Wait(ctx); err != nil {
		return err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, c.baseURL+path+"?"+params.Encode(), nil)
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("X-EBAY-C-MARKETPLACE-ID", marketplaceUS)

	resp, err := c.http.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	switch {
	case resp.StatusCode == http.StatusTooManyRequests:
		return provider.ErrRateLimited
	case resp.StatusCode != http.StatusOK:
		return fmt.Errorf("unexpected status %s", resp.Status)
	}
	if err := json.UnmarshalRead(resp.Body, into); err != nil {
		return fmt.Errorf("decode: %w", err)
	}
	return nil
}
