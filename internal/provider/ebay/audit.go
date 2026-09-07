package ebay

import (
	"context"
	"fmt"
	"io"

	"github.com/rflpazini/retroheat/internal/catalog"
)

// Audit prints how every live listing for a game was bucketed. It is the tool
// for spotting a catalog query that pulls in the wrong sequel or a title
// phrasing the classifier does not yet understand. It judges each listing with
// the same function the run uses, so what it prints is what the run did.
func (c *Client) Audit(ctx context.Context, g catalog.Game, w io.Writer) error {
	s, err := c.Listings(ctx, g)
	if err != nil {
		return err
	}
	fmt.Fprintf(w, "\n== %s (%s) — %d listings for %q\n", g.ID, g.Platform, len(s.Listings), s.Query)
	media := mediaOf(g)
	for _, l := range s.Listings {
		fmt.Fprintf(w, "  %-18s %8.2f %s\n", judge(l, g, media).label, float64(l.PriceCents)/100, l.Title)
	}
	return nil
}
