package main

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"regexp"
	"strings"
	"time"
)

// scrapesPerDay is how many times .github/workflows/scrape.yml runs the
// collector a day ("23 9,21 * * *"); a test keeps the two in step. eBay's
// quota resets once a day, so each of them needs a catalog's worth of the
// day's calls.
const scrapesPerDay = 2

// perRunMargin is room above one call per game for a run's token, retries and
// the wider second search for games the first one cannot price.
const perRunMargin = 100

// scrapesDue is how many of the quota day's scheduled scrapes have yet to
// finish: those that completed since the last reset are spent already, the
// rest still have to come out of what is left. The clock alone cannot say,
// because GitHub starts scheduled runs hours late (the 09:23 run has started
// as late as 16:40), so finished is when each completed scheduled run started,
// and an unread history (nil) counts every run as still to come. It is never
// below one, for a run started by hand.
func scrapesDue(now, reset time.Time, finished []time.Time) int {
	start := quotaDayStart(now, reset)
	due := scrapesPerDay
	for _, t := range finished {
		if !t.Before(start) && !t.After(now) {
			due--
		}
	}
	return max(due, 1)
}

// quotaDayStart is when the quota last reset. An unknown or past reset makes
// it now, so no run counts as already spent.
func quotaDayStart(now, reset time.Time) time.Time {
	if !reset.After(now) {
		return now
	}
	return reset.Add(-24 * time.Hour)
}

// scrapeHistory reads the finished scheduled scrapes of repo, or of the
// repository the catalog's checkout pushes to when repo is empty.
func scrapeHistory(ctx context.Context, repo, dir string, since time.Time) ([]time.Time, error) {
	if repo == "" {
		var err error
		if repo, err = repoOf(dir); err != nil {
			return nil, err
		}
	}
	api := firstEnv("GITHUB_API_URL")
	if api == "" {
		api = "https://api.github.com"
	}
	ctx, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()
	return finishedScrapes(ctx, api, repo, since)
}

// finishedScrapes reads when each scheduled scrape that completed since `since`
// started, from the repository's Actions history. The history of a public
// repository needs no token; GITHUB_TOKEN or GH_TOKEN is sent when set.
func finishedScrapes(ctx context.Context, api, repo string, since time.Time) ([]time.Time, error) {
	q := url.Values{
		"event":    {"schedule"},
		"status":   {"completed"},
		"created":  {">=" + since.UTC().Format(time.RFC3339)},
		"per_page": {"20"},
	}
	endpoint := fmt.Sprintf("%s/repos/%s/actions/workflows/scrape.yml/runs?%s", strings.TrimSuffix(api, "/"), repo, q.Encode())
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Accept", "application/vnd.github+json")
	if tok := firstEnv("GITHUB_TOKEN", "GH_TOKEN"); tok != "" {
		req.Header.Set("Authorization", "Bearer "+tok)
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("GitHub answered %s", resp.Status)
	}
	var body struct {
		Runs []struct {
			CreatedAt time.Time `json:"created_at"`
			StartedAt time.Time `json:"run_started_at"`
		} `json:"workflow_runs"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		return nil, fmt.Errorf("read GitHub's answer: %w", err)
	}
	out := make([]time.Time, 0, len(body.Runs))
	for _, r := range body.Runs {
		t := r.StartedAt
		if t.IsZero() {
			t = r.CreatedAt
		}
		out = append(out, t)
	}
	return out, nil
}

func firstEnv(names ...string) string {
	for _, n := range names {
		if v := os.Getenv(n); v != "" {
			return v
		}
	}
	return ""
}

var githubRepo = regexp.MustCompile(`github\.com[:/]([^/\s]+/[^/\s]+?)(?:\.git)?/?$`)

// repoOf names the GitHub repository a checkout pushes to, as owner/name.
func repoOf(dir string) (string, error) {
	out, err := exec.Command("git", "-C", dir, "config", "--get", "remote.origin.url").Output()
	if err != nil {
		return "", fmt.Errorf("no git remote: %w", err)
	}
	m := githubRepo.FindStringSubmatch(strings.TrimSpace(string(out)))
	if m == nil {
		return "", fmt.Errorf("origin %q is not on GitHub", strings.TrimSpace(string(out)))
	}
	return m[1], nil
}
