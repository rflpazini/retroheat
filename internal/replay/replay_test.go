package replay_test

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/rflpazini/retroheat/internal/budget"
	"github.com/rflpazini/retroheat/internal/catalog"
	"github.com/rflpazini/retroheat/internal/history"
	"github.com/rflpazini/retroheat/internal/pipeline"
	"github.com/rflpazini/retroheat/internal/provider"
	"github.com/rflpazini/retroheat/internal/provider/ebay"
	"github.com/rflpazini/retroheat/internal/rawarchive"
	"github.com/rflpazini/retroheat/internal/replay"
)

const ps2YAML = `platform: ps2
games:
  - id: silent-hill-2-ps2
    title: "Silent Hill 2"
    ebay: {query: "Silent Hill 2 PS2"}
  - id: god-hand-ps2
    title: "God Hand"
    ebay: {query: "God Hand PS2"}
`

var runDay = time.Date(2026, 9, 1, 9, 23, 41, 0, time.UTC)

func setup(t *testing.T) (dataDir, catalogDir, rawDir string) {
	t.Helper()
	catalogDir = t.TempDir()
	if err := os.WriteFile(filepath.Join(catalogDir, "ps2.yaml"), []byte(ps2YAML), 0o600); err != nil {
		t.Fatal(err)
	}
	return t.TempDir(), catalogDir, t.TempDir()
}

// live mimics the eBay client over synthetic titles: it exposes its listings
// and judges them with the real eBay rules.
type live struct{}

func (live) Name() string     { return ebay.Name }
func (live) Kind() string     { return provider.KindAsking }
func (live) CostPerGame() int { return 1 }
func (live) Listings(_ context.Context, g catalog.Game) (provider.Sample, error) {
	return provider.Sample{Query: g.Ebay.Query, Listings: goodListings(g)}, nil
}
func (live) QuotesFromListings(g catalog.Game, ls []provider.Listing) ([]provider.Quote, error) {
	return ebay.QuotesFromListings(g, ls)
}
func (p live) Quotes(ctx context.Context, g catalog.Game) ([]provider.Quote, error) {
	s, err := p.Listings(ctx, g)
	if err != nil {
		return nil, err
	}
	return ebay.QuotesFromListings(g, s.Listings)
}

func goodListings(g catalog.Game) []provider.Listing {
	var out []provider.Listing
	for i := range 5 {
		out = append(out,
			provider.Listing{ItemID: fmt.Sprintf("c%d", i), Title: g.Title + " PS2 Complete CIB", PriceCents: 9000 + int64(i)*200, Currency: "USD"},
			provider.Listing{ItemID: fmt.Sprintf("l%d", i), Title: g.Title + " (PlayStation 2) Disc Only", PriceCents: 4000 + int64(i)*200, Currency: "USD"},
		)
	}
	return out
}

func junkListings(g catalog.Game) []provider.Listing {
	var out []provider.Listing
	for i := range 5 {
		out = append(out, provider.Listing{ItemID: fmt.Sprintf("j%d", i), Title: "Lot of 10 PS2 games " + g.Title, PriceCents: 5000, Currency: "USD"})
	}
	return out
}

func liveRun(t *testing.T, dataDir, catalogDir, rawDir string, now time.Time) {
	t.Helper()
	_, err := pipeline.Run(context.Background(), pipeline.Options{
		DataDir: dataDir, CatalogDir: catalogDir, Provider: live{}, Budget: budget.New(0), Now: now, RawDir: rawDir,
	})
	if err != nil {
		t.Fatal(err)
	}
}

func historyBytes(t *testing.T, dataDir string) map[string]string {
	t.Helper()
	out := map[string]string{}
	entries, err := os.ReadDir(filepath.Join(dataDir, "history"))
	if err != nil {
		t.Fatal(err)
	}
	for _, e := range entries {
		body, err := os.ReadFile(filepath.Join(dataDir, "history", e.Name()))
		if err != nil {
			t.Fatal(err)
		}
		out[e.Name()] = string(body)
	}
	return out
}

func writeArchive(t *testing.T, rawDir string, at time.Time, games map[string][]provider.Listing) {
	t.Helper()
	run := &rawarchive.Run{Schema: rawarchive.Schema, GeneratedAt: at.Format(time.RFC3339), Source: ebay.Name, SeriesVersion: 1}
	for id, ls := range games {
		run.Record(id, id, ls, nil)
	}
	if err := rawarchive.Write(filepath.Join(rawDir, rawarchive.FileName(at)), run); err != nil {
		t.Fatal(err)
	}
}

// The whole point: after deleting the history, a replay of the archive must
// rebuild it byte for byte, or archives would not be a backup.
func TestReplayReproducesTheLiveRunByteForByte(t *testing.T) {
	t.Parallel()
	dataDir, catalogDir, rawDir := setup(t)
	liveRun(t, dataDir, catalogDir, rawDir, runDay)
	liveRun(t, dataDir, catalogDir, rawDir, runDay.AddDate(0, 0, 1))
	want := historyBytes(t, dataDir)

	if err := os.RemoveAll(filepath.Join(dataDir, "history")); err != nil {
		t.Fatal(err)
	}
	sum, err := replay.Run(replay.Options{ArchiveDir: rawDir, DataDir: dataDir, CatalogDir: catalogDir, Now: runDay.AddDate(0, 0, 1)})
	if err != nil {
		t.Fatal(err)
	}
	if sum.Runs != 2 || sum.Games != 2 || sum.Added != 4 || sum.Replaced != 0 || sum.Removed != 0 {
		t.Errorf("summary = %+v, want 2 runs rebuilding 2 files with 4 new points", sum)
	}
	got := historyBytes(t, dataDir)
	for name, body := range want {
		if got[name] != body {
			t.Errorf("%s differs after replay:\nlive:\n%s\nreplayed:\n%s", name, body, got[name])
		}
	}
}

func TestReplayWithUnchangedRulesIsANoOp(t *testing.T) {
	t.Parallel()
	dataDir, catalogDir, rawDir := setup(t)
	liveRun(t, dataDir, catalogDir, rawDir, runDay)
	want := historyBytes(t, dataDir)

	sum, err := replay.Run(replay.Options{ArchiveDir: rawDir, DataDir: dataDir, CatalogDir: catalogDir, Now: runDay})
	if err != nil {
		t.Fatal(err)
	}
	if sum.Games != 0 || sum.Replaced != 0 || sum.Added != 0 || sum.Removed != 0 {
		t.Errorf("summary = %+v, want nothing to change", sum)
	}
	got := historyBytes(t, dataDir)
	for name, body := range want {
		if got[name] != body {
			t.Errorf("%s changed under unchanged rules", name)
		}
	}
}

func TestDryRunWritesNothing(t *testing.T) {
	t.Parallel()
	dataDir, catalogDir, rawDir := setup(t)
	liveRun(t, dataDir, catalogDir, rawDir, runDay)
	if err := os.RemoveAll(filepath.Join(dataDir, "history")); err != nil {
		t.Fatal(err)
	}
	sum, err := replay.Run(replay.Options{ArchiveDir: rawDir, DataDir: dataDir, CatalogDir: catalogDir, Now: runDay, DryRun: true})
	if err != nil {
		t.Fatal(err)
	}
	if sum.Added != 2 {
		t.Errorf("Added = %d, want the dry run to count what it would add", sum.Added)
	}
	if _, err := os.Stat(filepath.Join(dataDir, "history")); !errors.Is(err, os.ErrNotExist) {
		t.Error("a dry run wrote history files")
	}
}

// The archive does not cover every run: archiving started after some points
// were written, and a run can fail to upload. A day the archive cannot price
// therefore stands by default and is only counted; removing it is a deliberate
// choice made with -prune.
func TestReplayKeepsADateTheArchiveCannotPriceUnlessPruning(t *testing.T) {
	t.Parallel()
	dataDir, catalogDir, rawDir := setup(t)
	liveRun(t, dataDir, catalogDir, rawDir, runDay)
	// Re-archive the same day as if the market had only offered lots.
	os.RemoveAll(rawDir)
	rawDir = t.TempDir()
	g := catalog.Game{ID: "god-hand-ps2", Title: "God Hand"}
	writeArchive(t, rawDir, runDay, map[string][]provider.Listing{"god-hand-ps2": junkListings(g)})

	sum, err := replay.Run(replay.Options{ArchiveDir: rawDir, DataDir: dataDir, CatalogDir: catalogDir, Now: runDay})
	if err != nil {
		t.Fatal(err)
	}
	if sum.Removed != 0 || sum.Unpriceable != 1 || sum.Games != 0 {
		t.Errorf("summary = %+v, want the day kept and counted as unpriceable", sum)
	}
	hf, err := history.Read(filepath.Join(dataDir, "history"), "god-hand-ps2")
	if err != nil {
		t.Fatal(err)
	}
	if len(hf.Points) != 1 {
		t.Fatalf("points = %+v, want the live point still standing", hf.Points)
	}

	sum, err = replay.Run(replay.Options{ArchiveDir: rawDir, DataDir: dataDir, CatalogDir: catalogDir, Now: runDay, Prune: true})
	if err != nil {
		t.Fatal(err)
	}
	if sum.Removed != 1 || sum.Games != 1 {
		t.Errorf("summary with Prune = %+v, want one point removed from one file", sum)
	}
	hf, _ = history.Read(filepath.Join(dataDir, "history"), "god-hand-ps2")
	if len(hf.Points) != 0 {
		t.Errorf("points = %+v, want the unpriceable day gone when pruning", hf.Points)
	}
}

// Replaying days that were already folded into a weekly point restores them
// at daily resolution and folds them again, so the Monday date the data guard
// watches for is still there afterwards.
func TestReplayIntoACompactedWeekKeepsTheMondayDate(t *testing.T) {
	t.Parallel()
	dataDir, catalogDir, rawDir := setup(t)
	old := int64(1)
	weekly := &history.File{ID: "silent-hill-2-ps2", Points: []history.Point{
		{Date: "2026-01-05", Res: history.ResWeekly, CIB: &old, NC: 5, V: 1},
	}}
	if err := history.Write(filepath.Join(dataDir, "history"), weekly); err != nil {
		t.Fatal(err)
	}
	g := catalog.Game{ID: "silent-hill-2-ps2", Title: "Silent Hill 2"}
	for i := range 7 {
		at := time.Date(2026, 1, 5+i, 9, 0, 0, 0, time.UTC)
		writeArchive(t, rawDir, at, map[string][]provider.Listing{"silent-hill-2-ps2": goodListings(g)})
	}

	sum, err := replay.Run(replay.Options{ArchiveDir: rawDir, DataDir: dataDir, CatalogDir: catalogDir, Now: time.Date(2026, 9, 1, 0, 0, 0, 0, time.UTC)})
	if err != nil {
		t.Fatal(err)
	}
	if sum.Replaced != 1 || sum.Added != 6 || sum.Removed != 0 {
		t.Errorf("summary = %+v, want the Monday replaced and six days added", sum)
	}
	hf, err := history.Read(filepath.Join(dataDir, "history"), "silent-hill-2-ps2")
	if err != nil {
		t.Fatal(err)
	}
	if len(hf.Points) != 1 || hf.Points[0].Date != "2026-01-05" || hf.Points[0].Res != history.ResWeekly {
		t.Fatalf("points = %+v, want a single weekly point on the Monday", hf.Points)
	}
	if hf.Points[0].CIB == nil || *hf.Points[0].CIB != 9400 {
		t.Errorf("weekly cib = %v, want the replayed median 9400", hf.Points[0].CIB)
	}
}

func TestReplayHonoursTheDateBounds(t *testing.T) {
	t.Parallel()
	dataDir, catalogDir, rawDir := setup(t)
	liveRun(t, dataDir, catalogDir, rawDir, runDay)
	liveRun(t, dataDir, catalogDir, rawDir, runDay.AddDate(0, 0, 1))
	if err := os.RemoveAll(filepath.Join(dataDir, "history")); err != nil {
		t.Fatal(err)
	}
	sum, err := replay.Run(replay.Options{ArchiveDir: rawDir, DataDir: dataDir, CatalogDir: catalogDir, Now: runDay.AddDate(0, 0, 1), From: "2026-09-02", To: "2026-09-02"})
	if err != nil {
		t.Fatal(err)
	}
	if sum.Runs != 1 || sum.Added != 2 {
		t.Errorf("summary = %+v, want only the second day replayed", sum)
	}
}

// Two runs on one day: the first prices the game, the second sees only junk.
// Live, the second run would have failed the game and kept the morning's
// point, so a replay must keep it too rather than erase the day.
func TestALaterRunWithNothingPublishableDoesNotEraseTheEarlierOne(t *testing.T) {
	t.Parallel()
	dataDir, catalogDir, rawDir := setup(t)
	g := catalog.Game{ID: "god-hand-ps2", Title: "God Hand"}
	morning := time.Date(2026, 9, 1, 9, 0, 0, 0, time.UTC)
	writeArchive(t, rawDir, morning, map[string][]provider.Listing{"god-hand-ps2": goodListings(g)})
	writeArchive(t, rawDir, morning.Add(12*time.Hour), map[string][]provider.Listing{"god-hand-ps2": junkListings(g)})

	sum, err := replay.Run(replay.Options{ArchiveDir: rawDir, DataDir: dataDir, CatalogDir: catalogDir, Now: morning})
	if err != nil {
		t.Fatal(err)
	}
	if sum.Removed != 0 || sum.Added != 1 {
		t.Errorf("summary = %+v, want the morning point added and nothing removed", sum)
	}
	hf, err := history.Read(filepath.Join(dataDir, "history"), "god-hand-ps2")
	if err != nil {
		t.Fatal(err)
	}
	if len(hf.Points) != 1 || hf.Points[0].CIB == nil || *hf.Points[0].CIB != 9400 {
		t.Errorf("points = %+v, want the morning's cib 9400 kept", hf.Points)
	}
}
