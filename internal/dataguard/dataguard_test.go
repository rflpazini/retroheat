package dataguard_test

import (
	"path/filepath"
	"strings"
	"testing"

	"github.com/rflpazini/retroheat/internal/catalog"
	"github.com/rflpazini/retroheat/internal/dataguard"
	"github.com/rflpazini/retroheat/internal/history"
	"github.com/rflpazini/retroheat/internal/snapshot"
)

func cents(v int64) *int64 { return &v }

func daily(date string, loose int64) history.Point {
	return history.Point{Date: date, Res: history.ResDaily, Loose: cents(loose), NL: 5, V: 1}
}

func writeHistory(t *testing.T, dir, id string, points ...history.Point) {
	t.Helper()
	f := &history.File{ID: id, Points: points}
	if err := history.Write(filepath.Join(dir, "history"), f); err != nil {
		t.Fatal(err)
	}
}

func writeBoard(t *testing.T, dir string, ids ...string) {
	t.Helper()
	l := snapshot.Latest{Platform: catalog.PS2, AsOf: "2026-09-07"}
	for _, id := range ids {
		l.Games = append(l.Games, snapshot.LatestGame{ID: id, Title: id})
	}
	if err := snapshot.WriteLatest(dir, l); err != nil {
		t.Fatal(err)
	}
}

func writeCatalog(t *testing.T, dir string, ids ...string) {
	t.Helper()
	c := snapshot.Catalog{AsOf: "2026-09-07"}
	for _, id := range ids {
		c.Games = append(c.Games, snapshot.CatalogGame{ID: id, Title: id, Platform: catalog.PS2})
	}
	if err := snapshot.WriteCatalog(dir, c); err != nil {
		t.Fatal(err)
	}
}

func compare(t *testing.T, before, after string) dataguard.Report {
	t.Helper()
	rep, err := dataguard.Compare(before, after)
	if err != nil {
		t.Fatal(err)
	}
	return rep
}

func wantViolation(t *testing.T, rep dataguard.Report, substr string) {
	t.Helper()
	for _, v := range rep.Violations {
		if strings.Contains(v.String(), substr) {
			return
		}
	}
	t.Errorf("no violation mentioning %q; got %v", substr, rep.Violations)
}

func TestDeletedHistoryFileIsAViolation(t *testing.T) {
	t.Parallel()
	before, after := t.TempDir(), t.TempDir()
	writeHistory(t, before, "bully-ps2", daily("2026-09-01", 1000))
	writeHistory(t, before, "okami-ps2", daily("2026-09-01", 1000))
	writeHistory(t, after, "okami-ps2", daily("2026-09-01", 1000))

	rep := compare(t, before, after)
	if len(rep.Violations) != 1 {
		t.Fatalf("violations = %v, want exactly the deleted file", rep.Violations)
	}
	wantViolation(t, rep, "history/bully-ps2.json: history file deleted")
}

func TestRemovedDailyPointIsAViolation(t *testing.T) {
	t.Parallel()
	before, after := t.TempDir(), t.TempDir()
	writeHistory(t, before, "bully-ps2", daily("2026-09-01", 1000), daily("2026-09-02", 1100))
	writeHistory(t, after, "bully-ps2", daily("2026-09-02", 1100))

	rep := compare(t, before, after)
	wantViolation(t, rep, "point 2026-09-01 (d) removed")
}

// The 90-day rollup replaces seven dailies with one weekly point on the ISO
// Monday. That is compaction, not loss, and must pass.
func TestRollupIntoAWeeklyPointIsAllowed(t *testing.T) {
	t.Parallel()
	before, after := t.TempDir(), t.TempDir()
	writeHistory(t, before, "bully-ps2",
		daily("2026-01-05", 1000), daily("2026-01-06", 1100), daily("2026-01-07", 1200), daily("2026-09-01", 1300))
	writeHistory(t, after, "bully-ps2",
		history.Point{Date: "2026-01-05", Res: history.ResWeekly, Loose: cents(1100), NL: 5, V: 1}, daily("2026-09-01", 1300))

	rep := compare(t, before, after)
	if !rep.OK() {
		t.Errorf("a rollup was reported as loss: %v", rep.Violations)
	}
}

func TestRemovedWeeklyPointIsAViolation(t *testing.T) {
	t.Parallel()
	before, after := t.TempDir(), t.TempDir()
	weekly := history.Point{Date: "2026-01-05", Res: history.ResWeekly, Loose: cents(1100), NL: 5, V: 1}
	writeHistory(t, before, "bully-ps2", weekly, daily("2026-09-01", 1300))
	writeHistory(t, after, "bully-ps2", daily("2026-09-01", 1300))

	rep := compare(t, before, after)
	wantViolation(t, rep, "point 2026-01-05 (w) removed")
}

// Twice-daily runs rewrite the day's point, and a replay rewrites older ones.
// Same date with different values is the normal shape of an update.
func TestSameDateChangedValuesAreAllowedAndCounted(t *testing.T) {
	t.Parallel()
	before, after := t.TempDir(), t.TempDir()
	writeHistory(t, before, "bully-ps2", daily("2026-09-01", 1000), daily("2026-09-02", 1100))
	writeHistory(t, after, "bully-ps2", daily("2026-09-01", 1000), daily("2026-09-02", 1250))

	rep := compare(t, before, after)
	if !rep.OK() {
		t.Errorf("a same-day replacement was reported as loss: %v", rep.Violations)
	}
	if rep.Replaced != 1 {
		t.Errorf("Replaced = %d, want 1", rep.Replaced)
	}
}

func TestAddedPointsAndFilesAreAllowed(t *testing.T) {
	t.Parallel()
	before, after := t.TempDir(), t.TempDir()
	writeHistory(t, before, "bully-ps2", daily("2026-09-01", 1000))
	writeHistory(t, after, "bully-ps2", daily("2026-09-01", 1000), daily("2026-09-02", 1100))
	writeHistory(t, after, "okami-ps2", daily("2026-09-02", 1100))

	rep := compare(t, before, after)
	if !rep.OK() {
		t.Errorf("growth was reported as loss: %v", rep.Violations)
	}
	if rep.Added != 1 {
		t.Errorf("Added = %d, want 1 new point in an existing file", rep.Added)
	}
}

func TestTrackedGameDroppedFromTheBoardIsAViolation(t *testing.T) {
	t.Parallel()
	before, after := t.TempDir(), t.TempDir()
	writeBoard(t, before, "bully-ps2", "okami-ps2")
	writeBoard(t, after, "okami-ps2")
	writeCatalog(t, after, "bully-ps2", "okami-ps2")

	rep := compare(t, before, after)
	wantViolation(t, rep, "latest/ps2.json: tracked game bully-ps2 dropped from the board")
}

func TestAGameRemovedFromTheCatalogMayLeaveTheBoard(t *testing.T) {
	t.Parallel()
	before, after := t.TempDir(), t.TempDir()
	writeBoard(t, before, "bully-ps2", "okami-ps2")
	writeBoard(t, after, "okami-ps2")
	writeCatalog(t, after, "okami-ps2")

	rep := compare(t, before, after)
	if !rep.OK() {
		t.Errorf("a deliberate catalog removal was reported as loss: %v", rep.Violations)
	}
}

func TestDeletedBoardIsAViolation(t *testing.T) {
	t.Parallel()
	before, after := t.TempDir(), t.TempDir()
	writeBoard(t, before, "bully-ps2")
	writeCatalog(t, after, "bully-ps2")

	rep := compare(t, before, after)
	wantViolation(t, rep, "latest/ps2.json: board deleted")
}

func TestAnEmptyBeforeHasNothingToLose(t *testing.T) {
	t.Parallel()
	before, after := t.TempDir(), t.TempDir()
	writeHistory(t, after, "bully-ps2", daily("2026-09-01", 1000))
	writeBoard(t, after, "bully-ps2")

	rep := compare(t, before, after)
	if !rep.OK() {
		t.Errorf("the first collection was reported as loss: %v", rep.Violations)
	}
}

func TestResetTrailerRequiresAReason(t *testing.T) {
	t.Parallel()
	cases := map[string]bool{
		"data: wipe\n\nData-Reset: classifier rewrite, see #12\n": true,
		"data: wipe\n\nData-Reset:\n":                             false,
		"data: wipe\n\nmentions Data-Reset: in the body\n":        false,
		"data: refresh 2026-09-07\n":                              false,
	}
	for msg, want := range cases {
		if got := dataguard.HasResetTrailer(msg); got != want {
			t.Errorf("HasResetTrailer(%q) = %v, want %v", msg, got, want)
		}
	}
}
