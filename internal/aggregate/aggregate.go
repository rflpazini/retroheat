// Package aggregate reduces a bucket of listing prices to one outlier-robust
// figure. Retro listings routinely mix a tight cluster of real asking prices
// with a few fantasy prices, so the median and mode are taken after an IQR
// trim.
package aggregate

import "slices"

// MinSample is the smallest post-trim bucket that still yields a figure worth
// publishing.
const MinSample = 4

type Result struct {
	MedianCents int64
	// ModeCents is the most common whole-dollar asking price in the bucket.
	// Where the median says what the middle seller asks, the mode says what
	// price point sellers actually cluster on.
	ModeCents  int64
	SampleSize int
}

func Median(vals []int64) int64 {
	if len(vals) == 0 {
		return 0
	}
	s := slices.Clone(vals)
	slices.Sort(s)
	return medianSorted(s)
}

func medianSorted(s []int64) int64 {
	n := len(s)
	if n == 0 {
		return 0
	}
	if n%2 == 1 {
		return s[n/2]
	}
	return (s[n/2-1] + s[n/2] + 1) / 2
}

// Mode reports the most common asking price after rounding each value to the
// nearest dollar. Sellers cluster on round figures, so $29.99 and $30.00 are
// the same price point; at exact-cent granularity nearly every value is a tie
// of one. Ties between dollar points go to the one closest to the median, and
// then to the lower price, so the figure is stable from run to run.
func Mode(vals []int64) int64 {
	if len(vals) == 0 {
		return 0
	}
	median := Median(vals)
	counts := map[int64]int{}
	for _, v := range vals {
		counts[roundToDollar(v)]++
	}
	var (
		best     int64
		bestN    int
		bestDist int64
	)
	for point, n := range counts {
		dist := point - median
		if dist < 0 {
			dist = -dist
		}
		switch {
		case n > bestN,
			n == bestN && dist < bestDist,
			n == bestN && dist == bestDist && point < best:
			best, bestN, bestDist = point, n, dist
		}
	}
	return best
}

func roundToDollar(cents int64) int64 {
	return (cents + 50) / 100 * 100
}

// TrimIQR drops values outside [Q1-1.5*IQR, Q3+1.5*IQR]. Fewer than four
// values carry no usable quartiles, so they pass through untouched.
func TrimIQR(vals []int64) []int64 {
	if len(vals) < 4 {
		return slices.Clone(vals)
	}
	s := slices.Clone(vals)
	slices.Sort(s)

	half := len(s) / 2
	q1 := medianSorted(s[:half])
	q3 := medianSorted(s[len(s)-half:])
	iqr := q3 - q1
	lo := q1 - iqr*3/2
	hi := q3 + iqr*3/2

	out := make([]int64, 0, len(s))
	for _, v := range s {
		if v >= lo && v <= hi {
			out = append(out, v)
		}
	}
	return out
}

// Aggregate reports the trimmed median for a condition bucket. ok is false
// when too few listings survive the trim to be meaningful.
func Aggregate(cents []int64) (Result, bool) {
	trimmed := TrimIQR(cents)
	if len(trimmed) < MinSample {
		return Result{}, false
	}
	return Result{
		MedianCents: medianSorted(trimmed),
		ModeCents:   Mode(trimmed),
		SampleSize:  len(trimmed),
	}, true
}
