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

// Name is the provider's name as written into meta.json and the raw archive.
const Name = "ebay-browse"

func (c *Client) Name() string     { return Name }
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

// Quotes fetches the game's listings and reduces them to one quote per
// condition. It is Listings followed by QuotesFromListings, so a replay over
// archived listings takes exactly the path a live run took.
func (c *Client) Quotes(ctx context.Context, g catalog.Game) ([]provider.Quote, error) {
	s, err := c.Listings(ctx, g)
	if err != nil {
		return nil, err
	}
	return QuotesFromListings(g, s.Listings)
}

// Listings runs the game's search and returns every result as the pipeline
// archives it: id, title, price in cents and currency, nothing judged yet.
func (c *Client) Listings(ctx context.Context, g catalog.Game) (provider.Sample, error) {
	query := BuildQuery(g)
	items, err := c.search(ctx, query)
	if err != nil {
		return provider.Sample{}, err
	}
	out := make([]provider.Listing, 0, len(items))
	for _, it := range items {
		// An unparseable price is recorded as zero and skipped when judged,
		// rather than dropping the listing from the record.
		cents, _ := parseCents(it.Price.Value)
		out = append(out, provider.Listing{ItemID: it.ItemID, Title: it.Title, PriceCents: cents, Currency: it.Price.Currency})
	}
	return provider.Sample{Query: query, Listings: out}, nil
}

// QuotesFromListings satisfies provider.ListingProvider. The work lives in the
// package-level function so a replay needs neither a client nor credentials.
func (c *Client) QuotesFromListings(g catalog.Game, ls []provider.Listing) ([]provider.Quote, error) {
	return QuotesFromListings(g, ls)
}

var _ provider.ListingProvider = (*Client)(nil)

// QuotesFromListings judges every listing against the game with the rules in
// force now and aggregates the survivors into one quote per condition.
func QuotesFromListings(g catalog.Game, ls []provider.Listing) ([]provider.Quote, error) {
	buckets := map[classify.Condition][]int64{}
	media := mediaOf(g)
	for _, l := range ls {
		v := judge(l, g, media)
		if !v.keep || l.PriceCents <= 0 {
			continue
		}
		buckets[v.condition] = append(buckets[v.condition], l.PriceCents)
	}

	var quotes []provider.Quote
	for _, cond := range []classify.Condition{classify.Loose, classify.CIB, classify.New} {
		if r, ok := aggregate.Aggregate(buckets[cond]); ok {
			quotes = append(quotes, provider.Quote{
				Condition:   cond,
				MedianCents: r.MedianCents,
				ModeCents:   r.ModeCents,
				Q1Cents:     r.Q1Cents,
				Q3Cents:     r.Q3Cents,
				SampleSize:  r.SampleSize,
			})
		}
	}
	if len(quotes) == 0 {
		return nil, fmt.Errorf("%s: %w", g.ID, provider.ErrNoData)
	}
	return quotes, nil
}

// verdict is the whole judgement of one listing, in the words the audit
// prints, so the live run and the audit can never disagree about a title.
type verdict struct {
	condition classify.Condition
	label     string
	keep      bool
}

func judge(l provider.Listing, g catalog.Game, media classify.Media) verdict {
	switch {
	case l.Currency != "USD":
		return verdict{label: "skip:currency"}
	case excluded(l.Title, g.Ebay.Negative):
		return verdict{label: "skip:negative"}
	case foreign(l.Title, g):
		return verdict{label: "skip:region"}
	case !classify.Mentions(l.Title, g.Title):
		return verdict{label: "skip:not-this-game"}
	}
	res := classify.ClassifyMedia(l.Title, media)
	switch {
	case res.Rejected:
		return verdict{label: "reject:" + res.Reason}
	case res.Condition == classify.Unknown:
		return verdict{label: "unknown"}
	}
	return verdict{condition: res.Condition, label: string(res.Condition) + ":" + res.Reason, keep: true}
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
