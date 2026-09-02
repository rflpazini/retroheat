// Package pricecharting is an optional price source for deployers who hold
// their own PriceCharting subscription.
//
// Read this before enabling it. PriceCharting's terms state that their price
// data "cannot be used in any software, application, or system that is
// accessible to third parties ... without express written permission", with a
// carve-out only for referencing prices when the site clearly cites
// PriceCharting and links back to it. Publishing this data on a public site
// therefore needs their written permission first, and their data must never be
// committed to a public repository without it. The project default is the eBay
// provider precisely because of this.
package pricecharting

import (
	"context"
	"fmt"
	"net/http"
	"net/url"
	"strings"
	"time"

	json "encoding/json/v2"

	"golang.org/x/time/rate"

	"github.com/rflpazini/retroheat/internal/aggregate"
	"github.com/rflpazini/retroheat/internal/catalog"
	"github.com/rflpazini/retroheat/internal/classify"
	"github.com/rflpazini/retroheat/internal/provider"
)

const defaultBaseURL = "https://www.pricecharting.com"

type Client struct {
	http    *http.Client
	baseURL string
	token   string
	limiter *rate.Limiter
}

type Option func(*Client)

func WithBaseURL(u string) Option {
	return func(c *Client) { c.baseURL = strings.TrimSuffix(u, "/") }
}

func New(token string, opts ...Option) *Client {
	c := &Client{
		http:    &http.Client{Timeout: 30 * time.Second},
		baseURL: defaultBaseURL,
		token:   token,
		limiter: rate.NewLimiter(1, 1),
	}
	for _, o := range opts {
		o(c)
	}
	return c
}

func (c *Client) Name() string     { return "pricecharting" }
func (c *Client) Kind() string     { return provider.KindSoldGuide }
func (c *Client) CostPerGame() int { return 1 }

// product mirrors the documented API fields. Prices arrive in pennies.
type product struct {
	Status      string `json:"status"`
	ProductName string `json:"product-name"`
	ConsoleName string `json:"console-name"`
	LoosePrice  int64  `json:"loose-price"`
	CIBPrice    int64  `json:"cib-price"`
	NewPrice    int64  `json:"new-price"`
	SalesVolume int    `json:"sales-volume"`
}

func (c *Client) Quotes(ctx context.Context, g catalog.Game) ([]provider.Quote, error) {
	if err := c.limiter.Wait(ctx); err != nil {
		return nil, err
	}

	params := url.Values{"t": {c.token}, "q": {g.Ebay.Query}}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet,
		c.baseURL+"/api/product?"+params.Encode(), nil)
	if err != nil {
		return nil, err
	}

	resp, err := c.http.Do(req)
	if err != nil {
		return nil, fmt.Errorf("pricecharting: %w", err)
	}
	defer resp.Body.Close()

	switch {
	case resp.StatusCode == http.StatusTooManyRequests:
		return nil, fmt.Errorf("pricecharting: %w", provider.ErrRateLimited)
	case resp.StatusCode != http.StatusOK:
		return nil, fmt.Errorf("pricecharting: unexpected status %s", resp.Status)
	}

	var p product
	if err := json.UnmarshalRead(resp.Body, &p); err != nil {
		return nil, fmt.Errorf("pricecharting: decode: %w", err)
	}
	if p.Status != "" && p.Status != "success" {
		return nil, fmt.Errorf("pricecharting: %s: %w", p.Status, provider.ErrNoData)
	}

	// The guide publishes one figure per condition rather than a sample, so
	// the liquidity gate uses yearly sales volume. A reported low volume is
	// real information and must be allowed to fail the gate; only a missing
	// figure falls back to the minimum.
	sample := p.SalesVolume
	if sample <= 0 {
		sample = aggregate.MinSample
	}

	var quotes []provider.Quote
	for _, q := range []struct {
		cond  classify.Condition
		cents int64
	}{
		{classify.Loose, p.LoosePrice},
		{classify.CIB, p.CIBPrice},
		{classify.New, p.NewPrice},
	} {
		if q.cents > 0 {
			quotes = append(quotes, provider.Quote{Condition: q.cond, MedianCents: q.cents, SampleSize: sample})
		}
	}
	if len(quotes) == 0 {
		return nil, fmt.Errorf("%s: %w", g.ID, provider.ErrNoData)
	}
	return quotes, nil
}
