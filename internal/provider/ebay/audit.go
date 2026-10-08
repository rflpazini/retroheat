package ebay

import (
	"context"
	"errors"
	"fmt"
	"io"

	"github.com/rflpazini/retroheat/internal/catalog"
	"github.com/rflpazini/retroheat/internal/provider"
)

// Audit prints how every live listing for a game was bucketed. It is the tool
// for spotting a catalog query that pulls in the wrong sequel or a title
// phrasing the classifier does not yet understand. It judges each listing with
// the same function the run uses, and runs the wider search when the run
// would, so what it prints is what the run did.
func (c *Client) Audit(ctx context.Context, g catalog.Game, w io.Writer) error {
	s, err := c.Listings(ctx, g)
	if err != nil {
		return err
	}
	if _, qerr := QuotesFromListings(g, s.Listings); errors.Is(qerr, provider.ErrNoData) && c.HasWideSearch(g) {
		wide, err := c.WideListings(ctx, g)
		if err != nil {
			return err
		}
		s = s.Merge(wide)
	}
	fmt.Fprintf(w, "\n== %s (%s) — %d listings for %q", g.ID, g.Platform, len(s.Listings), s.Query)
	if s.Wide != "" {
		fmt.Fprintf(w, " + wider %q", s.Wide)
	}
	fmt.Fprintln(w)
	media := mediaOf(g)
	for _, l := range s.Listings {
		fmt.Fprintf(w, "  %-18s %8.2f %s\n", judge(l, g, media).label, float64(l.PriceCents)/100, l.Title)
	}
	return nil
}
