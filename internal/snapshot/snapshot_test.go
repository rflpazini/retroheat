package snapshot_test

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/rflpazini/retroheat/internal/catalog"
	"github.com/rflpazini/retroheat/internal/snapshot"
	"github.com/rflpazini/retroheat/internal/trending"
)

func pct(v float64) *float64 { return &v }

func sampleLatest() snapshot.Latest {
	return snapshot.Latest{
		Platform:  catalog.PS2,
		AsOf:      "2026-09-01",
		Source:    "ebay-browse",
		PriceKind: "asking",
		Games: []snapshot.LatestGame{{
			ID:     "silent-hill-2-ps2",
			Title:  "Silent Hill 2",
			Region: catalog.RegionNTSCU,
			Prices: snapshot.Prices{
				Loose: &snapshot.Price{MedianCents: 4500, N: 12},
				CIB:   &snapshot.Price{MedianCents: 9800, N: 21},
			},
			Pct7d:  pct(12.345678),
			Sparks: snapshot.Sparks{CIB: []int64{9100, 9800}},
			AsOf:   "2026-09-01",
		}},
	}
}

func TestWriteLatestLandsAtThePlatformPath(t *testing.T) {
	t.Parallel()
	dir := t.TempDir()
	if err := snapshot.WriteLatest(dir, sampleLatest()); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(dir, "latest", "ps2.json")); err != nil {
		t.Fatalf("expected data/latest/ps2.json: %v", err)
	}
}

func TestWriteLatestRoundsPercentages(t *testing.T) {
	t.Parallel()
	dir := t.TempDir()
	if err := snapshot.WriteLatest(dir, sampleLatest()); err != nil {
		t.Fatal(err)
	}
	body, err := os.ReadFile(filepath.Join(dir, "latest", "ps2.json"))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(body), "12.35") {
		t.Errorf("percentages must be rounded for stable diffs, got:\n%s", body)
	}
}

func TestWriteLatestIsByteStable(t *testing.T) {
	t.Parallel()
	dir := t.TempDir()
	path := filepath.Join(dir, "latest", "ps2.json")

	if err := snapshot.WriteLatest(dir, sampleLatest()); err != nil {
		t.Fatal(err)
	}
	first, _ := os.ReadFile(path)
	if err := snapshot.WriteLatest(dir, sampleLatest()); err != nil {
		t.Fatal(err)
	}
	second, _ := os.ReadFile(path)

	if string(first) != string(second) {
		t.Error("identical input produced different bytes; every run would commit a diff")
	}
}

func TestReadLatestRoundTrips(t *testing.T) {
	t.Parallel()
	dir := t.TempDir()
	if err := snapshot.WriteLatest(dir, sampleLatest()); err != nil {
		t.Fatal(err)
	}
	got, err := snapshot.ReadLatest(dir, catalog.PS2)
	if err != nil {
		t.Fatal(err)
	}
	if len(got.Games) != 1 || got.Games[0].ID != "silent-hill-2-ps2" {
		t.Fatalf("round trip lost the game: %+v", got)
	}
	if got.Games[0].Prices.CIB == nil || got.Games[0].Prices.CIB.MedianCents != 9800 {
		t.Errorf("round trip lost CIB price: %+v", got.Games[0].Prices)
	}
}

func TestReadLatestMissingFileIsEmpty(t *testing.T) {
	t.Parallel()
	got, err := snapshot.ReadLatest(t.TempDir(), catalog.PS2)
	if err != nil {
		t.Fatalf("a first run has no previous file: %v", err)
	}
	if len(got.Games) != 0 {
		t.Errorf("want empty, got %+v", got)
	}
}

func TestWriteTrendingUsesNamedBoards(t *testing.T) {
	t.Parallel()
	dir := t.TempDir()
	board := snapshot.Trending{
		Board:   "all",
		AsOf:    "2026-09-01",
		Entries: []trending.Entry{{ID: "a-ps2", Score: 19.987654}},
	}
	if err := snapshot.WriteTrending(dir, board); err != nil {
		t.Fatal(err)
	}
	body, err := os.ReadFile(filepath.Join(dir, "trending", "all.json"))
	if err != nil {
		t.Fatalf("expected data/trending/all.json: %v", err)
	}
	if !strings.Contains(string(body), "19.99") {
		t.Errorf("score must be rounded, got:\n%s", body)
	}
}

func TestWriteMetaAndCatalog(t *testing.T) {
	t.Parallel()
	dir := t.TempDir()
	meta := snapshot.Meta{
		GeneratedAt:  "2026-09-01T09:23:41Z",
		Source:       "ebay-browse",
		PriceKind:    "asking",
		Counts:       snapshot.Counts{Tracked: 240, OK: 231, Stale: 7, Failed: 2},
		APICallsUsed: 240,
		Platforms:    []catalog.Platform{catalog.PS2},
	}
	if err := snapshot.WriteMeta(dir, meta); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(dir, "meta.json")); err != nil {
		t.Fatalf("expected data/meta.json: %v", err)
	}

	cat := snapshot.Catalog{
		AsOf: "2026-09-01",
		Games: []snapshot.CatalogGame{
			{ID: "silent-hill-2-ps2", Title: "Silent Hill 2", Platform: catalog.PS2},
		},
	}
	if err := snapshot.WriteCatalog(dir, cat); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(dir, "catalog.json")); err != nil {
		t.Fatalf("expected data/catalog.json: %v", err)
	}
}

func TestWritesLeaveNoTempFiles(t *testing.T) {
	t.Parallel()
	dir := t.TempDir()
	if err := snapshot.WriteLatest(dir, sampleLatest()); err != nil {
		t.Fatal(err)
	}
	entries, err := os.ReadDir(filepath.Join(dir, "latest"))
	if err != nil {
		t.Fatal(err)
	}
	for _, e := range entries {
		if strings.HasSuffix(e.Name(), ".tmp") {
			t.Errorf("left a temp file behind: %s", e.Name())
		}
	}
}

// Real catalog titles contain ampersands ("Beyond Good & Evil"). The output is
// committed to git and read in diffs, so it must not be HTML-escaped into
// "Beyond Good & Evil".
func TestWriteDoesNotHTMLEscapeTitles(t *testing.T) {
	t.Parallel()
	dir := t.TempDir()
	l := sampleLatest()
	l.Games[0].Title = "Beyond Good & Evil <Special>"

	if err := snapshot.WriteLatest(dir, l); err != nil {
		t.Fatal(err)
	}
	body, err := os.ReadFile(filepath.Join(dir, "latest", "ps2.json"))
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(body), "\\u") {
		t.Errorf("output contains a unicode escape; HTML escaping makes the committed diff unreadable:\n%s", body)
	}
	if !strings.Contains(string(body), "Beyond Good & Evil") {
		t.Errorf("title not written verbatim:\n%s", body)
	}
}
