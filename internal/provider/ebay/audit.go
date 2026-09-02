package ebay

import (
	"context"
	"fmt"
	"io"

	"github.com/rflpazini/retroheat/internal/catalog"
	"github.com/rflpazini/retroheat/internal/classify"
)

// Audit prints how every live listing for a game was bucketed. It is the tool
// for spotting a catalog query that pulls in the wrong sequel or a title
// phrasing the classifier does not yet understand.
func (c *Client) Audit(ctx context.Context, g catalog.Game, w io.Writer) error {
	items, err := c.search(ctx, BuildQuery(g))
	if err != nil {
		return err
	}
	fmt.Fprintf(w, "\n== %s (%s) — %d listings for %q\n", g.ID, g.Platform, len(items), BuildQuery(g))
	for _, it := range items {
		verdict := "skip:currency"
		switch {
		case it.Price.Currency != "USD":
		case excluded(it.Title, g.Ebay.Negative):
			verdict = "skip:negative"
		default:
			res := classify.Classify(it.Title, it.Condition)
			switch {
			case res.Rejected:
				verdict = "reject:" + res.Reason
			case res.Condition == classify.Unknown:
				verdict = "unknown"
			default:
				verdict = string(res.Condition) + ":" + res.Reason
			}
		}
		fmt.Fprintf(w, "  %-18s %8s %s\n", verdict, it.Price.Value, it.Title)
	}
	return nil
}
