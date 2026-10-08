package main

import (
	"cmp"
	"context"
	"errors"
	"fmt"
	"slices"

	"github.com/rflpazini/retroheat/internal/budget"
	"github.com/rflpazini/retroheat/internal/catalog"
	"github.com/rflpazini/retroheat/internal/mirror"
	"github.com/rflpazini/retroheat/internal/provider"
)

// minAgreeing is how many different people must pair a code eBay US has no
// listing for (a box printed for another market) before it is trusted.
const minAgreeing = 2

// review checks the pairings people made in the scanner. A pairing joins the
// catalog when eBay's listings for the code are this game, or, for a code
// eBay US does not know, when enough people agree. Everything else is
// returned as a note for a person to look at; nothing here is ever guessed.
func review(ctx context.Context, src source, games []catalog.Game, reports []mirror.BarcodeReport, b *budget.Budget) (map[string][]catalog.Barcode, []string, error) {
	byID := map[string]catalog.Game{}
	owner := map[string]string{}
	for _, g := range games {
		byID[g.ID] = g
		for _, bc := range g.Barcodes {
			if key, ok := catalog.NormalizeGTIN(bc.Code); ok {
				owner[key] = g.ID
			}
		}
	}

	// code → game → the people who named it
	votes := map[string]map[string]map[string]bool{}
	for _, r := range reports {
		key, ok := catalog.NormalizeGTIN(r.Code)
		if !ok {
			continue
		}
		if votes[key] == nil {
			votes[key] = map[string]map[string]bool{}
		}
		if votes[key][r.GameID] == nil {
			votes[key][r.GameID] = map[string]bool{}
		}
		votes[key][r.GameID][r.UserID] = true
	}
	codes := make([]string, 0, len(votes))
	for k := range votes {
		codes = append(codes, k)
	}
	slices.Sort(codes)

	accepted := map[string][]catalog.Barcode{}
	var notes []string
	for _, key := range codes {
		named := votes[key]
		if prev, taken := owner[key]; taken {
			if len(named) > 1 || named[prev] == nil {
				notes = append(notes, fmt.Sprintf("%s belongs to %s, but people also named %s", key, prev, gameList(named)))
			}
			continue
		}
		if len(named) > 1 {
			notes = append(notes, fmt.Sprintf("%s: people disagree (%s)", key, gameList(named)))
			continue
		}
		var id string
		for only := range named {
			id = only
		}
		g, known := byID[id]
		if !known {
			notes = append(notes, fmt.Sprintf("%s: paired with %s, which is no longer in the catalog", key, id))
			continue
		}
		if !b.Allow(1) {
			return accepted, notes, errBudget
		}
		kept, total, err := src.KeptForCode(ctx, g, key)
		if errors.Is(err, provider.ErrRateLimited) || ctx.Err() != nil {
			return accepted, notes, cmp.Or(ctx.Err(), err)
		}
		if err != nil {
			// One code eBay could not answer for waits for the next run.
			notes = append(notes, fmt.Sprintf("%s → %s: eBay did not answer (%v); asked again next run", key, id, err))
			continue
		}
		people := len(named[id])
		_, printed, _ := printedCode(key)
		switch {
		case kept >= 2:
			accepted[id] = append(accepted[id], catalog.Barcode{Code: printed})
		case total == 0 && people >= minAgreeing:
			accepted[id] = append(accepted[id], catalog.Barcode{Code: printed})
		case total == 0:
			notes = append(notes, fmt.Sprintf("%s → %s: eBay US has no listing with this code and %d person named it; waiting for a second", key, id, people))
		default:
			notes = append(notes, fmt.Sprintf("%s → %s: only %d of eBay's %d listings with this code are this game", key, id, kept, total))
		}
	}
	return accepted, notes, nil
}

func gameList(named map[string]map[string]bool) string {
	ids := make([]string, 0, len(named))
	for id, people := range named {
		ids = append(ids, fmt.Sprintf("%s ×%d", id, len(people)))
	}
	slices.Sort(ids)
	return fmt.Sprint(ids)
}

// withExisting adds accepted codes to what each entry already lists, since a
// reviewed pairing extends an entry rather than replacing its codes.
func withExisting(games []catalog.Game, accepted map[string][]catalog.Barcode) map[string][]catalog.Barcode {
	out := map[string][]catalog.Barcode{}
	for _, g := range games {
		if add, ok := accepted[g.ID]; ok {
			out[g.ID] = append(slices.Clone(g.Barcodes), add...)
		}
	}
	return out
}
