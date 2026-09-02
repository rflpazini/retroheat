package aggregate_test

import (
	"testing"

	"github.com/rflpazini/retroheat/internal/aggregate"
)

func TestMedian(t *testing.T) {
	t.Parallel()
	cases := []struct {
		name string
		in   []int64
		want int64
	}{
		{"odd", []int64{300, 100, 200}, 200},
		{"even averages middle pair", []int64{100, 200, 300, 500}, 250},
		{"single", []int64{4200}, 4200},
		{"even rounds half up", []int64{100, 101}, 101},
		{"does not mutate caller order", []int64{5, 1, 3}, 3},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			t.Parallel()
			in := append([]int64(nil), c.in...)
			if got := aggregate.Median(in); got != c.want {
				t.Errorf("Median(%v) = %d, want %d", c.in, got, c.want)
			}
		})
	}
}

func TestMedianDoesNotReorderInput(t *testing.T) {
	t.Parallel()
	in := []int64{500, 100, 300}
	aggregate.Median(in)
	if in[0] != 500 || in[1] != 100 || in[2] != 300 {
		t.Errorf("Median mutated its input: %v", in)
	}
}

func TestTrimIQRDropsOutliers(t *testing.T) {
	t.Parallel()
	// A tight cluster around $40 plus one $900 "sealed graded" style outlier.
	in := []int64{3800, 3900, 4000, 4100, 4200, 4300, 4400, 90000}
	got := aggregate.TrimIQR(in)
	for _, v := range got {
		if v == 90000 {
			t.Fatalf("TrimIQR kept the outlier: %v", got)
		}
	}
	if len(got) != len(in)-1 {
		t.Errorf("TrimIQR(%v) = %v, want only the outlier removed", in, got)
	}
}

func TestTrimIQRKeepsTightCluster(t *testing.T) {
	t.Parallel()
	in := []int64{4000, 4100, 4200, 4300, 4400}
	if got := aggregate.TrimIQR(in); len(got) != len(in) {
		t.Errorf("TrimIQR(%v) = %v, want all values kept", in, got)
	}
}

func TestTrimIQRHandlesTinyInputs(t *testing.T) {
	t.Parallel()
	for _, in := range [][]int64{nil, {}, {100}, {100, 200}, {100, 200, 300}} {
		if got := aggregate.TrimIQR(in); len(got) != len(in) {
			t.Errorf("TrimIQR(%v) = %v, want unchanged (too few values to trim)", in, got)
		}
	}
}

func TestAggregateRequiresMinimumSample(t *testing.T) {
	t.Parallel()
	if _, ok := aggregate.Aggregate([]int64{4000, 4100, 4200}); ok {
		t.Error("Aggregate with 3 values = ok, want rejected below MinSample")
	}
	got, ok := aggregate.Aggregate([]int64{4000, 4100, 4200, 4300})
	if !ok {
		t.Fatal("Aggregate with 4 values rejected, want ok")
	}
	if got.SampleSize != 4 {
		t.Errorf("SampleSize = %d, want 4", got.SampleSize)
	}
	if got.MedianCents != 4150 {
		t.Errorf("MedianCents = %d, want 4150", got.MedianCents)
	}
}

func TestAggregateReportsPostTrimSampleSize(t *testing.T) {
	t.Parallel()
	in := []int64{3800, 3900, 4000, 4100, 4200, 4300, 4400, 90000}
	got, ok := aggregate.Aggregate(in)
	if !ok {
		t.Fatal("Aggregate rejected a healthy sample")
	}
	if got.SampleSize != len(in)-1 {
		t.Errorf("SampleSize = %d, want %d (outlier excluded)", got.SampleSize, len(in)-1)
	}
	if got.MedianCents > 5000 {
		t.Errorf("MedianCents = %d, outlier still dragging the median up", got.MedianCents)
	}
}

func TestAggregateRejectsWhenTrimDropsBelowMinimum(t *testing.T) {
	t.Parallel()
	if _, ok := aggregate.Aggregate(nil); ok {
		t.Error("Aggregate(nil) = ok, want rejected")
	}
}
