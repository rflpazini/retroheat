// Package aggregate reduces a bucket of listing prices to one outlier-robust
// figure. Retro listings routinely mix a tight cluster of real asking prices
// with a few fantasy prices, so the median is taken after an IQR trim.
package aggregate

import "slices"

// MinSample is the smallest post-trim bucket that still yields a figure worth
// publishing.
const MinSample = 4

type Result struct {
	MedianCents int64
	SampleSize  int
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
	return Result{MedianCents: medianSorted(trimmed), SampleSize: len(trimmed)}, true
}
