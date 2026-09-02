// Package trending turns a game's price history into a momentum ranking.
// Percentage change beats absolute change here: a $4 move on a $12 game is
// news, the same move on a $400 game is noise.
package trending

import (
	"cmp"
	"slices"
	"time"

	"github.com/rflpazini/retroheat/internal/aggregate"
	"github.com/rflpazini/retroheat/internal/catalog"
	"github.com/rflpazini/retroheat/internal/classify"
	"github.com/rflpazini/retroheat/internal/history"
)

const (
	SmoothWindow = 5
	SparkPoints  = 30

	// MinPriceCents keeps bargain-bin titles out of the boards, where a
	// couple of dollars of noise reads as a huge percentage swing.
	MinPriceCents int64 = 1000

	// ToleranceDays is how far from the ideal lookback date a comparison
	// point may sit, covering missed runs and weekly-rolled history.
	ToleranceDays = 3

	weight7d  = 0.6
	weight30d = 0.4
)

type Sample struct {
	Date string
	Val  int64
}

type Input struct {
	ID       string
	Title    string
	Platform catalog.Platform
	Points   []history.Point
}

type Entry struct {
	ID                string              `json:"id"`
	Title             string              `json:"title"`
	Platform          catalog.Platform    `json:"platform"`
	HeadlineCondition classify.Condition  `json:"headline_condition"`
	PriceCents        int64               `json:"price_cents"`
	Pct7d             *float64            `json:"pct_7d"`
	Pct30d            *float64            `json:"pct_30d"`
	Score             float64             `json:"score"`
	Spark             []int64             `json:"spark"`
	Annotation        *catalog.Annotation `json:"annotation,omitempty"`
}

// Smooth replaces each value with the median of itself and the preceding
// window-1 values, so one weird day cannot create a trend.
func Smooth(vals []int64, window int) []int64 {
	if len(vals) == 0 {
		return nil
	}
	if window < 1 {
		window = 1
	}
	out := make([]int64, len(vals))
	for i := range vals {
		lo := max(0, i-window+1)
		out[i] = aggregate.Median(vals[lo : i+1])
	}
	return out
}

// PctChange compares the newest sample with the one closest to days before
// asOf. It reports false when no comparison point falls within tolerance.
func PctChange(samples []Sample, asOf time.Time, days, tolDays int) (float64, bool) {
	if len(samples) == 0 {
		return 0, false
	}
	current := samples[len(samples)-1].Val
	target := asOf.AddDate(0, 0, -days)

	var baseline int64
	bestDist := tolDays + 1
	for _, s := range samples {
		d, err := time.Parse(time.DateOnly, s.Date)
		if err != nil {
			continue
		}
		dist := int(d.Sub(target).Hours() / 24)
		if dist < 0 {
			dist = -dist
		}
		if dist < bestDist {
			bestDist, baseline = dist, s.Val
		}
	}
	if bestDist > tolDays || baseline == 0 {
		return 0, false
	}
	return float64(current-baseline) / float64(baseline) * 100, true
}

// Metrics are the chart-facing numbers for one game, computed without any
// ranking gates so that the platform boards can show every tracked title.
type Metrics struct {
	Condition  classify.Condition
	PriceCents int64
	Pct7d      *float64
	Pct30d     *float64
	Score      float64
	Spark      []int64
}

// Measure derives the headline price, percentage moves and sparkline. It
// reports false only when no condition has enough listings behind it.
func Measure(points []history.Point, asOf time.Time) (Metrics, bool) {
	if len(points) == 0 {
		return Metrics{}, false
	}
	cond, price := headline(points[len(points)-1])
	if cond == classify.Unknown {
		return Metrics{}, false
	}

	samples := seriesFor(points, cond)
	if len(samples) == 0 {
		return Metrics{}, false
	}
	vals := make([]int64, len(samples))
	for i, s := range samples {
		vals[i] = s.Val
	}
	smoothed := Smooth(vals, SmoothWindow)
	for i := range samples {
		samples[i].Val = smoothed[i]
	}

	m := Metrics{Condition: cond, PriceCents: price, Spark: lastN(smoothed, SparkPoints)}
	if pct7, ok := PctChange(samples, asOf, 7, ToleranceDays); ok {
		m.Pct7d = &pct7
		m.Score = pct7
		if pct30, ok := PctChange(samples, asOf, 30, ToleranceDays); ok {
			m.Pct30d = &pct30
			m.Score = weight7d*pct7 + weight30d*pct30
		}
	}
	return m, true
}

// SparkFor returns the smoothed recent series for one condition, so a board
// can chart each price column separately.
func SparkFor(points []history.Point, cond classify.Condition) []int64 {
	samples := seriesFor(points, cond)
	if len(samples) < 2 {
		return nil
	}
	vals := make([]int64, len(samples))
	for i, s := range samples {
		vals[i] = s.Val
	}
	return lastN(Smooth(vals, SmoothWindow), SparkPoints)
}

// Compute ranks one game, or reports false when it fails a gate: too cheap,
// too illiquid, or too new to have a week of history behind it.
func Compute(in Input, asOf time.Time) (Entry, bool) {
	m, ok := Measure(in.Points, asOf)
	if !ok || m.PriceCents < MinPriceCents || m.Pct7d == nil {
		return Entry{}, false
	}
	return Entry{
		ID:                in.ID,
		Title:             in.Title,
		Platform:          in.Platform,
		HeadlineCondition: m.Condition,
		PriceCents:        m.PriceCents,
		Pct7d:             m.Pct7d,
		Pct30d:            m.Pct30d,
		Score:             m.Score,
		Spark:             m.Spark,
	}, true
}

// headline picks the condition the board leads with: CIB is the collector's
// reference point, with loose as the fallback when nobody lists complete copies.
func headline(p history.Point) (classify.Condition, int64) {
	if p.CIB != nil && p.NC >= aggregate.MinSample {
		return classify.CIB, *p.CIB
	}
	if p.Loose != nil && p.NL >= aggregate.MinSample {
		return classify.Loose, *p.Loose
	}
	return classify.Unknown, 0
}

func seriesFor(points []history.Point, cond classify.Condition) []Sample {
	out := make([]Sample, 0, len(points))
	for _, p := range points {
		var v *int64
		switch cond {
		case classify.CIB:
			v = p.CIB
		case classify.Loose:
			v = p.Loose
		case classify.New:
			v = p.New
		}
		if v != nil {
			out = append(out, Sample{Date: p.Date, Val: *v})
		}
	}
	return out
}

func lastN(vals []int64, n int) []int64 {
	if len(vals) <= n {
		return slices.Clone(vals)
	}
	return slices.Clone(vals[len(vals)-n:])
}

// Rank orders entries by momentum, breaking ties on id so that repeated runs
// produce identical files.
func Rank(entries []Entry, limit int) []Entry {
	out := slices.Clone(entries)
	slices.SortFunc(out, func(a, b Entry) int {
		if c := cmp.Compare(b.Score, a.Score); c != 0 {
			return c
		}
		return cmp.Compare(a.ID, b.ID)
	})
	if limit > 0 && len(out) > limit {
		out = out[:limit]
	}
	return out
}
