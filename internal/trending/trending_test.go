package trending_test

import (
	"math"
	"testing"
	"time"

	"github.com/rflpazini/retroheat/internal/catalog"
	"github.com/rflpazini/retroheat/internal/classify"
	"github.com/rflpazini/retroheat/internal/history"
	"github.com/rflpazini/retroheat/internal/trending"
)

func cents(v int64) *int64 { return &v }

func day(s string) time.Time {
	t, err := time.Parse(time.DateOnly, s)
	if err != nil {
		panic(err)
	}
	return t
}

// series builds one daily point per value, ending on endDate.
func series(endDate string, cib []int64) []history.Point {
	end := day(endDate)
	pts := make([]history.Point, len(cib))
	for i, v := range cib {
		d := end.AddDate(0, 0, -(len(cib) - 1 - i))
		pts[i] = history.Point{
			Date: d.Format(time.DateOnly), Res: "d",
			CIB: cents(v), NC: 10,
		}
	}
	return pts
}

func TestSmoothSuppressesSingleDaySpike(t *testing.T) {
	t.Parallel()
	in := []int64{100, 100, 100, 900, 100, 100, 100}
	got := trending.Smooth(in, 5)

	if len(got) != len(in) {
		t.Fatalf("Smooth returned %d values, want %d", len(got), len(in))
	}
	for i, v := range got {
		if v == 900 {
			t.Errorf("smoothed[%d] = 900, the outlier survived: %v", i, got)
		}
	}
}

func TestSmoothHandlesShortSeries(t *testing.T) {
	t.Parallel()
	got := trending.Smooth([]int64{500}, 5)
	if len(got) != 1 || got[0] != 500 {
		t.Errorf("Smooth([500]) = %v, want [500]", got)
	}
	if got := trending.Smooth(nil, 5); len(got) != 0 {
		t.Errorf("Smooth(nil) = %v, want empty", got)
	}
}

func TestSmoothTracksSustainedMoves(t *testing.T) {
	t.Parallel()
	in := []int64{100, 100, 100, 100, 200, 200, 200, 200, 200}
	got := trending.Smooth(in, 5)
	if last := got[len(got)-1]; last != 200 {
		t.Errorf("last smoothed = %d, want 200: a real move must not be smoothed away", last)
	}
}

func TestPctChangeExactDate(t *testing.T) {
	t.Parallel()
	samples := []trending.Sample{
		{Date: "2026-08-25", Val: 1000},
		{Date: "2026-09-01", Val: 1100},
	}
	got, ok := trending.PctChange(samples, day("2026-09-01"), 7, 3)
	if !ok {
		t.Fatal("PctChange not ok, want a 7-day comparison")
	}
	if math.Abs(got-10) > 0.001 {
		t.Errorf("PctChange = %v, want 10", got)
	}
}

func TestPctChangeAcceptsNearbyDateWithinTolerance(t *testing.T) {
	t.Parallel()
	samples := []trending.Sample{
		{Date: "2026-08-26", Val: 1000},
		{Date: "2026-09-01", Val: 1200},
	}
	got, ok := trending.PctChange(samples, day("2026-09-01"), 7, 3)
	if !ok {
		t.Fatal("PctChange not ok; a point 6 days back is within a 3-day tolerance of 7")
	}
	if math.Abs(got-20) > 0.001 {
		t.Errorf("PctChange = %v, want 20", got)
	}
}

func TestPctChangeRejectsOutsideTolerance(t *testing.T) {
	t.Parallel()
	samples := []trending.Sample{{Date: "2026-09-01", Val: 1200}}
	if _, ok := trending.PctChange(samples, day("2026-09-01"), 7, 3); ok {
		t.Error("PctChange ok with no historical point, want not ok")
	}
}

func TestPctChangeIgnoresZeroBaseline(t *testing.T) {
	t.Parallel()
	samples := []trending.Sample{
		{Date: "2026-08-25", Val: 0},
		{Date: "2026-09-01", Val: 1200},
	}
	if _, ok := trending.PctChange(samples, day("2026-09-01"), 7, 3); ok {
		t.Error("PctChange ok against a zero baseline, want not ok")
	}
}

func TestComputePrefersCIBAsHeadline(t *testing.T) {
	t.Parallel()
	pts := series("2026-09-01", []int64{9000, 9000, 9000, 9000, 9000, 9000, 9000, 9800})
	for i := range pts {
		pts[i].Loose = cents(4000)
		pts[i].NL = 10
	}
	got, ok := trending.Compute(trending.Input{ID: "a-ps2", Title: "A", Platform: catalog.PS2, Points: pts}, day("2026-09-01"))
	if !ok {
		t.Fatal("Compute not ok")
	}
	if got.HeadlineCondition != classify.CIB {
		t.Errorf("headline = %q, want %q", got.HeadlineCondition, classify.CIB)
	}
	if got.PriceCents != 9800 {
		t.Errorf("price = %d, want the latest CIB 9800", got.PriceCents)
	}
}

func TestComputeFallsBackToLooseWhenNoCIB(t *testing.T) {
	t.Parallel()
	pts := series("2026-09-01", []int64{0, 0, 0, 0, 0, 0, 0, 0})
	for i := range pts {
		pts[i].CIB = nil
		pts[i].NC = 0
		pts[i].Loose = cents(4000 + int64(i)*100)
		pts[i].NL = 8
	}
	got, ok := trending.Compute(trending.Input{ID: "a-ps2", Title: "A", Platform: catalog.PS2, Points: pts}, day("2026-09-01"))
	if !ok {
		t.Fatal("Compute not ok")
	}
	if got.HeadlineCondition != classify.Loose {
		t.Errorf("headline = %q, want %q", got.HeadlineCondition, classify.Loose)
	}
}

func TestComputeScoreBlendsBothWindows(t *testing.T) {
	t.Parallel()
	// 31 daily points: 1000 for the first 24, then a step to 1100 for the last 7.
	vals := make([]int64, 31)
	for i := range vals {
		if i < 24 {
			vals[i] = 1000
		} else {
			vals[i] = 1100
		}
	}
	pts := series("2026-09-01", vals)
	got, ok := trending.Compute(trending.Input{ID: "a-ps2", Title: "A", Platform: catalog.PS2, Points: pts}, day("2026-09-01"))
	if !ok {
		t.Fatal("Compute not ok")
	}
	if got.Pct7d == nil || got.Pct30d == nil {
		t.Fatalf("want both windows populated, got 7d=%v 30d=%v", got.Pct7d, got.Pct30d)
	}
	want := 0.6*(*got.Pct7d) + 0.4*(*got.Pct30d)
	if math.Abs(got.Score-want) > 0.001 {
		t.Errorf("Score = %v, want %v (0.6*7d + 0.4*30d)", got.Score, want)
	}
}

func TestComputeUsesSevenDayOnlyWhenMonthMissing(t *testing.T) {
	t.Parallel()
	pts := series("2026-09-01", []int64{1000, 1000, 1000, 1000, 1000, 1000, 1000, 1100})
	got, ok := trending.Compute(trending.Input{ID: "a-ps2", Title: "A", Platform: catalog.PS2, Points: pts}, day("2026-09-01"))
	if !ok {
		t.Fatal("Compute not ok")
	}
	if got.Pct30d != nil {
		t.Errorf("Pct30d = %v, want nil with only 8 days of history", got.Pct30d)
	}
	if math.Abs(got.Score-*got.Pct7d) > 0.001 {
		t.Errorf("Score = %v, want the 7d change %v", got.Score, *got.Pct7d)
	}
}

func TestComputeRejectsCheapGames(t *testing.T) {
	t.Parallel()
	pts := series("2026-09-01", []int64{300, 300, 300, 300, 300, 300, 300, 900})
	if _, ok := trending.Compute(trending.Input{ID: "a-ps2", Title: "A", Platform: catalog.PS2, Points: pts}, day("2026-09-01")); ok {
		t.Error("Compute ok for a sub-$10 game, want gated out (small moves look like huge percentages)")
	}
}

func TestComputeRejectsThinLiquidity(t *testing.T) {
	t.Parallel()
	pts := series("2026-09-01", []int64{9000, 9000, 9000, 9000, 9000, 9000, 9000, 9800})
	for i := range pts {
		pts[i].NC = 2
	}
	if _, ok := trending.Compute(trending.Input{ID: "a-ps2", Title: "A", Platform: catalog.PS2, Points: pts}, day("2026-09-01")); ok {
		t.Error("Compute ok with only 2 listings behind the price, want gated out")
	}
}

func TestComputeRejectsASinglePoint(t *testing.T) {
	t.Parallel()
	pts := series("2026-09-01", []int64{9000})
	if _, ok := trending.Compute(trending.Input{ID: "a-ps2", Title: "A", Platform: catalog.PS2, Points: pts}, day("2026-09-01")); ok {
		t.Error("Compute ok with one day of history and nothing to compare, want gated out")
	}
}

func TestComputeRanksByDayChangeBeforeAWeekExists(t *testing.T) {
	t.Parallel()
	pts := series("2026-09-01", []int64{9000, 9900})
	got, ok := trending.Compute(trending.Input{ID: "a-ps2", Title: "A", Platform: catalog.PS2, Points: pts}, day("2026-09-01"))
	if !ok {
		t.Fatal("Compute not ok with two days of history, want ranked by the one-day change")
	}
	if got.Pct7d != nil {
		t.Errorf("Pct7d = %v, want nil with two days of history", *got.Pct7d)
	}
	if got.Pct1d == nil || *got.Pct1d < 9.9 || *got.Pct1d > 10.1 {
		t.Fatalf("Pct1d = %v, want ~10", got.Pct1d)
	}
	if got.Score != *got.Pct1d {
		t.Errorf("Score = %v, want the one-day change %v while no week exists", got.Score, *got.Pct1d)
	}
}

func TestDayChangeUsesRawConsecutivePoints(t *testing.T) {
	t.Parallel()
	pct, ok := trending.DayChange([]trending.Sample{
		{Date: "2026-08-30", Val: 5000},
		{Date: "2026-08-31", Val: 8000},
		{Date: "2026-09-01", Val: 8800},
	}, trending.DayToleranceDays)
	if !ok || pct < 9.9 || pct > 10.1 {
		t.Errorf("DayChange = %v, %v; want ~10 from the raw previous point, not a smoothed one", pct, ok)
	}
}

func TestDayChangeRejectsStalePreviousPoint(t *testing.T) {
	t.Parallel()
	cases := map[string][]trending.Sample{
		"gap wider than tolerance": {{Date: "2026-08-20", Val: 5000}, {Date: "2026-09-01", Val: 8000}},
		"same date":                {{Date: "2026-09-01", Val: 5000}, {Date: "2026-09-01", Val: 8000}},
		"zero baseline":            {{Date: "2026-08-31", Val: 0}, {Date: "2026-09-01", Val: 8000}},
		"single point":             {{Date: "2026-09-01", Val: 8000}},
	}
	for name, in := range cases {
		if _, ok := trending.DayChange(in, trending.DayToleranceDays); ok {
			t.Errorf("%s: DayChange ok, want not ok", name)
		}
	}
}

func TestRankKeepsTodaysMoversBesideTheWeeksLeaders(t *testing.T) {
	t.Parallel()
	up := 40.0
	in := []trending.Entry{
		{ID: "a", Score: 30},
		{ID: "b", Score: 12},
		{ID: "c", Score: 5, Pct1d: &up},
		{ID: "d", Score: 1},
	}
	got := trending.Rank(in, 2)
	ids := make([]string, len(got))
	for i, e := range got {
		ids[i] = e.ID
	}
	if len(ids) != 3 || ids[0] != "a" || ids[1] != "b" || ids[2] != "c" {
		t.Errorf("Rank = %v, want a,b by score plus c for today's jump", ids)
	}
}

func TestComputeSparkIsBounded(t *testing.T) {
	t.Parallel()
	vals := make([]int64, 120)
	for i := range vals {
		vals[i] = 9000 + int64(i)
	}
	got, ok := trending.Compute(trending.Input{ID: "a-ps2", Title: "A", Platform: catalog.PS2, Points: series("2026-09-01", vals)}, day("2026-09-01"))
	if !ok {
		t.Fatal("Compute not ok")
	}
	if len(got.Spark) != trending.SparkPoints {
		t.Errorf("spark length = %d, want %d", len(got.Spark), trending.SparkPoints)
	}
}

func TestRankSortsByScoreAndTruncates(t *testing.T) {
	t.Parallel()
	in := []trending.Entry{
		{ID: "a", Score: 5},
		{ID: "b", Score: 30},
		{ID: "c", Score: 12},
	}
	got := trending.Rank(in, 2)
	if len(got) != 2 {
		t.Fatalf("Rank returned %d entries, want 2", len(got))
	}
	if got[0].ID != "b" || got[1].ID != "c" {
		t.Errorf("Rank = %q,%q want b,c", got[0].ID, got[1].ID)
	}
}

func TestRankIsStableForEqualScores(t *testing.T) {
	t.Parallel()
	in := []trending.Entry{{ID: "b", Score: 5}, {ID: "a", Score: 5}}
	got := trending.Rank(in, 10)
	if got[0].ID != "a" {
		t.Errorf("ties must break on id for reproducible output, got %q first", got[0].ID)
	}
}
