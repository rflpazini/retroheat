// Package mirror keeps a second copy of the price history in Supabase. Git is
// the first copy; this one survives anything that happens to the repository
// and can be queried as a timeline. The collector pushes each run's points,
// cmd/mirror backfills or restores whole histories, and only the service role
// writes: the anon key the site ships with can read, never change.
package mirror

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"slices"
	"strings"
	"time"

	"github.com/rflpazini/retroheat/internal/history"
	"github.com/rflpazini/retroheat/internal/snapshot"
)

// Row is one history point as the price_points table stores it. Prices are
// pointers without omitempty so a rerun that lost a bucket writes an explicit
// null instead of leaving yesterday's value behind.
type Row struct {
	GameID string `json:"game_id"`
	Date   string `json:"d"`
	Res    string `json:"r"`
	Loose  *int64 `json:"loose_cents"`
	CIB    *int64 `json:"cib_cents"`
	New    *int64 `json:"new_cents"`
	NL     int    `json:"nl"`
	NC     int    `json:"nc"`
	NN     int    `json:"nn"`
	V      int    `json:"v"`
}

func RowFrom(gameID string, p history.Point) Row {
	return Row{GameID: gameID, Date: p.Date, Res: p.Res, Loose: p.Loose, CIB: p.CIB, New: p.New, NL: p.NL, NC: p.NC, NN: p.NN, V: p.V}
}

func (r Row) Point() history.Point {
	return history.Point{Date: r.Date, Res: r.Res, Loose: r.Loose, CIB: r.CIB, New: r.New, NL: r.NL, NC: r.NC, NN: r.NN, V: r.V}
}

// Writer is what a collector run needs: add today's points, note the run.
type Writer interface {
	UpsertPoints(ctx context.Context, rows []Row) error
	RecordRun(ctx context.Context, m snapshot.Meta) error
}

// Store is what a full push or a restore needs. Supabase implements both
// interfaces; tests use recording fakes.
type Store interface {
	UpsertPoints(ctx context.Context, rows []Row) error
	// DeleteOtherDates removes the game's rows for every date not in keep,
	// which is how a rollup or a replay reaches the copy.
	DeleteOtherDates(ctx context.Context, gameID string, keep []string) error
	// Points returns every stored row, ordered by game then date.
	Points(ctx context.Context) ([]Row, error)
}

// Supabase talks to PostgREST with the service role key.
type Supabase struct {
	http      *http.Client
	baseURL   string
	key       string
	batchSize int
	pageSize  int
}

type Option func(*Supabase)

func WithHTTPClient(h *http.Client) Option { return func(s *Supabase) { s.http = h } }

// WithBatchSize caps the rows per upsert request.
func WithBatchSize(n int) Option { return func(s *Supabase) { s.batchSize = n } }

// WithPageSize caps the rows per read request.
func WithPageSize(n int) Option { return func(s *Supabase) { s.pageSize = n } }

func NewSupabase(baseURL, serviceKey string, opts ...Option) *Supabase {
	s := &Supabase{
		http:      &http.Client{Timeout: 60 * time.Second},
		baseURL:   strings.TrimSuffix(baseURL, "/"),
		key:       serviceKey,
		batchSize: 500,
		pageSize:  1000,
	}
	for _, o := range opts {
		o(s)
	}
	return s
}

func (s *Supabase) UpsertPoints(ctx context.Context, rows []Row) error {
	for start := 0; start < len(rows); start += s.batchSize {
		end := min(start+s.batchSize, len(rows))
		if err := s.write(ctx, "price_points", "game_id,d", rows[start:end]); err != nil {
			return fmt.Errorf("upsert points %d-%d of %d: %w", start, end, len(rows), err)
		}
	}
	return nil
}

type runRow struct {
	GeneratedAt   string `json:"generated_at"`
	Source        string `json:"source"`
	SeriesVersion int    `json:"series_version"`
	Tracked       int    `json:"tracked"`
	OK            int    `json:"ok"`
	Stale         int    `json:"stale"`
	Failed        int    `json:"failed"`
	APICalls      int    `json:"api_calls"`
}

func (s *Supabase) RecordRun(ctx context.Context, m snapshot.Meta) error {
	row := runRow{
		GeneratedAt: m.GeneratedAt, Source: m.Source, SeriesVersion: m.SeriesVersion,
		Tracked: m.Counts.Tracked, OK: m.Counts.OK, Stale: m.Counts.Stale, Failed: m.Counts.Failed,
		APICalls: m.APICallsUsed,
	}
	if err := s.write(ctx, "collector_runs", "generated_at", row); err != nil {
		return fmt.Errorf("record run: %w", err)
	}
	return nil
}

// write is a PostgREST upsert: POST with merge-duplicates on the given
// conflict target, so repeating a request is harmless.
func (s *Supabase) write(ctx context.Context, table, onConflict string, body any) error {
	payload, err := json.Marshal(body)
	if err != nil {
		return err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost,
		s.baseURL+"/rest/v1/"+table+"?on_conflict="+url.QueryEscape(onConflict), bytes.NewReader(payload))
	if err != nil {
		return err
	}
	s.authorize(req)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Prefer", "resolution=merge-duplicates,return=minimal")
	return s.do(req, nil)
}

func (s *Supabase) DeleteOtherDates(ctx context.Context, gameID string, keep []string) error {
	q := url.Values{"game_id": {"eq." + gameID}}
	if len(keep) > 0 {
		q.Set("d", "not.in.("+strings.Join(keep, ",")+")")
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodDelete, s.baseURL+"/rest/v1/price_points?"+q.Encode(), nil)
	if err != nil {
		return err
	}
	s.authorize(req)
	req.Header.Set("Prefer", "return=minimal")
	if err := s.do(req, nil); err != nil {
		return fmt.Errorf("delete stale dates of %s: %w", gameID, err)
	}
	return nil
}

// Points reads the whole table a page at a time. Only an empty page means the
// end: a short page could be the server capping a page below the size asked
// for, and stopping there would silently truncate a restore.
func (s *Supabase) Points(ctx context.Context) ([]Row, error) {
	var all []Row
	for offset := 0; ; offset += s.pageSize {
		q := url.Values{
			"select": {"game_id,d,r,loose_cents,cib_cents,new_cents,nl,nc,nn,v"},
			"order":  {"game_id.asc,d.asc"},
			"limit":  {fmt.Sprint(s.pageSize)},
			"offset": {fmt.Sprint(offset)},
		}
		req, err := http.NewRequestWithContext(ctx, http.MethodGet, s.baseURL+"/rest/v1/price_points?"+q.Encode(), nil)
		if err != nil {
			return nil, err
		}
		s.authorize(req)
		var page []Row
		if err := s.do(req, &page); err != nil {
			return nil, fmt.Errorf("read points at offset %d: %w", offset, err)
		}
		if len(page) == 0 {
			return all, nil
		}
		all = append(all, page...)
	}
}

func (s *Supabase) authorize(req *http.Request) {
	req.Header.Set("apikey", s.key)
	req.Header.Set("Authorization", "Bearer "+s.key)
}

func (s *Supabase) do(req *http.Request, out any) error {
	resp, err := s.http.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode > 299 {
		msg, _ := io.ReadAll(io.LimitReader(resp.Body, 2048))
		return fmt.Errorf("supabase answered %d: %s", resp.StatusCode, strings.TrimSpace(string(msg)))
	}
	if out == nil {
		return nil
	}
	return json.NewDecoder(resp.Body).Decode(out)
}

// Push makes the copy match the history files under dir, or only the given
// ids: every point on disk is written, then every date the files no longer
// hold is removed, so the copy converges whether points were added, replaced
// by a rollup, or dropped by a replay. It reports how many rows were written.
func Push(ctx context.Context, store Store, dir string, ids []string) (int, error) {
	if ids == nil {
		entries, err := os.ReadDir(dir)
		if err != nil {
			return 0, fmt.Errorf("read history dir %s: %w", dir, err)
		}
		for _, e := range entries {
			if !e.IsDir() && strings.HasSuffix(e.Name(), ".json") {
				ids = append(ids, strings.TrimSuffix(e.Name(), ".json"))
			}
		}
	} else {
		// An explicit id with no file is a typo, not an empty history.
		for _, id := range ids {
			if _, err := os.Stat(history.Path(dir, id)); err != nil {
				return 0, fmt.Errorf("no history file for %q: %w", id, err)
			}
		}
	}
	slices.Sort(ids)

	var rows []Row
	dates := make(map[string][]string, len(ids))
	for _, id := range ids {
		f, err := history.Read(dir, id)
		if err != nil {
			return 0, err
		}
		for _, p := range f.Points {
			rows = append(rows, RowFrom(id, p))
			dates[id] = append(dates[id], p.Date)
		}
	}
	if err := store.UpsertPoints(ctx, rows); err != nil {
		return 0, err
	}
	for _, id := range ids {
		if err := store.DeleteOtherDates(ctx, id, dates[id]); err != nil {
			return 0, err
		}
	}
	return len(rows), nil
}

// Pull rebuilds history files under dir from the store and reports how many
// files it wrote. A file written by Pull is byte-identical to the one Push
// read, which is what makes the store a backup rather than a copy.
func Pull(ctx context.Context, store Store, dir string) (int, error) {
	rows, err := store.Points(ctx)
	if err != nil {
		return 0, err
	}
	if len(rows) == 0 {
		return 0, errors.New("the store holds no points")
	}
	byGame := map[string]*history.File{}
	for _, r := range rows {
		f, ok := byGame[r.GameID]
		if !ok {
			f = &history.File{ID: r.GameID}
			byGame[r.GameID] = f
		}
		history.Upsert(f, r.Point())
	}
	ids := make([]string, 0, len(byGame))
	for id := range byGame {
		ids = append(ids, id)
	}
	slices.Sort(ids)
	for _, id := range ids {
		if err := history.Write(dir, byGame[id]); err != nil {
			return 0, err
		}
	}
	return len(ids), nil
}
