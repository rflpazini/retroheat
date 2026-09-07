// Package provider defines the seam between the pipeline and whatever price
// source is configured. eBay Browse is the free default; PriceCharting is a
// drop-in for deployers who hold their own subscription and permission.
package provider

import (
	"context"
	"errors"

	"github.com/rflpazini/retroheat/internal/catalog"
	"github.com/rflpazini/retroheat/internal/classify"
)

// Kind describes what the numbers actually mean, which the site must state
// plainly: active-listing asking prices are not realized sale prices.
const (
	KindAsking    = "asking"
	KindSoldGuide = "sold-guide"
)

type Quote struct {
	Condition   classify.Condition
	MedianCents int64
	// ModeCents is the most common whole-dollar price point, or 0 when the
	// provider only supplies a single figure rather than a listing sample.
	ModeCents int64
	// Q1Cents and Q3Cents bound the middle half of the sample, zero when the
	// provider supplies a single figure.
	Q1Cents    int64
	Q3Cents    int64
	SampleSize int
}

type Provider interface {
	Name() string
	Kind() string
	// Quotes returns one aggregate per condition bucket it could measure.
	Quotes(ctx context.Context, g catalog.Game) ([]Quote, error)
	CostPerGame() int
}

// Listing is one raw search result: the smallest record from which a quote
// can be rebuilt. A history point is a few numbers derived from listings by
// rules that change; keeping the listings means a later rule can be replayed
// over the same market instead of wiping what the old rule wrote.
type Listing struct {
	ItemID     string
	Title      string
	PriceCents int64
	Currency   string
}

// Sample is everything one search returned for a game, with the query that
// found it.
type Sample struct {
	Query    string
	Listings []Listing
}

// ListingProvider is a Provider that separates fetching from judging, so the
// pipeline can archive what it saw and a replay can judge it again later with
// no network call and no credentials.
type ListingProvider interface {
	Provider
	Listings(ctx context.Context, g catalog.Game) (Sample, error)
	QuotesFromListings(g catalog.Game, ls []Listing) ([]Quote, error)
}

var (
	ErrRateLimited = errors.New("provider rate limited")
	ErrNoData      = errors.New("no usable listings")
)
