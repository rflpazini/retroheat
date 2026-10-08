package main

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"

	"github.com/rflpazini/retroheat/internal/budget"
	"github.com/rflpazini/retroheat/internal/catalog"
	"github.com/rflpazini/retroheat/internal/mirror"
	"github.com/rflpazini/retroheat/internal/provider"
	"github.com/rflpazini/retroheat/internal/provider/ebay"
)

// fakeEbay answers by query and by item, and counts what was asked.
type fakeEbay struct {
	tallies  map[string]ebay.Tally   // by query
	products map[string]ebay.Product // by item id
	byCode   map[string][2]int       // kept, total by code
	reads    []string
	searches []string
}

func (f *fakeEbay) TallyProducts(_ context.Context, g catalog.Game) (ebay.Tally, error) {
	f.searches = append(f.searches, g.Ebay.Query)
	return f.tallies[g.Ebay.Query], nil
}

func (f *fakeEbay) Product(_ context.Context, itemID string) (ebay.Product, error) {
	f.reads = append(f.reads, itemID)
	p, ok := f.products[itemID]
	if !ok {
		return ebay.Product{}, errors.New("unexpected status 404 Not Found")
	}
	return p, nil
}

func (f *fakeEbay) KeptForCode(_ context.Context, _ catalog.Game, gtin string) (int, int, error) {
	r := f.byCode[gtin]
	return r[0], r[1], nil
}

var silentHill2 = catalog.Game{
	ID: "silent-hill-2-ps2", Title: "Silent Hill 2", Platform: catalog.PS2, Variant: catalog.VariantBlackLabel, Region: catalog.RegionNTSCU,
	Ebay: catalog.EbayHints{Query: "Silent Hill 2 PS2", Negative: []string{"greatest hits", "silent hill 3"}},
}

func silentHillEbay() *fakeEbay {
	return &fakeEbay{
		tallies: map[string]ebay.Tally{
			"Silent Hill 2 PS2": {Kept: 40, Products: []ebay.ProductCount{
				{EPID: "5611", Listings: 15, ItemIDs: []string{"a"}}, {EPID: "777", Listings: 1, ItemIDs: []string{"x"}},
			}},
			`Silent Hill 2 PS2 "greatest hits"`: {Kept: 12, Products: []ebay.ProductCount{
				{EPID: "9190", Listings: 6, ItemIDs: []string{"b"}}, {EPID: "5611", Listings: 3, ItemIDs: []string{"c"}},
			}},
		},
		products: map[string]ebay.Product{
			"a": {EPID: "5611", Title: "Silent Hill 2 (PlayStation 2, 2001)", GTINs: []string{"0083717200253"}},
			"b": {EPID: "9190", Title: "Silent Hill 2 Greatest Hits (Sony PlayStation 2, 2002)", GTINs: []string{"0083717200505"}},
		},
	}
}

func TestHarvestFindsTheGameAndTheReprintItExcludes(t *testing.T) {
	t.Parallel()
	src := silentHillEbay()
	f, err := harvestGame(context.Background(), src, silentHill2, budget.New(0), map[string]ebay.Product{}, settings{minListings: 3, maxProducts: 4})
	if err != nil {
		t.Fatal(err)
	}
	want := []catalog.Barcode{{Code: "083717200253"}, {Code: "083717200505", Variant: catalog.VariantGreatestHits}}
	if !reflect.DeepEqual(f.Codes, want) {
		t.Errorf("codes = %+v, want %+v", f.Codes, want)
	}
	if f.Kept != 40 {
		t.Errorf("kept = %d, want the main search's count", f.Kept)
	}
	// 5611 turns up in both searches but is read once; 777 has one listing.
	if !reflect.DeepEqual(src.reads, []string{"a", "b"}) {
		t.Errorf("item reads = %v, want each attested product read once", src.reads)
	}
}

func TestHarvestStopsWhenTheBudgetIsSpent(t *testing.T) {
	t.Parallel()
	src := silentHillEbay()
	_, err := harvestGame(context.Background(), src, silentHill2, budget.New(2), map[string]ebay.Product{}, settings{minListings: 3, maxProducts: 4})
	if !errors.Is(err, errBudget) {
		t.Fatalf("err = %v, want the budget to stop the harvest", err)
	}
	if len(src.searches)+len(src.reads) != 2 {
		t.Errorf("spent %d calls on a budget of 2", len(src.searches)+len(src.reads))
	}
}

func TestHarvestNotesAProductItCouldNotRead(t *testing.T) {
	t.Parallel()
	src := silentHillEbay()
	delete(src.products, "b")
	f, err := harvestGame(context.Background(), src, silentHill2, budget.New(0), map[string]ebay.Product{}, settings{minListings: 3, maxProducts: 4})
	if err != nil {
		t.Fatal(err)
	}
	if len(f.Codes) != 1 || len(f.Rejected) != 1 || !strings.Contains(f.Rejected[0], "9190") {
		t.Errorf("found = %+v, want the black label kept and the unreadable product noted", f)
	}
}

// eBay's search attaches a product to a listing whose own page can come back
// without it; the next listing on the same product is read instead.
func TestHarvestReadsThroughAListingThatLostItsProduct(t *testing.T) {
	t.Parallel()
	src := &fakeEbay{
		tallies: map[string]ebay.Tally{"Okami PS2": {Kept: 30, Products: []ebay.ProductCount{
			{EPID: "48660621", Listings: 20, ItemIDs: []string{"bare", "full", "spare"}},
		}}},
		products: map[string]ebay.Product{
			"bare": {},
			"full": {Title: "Okami (Sony PlayStation 2, 2006)", GTINs: []string{"0013388260591"}},
		},
	}
	okami := catalog.Game{ID: "okami-ps2", Title: "Okami", Platform: catalog.PS2, Region: catalog.RegionNTSCU, Ebay: catalog.EbayHints{Query: "Okami PS2"}}
	f, err := harvestGame(context.Background(), src, okami, budget.New(0), map[string]ebay.Product{}, settings{minListings: 3, maxProducts: 4})
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(f.Codes, []catalog.Barcode{{Code: "013388260591"}}) || !reflect.DeepEqual(src.reads, []string{"bare", "full"}) {
		t.Errorf("codes = %+v after reading %v; want Okami's code from the second listing", f.Codes, src.reads)
	}
}

// A US entry keeps only the US box's code, even when eBay's product for it
// lists the European or Japanese one.
func TestHarvestKeepsOnlyTheEntrysRegion(t *testing.T) {
	t.Parallel()
	src := &fakeEbay{
		tallies: map[string]ebay.Tally{"Suikoden III PS2": {Kept: 60, Products: []ebay.ProductCount{
			{EPID: "1", Listings: 30, ItemIDs: []string{"jp"}}, {EPID: "2", Listings: 9, ItemIDs: []string{"us"}},
		}}},
		products: map[string]ebay.Product{
			"jp": {Title: "Suikoden III (Sony PlayStation 2, 2002)", GTINs: []string{"4988601003995"}},
			"us": {Title: "Suikoden III (PlayStation 2, 2002)", GTINs: []string{"0083717200529"}},
		},
	}
	g := catalog.Game{ID: "suikoden-3-ps2", Title: "Suikoden III", Platform: catalog.PS2, Region: catalog.RegionNTSCU, Ebay: catalog.EbayHints{Query: "Suikoden III PS2"}}
	f, err := harvestGame(context.Background(), src, g, budget.New(0), map[string]ebay.Product{}, settings{minListings: 3, maxProducts: 4})
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(f.Codes, []catalog.Barcode{{Code: "083717200529"}}) {
		t.Errorf("codes = %+v, want only the US code", f.Codes)
	}
	if len(f.Rejected) != 1 || !strings.Contains(f.Rejected[0], "NTSC-J box") {
		t.Errorf("rejected = %v, want the Japanese code noted", f.Rejected)
	}
}

func TestRegionOfCode(t *testing.T) {
	t.Parallel()
	for code, want := range map[string]catalog.Region{
		"0083717200253": catalog.RegionNTSCU,
		"1234567890128": catalog.RegionNTSCU,
		"4988601003995": catalog.RegionNTSCJ,
		"4542084000355": catalog.RegionNTSCJ,
		"4005209035361": catalog.RegionPAL,
		"5030917012345": catalog.RegionPAL,
	} {
		if got := regionOfCode(code); got != want {
			t.Errorf("regionOfCode(%s) = %s, want %s", code, got, want)
		}
	}
}

func TestPrintedCode(t *testing.T) {
	t.Parallel()
	for in, want := range map[string][2]string{
		"0083717200253":  {"0083717200253", "083717200253"},
		"00083717200253": {"0083717200253", "083717200253"},
		"4988601003995":  {"4988601003995", "4988601003995"},
	} {
		key, printed, ok := printedCode(in)
		if !ok || key != want[0] || printed != want[1] {
			t.Errorf("printedCode(%s) = %s, %s, %v; want %v", in, key, printed, ok, want)
		}
	}
	if _, _, ok := printedCode("0083717200254"); ok {
		t.Error("printedCode accepted a bad check digit")
	}
}

func TestAssignGivesAContestedCodeToTheEditionItBelongsTo(t *testing.T) {
	t.Parallel()
	games := []catalog.Game{
		{ID: "a-ps2"}, {ID: "a-greatest-hits-ps2"}, {ID: "b-ps2"}, {ID: "c-ps2"},
		{ID: "d-ps2", Barcodes: []catalog.Barcode{{Code: "711719501527"}}},
	}
	harvested := map[string]found{
		// The base game finds the reprint's code as a reprint; the reprint's
		// own entry finds it as its own edition.
		"a-ps2":               {Codes: []catalog.Barcode{{Code: "083717200253"}, {Code: "083717200505", Variant: catalog.VariantGreatestHits}}},
		"a-greatest-hits-ps2": {Codes: []catalog.Barcode{{Code: "083717200505"}}},
		// Two entries both claim a code as their own: nobody gets it.
		"b-ps2": {Codes: []catalog.Barcode{{Code: "4988601003995"}}},
		"c-ps2": {Codes: []catalog.Barcode{{Code: "4988601003995"}, {Code: "711719501527"}}},
	}
	got, conflicts := assign(games, harvested)
	want := map[string][]catalog.Barcode{
		"a-ps2":               {{Code: "083717200253"}},
		"a-greatest-hits-ps2": {{Code: "083717200505"}},
	}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("assign = %+v, want %+v", got, want)
	}
	if len(conflicts) != 2 || !strings.Contains(conflicts[0]+conflicts[1], "already belongs to d-ps2") {
		t.Errorf("conflicts = %v, want the shared code and the one d-ps2 already lists", conflicts)
	}
}

const ps2File = `platform: ps2
games:
  - id: silent-hill-2-ps2
    title: "Silent Hill 2"
    variant: black-label
    ebay:
      query: "Silent Hill 2 PS2"
      negative: ["greatest hits"]

  # A comment between entries stays where it is.
  - id: god-hand-ps2
    title: "God Hand"
    ebay: {query: "God Hand PS2"}
    barcodes:
      - {code: "711719501527"}
`

func catalogDir(t *testing.T) string {
	t.Helper()
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "ps2.yaml"), []byte(ps2File), 0o600); err != nil {
		t.Fatal(err)
	}
	return dir
}

func TestWriteBarcodesEditsOnlyTheBarcodesBlocks(t *testing.T) {
	t.Parallel()
	dir := catalogDir(t)
	games, err := catalog.Load(dir)
	if err != nil {
		t.Fatal(err)
	}
	err = writeBarcodes(dir, games, map[string][]catalog.Barcode{
		"silent-hill-2-ps2": {{Code: "083717200253"}, {Code: "083717200505", Variant: catalog.VariantGreatestHits}},
		"god-hand-ps2":      {{Code: "013388250011"}},
	})
	if err != nil {
		t.Fatal(err)
	}
	raw, _ := os.ReadFile(filepath.Join(dir, "ps2.yaml"))
	want := `platform: ps2
games:
  - id: silent-hill-2-ps2
    title: "Silent Hill 2"
    variant: black-label
    ebay:
      query: "Silent Hill 2 PS2"
      negative: ["greatest hits"]
    barcodes:
      - {code: "083717200253"}
      - {code: "083717200505", variant: greatest-hits}

  # A comment between entries stays where it is.
  - id: god-hand-ps2
    title: "God Hand"
    ebay: {query: "God Hand PS2"}
    barcodes:
      - {code: "013388250011"}
`
	if string(raw) != want {
		t.Errorf("ps2.yaml =\n%s\nwant\n%s", raw, want)
	}
}

func TestWriteBarcodesLeavesTheCatalogAloneWhenItWouldNotValidate(t *testing.T) {
	t.Parallel()
	dir := catalogDir(t)
	games, err := catalog.Load(dir)
	if err != nil {
		t.Fatal(err)
	}
	// God Hand already lists this code, so giving it to Silent Hill 2 too
	// would make one box two games.
	err = writeBarcodes(dir, games, map[string][]catalog.Barcode{"silent-hill-2-ps2": {{Code: "711719501527"}}})
	if err == nil || !strings.Contains(err.Error(), "nothing was written") {
		t.Fatalf("err = %v, want the edit refused", err)
	}
	if raw, _ := os.ReadFile(filepath.Join(dir, "ps2.yaml")); string(raw) != ps2File {
		t.Errorf("ps2.yaml was left edited:\n%s", raw)
	}
}

func TestReviewTrustsEbayOrAgreement(t *testing.T) {
	t.Parallel()
	games := []catalog.Game{
		{ID: "silent-hill-2-ps2", Title: "Silent Hill 2", Platform: catalog.PS2},
		{ID: "god-hand-ps2", Title: "God Hand", Platform: catalog.PS2, Barcodes: []catalog.Barcode{{Code: "711719501527"}}},
		{ID: "okami-ps2", Title: "Okami", Platform: catalog.PS2},
	}
	reports := []mirror.BarcodeReport{
		// eBay's listings for the code are Silent Hill 2.
		{Code: "0083717200253", GameID: "silent-hill-2-ps2", UserID: "u1"},
		// A Brazilian box eBay US has never seen, paired twice and once.
		{Code: "7891234567895", GameID: "okami-ps2", UserID: "u1"},
		{Code: "7891234567895", GameID: "okami-ps2", UserID: "u2"},
		{Code: "7899876543215", GameID: "okami-ps2", UserID: "u3"},
		// Already in the catalog, and someone disagrees with it.
		{Code: "711719501527", GameID: "okami-ps2", UserID: "u4"},
		// Mostly some other game on eBay.
		{Code: "0083717200505", GameID: "okami-ps2", UserID: "u5"},
	}
	src := &fakeEbay{byCode: map[string][2]int{
		"0083717200253": {9, 10},
		"0083717200505": {0, 8},
	}}
	got, notes, err := review(context.Background(), src, games, reports, budget.New(0))
	if err != nil {
		t.Fatal(err)
	}
	want := map[string][]catalog.Barcode{
		"silent-hill-2-ps2": {{Code: "083717200253"}},
		"okami-ps2":         {{Code: "7891234567895"}},
	}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("accepted = %+v, want %+v", got, want)
	}
	all := strings.Join(notes, "\n")
	for _, n := range []string{"belongs to god-hand-ps2", "waiting for a second", "only 0 of eBay's 8"} {
		if !strings.Contains(all, n) {
			t.Errorf("notes lack %q:\n%s", n, all)
		}
	}
}

func TestSelectGamesSkipsEntriesWithCodesUnlessForced(t *testing.T) {
	t.Parallel()
	games := []catalog.Game{
		{ID: "a-ps2", Platform: catalog.PS2},
		{ID: "b-ps2", Platform: catalog.PS2, Barcodes: []catalog.Barcode{{Code: "711719501527"}}},
		{ID: "c-n64", Platform: catalog.N64},
	}
	got, _ := selectGames(games, "ps2", "", false)
	if len(got) != 1 || got[0].ID != "a-ps2" {
		t.Errorf("selectGames = %v, want only the PS2 entry without codes", got)
	}
	if got, _ := selectGames(games, "", "", true); len(got) != 3 {
		t.Errorf("selectGames with -force = %d entries, want all 3", len(got))
	}
	if _, err := selectGames(games, "", "nope-ps2", false); err == nil {
		t.Error("selectGames accepted an unknown id")
	}
}

func TestUsableForTurnsDownFillerAndOtherRegions(t *testing.T) {
	t.Parallel()
	us := catalog.Game{ID: "mega-man-iii-gb", Region: catalog.RegionNTSCU}
	if _, ok := usableFor(us, "0911448911448"); ok {
		t.Error("a code that is one half printed twice was accepted")
	}
	if _, ok := usableFor(us, "4988601003995"); ok {
		t.Error("a Japanese code was accepted for a US entry")
	}
	if _, ok := usableFor(catalog.Game{Region: catalog.RegionNTSCJ}, "4988601003995"); !ok {
		t.Error("a Japanese code was turned down for a Japanese entry")
	}
	if _, ok := usableFor(us, "0083717200253"); !ok {
		t.Error("a US code was turned down for a US entry")
	}
}

// A rule that improves after a harvest is applied to the codes already
// written, from the products the harvest remembered, without asking eBay.
func TestRejudgeDropsCodesNoProductStillVouchesFor(t *testing.T) {
	t.Parallel()
	games := []catalog.Game{
		{ID: "advance-wars-gba", Title: "Advance Wars", Platform: catalog.GBA, Region: catalog.RegionNTSCU,
			Ebay: catalog.EbayHints{Query: "x"}, Barcodes: []catalog.Barcode{{Code: "045496731007"}, {Code: "785138321394"}}},
		{ID: "mega-man-iii-gb", Title: "Mega Man III", Platform: catalog.GB, Region: catalog.RegionNTSCU,
			Ebay: catalog.EbayHints{Query: "x"}, Barcodes: []catalog.Barcode{{Code: "911448911448"}}},
		// Paired by hand: no remembered product carries it, so it stays.
		{ID: "okami-ps2", Title: "Okami", Platform: catalog.PS2, Region: catalog.RegionNTSCU,
			Ebay: catalog.EbayHints{Query: "x"}, Barcodes: []catalog.Barcode{{Code: "013388260591"}}},
	}
	products := map[string]ebay.Product{
		"1": {Title: "Advance Wars (Nintendo Game Boy Advance, 2001)", GTINs: []string{"0045496731007"}},
		"2": {Title: "Star Wars-Flight of the Falcon - Nintendo Game Boy Advance", GTINs: []string{"0785138321394"}},
		"3": {Title: "Mega Man III (Nintendo Game Boy, 1992)", GTINs: []string{"0911448911448"}},
	}
	got, dropped := rejudge(games, products)
	want := map[string][]catalog.Barcode{
		"advance-wars-gba": {{Code: "045496731007"}},
		"mega-man-iii-gb":  nil,
	}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("rejudge = %+v, want %+v", got, want)
	}
	if len(dropped) != 2 {
		t.Errorf("dropped = %v, want the Star Wars code and the filler", dropped)
	}
}

func TestWriteBarcodesRemovesAnEmptiedBlock(t *testing.T) {
	t.Parallel()
	dir := catalogDir(t)
	games, err := catalog.Load(dir)
	if err != nil {
		t.Fatal(err)
	}
	if err := writeBarcodes(dir, games, map[string][]catalog.Barcode{"god-hand-ps2": nil}); err != nil {
		t.Fatal(err)
	}
	raw, _ := os.ReadFile(filepath.Join(dir, "ps2.yaml"))
	if strings.Contains(string(raw), "barcodes") || !strings.HasSuffix(string(raw), "ebay: {query: \"God Hand PS2\"}\n") {
		t.Errorf("ps2.yaml =\n%s", raw)
	}
}

// A harvest only adds. An entry asked about again keeps the codes it had,
// even when another entry now finds one of them; that is reported, and the
// catalog still validates, so a forced run is never thrown away.
func TestAssignNeverTakesACodeAway(t *testing.T) {
	t.Parallel()
	games := []catalog.Game{
		{ID: "a-ps2", Barcodes: []catalog.Barcode{{Code: "083717200253"}}},
		{ID: "b-ps2"},
	}
	harvested := map[string]found{
		"a-ps2": {Codes: []catalog.Barcode{{Code: "083717200253"}, {Code: "083717200505", Variant: catalog.VariantGreatestHits}}},
		"b-ps2": {Codes: []catalog.Barcode{{Code: "083717200253"}}},
	}
	got, conflicts := assign(games, harvested)
	want := map[string][]catalog.Barcode{
		"a-ps2": {{Code: "083717200253"}, {Code: "083717200505", Variant: catalog.VariantGreatestHits}},
	}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("assign = %+v, want %+v", got, want)
	}
	if len(conflicts) != 1 || !strings.Contains(conflicts[0], "already belongs to a-ps2, also found for b-ps2") {
		t.Errorf("conflicts = %v", conflicts)
	}
	// Finding again what an entry already lists is no conflict.
	if _, conflicts := assign(games, map[string]found{"a-ps2": {Codes: []catalog.Barcode{{Code: "083717200253"}}}}); len(conflicts) != 0 {
		t.Errorf("conflicts = %v, want none", conflicts)
	}
}

// A code -rejudge took out must not come back from the remembered answers.
func TestPruneCacheHoldsRememberedAnswersToTodaysRules(t *testing.T) {
	t.Parallel()
	g := catalog.Game{ID: "mega-man-iii-gb", Title: "Mega Man III", Platform: catalog.GB, Region: catalog.RegionNTSCU, Ebay: catalog.EbayHints{Query: "q"}}
	c := cacheFile{
		Games: map[string]found{"mega-man-iii-gb": {Query: "q", Codes: []catalog.Barcode{{Code: "911448911448"}, {Code: "013388110100"}}}},
		Products: map[string]ebay.Product{
			"1": {Title: "Mega Man III (Nintendo Game Boy, 1992)", GTINs: []string{"0911448911448"}},
		},
	}
	pruneCache(c, []catalog.Game{g})
	if got := c.Games["mega-man-iii-gb"].Codes; !reflect.DeepEqual(got, []catalog.Barcode{{Code: "013388110100"}}) {
		t.Errorf("cached codes = %+v, want the filler gone and the code no product carries kept", got)
	}
}

// A product read that failed for a reason unrelated to the product leaves
// the answer unfinished, so it is not remembered as the game's last word.
func TestHarvestMarksAFailedReadForRetry(t *testing.T) {
	t.Parallel()
	src := silentHillEbay()
	delete(src.products, "b")
	f, err := harvestGame(context.Background(), src, silentHill2, budget.New(0), map[string]ebay.Product{}, settings{minListings: 3, maxProducts: 4})
	if err != nil {
		t.Fatal(err)
	}
	if !f.Retry {
		t.Error("an unreadable product did not mark the answer for retry")
	}
	if f, _ := harvestGame(context.Background(), silentHillEbay(), silentHill2, budget.New(0), map[string]ebay.Product{}, settings{minListings: 3, maxProducts: 4}); f.Retry {
		t.Error("a clean answer was marked for retry")
	}
	bare := silentHillEbay()
	bare.products["b"] = ebay.Product{}
	if f, _ := harvestGame(context.Background(), bare, silentHill2, budget.New(0), map[string]ebay.Product{}, settings{minListings: 3, maxProducts: 4}); !f.Retry {
		t.Error("a product that came back bare through every listing did not mark the answer for retry")
	}
}

type flakyEbay struct {
	fakeEbay
	fail map[string]error
}

func (f *flakyEbay) KeptForCode(ctx context.Context, g catalog.Game, gtin string) (int, int, error) {
	if err := f.fail[gtin]; err != nil {
		return 0, 0, err
	}
	return f.fakeEbay.KeptForCode(ctx, g, gtin)
}

// A rate limit stops the review but keeps what it confirmed; one code eBay
// could not answer for is noted and the review goes on.
func TestReviewKeepsWhatItConfirmedWhenEbayStops(t *testing.T) {
	t.Parallel()
	games := []catalog.Game{
		{ID: "silent-hill-2-ps2", Title: "Silent Hill 2", Platform: catalog.PS2},
		{ID: "silent-hill-3-ps2", Title: "Silent Hill 3", Platform: catalog.PS2},
		{ID: "okami-ps2", Title: "Okami", Platform: catalog.PS2},
	}
	reports := []mirror.BarcodeReport{
		{Code: "0013388260591", GameID: "okami-ps2", UserID: "u1"},
		{Code: "0083717200253", GameID: "silent-hill-2-ps2", UserID: "u1"},
		{Code: "0083717200529", GameID: "silent-hill-3-ps2", UserID: "u1"},
	}
	src := &flakyEbay{
		fakeEbay: fakeEbay{byCode: map[string][2]int{"0083717200253": {5, 5}}},
		fail: map[string]error{
			"0013388260591": errors.New("unexpected status 503 Service Unavailable"),
			"0083717200529": provider.ErrRateLimited,
		},
	}
	got, notes, err := review(context.Background(), src, games, reports, budget.New(0))
	if !errors.Is(err, provider.ErrRateLimited) {
		t.Fatalf("err = %v, want the rate limit reported", err)
	}
	if !reflect.DeepEqual(got, map[string][]catalog.Barcode{"silent-hill-2-ps2": {{Code: "083717200253"}}}) {
		t.Errorf("accepted = %+v, want Silent Hill 2 kept", got)
	}
	if len(notes) != 1 || !strings.Contains(notes[0], "did not answer") {
		t.Errorf("notes = %v, want Okami's failed answer noted", notes)
	}
}
