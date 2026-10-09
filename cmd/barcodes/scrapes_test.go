package main

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"
	"time"
)

// The history of 8 October 2026: the 09:23 run started at 16:38, the previous
// evening's 21:23 run at 01:05, and the quota reset at 07:00.
func TestScrapesDueCountsTheRunsThatHaveNotFinished(t *testing.T) {
	t.Parallel()
	at := func(day, h, m int) time.Time { return time.Date(2026, 10, day, h, m, 0, 0, time.UTC) }
	reset := at(9, 7, 0)
	previousEvening, morning := at(8, 1, 5), at(8, 16, 38)
	for _, c := range []struct {
		name     string
		now      time.Time
		reset    time.Time
		finished []time.Time
		due      int
	}{
		{"just after the reset", at(8, 7, 30), reset, []time.Time{previousEvening}, 2},
		{"past 09:23, the morning run not started", at(8, 10, 0), reset, []time.Time{previousEvening}, 2},
		{"the morning run done", at(8, 18, 0), reset, []time.Time{previousEvening, morning}, 1},
		{"both done, but a run by hand may come", at(9, 2, 0), reset, []time.Time{previousEvening, morning, at(9, 1, 10)}, 1},
		{"history unread", at(8, 18, 0), reset, nil, 2},
		{"reset unknown", at(8, 18, 0), time.Time{}, []time.Time{morning}, 2},
	} {
		if got := scrapesDue(c.now, c.reset, c.finished); got != c.due {
			t.Errorf("%s: %d scrapes due, want %d", c.name, got, c.due)
		}
	}
}

func TestFinishedScrapesReadsTheScheduledRuns(t *testing.T) {
	t.Parallel()
	var query url.Values
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/repos/owner/shop/actions/workflows/scrape.yml/runs" {
			http.NotFound(w, r)
			return
		}
		query = r.URL.Query()
		_, _ = io.WriteString(w, `{"workflow_runs":[
			{"created_at":"2026-10-08T16:38:11Z","run_started_at":"2026-10-08T16:38:11Z"},
			{"created_at":"2026-10-08T01:05:32Z"}]}`)
	}))
	defer srv.Close()

	got, err := finishedScrapes(context.Background(), srv.URL, "owner/shop", time.Date(2026, 10, 8, 7, 0, 0, 0, time.UTC))
	if err != nil {
		t.Fatal(err)
	}
	want := []time.Time{time.Date(2026, 10, 8, 16, 38, 11, 0, time.UTC), time.Date(2026, 10, 8, 1, 5, 32, 0, time.UTC)}
	if !slices.EqualFunc(got, want, time.Time.Equal) {
		t.Errorf("runs = %v, want %v", got, want)
	}
	if query.Get("event") != "schedule" || query.Get("status") != "completed" || query.Get("created") != ">=2026-10-08T07:00:00Z" {
		t.Errorf("query = %v, want completed scheduled runs since the reset", query)
	}

	if _, err := finishedScrapes(context.Background(), srv.URL, "someone/else", time.Now()); err == nil {
		t.Error("a 404 read as a history")
	}
}

func TestRepoOfReadsTheOrigin(t *testing.T) {
	t.Parallel()
	for remote, want := range map[string]string{
		"git@github.com:rflpazini/retroheat.git":       "rflpazini/retroheat",
		"https://github.com/rflpazini/retroheat.git":   "rflpazini/retroheat",
		"https://github.com/rflpazini/retroheat":       "rflpazini/retroheat",
		"ssh://git@github.com/someone/retro-fork.git/": "someone/retro-fork",
	} {
		m := githubRepo.FindStringSubmatch(remote)
		if m == nil || m[1] != want {
			t.Errorf("%s: got %v, want %s", remote, m, want)
		}
	}
	if githubRepo.MatchString("git@gitlab.com:someone/retroheat.git") {
		t.Error("a GitLab remote read as GitHub")
	}
}

// The reserve is only right while it knows how often the collector runs.
func TestScrapesPerDayMatchTheWorkflow(t *testing.T) {
	t.Parallel()
	raw, err := os.ReadFile(filepath.Join("..", "..", ".github", "workflows", "scrape.yml"))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(raw), `cron: "23 9,21 * * *"`) {
		t.Error("scrape.yml's schedule changed; update scrapesPerDay in cmd/barcodes/scrapes.go to match")
	}
}
