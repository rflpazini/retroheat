// Package ebay prices games from active Browse API listings. Browse exposes
// asking prices only: eBay's sold-price APIs were decommissioned or closed to
// new applications, so everything this package produces is what sellers want,
// not what buyers paid.
package ebay

import (
	"context"
	"fmt"
	"math"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"sync"
	"time"

	json "encoding/json/v2"

	"golang.org/x/time/rate"

	"github.com/rflpazini/retroheat/internal/aggregate"
	"github.com/rflpazini/retroheat/internal/catalog"
	"github.com/rflpazini/retroheat/internal/classify"
	"github.com/rflpazini/retroheat/internal/provider"
)

const (
	defaultBaseURL = "https://api.ebay.com"

	// videoGamesCategory is "Video Games", which keeps consoles, guides and
	// merchandise out of the result set before the classifier sees them.
	videoGamesCategory = "139973"

	marketplaceUS = "EBAY_US"

	// pageLimit is the largest page Browse will return. One page per game is
	// deliberate: pagination would multiply the daily call budget.
	pageLimit = "200"

	searchFilter = "buyingOptions:{FIXED_PRICE},itemLocationCountry:US,priceCurrency:USD,price:[3..]"
)

type Client struct {
	http         *http.Client
	baseURL      string
	clientID     string
	clientSecret string
	limiter      *rate.Limiter

	mu          sync.Mutex
	accessToken string
	tokenExpiry time.Time
}

type Option func(*Client)

func WithBaseURL(u string) Option {
	return func(c *Client) { c.baseURL = strings.TrimSuffix(u, "/") }
}

func WithHTTPClient(h *http.Client) Option {
	return func(c *Client) { c.http = h }
}

func New(clientID, clientSecret string, opts ...Option) *Client {
	c := &Client{
		http:         &http.Client{Timeout: 30 * time.Second},
		baseURL:      defaultBaseURL,
		clientID:     clientID,
		clientSecret: clientSecret,
		limiter:      rate.NewLimiter(5, 1),
	}
	for _, o := range opts {
		o(c)
	}
	return c
}

func (c *Client) Name() string     { return "ebay-browse" }
func (c *Client) Kind() string     { return provider.KindAsking }
func (c *Client) CostPerGame() int { return 1 }

type itemSummary struct {
	ItemID    string `json:"itemId"`
	Title     string `json:"title"`
	Condition string `json:"condition"`
	Price     struct {
		Value    string `json:"value"`
		Currency string `json:"currency"`
	} `json:"price"`
}

type searchResponse struct {
	Total         int           `json:"total"`
	ItemSummaries []itemSummary `json:"itemSummaries"`
}

func (c *Client) Quotes(ctx context.Context, g catalog.Game) ([]provider.Quote, error) {
	items, err := c.search(ctx, BuildQuery(g))
	if err != nil {
		return nil, err
	}

	buckets := map[classify.Condition][]int64{}
	for _, it := range items {
		if it.Price.Currency != "USD" || excluded(it.Title, g.Ebay.Negative) || !classify.Mentions(it.Title, g.Title) {
			continue
		}
		res := classify.Classify(it.Title, it.Condition)
		if res.Rejected || res.Condition == classify.Unknown {
			continue
		}
		cents, ok := parseCents(it.Price.Value)
		if !ok {
			continue
		}
		buckets[res.Condition] = append(buckets[res.Condition], cents)
	}

	var quotes []provider.Quote
	for _, cond := range []classify.Condition{classify.Loose, classify.CIB, classify.New} {
		if r, ok := aggregate.Aggregate(buckets[cond]); ok {
			quotes = append(quotes, provider.Quote{
				Condition:   cond,
				MedianCents: r.MedianCents,
				ModeCents:   r.ModeCents,
				SampleSize:  r.SampleSize,
			})
		}
	}
	if len(quotes) == 0 {
		return nil, fmt.Errorf("%s: %w", g.ID, provider.ErrNoData)
	}
	return quotes, nil
}

func (c *Client) search(ctx context.Context, query string) ([]itemSummary, error) {
	token, err := c.token(ctx)
	if err != nil {
		return nil, err
	}
	if err := c.limiter.Wait(ctx); err != nil {
		return nil, err
	}

	params := url.Values{
		"q":            {query},
		"category_ids": {videoGamesCategory},
		"limit":        {pageLimit},
		"filter":       {searchFilter},
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet,
		c.baseURL+"/buy/browse/v1/item_summary/search?"+params.Encode(), nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("X-EBAY-C-MARKETPLACE-ID", marketplaceUS)

	resp, err := c.http.Do(req)
	if err != nil {
		return nil, fmt.Errorf("ebay search: %w", err)
	}
	defer resp.Body.Close()

	switch {
	case resp.StatusCode == http.StatusTooManyRequests:
		return nil, fmt.Errorf("ebay search: %w", provider.ErrRateLimited)
	case resp.StatusCode != http.StatusOK:
		return nil, fmt.Errorf("ebay search: unexpected status %s", resp.Status)
	}

	var sr searchResponse
	if err := json.UnmarshalRead(resp.Body, &sr); err != nil {
		return nil, fmt.Errorf("ebay search: decode: %w", err)
	}
	return sr.ItemSummaries, nil
}

func parseCents(v string) (int64, bool) {
	f, err := strconv.ParseFloat(strings.TrimSpace(v), 64)
	if err != nil || f <= 0 {
		return 0, false
	}
	return int64(math.Round(f * 100)), true
}
