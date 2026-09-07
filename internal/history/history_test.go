package history_test

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/rflpazini/retroheat/internal/history"
)

func cents(v int64) *int64 { return &v }

func day(s string) time.Time {
	t, err := time.Parse(time.DateOnly, s)
	if err != nil {
		panic(err)
	}
	return t
}

func TestUpsertAppendsNewDate(t *testing.T) {
	t.Parallel()
	f := &history.File{ID: "god-hand-ps2"}
	history.Upsert(f, history.Point{Date: "2026-08-31", Res: "d", Loose: cents(1000)})
	history.Upsert(f, history.Point{Date: "2026-09-01", Res: "d", Loose: cents(1100)})

	if len(f.Points) != 2 {
		t.Fatalf("points = %d, want 2", len(f.Points))
	}
}

func TestUpsertReplacesSameDay(t *testing.T) {
	t.Parallel()
	f := &history.File{ID: "god-hand-ps2"}
	history.Upsert(f, history.Point{Date: "2026-09-01", Res: "d", Loose: cents(1000)})
	history.Upsert(f, history.Point{Date: "2026-09-01", Res: "d", Loose: cents(1234)})

	if len(f.Points) != 1 {
		t.Fatalf("points = %d, want 1 (a second run on the same day replaces, never appends)", len(f.Points))
	}
	if *f.Points[0].Loose != 1234 {
		t.Errorf("loose = %d, want the newer 1234", *f.Points[0].Loose)
	}
}

func TestUpsertKeepsPointsSortedByDate(t *testing.T) {
	t.Parallel()
	f := &history.File{ID: "god-hand-ps2"}
	history.Upsert(f, history.Point{Date: "2026-09-01", Res: "d"})
	history.Upsert(f, history.Point{Date: "2026-08-01", Res: "d"})
	history.Upsert(f, history.Point{Date: "2026-08-15", Res: "d"})

	want := []string{"2026-08-01", "2026-08-15", "2026-09-01"}
	for i, w := range want {
		if f.Points[i].Date != w {
			t.Fatalf("points[%d].Date = %q, want %q (order: %+v)", i, f.Points[i].Date, w, f.Points)
		}
	}
}

func TestRollupLeavesRecentDailiesAlone(t *testing.T) {
	t.Parallel()
	f := &history.File{ID: "god-hand-ps2"}
	for _, d := range []string{"2026-08-28", "2026-08-29", "2026-08-30", "2026-09-01"} {
		history.Upsert(f, history.Point{Date: d, Res: "d", Loose: cents(1000)})
	}
	history.Rollup(f, day("2026-09-01"), 90*24*time.Hour)

	if len(f.Points) != 4 {
		t.Fatalf("points = %d, want all 4 dailies kept inside the window", len(f.Points))
	}
	for _, p := range f.Points {
		if p.Res != "d" {
			t.Errorf("point %s has res %q, want daily", p.Date, p.Res)
		}
	}
}

func TestRollupCompactsOldWeekToMedian(t *testing.T) {
	t.Parallel()
	f := &history.File{ID: "god-hand-ps2"}
	// ISO week 2 of 2026: Mon 2026-01-05 .. Sun 2026-01-11.
	vals := []int64{1000, 1100, 1200, 1300, 1400, 1500, 1600}
	for i, d := range []string{"2026-01-05", "2026-01-06", "2026-01-07", "2026-01-08", "2026-01-09", "2026-01-10", "2026-01-11"} {
		history.Upsert(f, history.Point{Date: d, Res: "d", Loose: cents(vals[i]), NL: 10})
	}
	history.Rollup(f, day("2026-09-01"), 90*24*time.Hour)

	if len(f.Points) != 1 {
		t.Fatalf("points = %d, want a single weekly point: %+v", len(f.Points), f.Points)
	}
	got := f.Points[0]
	if got.Res != "w" {
		t.Errorf("res = %q, want %q", got.Res, "w")
	}
	if got.Date != "2026-01-05" {
		t.Errorf("date = %q, want the ISO week's Monday 2026-01-05", got.Date)
	}
	if got.Loose == nil || *got.Loose != 1300 {
		t.Errorf("loose = %v, want the week median 1300", got.Loose)
	}
}

func TestRollupSeparatesDistinctWeeks(t *testing.T) {
	t.Parallel()
	f := &history.File{ID: "god-hand-ps2"}
	for _, d := range []string{"2026-01-05", "2026-01-06", "2026-01-12", "2026-01-13"} {
		history.Upsert(f, history.Point{Date: d, Res: "d", Loose: cents(1000)})
	}
	history.Rollup(f, day("2026-09-01"), 90*24*time.Hour)

	if len(f.Points) != 2 {
		t.Fatalf("points = %d, want one per ISO week: %+v", len(f.Points), f.Points)
	}
	if f.Points[0].Date != "2026-01-05" || f.Points[1].Date != "2026-01-12" {
		t.Errorf("weekly dates = %q,%q want 2026-01-05,2026-01-12", f.Points[0].Date, f.Points[1].Date)
	}
}

func TestRollupIsIdempotent(t *testing.T) {
	t.Parallel()
	build := func() *history.File {
		f := &history.File{ID: "god-hand-ps2"}
		for _, d := range []string{"2026-01-05", "2026-01-06", "2026-01-07", "2026-08-30", "2026-09-01"} {
			history.Upsert(f, history.Point{Date: d, Res: "d", Loose: cents(1000), NL: 5})
		}
		return f
	}
	once, twice := build(), build()
	history.Rollup(once, day("2026-09-01"), 90*24*time.Hour)
	history.Rollup(twice, day("2026-09-01"), 90*24*time.Hour)
	history.Rollup(twice, day("2026-09-01"), 90*24*time.Hour)

	if len(once.Points) != len(twice.Points) {
		t.Fatalf("point count drifted: once=%d twice=%d", len(once.Points), len(twice.Points))
	}
	for i := range once.Points {
		if once.Points[i].Date != twice.Points[i].Date || once.Points[i].Res != twice.Points[i].Res {
			t.Fatalf("rollup not idempotent at %d: %+v vs %+v", i, once.Points[i], twice.Points[i])
		}
	}
}

func TestRollupIgnoresNilPrices(t *testing.T) {
	t.Parallel()
	f := &history.File{ID: "god-hand-ps2"}
	history.Upsert(f, history.Point{Date: "2026-01-05", Res: "d", Loose: cents(1000), New: nil})
	history.Upsert(f, history.Point{Date: "2026-01-06", Res: "d", Loose: nil, New: cents(5000)})
	history.Rollup(f, day("2026-09-01"), 90*24*time.Hour)

	if len(f.Points) != 1 {
		t.Fatalf("points = %d, want 1", len(f.Points))
	}
	p := f.Points[0]
	if p.Loose == nil || *p.Loose != 1000 {
		t.Errorf("loose = %v, want 1000 from the only non-nil value", p.Loose)
	}
	if p.New == nil || *p.New != 5000 {
		t.Errorf("new = %v, want 5000 from the only non-nil value", p.New)
	}
}

func TestReadMissingFileYieldsEmptyHistory(t *testing.T) {
	t.Parallel()
	f, err := history.Read(t.TempDir(), "never-seen-ps2")
	if err != nil {
		t.Fatalf("Read of a new game must not error: %v", err)
	}
	if f.ID != "never-seen-ps2" || len(f.Points) != 0 {
		t.Errorf("Read = %+v, want an empty history for the id", f)
	}
}

func TestWriteThenReadRoundTrips(t *testing.T) {
	t.Parallel()
	dir := t.TempDir()
	f := &history.File{ID: "god-hand-ps2"}
	history.Upsert(f, history.Point{Date: "2026-09-01", Res: "d", Loose: cents(4200), NL: 7})

	if err := history.Write(dir, f); err != nil {
		t.Fatal(err)
	}
	got, err := history.Read(dir, "god-hand-ps2")
	if err != nil {
		t.Fatal(err)
	}
	if len(got.Points) != 1 || *got.Points[0].Loose != 4200 || got.Points[0].NL != 7 {
		t.Errorf("round trip lost data: %+v", got.Points)
	}
}

func TestWriteIsByteStableAcrossRuns(t *testing.T) {
	t.Parallel()
	dir := t.TempDir()
	f := &history.File{ID: "god-hand-ps2"}
	history.Upsert(f, history.Point{Date: "2026-09-01", Res: "d", Loose: cents(4200), CIB: cents(9800)})

	if err := history.Write(dir, f); err != nil {
		t.Fatal(err)
	}
	first, err := os.ReadFile(filepath.Join(dir, "god-hand-ps2.json"))
	if err != nil {
		t.Fatal(err)
	}
	if err := history.Write(dir, f); err != nil {
		t.Fatal(err)
	}
	second, _ := os.ReadFile(filepath.Join(dir, "god-hand-ps2.json"))

	if string(first) != string(second) {
		t.Error("rewriting identical data produced different bytes; git would see a spurious diff every run")
	}
}

// The 90-day window does not sweep past a week all at once: it advances one
// day per day, so a week ages out over seven consecutive runs. The weekly
// point must survive that sweep unchanged, or every run commits a diff and the
// week ends up summarising whichever day happened to cross last.
func TestRollupSurvivesTheWindowSweepingAcrossAWeek(t *testing.T) {
	t.Parallel()
	f := &history.File{ID: "god-hand-ps2"}
	vals := []int64{1000, 1100, 1200, 1300, 1400, 1500, 1600}
	week := []string{"2026-01-05", "2026-01-06", "2026-01-07", "2026-01-08", "2026-01-09", "2026-01-10", "2026-01-11"}
	for i, d := range week {
		history.Upsert(f, history.Point{Date: d, Res: "d", Loose: cents(vals[i]), NL: 10})
	}

	// Walk the clock day by day across the whole sweep, as production does.
	// The 90-day cutoff reaches the Monday on 2026-04-05 and the Sunday on
	// 2026-04-11, so this range covers the week entering and fully clearing it.
	var seen []int64
	for step := range 14 {
		now := day("2026-04-04").AddDate(0, 0, step)
		history.Rollup(f, now, 90*24*time.Hour)
		for _, p := range f.Points {
			if p.Res == "w" && p.Loose != nil {
				seen = append(seen, *p.Loose)
			}
		}
	}

	if len(seen) == 0 {
		t.Fatal("the week never rolled up during the sweep; the test dates are wrong")
	}
	for i, v := range seen {
		if v != 1300 {
			t.Fatalf("weekly median was %d at sweep step %d; want the true week median 1300 at every step (sequence: %v)", v, i, seen)
		}
	}
}

// Files written before points carried a version must not change bytes when
// they are rewritten, or the first run after the field appears would commit a
// diff across every history file.
func TestWriteOmitsZeroVersionSoLegacyFilesDoNotChurn(t *testing.T) {
	t.Parallel()
	dir := t.TempDir()
	f := &history.File{ID: "god-hand-ps2"}
	history.Upsert(f, history.Point{Date: "2026-09-01", Res: "d", Loose: cents(4200), NL: 7})
	if err := history.Write(dir, f); err != nil {
		t.Fatal(err)
	}
	body, err := os.ReadFile(filepath.Join(dir, "god-hand-ps2.json"))
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(body), `"v"`) {
		t.Errorf("an unversioned point serialized a v field:\n%s", body)
	}
}

func TestVersionRoundTrips(t *testing.T) {
	t.Parallel()
	dir := t.TempDir()
	f := &history.File{ID: "god-hand-ps2"}
	history.Upsert(f, history.Point{Date: "2026-09-01", Res: "d", Loose: cents(4200), NL: 7, V: 2})
	if err := history.Write(dir, f); err != nil {
		t.Fatal(err)
	}
	got, err := history.Read(dir, "god-hand-ps2")
	if err != nil {
		t.Fatal(err)
	}
	if got.Points[0].V != 2 {
		t.Errorf("v = %d after a round trip, want 2", got.Points[0].V)
	}
}

// A week in which the classifier changed holds two different series. Folding
// it into one median would blend them, so it stays at daily resolution, and
// because the set of versions in a past week never changes, doing so is
// stable across runs.
func TestRollupNeverCompactsAWeekSpanningTwoVersions(t *testing.T) {
	t.Parallel()
	build := func() *history.File {
		f := &history.File{ID: "god-hand-ps2"}
		for i, d := range []string{"2026-01-05", "2026-01-06", "2026-01-07", "2026-01-08", "2026-01-09", "2026-01-10", "2026-01-11"} {
			v := 0
			if i >= 3 {
				v = 1
			}
			history.Upsert(f, history.Point{Date: d, Res: "d", Loose: cents(1000), NL: 5, V: v})
		}
		return f
	}
	once, twice := build(), build()
	history.Rollup(once, day("2026-09-01"), 90*24*time.Hour)
	history.Rollup(twice, day("2026-09-01"), 90*24*time.Hour)
	history.Rollup(twice, day("2026-09-01"), 90*24*time.Hour)

	if len(once.Points) != 7 {
		t.Fatalf("points = %d, want all 7 dailies kept across the version boundary: %+v", len(once.Points), once.Points)
	}
	for _, p := range once.Points {
		if p.Res != "d" {
			t.Errorf("point %s was compacted to %q inside a mixed-version week", p.Date, p.Res)
		}
	}
	if len(twice.Points) != len(once.Points) {
		t.Fatalf("a second rollup changed the point count: %d then %d", len(once.Points), len(twice.Points))
	}
	for i := range once.Points {
		a, b := once.Points[i], twice.Points[i]
		if a.Date != b.Date || a.Res != b.Res || a.V != b.V || *a.Loose != *b.Loose {
			t.Fatalf("rollup not idempotent at %d: %+v vs %+v", i, a, b)
		}
	}
}

func TestRollupWeeklyPointCarriesTheWeeksVersion(t *testing.T) {
	t.Parallel()
	f := &history.File{ID: "god-hand-ps2"}
	for _, d := range []string{"2026-01-05", "2026-01-06", "2026-01-07"} {
		history.Upsert(f, history.Point{Date: d, Res: "d", Loose: cents(1000), NL: 5, V: 3})
	}
	history.Rollup(f, day("2026-09-01"), 90*24*time.Hour)

	if len(f.Points) != 1 || f.Points[0].Res != "w" {
		t.Fatalf("points = %+v, want one weekly point", f.Points)
	}
	if f.Points[0].V != 3 {
		t.Errorf("weekly v = %d, want the dailies' version 3", f.Points[0].V)
	}
}

func TestRollupKeepsDateOrderWithAMixedWeekBetweenFoldedWeeks(t *testing.T) {
	t.Parallel()
	f := &history.File{ID: "god-hand-ps2"}
	history.Upsert(f, history.Point{Date: "2026-01-05", Res: "d", Loose: cents(1000), V: 1})
	history.Upsert(f, history.Point{Date: "2026-01-06", Res: "d", Loose: cents(1000), V: 1})
	history.Upsert(f, history.Point{Date: "2026-01-12", Res: "d", Loose: cents(1000), V: 1})
	history.Upsert(f, history.Point{Date: "2026-01-13", Res: "d", Loose: cents(1000), V: 2})
	history.Upsert(f, history.Point{Date: "2026-01-19", Res: "d", Loose: cents(1000), V: 2})
	history.Upsert(f, history.Point{Date: "2026-01-20", Res: "d", Loose: cents(1000), V: 2})
	history.Rollup(f, day("2026-09-01"), 90*24*time.Hour)

	want := []string{"2026-01-05 w", "2026-01-12 d", "2026-01-13 d", "2026-01-19 w"}
	if len(f.Points) != len(want) {
		t.Fatalf("points = %+v, want %v", f.Points, want)
	}
	for i, p := range f.Points {
		if got := p.Date + " " + p.Res; got != want[i] {
			t.Errorf("points[%d] = %q, want %q", i, got, want[i])
		}
	}
}

func TestRemoveDropsTheDate(t *testing.T) {
	t.Parallel()
	f := &history.File{ID: "god-hand-ps2"}
	history.Upsert(f, history.Point{Date: "2026-09-01", Res: "d", Loose: cents(1000)})
	history.Upsert(f, history.Point{Date: "2026-09-02", Res: "d", Loose: cents(1100)})

	if !history.Remove(f, "2026-09-01") {
		t.Fatal("Remove reported no point for a date that exists")
	}
	if len(f.Points) != 1 || f.Points[0].Date != "2026-09-02" {
		t.Errorf("points = %+v, want only 2026-09-02", f.Points)
	}
	if history.Remove(f, "2026-09-01") {
		t.Error("Remove reported a point for a date already removed")
	}
}

func TestRemoveWeeklyDropsTheCoveringWeekOnly(t *testing.T) {
	t.Parallel()
	f := &history.File{ID: "god-hand-ps2"}
	history.Upsert(f, history.Point{Date: "2026-01-05", Res: "w", Loose: cents(1000)})
	history.Upsert(f, history.Point{Date: "2026-01-12", Res: "w", Loose: cents(1000)})
	history.Upsert(f, history.Point{Date: "2026-09-01", Res: "d", Loose: cents(1000)})

	if !history.RemoveWeekly(f, "2026-01-08") {
		t.Fatal("RemoveWeekly did not find the week of 2026-01-08")
	}
	if len(f.Points) != 2 || f.Points[0].Date != "2026-01-12" {
		t.Errorf("points = %+v, want the other week and the daily kept", f.Points)
	}
	if history.RemoveWeekly(f, "2026-09-01") {
		t.Error("RemoveWeekly removed something for a week that only has a daily point")
	}
}

func TestEqualComparesValuesNotPointers(t *testing.T) {
	t.Parallel()
	a := history.Point{Date: "2026-09-01", Res: "d", Loose: cents(1000), NL: 5, V: 1}
	b := history.Point{Date: "2026-09-01", Res: "d", Loose: cents(1000), NL: 5, V: 1}
	if !a.Equal(b) {
		t.Error("equal values with different pointers reported unequal")
	}
	b.V = 2
	if a.Equal(b) {
		t.Error("a different version reported equal")
	}
	b.V, b.Loose = 1, nil
	if a.Equal(b) {
		t.Error("a nil price reported equal to a value")
	}
}
