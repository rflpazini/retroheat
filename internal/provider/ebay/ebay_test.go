package ebay_test

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"

	"github.com/rflpazini/retroheat/internal/catalog"
	"github.com/rflpazini/retroheat/internal/classify"
	"github.com/rflpazini/retroheat/internal/provider"
	"github.com/rflpazini/retroheat/internal/provider/ebay"
)

var silentHill = catalog.Game{
	ID:       "silent-hill-2-ps2",
	Title:    "Silent Hill 2",
	Platform: catalog.PS2,
	Ebay:     catalog.EbayHints{Query: "Silent Hill 2 PS2", Negative: []string{"greatest hits", "demo"}},
}

type stub struct {
	tokenCalls  atomic.Int32
	searchCalls atomic.Int32
	lastQuery   atomic.Value
	fixture     string
	status      int
}

func (s *stub) server(t *testing.T) *httptest.Server {
	t.Helper()
	mux := http.NewServeMux()
	mux.HandleFunc("/identity/v1/oauth2/token", func(w http.ResponseWriter, r *http.Request) {
		s.tokenCalls.Add(1)
		if _, _, ok := r.BasicAuth(); !ok {
			t.Error("token request missing basic auth")
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"access_token":"tok-123","expires_in":7200,"token_type":"Application Access Token"}`))
	})
	mux.HandleFunc("/buy/browse/v1/item_summary/search", func(w http.ResponseWriter, r *http.Request) {
		s.searchCalls.Add(1)
		s.lastQuery.Store(r.URL.Query().Get("q"))
		if got := r.Header.Get("Authorization"); got != "Bearer tok-123" {
			t.Errorf("Authorization = %q, want the cached bearer token", got)
		}
		if got := r.Header.Get("X-EBAY-C-MARKETPLACE-ID"); got != "EBAY_US" {
			t.Errorf("marketplace header = %q, want EBAY_US", got)
		}
		if s.status != 0 {
			w.WriteHeader(s.status)
			_, _ = w.Write([]byte(`{"errors":[{"errorId":1001,"message":"rate limit"}]}`))
			return
		}
		body, err := os.ReadFile(filepath.Join("testdata", s.fixture))
		if err != nil {
			t.Fatal(err)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write(body)
	})
	srv := httptest.NewServer(mux)
	t.Cleanup(srv.Close)
	return srv
}

func newClient(t *testing.T, s *stub) *ebay.Client {
	srv := s.server(t)
	return ebay.New("id", "secret", ebay.WithBaseURL(srv.URL))
}

func TestBuildQueryAppendsNegativeTerms(t *testing.T) {
	t.Parallel()
	got := ebay.BuildQuery(silentHill)
	if !strings.HasPrefix(got, "Silent Hill 2 PS2") {
		t.Errorf("query = %q, want it to start with the catalog query", got)
	}
	if !strings.Contains(got, `-"greatest hits"`) {
		t.Errorf("query = %q, want the multi-word exclusion quoted", got)
	}
	if !strings.Contains(got, "-demo") {
		t.Errorf("query = %q, want the single-word exclusion", got)
	}
}

func TestQuotesAggregatesEachConditionBucket(t *testing.T) {
	t.Parallel()
	c := newClient(t, &stub{fixture: "search_silent_hill_2.json"})

	quotes, err := c.Quotes(context.Background(), silentHill)
	if err != nil {
		t.Fatalf("Quotes: %v", err)
	}

	got := map[classify.Condition]provider.Quote{}
	for _, q := range quotes {
		got[q.Condition] = q
	}

	loose, ok := got[classify.Loose]
	if !ok {
		t.Fatal("no loose quote")
	}
	if loose.MedianCents != 4400 {
		t.Errorf("loose median = %d, want 4400", loose.MedianCents)
	}
	if loose.SampleSize != 5 {
		t.Errorf("loose sample = %d, want 5 (the $500 listing is trimmed)", loose.SampleSize)
	}

	if cib := got[classify.CIB]; cib.MedianCents != 9800 || cib.SampleSize != 5 {
		t.Errorf("cib = %+v, want median 9800 over 5 listings", cib)
	}
	if n := got[classify.New]; n.MedianCents != 33000 || n.SampleSize != 4 {
		t.Errorf("new = %+v, want median 33000 over 4 listings", n)
	}
}

func TestQuotesExcludesJunkAndForeignCurrency(t *testing.T) {
	t.Parallel()
	c := newClient(t, &stub{fixture: "search_silent_hill_2.json"})

	quotes, err := c.Quotes(context.Background(), silentHill)
	if err != nil {
		t.Fatal(err)
	}
	total := 0
	for _, q := range quotes {
		total += q.SampleSize
	}
	// 19 listings: 2 junk, 1 EUR, 1 storefront listing that never names the
	// game, and 1 trimmed outlier never count.
	if total != 14 {
		t.Errorf("counted %d listings, want 14 after junk, currency, relevance and outlier filtering", total)
	}
}

func TestQuotesReusesTheAccessToken(t *testing.T) {
	t.Parallel()
	s := &stub{fixture: "search_silent_hill_2.json"}
	c := newClient(t, s)

	for range 3 {
		if _, err := c.Quotes(context.Background(), silentHill); err != nil {
			t.Fatal(err)
		}
	}
	if got := s.tokenCalls.Load(); got != 1 {
		t.Errorf("token fetched %d times, want 1 for the whole run", got)
	}
	if got := s.searchCalls.Load(); got != 3 {
		t.Errorf("search called %d times, want 1 per game", got)
	}
}

func TestQuotesSendsTheBuiltQuery(t *testing.T) {
	t.Parallel()
	s := &stub{fixture: "search_silent_hill_2.json"}
	c := newClient(t, s)

	if _, err := c.Quotes(context.Background(), silentHill); err != nil {
		t.Fatal(err)
	}
	if got, _ := s.lastQuery.Load().(string); got != ebay.BuildQuery(silentHill) {
		t.Errorf("sent q=%q, want %q", got, ebay.BuildQuery(silentHill))
	}
}

func TestQuotesReportsNoDataForAnEmptyResult(t *testing.T) {
	t.Parallel()
	c := newClient(t, &stub{fixture: "search_empty.json"})

	if _, err := c.Quotes(context.Background(), silentHill); !errors.Is(err, provider.ErrNoData) {
		t.Errorf("err = %v, want ErrNoData", err)
	}
}

func TestQuotesReportsRateLimiting(t *testing.T) {
	t.Parallel()
	c := newClient(t, &stub{fixture: "search_empty.json", status: http.StatusTooManyRequests})

	if _, err := c.Quotes(context.Background(), silentHill); !errors.Is(err, provider.ErrRateLimited) {
		t.Errorf("err = %v, want ErrRateLimited", err)
	}
}

func TestClientSatisfiesTheProviderInterface(t *testing.T) {
	t.Parallel()
	var p provider.Provider = ebay.New("id", "secret")
	if p.Name() != "ebay-browse" {
		t.Errorf("Name = %q, want ebay-browse", p.Name())
	}
	if p.Kind() != provider.KindAsking {
		t.Errorf("Kind = %q, want %q: Browse returns asking prices, not sold prices", p.Kind(), provider.KindAsking)
	}
	if p.CostPerGame() != 1 {
		t.Errorf("CostPerGame = %d, want 1", p.CostPerGame())
	}
}
