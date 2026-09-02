// Package fake generates plausible, fully deterministic prices so the site and
// the pipeline can be developed and tested without touching a live API.
package fake

import (
	"context"
	"hash/fnv"
	"math"
	"time"

	"github.com/rflpazini/retroheat/internal/catalog"
	"github.com/rflpazini/retroheat/internal/classify"
	"github.com/rflpazini/retroheat/internal/history"
	"github.com/rflpazini/retroheat/internal/provider"
)

type Provider struct{ now time.Time }

// New pins the provider to a fixed day so repeated runs and tests agree.
func New(now time.Time) *Provider { return &Provider{now: now} }

func (p *Provider) Name() string     { return "fake" }
func (p *Provider) Kind() string     { return provider.KindAsking }
func (p *Provider) CostPerGame() int { return 0 }

func (p *Provider) Quotes(_ context.Context, g catalog.Game) ([]provider.Quote, error) {
	v := valuesOn(g.ID, p.now)
	quotes := []provider.Quote{
		{Condition: classify.Loose, MedianCents: v.loose, ModeCents: modeNear(v.loose), SampleSize: v.nl},
		{Condition: classify.CIB, MedianCents: v.cib, ModeCents: modeNear(v.cib), SampleSize: v.nc},
	}
	if v.hasNew {
		quotes = append(quotes, provider.Quote{Condition: classify.New, MedianCents: v.newp, ModeCents: modeNear(v.newp), SampleSize: v.nn})
	}
	return quotes, nil
}

// modeNear stands in for the price point sellers cluster on: the median
// rounded to the dollar, the same shape the live provider produces.
func modeNear(median int64) int64 { return (median + 50) / 100 * 100 }

// Backfill invents a history so that trend charts and the momentum boards have
// something to show on a fresh checkout.
func (p *Provider) Backfill(g catalog.Game, days int, asOf time.Time) []history.Point {
	points := make([]history.Point, 0, days)
	for i := days - 1; i >= 0; i-- {
		d := asOf.AddDate(0, 0, -i)
		v := valuesOn(g.ID, d)
		pt := history.Point{
			Date:  d.Format(time.DateOnly),
			Res:   history.ResDaily,
			Loose: &v.loose,
			CIB:   &v.cib,
			NL:    v.nl,
			NC:    v.nc,
		}
		if v.hasNew {
			pt.New = &v.newp
			pt.NN = v.nn
		}
		points = append(points, pt)
	}
	return points
}

type values struct {
	loose, cib, newp int64
	nl, nc, nn       int
	hasNew           bool
}

var epoch = time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)

func valuesOn(id string, date time.Time) values {
	h := hash(id)
	base := float64(800 + h%40000)

	// Prices must depend on the calendar day alone. Deriving them from a full
	// timestamp would make two runs on the same day disagree by a cent, which
	// the pipeline would faithfully commit as a diff.
	day := time.Date(date.Year(), date.Month(), date.Day(), 0, 0, 0, 0, time.UTC)
	d := day.Sub(epoch).Hours() / 24
	slope := (float64(h%20) - 5) / 10000
	phase := float64(h%360) * math.Pi / 180
	wave := 0.12 * math.Sin(2*math.Pi*d/90+phase)
	jitter := (float64(hash(id+day.Format(time.DateOnly))%400) - 200) / 10000

	factor := 1 + slope*d + wave + jitter
	if factor < 0.2 {
		factor = 0.2
	}

	loose := int64(base * factor)
	cib := int64(float64(loose) * (1.8 + float64(h%70)/100))
	newp := int64(float64(cib) * (3 + float64(h%300)/100))

	return values{
		loose:  loose,
		cib:    cib,
		newp:   newp,
		nl:     4 + int(h%22),
		nc:     4 + int((h/7)%18),
		nn:     4 + int((h/13)%8),
		hasNew: h%3 != 0,
	}
}

func hash(s string) uint32 {
	f := fnv.New32a()
	_, _ = f.Write([]byte(s))
	return f.Sum32()
}
