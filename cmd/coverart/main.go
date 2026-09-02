// Command coverart fills info.cover_url for catalog entries that lack one,
// using the infobox image of the game's English Wikipedia article. It edits
// the YAML files in place and touches only the cover_url line, so comments,
// ordering and everything a contributor wrote survive.
//
//	go run ./cmd/coverart -catalog ./catalog
//	go run ./cmd/coverart -set dark-cloud-2-ps2="Dark Chronicle"
//
// Wikipedia is used because it needs no credentials, its article descriptions
// ("2012 video game") make a wrong match easy to reject, and the image URLs are
// stable enough to hotlink from a static site. Entries it cannot resolve are
// listed at the end so they can be filled in by hand.
package main

import (
	"context"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"os/signal"
	"path/filepath"
	"regexp"
	"slices"
	"strings"
	"sync"
	"syscall"
	"time"

	"github.com/rflpazini/retroheat/internal/catalog"
)

// Wikimedia asks API clients to identify themselves; anonymous user agents
// are throttled or refused.
const userAgent = "RetroHeat/0.1 (+https://github.com/rflpazini/retroheat)"

const (
	summaryURL = "https://en.wikipedia.org/api/rest_v1/page/summary/"
	searchURL  = "https://en.wikipedia.org/w/api.php"
	// pause keeps well under Wikimedia's guidance for unauthenticated clients.
	pause = 150 * time.Millisecond
	// maxOriginalWidth is the widest image worth hotlinking at full size.
	// Above it the API's 320px thumbnail is used instead.
	maxOriginalWidth = 800
)

var platformLabel = map[catalog.Platform]string{
	catalog.PS2:       "PlayStation 2",
	catalog.GameCube:  "GameCube",
	catalog.PSP:       "PlayStation Portable",
	catalog.Vita:      "PlayStation Vita",
	catalog.N64:       "Nintendo 64",
	catalog.Dreamcast: "Dreamcast",
}

func main() { os.Exit(run()) }

func run() int {
	var (
		catalogDir = flag.String("catalog", "./catalog", "directory holding the game catalog")
		force      = flag.Bool("force", false, "re-resolve entries that already have a cover_url")
		dryRun     = flag.Bool("dry-run", false, "resolve and report, but do not edit the catalog")
		platforms  = flag.String("platforms", "", "comma-separated platforms to process (default: all)")
		verbose    = flag.Bool("v", false, "print every candidate tried")
		workers    = flag.Int("workers", 4, "concurrent Wikipedia lookups")
		overrides  = map[string]string{}
	)
	flag.Func("set", "id=Wikipedia article to use for that entry, when the automatic match is wrong (repeatable)", func(v string) error {
		id, article, ok := strings.Cut(v, "=")
		if !ok || id == "" || article == "" {
			return fmt.Errorf("want id=Article Title, got %q", v)
		}
		overrides[id] = article
		return nil
	})
	flag.Parse()

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	games, err := catalog.Load(*catalogDir)
	if err != nil {
		fmt.Fprintln(os.Stderr, "load catalog:", err)
		return 2
	}
	only := map[catalog.Platform]bool{}
	for _, p := range strings.Split(*platforms, ",") {
		if p = strings.TrimSpace(p); p != "" {
			only[catalog.Platform(strings.ToLower(p))] = true
		}
	}

	r := &resolver{http: &http.Client{Timeout: 20 * time.Second}, verbose: *verbose}

	// With -set, only the named entries are touched; the automatic pass is
	// for everything that has no cover yet (or everything, with -force).
	var todo []catalog.Game
	skipped := 0
	for _, g := range games {
		if _, forced := overrides[g.ID]; forced {
			todo = append(todo, g)
			continue
		}
		if len(overrides) > 0 || (len(only) > 0 && !only[g.Platform]) {
			continue
		}
		if !*force && g.Info != nil && g.Info.CoverURL != "" {
			skipped++
			continue
		}
		todo = append(todo, g)
	}
	for id := range overrides {
		if !slices.ContainsFunc(todo, func(g catalog.Game) bool { return g.ID == id }) {
			fmt.Fprintf(os.Stderr, "-set %s: no such catalog entry\n", id)
			return 2
		}
	}

	// Lookups run a few at a time; results are kept in catalog order so the
	// report reads the same way every run.
	outcomes := make([]outcome, len(todo))
	jobs := make(chan int)
	var wg sync.WaitGroup
	for w := 0; w < max(1, *workers); w++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for i := range jobs {
				var o outcome
				if article, ok := overrides[todo[i].ID]; ok {
					o.cover, o.via, o.err = r.pinned(ctx, article)
				} else {
					o.cover, o.via, o.err = r.resolve(ctx, todo[i])
				}
				outcomes[i] = o
			}
		}()
	}
	for i := range todo {
		select {
		case jobs <- i:
		case <-ctx.Done():
		}
	}
	close(jobs)
	wg.Wait()
	if ctx.Err() != nil {
		return 130
	}

	var (
		resolved   = map[catalog.Platform]map[string]string{}
		unresolved []string
	)
	for i, g := range todo {
		o := outcomes[i]
		if o.err != nil {
			unresolved = append(unresolved, fmt.Sprintf("%-50s %s", g.ID, o.err))
			continue
		}
		fmt.Printf("%-50s %s\n    %s\n", g.ID, o.via, o.cover)
		if resolved[g.Platform] == nil {
			resolved[g.Platform] = map[string]string{}
		}
		resolved[g.Platform][g.ID] = o.cover
	}

	if !*dryRun {
		for p, covers := range resolved {
			path := filepath.Join(*catalogDir, string(p)+".yaml")
			if err := setCovers(path, covers); err != nil {
				fmt.Fprintln(os.Stderr, "edit", path+":", err)
				return 1
			}
		}
		// Re-load so a malformed edit fails here, not in the next collector run.
		if _, err := catalog.Load(*catalogDir); err != nil {
			fmt.Fprintln(os.Stderr, "catalog no longer loads after edit:", err)
			return 1
		}
	}

	total := 0
	for _, m := range resolved {
		total += len(m)
	}
	fmt.Printf("\nresolved %d, unresolved %d, already had cover %d\n", total, len(unresolved), skipped)
	if len(unresolved) > 0 {
		fmt.Println("\nunresolved (fill info.cover_url by hand):")
		for _, u := range unresolved {
			fmt.Println("  " + u)
		}
	}
	return 0
}

type outcome struct {
	cover, via string
	err        error
}

type resolver struct {
	http    *http.Client
	verbose bool
}

type summary struct {
	Type        string `json:"type"`
	Title       string `json:"title"`
	Description string `json:"description"`
	Thumbnail   *struct {
		Source string `json:"source"`
		Width  int    `json:"width"`
	} `json:"thumbnail"`
	OriginalImage *struct {
		Source string `json:"source"`
		Width  int    `json:"width"`
	} `json:"originalimage"`
}

// resolve tries the article titles Wikipedia most often uses for a game, then
// falls back to a search. Every candidate must describe itself as a video game
// and share its name with the catalog entry, so a film, novel or franchise
// page with the same title is rejected rather than used.
func (r *resolver) resolve(ctx context.Context, g catalog.Game) (cover, via string, err error) {
	candidates := []string{g.Title + " (video game)"}
	if g.Info != nil && g.Info.Year > 0 {
		candidates = append(candidates, fmt.Sprintf("%s (%d video game)", g.Title, g.Info.Year))
	}
	candidates = append(candidates, g.Title)

	var lastReason string
	for _, c := range candidates {
		cover, resolved, reason, err := r.try(ctx, g.Title, c, true)
		if err != nil {
			return "", "", err
		}
		if cover != "" {
			return cover, describe("article", c, resolved), nil
		}
		lastReason = reason
	}

	hits, err := r.search(ctx, fmt.Sprintf("%s %s video game", g.Title, platformLabel[g.Platform]))
	if err != nil {
		return "", "", err
	}
	for _, h := range hits {
		cover, resolved, reason, err := r.try(ctx, g.Title, h, true)
		if err != nil {
			return "", "", err
		}
		if cover != "" {
			return cover, describe("search hit", h, resolved), nil
		}
		lastReason = reason
	}
	if lastReason == "" {
		lastReason = "no article found"
	}
	return "", "", errors.New(lastReason)
}

// pinned fetches the cover of an article a human chose with -set. The name
// check is skipped, since the whole point is that the names differ, but the
// page still has to be a game with an image.
func (r *resolver) pinned(ctx context.Context, article string) (cover, via string, err error) {
	cover, resolved, reason, err := r.try(ctx, "", article, false)
	if err != nil {
		return "", "", err
	}
	if cover == "" {
		return "", "", errors.New(reason)
	}
	return cover, describe("pinned", article, resolved), nil
}

// describe names the article a cover came from, showing the redirect when
// Wikipedia sent the candidate somewhere else, so a wrong hop is visible.
func describe(how, candidate, resolved string) string {
	if candidate == resolved {
		return how + " " + resolved
	}
	return fmt.Sprintf("%s %s -> %s", how, candidate, resolved)
}

// try returns the cover for one article title, or the reason it was rejected.
func (r *resolver) try(ctx context.Context, gameTitle, article string, checkName bool) (cover, resolved, reason string, err error) {
	s, found, err := r.summary(ctx, article)
	if err != nil {
		return "", "", "", err
	}
	switch {
	case !found:
		reason = fmt.Sprintf("%q: no article", article)
	case s.Type != "standard":
		reason = fmt.Sprintf("%q: %s page", article, s.Type)
	case strings.HasPrefix(s.Title, "List of"):
		reason = fmt.Sprintf("%q: resolved to a list page", article)
	case !isVideoGame(s.Description):
		reason = fmt.Sprintf("%q: described as %q", article, s.Description)
	case checkName && !sameGame(gameTitle, s.Title):
		reason = fmt.Sprintf("%q: resolved to unrelated article %q", article, s.Title)
	case s.Thumbnail == nil:
		reason = fmt.Sprintf("%q: article has no image", article)
	default:
		if s.OriginalImage != nil && s.OriginalImage.Width <= maxOriginalWidth {
			return stripQuery(s.OriginalImage.Source), s.Title, "", nil
		}
		return stripQuery(s.Thumbnail.Source), s.Title, "", nil
	}
	if r.verbose {
		fmt.Fprintln(os.Stderr, "   ", reason)
	}
	return "", "", reason, nil
}

func (r *resolver) summary(ctx context.Context, title string) (summary, bool, error) {
	var s summary
	status, err := r.get(ctx, summaryURL+url.PathEscape(title), &s)
	if err != nil {
		return s, false, err
	}
	if status == http.StatusNotFound {
		return s, false, nil
	}
	if status != http.StatusOK {
		return s, false, fmt.Errorf("summary %q: HTTP %d", title, status)
	}
	return s, true, nil
}

func (r *resolver) search(ctx context.Context, query string) ([]string, error) {
	q := url.Values{
		"action":   {"query"},
		"list":     {"search"},
		"format":   {"json"},
		"srlimit":  {"5"},
		"srsearch": {query},
	}
	var res struct {
		Query struct {
			Search []struct {
				Title string `json:"title"`
			} `json:"search"`
		} `json:"query"`
	}
	status, err := r.get(ctx, searchURL+"?"+q.Encode(), &res)
	if err != nil {
		return nil, err
	}
	if status != http.StatusOK {
		return nil, fmt.Errorf("search %q: HTTP %d", query, status)
	}
	titles := make([]string, 0, len(res.Query.Search))
	for _, h := range res.Query.Search {
		titles = append(titles, h.Title)
	}
	return titles, nil
}

func (r *resolver) get(ctx context.Context, u string, into any) (int, error) {
	time.Sleep(pause)
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u, nil)
	if err != nil {
		return 0, err
	}
	req.Header.Set("User-Agent", userAgent)
	req.Header.Set("Accept", "application/json")
	resp, err := r.http.Do(req)
	if err != nil {
		return 0, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		_, _ = io.Copy(io.Discard, resp.Body)
		return resp.StatusCode, nil
	}
	if err := json.NewDecoder(resp.Body).Decode(into); err != nil {
		return 0, fmt.Errorf("decode %s: %w", u, err)
	}
	return resp.StatusCode, nil
}

// isVideoGame reads Wikipedia's short description. Individual games are
// described as "2012 video game", "2010 visual novel" or "2001 role-playing
// game"; the pages to avoid describe a series, a studio or a list.
func isVideoGame(description string) bool {
	d := strings.ToLower(description)
	if !strings.Contains(d, "game") && !strings.Contains(d, "visual novel") {
		return false
	}
	for _, bad := range []string{"series", "franchise", "company", "developer", "publisher", "list of", "character"} {
		if strings.Contains(d, bad) {
			return false
		}
	}
	return true
}

var nonAlnum = regexp.MustCompile(`[^a-z0-9 ]+`)

// sameGame accepts an article whose name contains the catalog title or vice
// versa, after dropping punctuation and any parenthetical. "Marvel vs. Capcom
// 2: New Age of Heroes" matches "Marvel vs. Capcom 2"; "Persona 4" matches
// "Persona 4 Golden" (the enhanced port shares the article). Failing that, at
// least half of the catalog title's words must appear in the article title,
// which is how "Muramasa Rebirth" finds "Muramasa: The Demon Blade".
func sameGame(gameTitle, articleTitle string) bool {
	a := normalize(gameTitle)
	b := normalize(articleTitle)
	if a == "" || b == "" {
		return false
	}
	if strings.Contains(a, b) || strings.Contains(b, a) {
		return true
	}
	have := map[string]bool{}
	for _, w := range strings.Fields(b) {
		have[w] = true
	}
	var words, shared int
	for _, w := range strings.Fields(a) {
		if stopword[w] {
			continue
		}
		words++
		if have[w] {
			shared++
		}
	}
	return words > 0 && shared*2 >= words
}

var stopword = map[string]bool{"the": true, "of": true, "and": true, "a": true, "an": true, "plus": true}

func normalize(s string) string {
	if i := strings.Index(s, " ("); i > 0 {
		s = s[:i]
	}
	s = strings.ToLower(s)
	s = strings.ReplaceAll(s, "&", " and ")
	s = nonAlnum.ReplaceAllString(s, " ")
	return strings.Join(strings.Fields(s), " ")
}

func stripQuery(u string) string {
	if i := strings.IndexByte(u, '?'); i >= 0 {
		return u[:i]
	}
	return u
}

// setCovers writes cover_url lines into one platform file. It works on the
// text rather than re-marshalling YAML so nothing else in the file moves.
func setCovers(path string, covers map[string]string) error {
	raw, err := os.ReadFile(path)
	if err != nil {
		return err
	}
	lines := strings.Split(string(raw), "\n")
	for id, cover := range covers {
		var ok bool
		if lines, ok = setCover(lines, id, cover); !ok {
			return fmt.Errorf("entry %q not found in %s", id, path)
		}
	}
	return os.WriteFile(path, []byte(strings.Join(lines, "\n")), 0o644)
}

func setCover(lines []string, id, cover string) ([]string, bool) {
	start := -1
	for i, l := range lines {
		if strings.TrimRight(l, " ") == "  - id: "+id {
			start = i
			break
		}
	}
	if start < 0 {
		return lines, false
	}
	end := len(lines)
	for i := start + 1; i < len(lines); i++ {
		if strings.HasPrefix(lines[i], "  - id: ") {
			end = i
			break
		}
	}
	coverLine := fmt.Sprintf("      cover_url: %q", cover)

	// Replace an existing cover_url inside the entry's info block.
	for i := start; i < end; i++ {
		if strings.HasPrefix(lines[i], "      cover_url:") {
			lines[i] = coverLine
			return lines, true
		}
	}
	// Otherwise add it as the first key of an existing info block...
	for i := start; i < end; i++ {
		if strings.TrimRight(lines[i], " ") == "    info:" {
			return insert(lines, i+1, coverLine), true
		}
	}
	// ...or open a new info block right after the title.
	for i := start; i < end; i++ {
		if strings.HasPrefix(lines[i], "    title:") {
			return insert(lines, i+1, "    info:", coverLine), true
		}
	}
	return lines, false
}

func insert(lines []string, at int, add ...string) []string {
	out := make([]string, 0, len(lines)+len(add))
	out = append(out, lines[:at]...)
	out = append(out, add...)
	return append(out, lines[at:]...)
}
