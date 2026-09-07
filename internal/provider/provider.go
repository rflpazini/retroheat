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

var (
	ErrRateLimited = errors.New("provider rate limited")
	ErrNoData      = errors.New("no usable listings")
)
