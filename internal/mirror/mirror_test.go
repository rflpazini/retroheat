package mirror_test

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"sync"
	"testing"

	"github.com/rflpazini/retroheat/internal/history"
	"github.com/rflpazini/retroheat/internal/mirror"
	"github.com/rflpazini/retroheat/internal/snapshot"
)

func cents(v int64) *int64 { return &v }

// fakeREST is enough of PostgREST for the mirror: it stores rows by primary
// key, honours limit/offset on reads, and records every request it saw.
type fakeREST struct {
	mu       sync.Mutex
	rows     map[string]map[string]any // "game_id|d" -> row
	runs     []map[string]any
	requests []*http.Request
	bodies   [][]map[string]any
	fail     int // when non-zero, every write answers with this status
}

func newFake() *fakeREST { return &fakeREST{rows: map[string]map[string]any{}} }

func (f *fakeREST) handler(t *testing.T) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		f.mu.Lock()
		defer f.mu.Unlock()
		f.requests = append(f.requests, r.Clone(context.Background()))
		if r.Header.Get("apikey") == "" || !strings.HasPrefix(r.Header.Get("Authorization"), "Bearer ") {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		switch {
		case r.Method == http.MethodPost && r.URL.Path == "/rest/v1/price_points":
			if f.fail != 0 {
				w.WriteHeader(f.fail)
				_, _ = w.Write([]byte(`{"message":"boom"}`))
				return
			}
			var rows []map[string]any
			if err := json.NewDecoder(r.Body).Decode(&rows); err != nil {
				t.Errorf("bad body: %v", err)
			}
			f.bodies = append(f.bodies, rows)
			for _, row := range rows {
				f.rows[row["game_id"].(string)+"|"+row["d"].(string)] = row
			}
			w.WriteHeader(http.StatusCreated)
		case r.Method == http.MethodPost && r.URL.Path == "/rest/v1/collector_runs":
			var run map[string]any
			if err := json.NewDecoder(r.Body).Decode(&run); err != nil {
				t.Errorf("bad run body: %v", err)
			}
			f.runs = append(f.runs, run)
			w.WriteHeader(http.StatusCreated)
		case r.Method == http.MethodDelete && r.URL.Path == "/rest/v1/price_points":
			q := r.URL.Query()
			game := strings.TrimPrefix(q.Get("game_id"), "eq.")
			if game == "" {
				t.Error("DELETE without a game_id filter would wipe the table")
				w.WriteHeader(http.StatusBadRequest)
				return
			}
			keep := map[string]bool{}
			if in := q.Get("d"); in != "" {
				if !strings.HasPrefix(in, "not.in.(") || !strings.HasSuffix(in, ")") {
					t.Errorf("unexpected d filter %q", in)
				}
				for _, d := range strings.Split(strings.TrimSuffix(strings.TrimPrefix(in, "not.in.("), ")"), ",") {
					keep[strings.Trim(d, `"`)] = true
				}
			}
			for k, row := range f.rows {
				if row["game_id"] == game && !keep[row["d"].(string)] {
					delete(f.rows, k)
				}
			}
			w.WriteHeader(http.StatusNoContent)
		case r.Method == http.MethodGet && r.URL.Path == "/rest/v1/price_points":
			if got := r.URL.Query().Get("order"); got != "game_id.asc,d.asc" {
				t.Errorf("order = %q; offset pagination is only stable over the primary key", got)
			}
			if got := r.URL.Query().Get("select"); !strings.Contains(got, "game_id") || !strings.Contains(got, "v") {
				t.Errorf("select = %q, want every column the point needs", got)
			}
			keys := make([]string, 0, len(f.rows))
			for k := range f.rows {
				keys = append(keys, k)
			}
			sort.Strings(keys)
			limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
			offset, _ := strconv.Atoi(r.URL.Query().Get("offset"))
			if limit == 0 {
				limit = len(keys)
			}
			out := []map[string]any{}
			for i := offset; i < len(keys) && i < offset+limit; i++ {
				out = append(out, f.rows[keys[i]])
			}
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(out)
		default:
			w.WriteHeader(http.StatusNotFound)
		}
	})
}

func newStore(t *testing.T, f *fakeREST, opts ...mirror.Option) *mirror.Supabase {
	t.Helper()
	srv := httptest.NewServer(f.handler(t))
	t.Cleanup(srv.Close)
	return mirror.NewSupabase(srv.URL, "service-key", opts...)
}

func TestUpsertPointsSendsOneMergingUpsertPerBatch(t *testing.T) {
	t.Parallel()
	f := newFake()
	s := newStore(t, f, mirror.WithBatchSize(2))

	rows := []mirror.Row{
		{GameID: "bully-ps2", Date: "2026-09-05", Res: "d", Loose: cents(1500), CIB: cents(3000), NL: 5, NC: 6, V: 1},
		{GameID: "bully-ps2", Date: "2026-09-06", Res: "d", Loose: cents(1600), NL: 4, V: 1},
		{GameID: "okami-ps2", Date: "2026-09-06", Res: "d", CIB: cents(2000), NC: 7, V: 1},
	}
	if err := s.UpsertPoints(context.Background(), rows); err != nil {
		t.Fatal(err)
	}

	if len(f.bodies) != 2 {
		t.Fatalf("requests = %d, want 2 batches of at most 2 rows", len(f.bodies))
	}
	req := f.requests[0]
	if got := req.URL.Query().Get("on_conflict"); got != "game_id,d" {
		t.Errorf("on_conflict = %q, want the primary key so a rerun replaces the day", got)
	}
	if got := req.Header.Get("Prefer"); !strings.Contains(got, "resolution=merge-duplicates") {
		t.Errorf("Prefer = %q, want merge-duplicates", got)
	}
	if req.Header.Get("apikey") != "service-key" || req.Header.Get("Authorization") != "Bearer service-key" {
		t.Error("the service key must travel in both apikey and Authorization headers")
	}
	stored := f.rows["bully-ps2|2026-09-05"]
	if stored["loose_cents"] != float64(1500) || stored["cib_cents"] != float64(3000) || stored["nl"] != float64(5) || stored["v"] != float64(1) || stored["r"] != "d" {
		t.Errorf("stored row = %v, want every field of the point", stored)
	}
	if v, ok := stored["new_cents"]; !ok || v != nil {
		t.Errorf("new_cents = %v, want an explicit null so a rerun can clear a price", v)
	}
	if len(f.rows) != 3 {
		t.Errorf("stored rows = %d, want 3", len(f.rows))
	}
}

func TestUpsertPointsWithNothingToSendMakesNoRequest(t *testing.T) {
	t.Parallel()
	f := newFake()
	s := newStore(t, f)
	if err := s.UpsertPoints(context.Background(), nil); err != nil {
		t.Fatal(err)
	}
	if len(f.requests) != 0 {
		t.Errorf("requests = %d, want none", len(f.requests))
	}
}

func TestUpsertPointsReportsTheServersAnswer(t *testing.T) {
	t.Parallel()
	f := newFake()
	f.fail = http.StatusInternalServerError
	s := newStore(t, f)
	err := s.UpsertPoints(context.Background(), []mirror.Row{{GameID: "bully-ps2", Date: "2026-09-05", Res: "d"}})
	if err == nil {
		t.Fatal("a 500 was swallowed")
	}
	if !strings.Contains(err.Error(), "500") || !strings.Contains(err.Error(), "boom") {
		t.Errorf("error = %q, want the status and the server's message", err)
	}
}

func TestRecordRunPostsTheRunSummary(t *testing.T) {
	t.Parallel()
	f := newFake()
	s := newStore(t, f)
	err := s.RecordRun(context.Background(), snapshot.Meta{
		GeneratedAt: "2026-09-07T23:03:11Z", Source: "ebay-browse", SeriesVersion: 1,
		Counts: snapshot.Counts{Tracked: 291, OK: 257, Stale: 1, Failed: 34}, APICallsUsed: 291,
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(f.runs) != 1 {
		t.Fatalf("runs = %d, want 1", len(f.runs))
	}
	run := f.runs[0]
	if run["generated_at"] != "2026-09-07T23:03:11Z" || run["series_version"] != float64(1) || run["ok"] != float64(257) || run["api_calls"] != float64(291) {
		t.Errorf("run = %v, want the meta fields", run)
	}
	if got := f.requests[0].URL.Query().Get("on_conflict"); got != "generated_at" {
		t.Errorf("on_conflict = %q, want generated_at so a retry is harmless", got)
	}
}

func TestRowsRoundTripThroughPoints(t *testing.T) {
	t.Parallel()
	p := history.Point{Date: "2026-09-05", Res: "w", Loose: cents(1500), New: cents(9000), NL: 5, NN: 4, V: 2}
	row := mirror.RowFrom("bully-ps2", p)
	back := row.Point()
	if !back.Equal(p) {
		t.Errorf("round trip changed the point: %+v vs %+v", back, p)
	}
	if row.GameID != "bully-ps2" {
		t.Errorf("GameID = %q", row.GameID)
	}
}

// The reason the mirror exists: after the history directory is gone, Pull
// must rebuild it byte for byte from what Push stored.
func TestPushThenPullRebuildsTheHistoryByteForByte(t *testing.T) {
	t.Parallel()
	f := newFake()
	s := newStore(t, f, mirror.WithBatchSize(3), mirror.WithPageSize(2))

	src := t.TempDir()
	write := func(id string, pts ...history.Point) {
		if err := history.Write(filepath.Join(src, "history"), &history.File{ID: id, Points: pts}); err != nil {
			t.Fatal(err)
		}
	}
	write("bully-ps2",
		history.Point{Date: "2026-06-01", Res: "w", Loose: cents(1400), NL: 5, V: 1},
		history.Point{Date: "2026-09-05", Res: "d", Loose: cents(1500), CIB: cents(3000), NL: 5, NC: 6, V: 1},
		history.Point{Date: "2026-09-06", Res: "d", Loose: cents(1600), NL: 4, V: 1})
	write("okami-ps2", history.Point{Date: "2026-09-06", Res: "d", CIB: cents(2000), NC: 7})
	write("gitaroo-man-ps2", history.Point{Date: "2026-09-06", Res: "d", New: cents(9000), NN: 4, V: 1})

	pushed, err := mirror.Push(context.Background(), s, filepath.Join(src, "history"), nil)
	if err != nil {
		t.Fatal(err)
	}
	if pushed != 5 {
		t.Errorf("pushed = %d rows, want 5", pushed)
	}

	dst := t.TempDir()
	pulled, err := mirror.Pull(context.Background(), s, filepath.Join(dst, "history"))
	if err != nil {
		t.Fatal(err)
	}
	if pulled != 3 {
		t.Errorf("pulled = %d files, want 3", pulled)
	}
	for _, id := range []string{"bully-ps2", "okami-ps2", "gitaroo-man-ps2"} {
		want, _ := os.ReadFile(filepath.Join(src, "history", id+".json"))
		got, err := os.ReadFile(filepath.Join(dst, "history", id+".json"))
		if err != nil {
			t.Fatalf("%s not restored: %v", id, err)
		}
		if string(got) != string(want) {
			t.Errorf("%s differs after pull:\nwant\n%s\ngot\n%s", id, want, got)
		}
	}
	// Pages of 2 over 5 rows: three pages with rows and one empty page that
	// says the end was reached. Stopping on a short page instead would
	// silently truncate a restore whenever the server caps a page below
	// the requested size.
	gets := 0
	for _, r := range f.requests {
		if r.Method == http.MethodGet {
			gets++
		}
	}
	if gets != 4 {
		t.Errorf("GET requests = %d, want 4 (three pages plus the empty one)", gets)
	}
}

// Rollup folds dailies into a weekly point and a replay can drop a day. The
// files then hold fewer dates than the copy, so a full push must also remove
// what the files no longer have, or a restore would resurrect stale points.
func TestPushRemovesDatesTheFileNoLongerHas(t *testing.T) {
	t.Parallel()
	f := newFake()
	s := newStore(t, f)
	src := t.TempDir()
	dir := filepath.Join(src, "history")
	before := &history.File{ID: "bully-ps2", Points: []history.Point{
		{Date: "2026-01-05", Res: "d", Loose: cents(1000), NL: 5, V: 1},
		{Date: "2026-01-06", Res: "d", Loose: cents(1200), NL: 5, V: 1},
		{Date: "2026-01-07", Res: "d", Loose: cents(1400), NL: 5, V: 1},
		{Date: "2026-09-06", Res: "d", Loose: cents(1600), NL: 4, V: 1},
	}}
	if err := history.Write(dir, before); err != nil {
		t.Fatal(err)
	}
	if err := history.Write(dir, &history.File{ID: "okami-ps2", Points: []history.Point{{Date: "2026-09-06", Res: "d", CIB: cents(2000), NC: 7, V: 1}}}); err != nil {
		t.Fatal(err)
	}
	if _, err := mirror.Push(context.Background(), s, dir, nil); err != nil {
		t.Fatal(err)
	}

	// The week is compacted: three dailies become one weekly point on the Monday.
	after := &history.File{ID: "bully-ps2", Points: []history.Point{
		{Date: "2026-01-05", Res: "w", Loose: cents(1200), NL: 5, V: 1},
		{Date: "2026-09-06", Res: "d", Loose: cents(1600), NL: 4, V: 1},
	}}
	if err := history.Write(dir, after); err != nil {
		t.Fatal(err)
	}
	if _, err := mirror.Push(context.Background(), s, dir, nil); err != nil {
		t.Fatal(err)
	}

	rows, err := s.Points(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if len(rows) != 3 {
		t.Fatalf("stored rows = %d, want the file's 2 for bully plus okami's 1: %+v", len(rows), rows)
	}
	dst := t.TempDir()
	if _, err := mirror.Pull(context.Background(), s, filepath.Join(dst, "history")); err != nil {
		t.Fatal(err)
	}
	want, _ := os.ReadFile(filepath.Join(dir, "bully-ps2.json"))
	got, _ := os.ReadFile(filepath.Join(dst, "history", "bully-ps2.json"))
	if string(got) != string(want) {
		t.Errorf("pull after a compaction differs from the file:\nwant\n%s\ngot\n%s", want, got)
	}
	if _, ok := f.rows["okami-ps2|2026-09-06"]; !ok {
		t.Error("reconciling one game removed another game's rows")
	}
}

func TestPullOnAnEmptyStoreIsAnErrorNotAnEmptyHistory(t *testing.T) {
	t.Parallel()
	s := newStore(t, newFake())
	dir := filepath.Join(t.TempDir(), "history")
	if _, err := mirror.Pull(context.Background(), s, dir); err == nil {
		t.Fatal("Pull from an empty store succeeded; a restore would silently write nothing")
	}
	if entries, _ := os.ReadDir(dir); len(entries) != 0 {
		t.Error("Pull wrote files from an empty store")
	}
}

func TestPushReportsAMissingHistoryDirectory(t *testing.T) {
	t.Parallel()
	s := newStore(t, newFake())
	if _, err := mirror.Push(context.Background(), s, filepath.Join(t.TempDir(), "nope"), nil); err == nil {
		t.Fatal("Push over a missing directory succeeded with nothing to push")
	}
}

func TestPushRejectsAnIdWithNoHistoryFile(t *testing.T) {
	t.Parallel()
	f := newFake()
	s := newStore(t, f)
	dir := filepath.Join(t.TempDir(), "history")
	if err := history.Write(dir, &history.File{ID: "bully-ps2", Points: []history.Point{{Date: "2026-09-06", Res: "d", Loose: cents(1000), NL: 4, V: 1}}}); err != nil {
		t.Fatal(err)
	}
	if _, err := mirror.Push(context.Background(), s, dir, []string{"bulyy-ps2"}); err == nil {
		t.Fatal("a misspelled id pushed zero rows and looked like success")
	}
	if len(f.rows) != 0 {
		t.Error("rows were written despite the error")
	}
}

func TestPushCanBeLimitedToSomeGames(t *testing.T) {
	t.Parallel()
	f := newFake()
	s := newStore(t, f)
	src := t.TempDir()
	for _, id := range []string{"bully-ps2", "okami-ps2"} {
		if err := history.Write(filepath.Join(src, "history"), &history.File{ID: id, Points: []history.Point{{Date: "2026-09-06", Res: "d", Loose: cents(1000), NL: 4, V: 1}}}); err != nil {
			t.Fatal(err)
		}
	}
	pushed, err := mirror.Push(context.Background(), s, filepath.Join(src, "history"), []string{"okami-ps2"})
	if err != nil {
		t.Fatal(err)
	}
	if pushed != 1 || len(f.rows) != 1 {
		t.Errorf("pushed %d rows, stored %d; want only okami-ps2", pushed, len(f.rows))
	}
}
