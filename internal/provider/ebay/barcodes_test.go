package ebay_test

import (
	"context"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"testing"

	"github.com/rflpazini/retroheat/internal/catalog"
	"github.com/rflpazini/retroheat/internal/provider/ebay"
)

// The search below is shaped like a live one for Silent Hill 2 on
// 2026-10-08: listings on the black-label product (5611), one on the
// Greatest Hits product (9190), sequels on products of their own, and
// listings with no product at all.
const silentHillSearch = `{"total": 9, "itemSummaries": [
 {"itemId": "v1|1|0", "title": "Silent Hill 2 PS2 Black Label Complete CIB", "epid": "5611", "price": {"value": "89.99", "currency": "USD"}},
 {"itemId": "v1|2|0", "title": "Silent Hill 2 PlayStation 2 Complete w/ Manual", "epid": "5611", "price": {"value": "95.00", "currency": "USD"}},
 {"itemId": "v1|3|0", "title": "Silent Hill 2 (PS2) Disc Only Tested", "epid": "5611", "price": {"value": "40.00", "currency": "USD"}},
 {"itemId": "v1|4|0", "title": "Silent Hill 2 PS2 CIB Complete", "price": {"value": "92.00", "currency": "USD"}},
 {"itemId": "v1|5|0", "title": "Silent Hill 2 Greatest Hits PS2 Complete", "epid": "9190", "price": {"value": "60.00", "currency": "USD"}},
 {"itemId": "v1|6|0", "title": "Silent Hill 3 PS2 Complete CIB", "epid": "9963", "price": {"value": "120.00", "currency": "USD"}},
 {"itemId": "v1|7|0", "title": "Silent Hill 3 PlayStation 2 Complete", "epid": "9963", "price": {"value": "125.00", "currency": "USD"}},
 {"itemId": "v1|8|0", "title": "Silent Hill 3 PS2 Complete", "epid": "9963", "price": {"value": "119.00", "currency": "USD"}},
 {"itemId": "v1|9|0", "title": "Silent Hill 2 PS2 manual only", "epid": "5611", "price": {"value": "15.00", "currency": "USD"}}
]}`

const blackLabelItem = `{"itemId": "v1|1|0", "epid": "5611", "gtin": "0083717200253",
 "product": {"title": "Silent Hill 2 (PlayStation 2, 2001)", "gtins": ["0083717200253"]}}`

func harvestServer(t *testing.T, routes map[string]string) (*ebay.Client, *[]string) {
	t.Helper()
	var calls []string
	mux := http.NewServeMux()
	mux.HandleFunc("/identity/v1/oauth2/token", func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte(`{"access_token":"tok","expires_in":7200}`))
	})
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		calls = append(calls, r.URL.Path+"?"+r.URL.RawQuery)
		body, ok := routes[r.URL.Path]
		if !ok {
			http.NotFound(w, r)
			return
		}
		_, _ = w.Write([]byte(body))
	})
	srv := httptest.NewServer(mux)
	t.Cleanup(srv.Close)
	return ebay.New("id", "secret", ebay.WithBaseURL(srv.URL)), &calls
}

func TestTallyProductsCountsOnlyListingsKeptForTheGame(t *testing.T) {
	t.Parallel()
	c, _ := harvestServer(t, map[string]string{"/buy/browse/v1/item_summary/search": silentHillSearch})
	got, err := c.TallyProducts(context.Background(), silentHill)
	if err != nil {
		t.Fatal(err)
	}
	// The Greatest Hits listing is a negative, Silent Hill 3 is not this
	// game and the manual alone is rejected, so only the black label counts.
	want := []ebay.ProductCount{{EPID: "5611", Listings: 3, ItemIDs: []string{"v1|1|0", "v1|2|0", "v1|3|0"}}}
	if !reflect.DeepEqual(got.Products, want) {
		t.Errorf("Products = %+v, want %+v", got.Products, want)
	}
	if got.Kept != 4 {
		t.Errorf("Kept = %d, want the four Silent Hill 2 copies", got.Kept)
	}
}

func TestAttestedNeedsAgreement(t *testing.T) {
	t.Parallel()
	tally := ebay.Tally{Products: []ebay.ProductCount{
		{EPID: "a", Listings: 2}, {EPID: "b", Listings: 2}, {EPID: "c", Listings: 1},
	}}
	got := tally.Attested(3, 4)
	if len(got) != 1 || got[0].EPID != "a" {
		t.Errorf("Attested = %+v, want only the best-attested product at two listings", got)
	}
	tally = ebay.Tally{Products: []ebay.ProductCount{
		{EPID: "a", Listings: 9}, {EPID: "b", Listings: 5}, {EPID: "c", Listings: 3}, {EPID: "d", Listings: 3},
	}}
	if got := tally.Attested(3, 2); len(got) != 2 {
		t.Errorf("Attested = %+v, want it capped at two products", got)
	}
}

func TestProductReadsTheCodesOffTheItem(t *testing.T) {
	t.Parallel()
	c, calls := harvestServer(t, map[string]string{"/buy/browse/v1/item/v1|1|0": blackLabelItem})
	got, err := c.Product(context.Background(), "v1|1|0")
	if err != nil {
		t.Fatal(err)
	}
	want := ebay.Product{EPID: "5611", Title: "Silent Hill 2 (PlayStation 2, 2001)", GTINs: []string{"0083717200253"}}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("Product = %+v, want %+v", got, want)
	}
	if len(*calls) != 1 || !strings.Contains((*calls)[0], "fieldgroups=PRODUCT") {
		t.Errorf("calls = %v, want one item read with the PRODUCT field group", *calls)
	}
}

func TestJudgeProduct(t *testing.T) {
	t.Parallel()
	codes := []string{"0083717200253"}
	reprint := ebay.ReprintSearches(silentHill)[0]
	cases := []struct {
		name    string
		game    catalog.Game
		title   string
		variant catalog.Variant
		ok      bool
	}{
		{"the game", silentHill, "Silent Hill 2 (PlayStation 2, 2001)", catalog.VariantNone, true},
		{"a reprint the entry excludes", silentHill, "Silent Hill 2 Greatest Hits (Sony PlayStation 2, 2002)", "", false},
		{"that reprint, looked for", reprint, "Silent Hill 2 Greatest Hits (Sony PlayStation 2, 2002)", catalog.VariantGreatestHits, true},
		{"the sequel", silentHill, "Silent Hill 3 (PlayStation 2, 2003)", "", false},
		{"another platform", silentHill, "Silent Hill 2: Restless Dreams (Microsoft Xbox, 2001)", "", false},
		{"a Game Boy Color product for a Game Boy entry",
			catalog.Game{ID: "tetris-dx-gb", Title: "Tetris DX", Platform: catalog.GB, Ebay: catalog.EbayHints{Query: "x"}},
			"Tetris DX (Nintendo Game Boy Color, 1998)", "", false},
		// The platform's own name must not supply the game's words.
		{"Advance from Game Boy Advance",
			catalog.Game{ID: "advance-wars-gba", Title: "Advance Wars", Platform: catalog.GBA, Ebay: catalog.EbayHints{Query: "x"}},
			"Star Wars-Flight of the Falcon - Nintendo Game Boy Advance", "", false},
		{"Advance Wars itself",
			catalog.Game{ID: "advance-wars-gba", Title: "Advance Wars", Platform: catalog.GBA, Ebay: catalog.EbayHints{Query: "x"}},
			"Advance Wars (Nintendo Game Boy Advance, 2001)", catalog.VariantNone, true},
		{"64 from Nintendo 64",
			catalog.Game{ID: "super-mario-64-n64", Title: "Super Mario 64", Platform: catalog.N64, Ebay: catalog.EbayHints{Query: "x"}},
			"Paper Mario Story - Nintendo 64 (N64)", "", false},
		{"Super Mario 64 itself",
			catalog.Game{ID: "super-mario-64-n64", Title: "Super Mario 64", Platform: catalog.N64, Ebay: catalog.EbayHints{Query: "x"}},
			"Super Mario 64 (Nintendo 64, 1996)", catalog.VariantNone, true},
		{"an N64 game eBay names without its 64",
			catalog.Game{ID: "harvest-moon-64-n64", Title: "Harvest Moon 64", Platform: catalog.N64, Ebay: catalog.EbayHints{Query: "x"}},
			"Harvest Moon (Nintendo 64)", catalog.VariantNone, true},
		{"another N64 game sharing a word",
			catalog.Game{ID: "mario-kart-64-n64", Title: "Mario Kart 64", Platform: catalog.N64, Ebay: catalog.EbayHints{Query: "x"}},
			"Mario Party (Nintendo 64, 1999)", "", false},
		{"Platinum in the game's own name is not a reprint",
			catalog.Game{ID: "pokemon-platinum-gba", Title: "Pokemon Platinum", Platform: catalog.GBA, Ebay: catalog.EbayHints{Query: "x"}},
			"Pokemon Platinum (Nintendo Game Boy Advance)", catalog.VariantNone, true},
	}
	for _, c := range cases {
		v, reason, ok := ebay.Judge(c.game, ebay.Product{Title: c.title, GTINs: codes})
		if ok != c.ok || v != c.variant {
			t.Errorf("%s: Judge = %q, %v (%s); want %q, %v", c.name, v, ok, reason, c.variant, c.ok)
		}
	}
	if _, _, ok := ebay.Judge(silentHill, ebay.Product{Title: "Silent Hill 2 (PlayStation 2, 2001)"}); ok {
		t.Error("Judge accepted a product with no codes")
	}
}

func TestReprintSearchesLookForEachExcludedReprint(t *testing.T) {
	t.Parallel()
	g := silentHill
	g.Ebay.Negative = []string{"greatest hits", "demo", "player's choice", "players choice"}
	got := ebay.ReprintSearches(g)
	if len(got) != 2 {
		t.Fatalf("ReprintSearches = %d searches, want one per reprint", len(got))
	}
	if got[0].Ebay.Query != `Silent Hill 2 PS2 "greatest hits"` {
		t.Errorf("query = %q", got[0].Ebay.Query)
	}
	if want := []string{"demo", "player's choice", "players choice"}; !reflect.DeepEqual(got[0].Ebay.Negative, want) {
		t.Errorf("negatives = %v, want %v", got[0].Ebay.Negative, want)
	}
	if want := []string{"greatest hits", "demo"}; !reflect.DeepEqual(got[1].Ebay.Negative, want) {
		t.Errorf("negatives = %v, want both spellings of Player's Choice dropped: %v", got[1].Ebay.Negative, want)
	}
	if !reflect.DeepEqual(g.Ebay.Negative, []string{"greatest hits", "demo", "player's choice", "players choice"}) {
		t.Error("ReprintSearches changed the entry it was given")
	}
}

func TestKeptForCodeJudgesListingsFoundByCode(t *testing.T) {
	t.Parallel()
	c, calls := harvestServer(t, map[string]string{"/buy/browse/v1/item_summary/search": silentHillSearch})
	kept, total, err := c.KeptForCode(context.Background(), silentHill, "083717200253")
	if err != nil {
		t.Fatal(err)
	}
	if kept != 4 || total != 9 {
		t.Errorf("KeptForCode = %d of %d, want 4 of 9", kept, total)
	}
	if q := (*calls)[0]; !strings.Contains(q, "gtin=083717200253") || strings.Contains(q, "q=") {
		t.Errorf("search = %s, want a code search with no keywords (Browse refuses both)", q)
	}
}

func TestCallsLeftReadsTheBrowseQuota(t *testing.T) {
	t.Parallel()
	c, _ := harvestServer(t, map[string]string{"/developer/analytics/v1_beta/rate_limit/": `{"rateLimits": [{"apiName": "Browse",
	 "resources": [{"name": "buy.browse", "rates": [{"limit": 5000, "remaining": 3930, "reset": "2026-10-09T07:00:00.000Z"}]},
	               {"name": "buy.browse.item.bulk", "rates": [{"limit": 5000, "remaining": 5000}]}]}]}`})
	left, reset, err := c.CallsLeft(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if left != 3930 || reset.Hour() != 7 {
		t.Errorf("CallsLeft = %d, %v; want 3930 resetting at 07:00", left, reset)
	}
}
