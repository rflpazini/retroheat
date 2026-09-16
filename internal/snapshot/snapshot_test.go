package snapshot_test

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/rflpazini/retroheat/internal/catalog"
	"github.com/rflpazini/retroheat/internal/classify"
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

func TestWritePricesIsCompactAndByteStable(t *testing.T) {
	t.Parallel()
	dir := t.TempDir()
	idx := snapshot.PriceIndex{AsOf: "2026-09-01", Games: map[string]snapshot.PriceEntry{
		"silent-hill-2-ps2": {Prices: map[classify.Condition]int64{classify.Loose: 4500, classify.CIB: 9800}, Pct7d: pct(12.345678)},
		"god-hand-ps2":      {Prices: map[classify.Condition]int64{classify.CIB: 5000}, Stale: true},
	}}
	if err := snapshot.WritePrices(dir, idx); err != nil {
		t.Fatal(err)
	}
	first, err := os.ReadFile(filepath.Join(dir, "prices.json"))
	if err != nil {
		t.Fatalf("expected data/prices.json: %v", err)
	}
	body := string(first)
	for _, want := range []string{`"cib":9800`, `"loose":4500`, `"pct_7d":12.35`, `"stale":true`, `"as_of":"2026-09-01"`} {
		if !strings.Contains(body, want) {
			t.Errorf("prices.json lacks %s:\n%s", want, body)
		}
	}
	if strings.Contains(body, "mode_cents") || strings.Contains(body, "sparks") || strings.Contains(body, "  ") {
		t.Errorf("prices.json must be the compact index, not a copy of the boards:\n%s", body)
	}
	if err := snapshot.WritePrices(dir, idx); err != nil {
		t.Fatal(err)
	}
	second, _ := os.ReadFile(filepath.Join(dir, "prices.json"))
	if string(second) != body {
		t.Error("rewriting the same index produced different bytes")
	}
}

func TestPriceIndexFromBoardsKeepsOnlyWhatSearchAndShelvesNeed(t *testing.T) {
	t.Parallel()
	l := sampleLatest()
	l.Games[0].Stale = true
	idx := snapshot.PriceIndexFrom("2026-09-01", []snapshot.Latest{l})
	e, ok := idx.Games["silent-hill-2-ps2"]
	if !ok {
		t.Fatal("the priced game is missing from the index")
	}
	if e.Prices[classify.Loose] != 4500 || e.Prices[classify.CIB] != 9800 || e.Pct7d == nil || !e.Stale {
		t.Errorf("entry = %+v, want medians, the 7-day move and staleness", e)
	}
	if _, has := e.Prices[classify.New]; has {
		t.Error("a condition without a price must be absent, not zero")
	}
}

func TestWriteGameLandsUnderGames(t *testing.T) {
	t.Parallel()
	dir := t.TempDir()
	g := snapshot.GameDetail{
		ID: "silent-hill-2-ps2", Title: "Silent Hill 2", Platform: catalog.PS2,
		EbayURL: "https://www.ebay.com/sch/i.html?_nkw=Silent+Hill+2+PS2",
		Info:    &catalog.Info{About: "A 2001 survival horror game.", Why: "Never re-released faithfully."},
	}
	if err := snapshot.WriteGame(dir, g); err != nil {
		t.Fatal(err)
	}
	body, err := os.ReadFile(filepath.Join(dir, "games", "silent-hill-2-ps2.json"))
	if err != nil {
		t.Fatalf("expected data/games/silent-hill-2-ps2.json: %v", err)
	}
	for _, want := range []string{`"about"`, `"why"`, `"ebay_url"`} {
		if !strings.Contains(string(body), want) {
			t.Errorf("game file lacks %s:\n%s", want, body)
		}
	}
}

func TestShelfOfHidesCountsUnderThree(t *testing.T) {
	t.Parallel()
	cases := []struct {
		name         string
		owned, saved int
		want         *snapshot.ShelfCount
	}{
		{"both clear the floor", 5, 3, &snapshot.ShelfCount{Owned: 5, Saved: 3}},
		{"only owned clears it", 4, 2, &snapshot.ShelfCount{Owned: 4}},
		{"only saved clears it", 1, 3, &snapshot.ShelfCount{Saved: 3}},
		{"neither clears it", 2, 2, nil},
		{"nobody", 0, 0, nil},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			t.Parallel()
			got := snapshot.ShelfOf(c.owned, c.saved)
			if (got == nil) != (c.want == nil) || (got != nil && *got != *c.want) {
				t.Errorf("ShelfOf(%d, %d) = %+v, want %+v", c.owned, c.saved, got, c.want)
			}
		})
	}
}

func TestGameFileRoundTripsShelfCounts(t *testing.T) {
	t.Parallel()
	dir := t.TempDir()
	g := snapshot.GameDetail{ID: "bully-ps2", Title: "Bully", Platform: catalog.PS2, Shelf: &snapshot.ShelfCount{Owned: 12}}
	if err := snapshot.WriteGame(dir, g); err != nil {
		t.Fatal(err)
	}
	raw, err := os.ReadFile(filepath.Join(dir, "games", "bully-ps2.json"))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(raw), `"shelf"`) || strings.Contains(string(raw), `"saved"`) {
		t.Errorf("game file = %s, want owned under shelf and no saved key for a count below the floor", raw)
	}
	back, err := snapshot.ReadGame(dir, "bully-ps2")
	if err != nil {
		t.Fatal(err)
	}
	if back.Shelf == nil || back.Shelf.Owned != 12 || back.Shelf.Saved != 0 {
		t.Errorf("read back shelf = %+v, want owned 12", back.Shelf)
	}

	// A game nobody has counted carries no key at all, so the page says nothing.
	if err := snapshot.WriteGame(dir, snapshot.GameDetail{ID: "okami-ps2", Title: "Okami", Platform: catalog.PS2}); err != nil {
		t.Fatal(err)
	}
	raw, err = os.ReadFile(filepath.Join(dir, "games", "okami-ps2.json"))
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(raw), `"shelf"`) {
		t.Errorf("game file = %s, want no shelf key", raw)
	}
	if _, err := snapshot.ReadGame(dir, "vanished-ps2"); err == nil {
		t.Error("reading a game file that does not exist must fail, not invent a game")
	}
}
