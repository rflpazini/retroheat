// Command enrich fills the factual part of a catalog entry's info block from
// Wikipedia and Wikidata: cover_url, developer, publisher, year, genre, and a
// short about paragraph with its source. It edits the YAML files in place and
// touches only the lines it adds, so comments, ordering and everything a
// contributor wrote survive. It never writes trivia or why: those are the
// editorial layer and stay hand-written.
//
//	go run ./cmd/enrich -catalog ./catalog
//	go run ./cmd/enrich -set dark-cloud-2-ps2="Dark Chronicle"
//
// Wikipedia is used because it needs no credentials, its article descriptions
// ("2012 video game") make a wrong match easy to reject, and the image URLs
// are stable enough to hotlink from a static site. Entries it cannot resolve
// are listed at the end so they can be filled in by hand.
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
	"sort"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"
	"unicode"

	"github.com/rflpazini/retroheat/internal/catalog"
)

// Wikimedia asks API clients to identify themselves; anonymous user agents
// are throttled or refused.
const userAgent = "RetroHeat/0.1 (+https://github.com/rflpazini/retroheat)"

const (
	summaryURL  = "https://en.wikipedia.org/api/rest_v1/page/summary/"
	wikiAPI     = "https://en.wikipedia.org/w/api.php"
	wikidataAPI = "https://www.wikidata.org/w/api.php"
	entityURL   = "https://www.wikidata.org/wiki/Special:EntityData/"
	// pause keeps well under Wikimedia's guidance for unauthenticated clients.
	pause = 250 * time.Millisecond
	// maxRetries bounds how long a 429 or 5xx is retried with backoff.
	maxRetries = 5
	// maxOriginalWidth is the widest image worth hotlinking at full size.
	// Above it the API's 320px thumbnail is used instead.
	maxOriginalWidth = 800
	// aboutMaxChars caps the about paragraph; two sentences usually fit.
	aboutMaxChars = 400
)

// Wikidata properties and the console items used to pick the right release.
const (
	propDeveloper = "P178"
	propPublisher = "P123"
	propGenre     = "P136"
	propPubDate   = "P577"
	propPlatform  = "P400"
)

var platformLabel = map[catalog.Platform]string{
	catalog.PS2:       "PlayStation 2",
	catalog.GameCube:  "GameCube",
	catalog.PSP:       "PlayStation Portable",
	catalog.Vita:      "PlayStation Vita",
	catalog.N64:       "Nintendo 64",
	catalog.Dreamcast: "Dreamcast",
}

var platformQID = map[catalog.Platform]string{
	catalog.PS2:       "Q10680",
	catalog.GameCube:  "Q182172",
	catalog.PSP:       "Q170325",
	catalog.Vita:      "Q188808",
	catalog.N64:       "Q184839",
	catalog.Dreamcast: "Q184198",
}

// platformLaunch is the first year a game could have shipped on each console.
var platformLaunch = map[catalog.Platform]int{
	catalog.PS2:       2000,
	catalog.GameCube:  2001,
	catalog.PSP:       2004,
	catalog.Vita:      2011,
	catalog.N64:       1996,
	catalog.Dreamcast: 1998,
}

// fieldOrder is how new keys are laid out in a fresh info block.
var fieldOrder = []string{"developer", "publisher", "year", "genre", "cover_url", "about", "about_url"}

func main() { os.Exit(run()) }

func run() int {
	var (
		catalogDir = flag.String("catalog", "./catalog", "directory holding the game catalog")
		force      = flag.Bool("force", false, "overwrite fields that already have a value")
		dryRun     = flag.Bool("dry-run", false, "resolve and report, but do not edit the catalog")
		platforms  = flag.String("platforms", "", "comma-separated platforms to process (default: all)")
		verbose    = flag.Bool("v", false, "print every candidate tried")
		workers    = flag.Int("workers", 2, "concurrent lookups")
		onlyIDs    = flag.String("only", "", "comma-separated entry ids to process (default: all needing a field)")
		skipIDs    = flag.String("skip", "", "comma-separated entry ids to leave alone (no usable article)")
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
	only := idSet(*onlyIDs)
	skip := idSet(*skipIDs)

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	games, err := catalog.Load(*catalogDir)
	if err != nil {
		fmt.Fprintln(os.Stderr, "load catalog:", err)
		return 2
	}
	onPlatform := map[catalog.Platform]bool{}
	for _, p := range strings.Split(*platforms, ",") {
		if p = strings.TrimSpace(p); p != "" {
			onPlatform[catalog.Platform(strings.ToLower(p))] = true
		}
	}
	known := map[string]bool{}
	for _, g := range games {
		known[g.ID] = true
	}
	for _, m := range []map[string]bool{only, skip} {
		for id := range m {
			if !known[id] {
				fmt.Fprintf(os.Stderr, "no such catalog entry: %s\n", id)
				return 2
			}
		}
	}
	for id := range overrides {
		if !known[id] {
			fmt.Fprintf(os.Stderr, "-set %s: no such catalog entry\n", id)
			return 2
		}
	}

	// The automatic pass covers everything missing at least one field (or
	// everything, with -force), narrowed by -platforms, -only and -skip.
	var todo []catalog.Game
	skipped := 0
	for _, g := range games {
		if skip[g.ID] || (len(only) > 0 && !only[g.ID]) || (len(onPlatform) > 0 && !onPlatform[g.Platform]) {
			continue
		}
		if !*force && len(missingFields(g)) == 0 {
			skipped++
			continue
		}
		todo = append(todo, g)
	}

	r := &resolver{http: &http.Client{Timeout: 20 * time.Second}, verbose: *verbose}

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
				g := todo[i]
				var o outcome
				if article, ok := overrides[g.ID]; ok {
					o = r.enrich(ctx, g, article)
				} else {
					o = r.enrich(ctx, g, "")
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

	// Wikidata returns item ids; one batched call per 50 turns them into names.
	if err := r.resolveLabels(ctx, outcomes); err != nil {
		fmt.Fprintln(os.Stderr, "wikidata labels:", err)
		return 1
	}

	var (
		edits      = map[catalog.Platform]map[string]map[string]string{}
		unresolved []string
		filled     = map[string]int{}
	)
	for i, g := range todo {
		o := outcomes[i]
		if o.err != nil {
			unresolved = append(unresolved, fmt.Sprintf("%-50s %s", g.ID, o.err))
			continue
		}
		fields := o.fields()
		if !*force {
			want := missingFields(g)
			for k := range fields {
				if !slices.Contains(want, k) {
					delete(fields, k)
				}
			}
		}
		if len(fields) == 0 {
			continue
		}
		keys := make([]string, 0, len(fields))
		for k := range fields {
			keys = append(keys, k)
			filled[k]++
		}
		sort.Strings(keys)
		fmt.Printf("%-50s %s\n", g.ID, o.via)
		for _, k := range keys {
			v := fields[k]
			if k == "about" && len(v) > 90 {
				v = v[:90] + "…"
			}
			fmt.Printf("    %-10s %s\n", k, v)
		}
		if edits[g.Platform] == nil {
			edits[g.Platform] = map[string]map[string]string{}
		}
		edits[g.Platform][g.ID] = fields
	}

	if !*dryRun {
		for p, byGame := range edits {
			path := filepath.Join(*catalogDir, string(p)+".yaml")
			if err := applyEdits(path, byGame); err != nil {
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

	fmt.Printf("\nprocessed %d, unresolved %d, already complete %d\n", len(todo)-len(unresolved), len(unresolved), skipped)
	for _, k := range fieldOrder {
		if filled[k] > 0 {
			fmt.Printf("  %-10s %d\n", k, filled[k])
		}
	}
	if len(unresolved) > 0 {
		fmt.Println("\nunresolved (fill by hand):")
		for _, u := range unresolved {
			fmt.Println("  " + u)
		}
	}
	return 0
}

// missingFields lists the factual info keys an entry has no value for.
func missingFields(g catalog.Game) []string {
	var out []string
	in := g.Info
	if in == nil {
		in = &catalog.Info{}
	}
	if in.Developer == "" {
		out = append(out, "developer")
	}
	if in.Publisher == "" {
		out = append(out, "publisher")
	}
	if in.Year == 0 {
		out = append(out, "year")
	}
	if in.Genre == "" {
		out = append(out, "genre")
	}
	if in.CoverURL == "" {
		out = append(out, "cover_url")
	}
	if in.About == "" {
		out = append(out, "about", "about_url")
	}
	return out
}

type outcome struct {
	via   string
	err   error
	cover string
	about string
	url   string
	year  int
	// Wikidata item ids, resolved to names by resolveLabels.
	developerID, publisherID, genreID string
	developer, publisher, genre       string
}

func (o outcome) fields() map[string]string {
	f := map[string]string{}
	if o.cover != "" {
		f["cover_url"] = o.cover
	}
	if o.about != "" {
		f["about"] = o.about
		f["about_url"] = o.url
	}
	if o.year > 0 {
		f["year"] = strconv.Itoa(o.year)
	}
	if o.developer != "" {
		f["developer"] = o.developer
	}
	if o.publisher != "" {
		f["publisher"] = o.publisher
	}
	if o.genre != "" {
		f["genre"] = o.genre
	}
	return f
}

type resolver struct {
	http    *http.Client
	verbose bool
}

type summary struct {
	Type        string `json:"type"`
	Title       string `json:"title"`
	Description string `json:"description"`
	Extract     string `json:"extract"`
	Thumbnail   *struct {
		Source string `json:"source"`
		Width  int    `json:"width"`
	} `json:"thumbnail"`
	OriginalImage *struct {
		Source string `json:"source"`
		Width  int    `json:"width"`
	} `json:"originalimage"`
}

// enrich resolves the article for one game (or uses the pinned one) and pulls
// everything the info block can take from it.
func (r *resolver) enrich(ctx context.Context, g catalog.Game, pinned string) outcome {
	var (
		s   summary
		via string
		err error
	)
	if pinned != "" {
		s, via, err = r.pinned(ctx, pinned)
	} else {
		s, via, err = r.resolve(ctx, g)
	}
	if err != nil {
		return outcome{err: err}
	}
	o := outcome{via: via, cover: coverOf(s), url: articleURL(s.Title)}
	o.about = firstSentences(s.Extract, 2, aboutMaxChars)

	qid, err := r.wikibaseItem(ctx, s.Title)
	if err != nil {
		return outcome{err: fmt.Errorf("wikidata item: %w", err)}
	}
	if qid == "" {
		return o
	}
	facts, err := r.facts(ctx, qid, platformQID[g.Platform])
	if err != nil {
		return outcome{err: fmt.Errorf("wikidata %s: %w", qid, err)}
	}
	o.developerID, o.publisherID, o.genreID, o.year = facts.developer, facts.publisher, facts.genre, facts.year
	// A game cannot predate its console. When Wikidata only knows the
	// original release of a port, leave the year for a human.
	if o.year != 0 && o.year < platformLaunch[g.Platform] {
		o.year = 0
	}
	return o
}

// resolve tries the article titles Wikipedia most often uses for a game, then
// falls back to a search. Every candidate must describe itself as a video game
// and share its name with the catalog entry, so a film, novel or franchise
// page with the same title is rejected rather than used.
func (r *resolver) resolve(ctx context.Context, g catalog.Game) (summary, string, error) {
	candidates := []string{g.Title + " (video game)"}
	if g.Info != nil && g.Info.Year > 0 {
		candidates = append(candidates, fmt.Sprintf("%s (%d video game)", g.Title, g.Info.Year))
	}
	candidates = append(candidates, g.Title)

	var lastReason string
	for _, c := range candidates {
		s, reason, err := r.try(ctx, g.Title, c, true)
		if err != nil {
			return summary{}, "", err
		}
		if reason == "" {
			return s, describe("article", c, s.Title), nil
		}
		lastReason = reason
	}

	hits, err := r.search(ctx, fmt.Sprintf("%s %s video game", g.Title, platformLabel[g.Platform]))
	if err != nil {
		return summary{}, "", err
	}
	for _, h := range hits {
		s, reason, err := r.try(ctx, g.Title, h, true)
		if err != nil {
			return summary{}, "", err
		}
		if reason == "" {
			return s, describe("search hit", h, s.Title), nil
		}
		lastReason = reason
	}
	if lastReason == "" {
		lastReason = "no article found"
	}
	return summary{}, "", errors.New(lastReason)
}

// pinned fetches an article a human chose with -set. The name check is
// skipped, since the whole point is that the names differ, but the page still
// has to be a game.
func (r *resolver) pinned(ctx context.Context, article string) (summary, string, error) {
	s, reason, err := r.try(ctx, "", article, false)
	if err != nil {
		return summary{}, "", err
	}
	if reason != "" {
		return summary{}, "", errors.New(reason)
	}
	return s, describe("pinned", article, s.Title), nil
}

// describe names the article a result came from, showing the redirect when
// Wikipedia sent the candidate somewhere else, so a wrong hop is visible.
func describe(how, candidate, resolved string) string {
	if candidate == resolved {
		return how + " " + resolved
	}
	return fmt.Sprintf("%s %s -> %s", how, candidate, resolved)
}

// try fetches one article and returns it, or the reason it was rejected.
func (r *resolver) try(ctx context.Context, gameTitle, article string, checkName bool) (s summary, reason string, err error) {
	s, found, err := r.summary(ctx, article)
	if err != nil {
		return summary{}, "", err
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
	default:
		return s, "", nil
	}
	if r.verbose {
		fmt.Fprintln(os.Stderr, "   ", reason)
	}
	return summary{}, reason, nil
}

func coverOf(s summary) string {
	if s.Thumbnail == nil {
		return ""
	}
	if s.OriginalImage != nil && s.OriginalImage.Width <= maxOriginalWidth {
		return stripQuery(s.OriginalImage.Source)
	}
	return stripQuery(s.Thumbnail.Source)
}

func articleURL(title string) string {
	return "https://en.wikipedia.org/wiki/" + url.PathEscape(strings.ReplaceAll(title, " ", "_"))
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
	status, err := r.get(ctx, wikiAPI+"?"+q.Encode(), &res)
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

// wikibaseItem maps an article to its Wikidata item id, or "" if it has none.
func (r *resolver) wikibaseItem(ctx context.Context, title string) (string, error) {
	q := url.Values{
		"action":    {"query"},
		"prop":      {"pageprops"},
		"ppprop":    {"wikibase_item"},
		"titles":    {title},
		"redirects": {"1"},
		"format":    {"json"},
	}
	var res struct {
		Query struct {
			Pages map[string]struct {
				PageProps struct {
					Item string `json:"wikibase_item"`
				} `json:"pageprops"`
			} `json:"pages"`
		} `json:"query"`
	}
	status, err := r.get(ctx, wikiAPI+"?"+q.Encode(), &res)
	if err != nil {
		return "", err
	}
	if status != http.StatusOK {
		return "", fmt.Errorf("pageprops %q: HTTP %d", title, status)
	}
	for _, p := range res.Query.Pages {
		return p.PageProps.Item, nil
	}
	return "", nil
}

type wdFacts struct {
	developer, publisher, genre string
	year                        int
}

type wdClaim struct {
	Rank     string `json:"rank"`
	MainSnak struct {
		DataValue *struct {
			Value json.RawMessage `json:"value"`
		} `json:"datavalue"`
	} `json:"mainsnak"`
	Qualifiers map[string][]struct {
		DataValue *struct {
			Value json.RawMessage `json:"value"`
		} `json:"datavalue"`
	} `json:"qualifiers"`
}

// facts reads the claims that fill the specs table. Multi-platform releases
// carry several publication dates; the one qualified with this catalog's
// platform wins, otherwise the earliest, so a Vita port is dated as the port.
func (r *resolver) facts(ctx context.Context, qid, platform string) (wdFacts, error) {
	var res struct {
		Entities map[string]struct {
			Claims map[string][]wdClaim `json:"claims"`
		} `json:"entities"`
	}
	status, err := r.get(ctx, entityURL+qid+".json", &res)
	if err != nil {
		return wdFacts{}, err
	}
	if status != http.StatusOK {
		return wdFacts{}, fmt.Errorf("HTTP %d", status)
	}
	claims := res.Entities[qid].Claims

	var f wdFacts
	f.developer = firstItem(claims[propDeveloper])
	f.publisher = firstItem(claims[propPublisher])
	f.genre = firstItem(claims[propGenre])

	var onPlatform, any []int
	for _, c := range claims[propPubDate] {
		if c.MainSnak.DataValue == nil || c.Rank == "deprecated" {
			continue
		}
		y := yearOf(c.MainSnak.DataValue.Value)
		if y == 0 {
			continue
		}
		any = append(any, y)
		for _, q := range c.Qualifiers[propPlatform] {
			if q.DataValue != nil && itemID(q.DataValue.Value) == platform {
				onPlatform = append(onPlatform, y)
			}
		}
	}
	switch {
	case len(onPlatform) > 0:
		f.year = slices.Min(onPlatform)
	case len(any) > 0:
		f.year = slices.Min(any)
	}
	return f, nil
}

// firstItem prefers a preferred-rank statement, then the first normal one.
func firstItem(claims []wdClaim) string {
	for _, want := range []string{"preferred", "normal"} {
		for _, c := range claims {
			if c.Rank == want && c.MainSnak.DataValue != nil {
				if id := itemID(c.MainSnak.DataValue.Value); id != "" {
					return id
				}
			}
		}
	}
	return ""
}

func itemID(raw json.RawMessage) string {
	var v struct {
		ID string `json:"id"`
	}
	_ = json.Unmarshal(raw, &v)
	return v.ID
}

func yearOf(raw json.RawMessage) int {
	var v struct {
		Time string `json:"time"`
	}
	if json.Unmarshal(raw, &v) != nil || len(v.Time) < 5 {
		return 0
	}
	// "+2006-10-17T00:00:00Z"
	y, err := strconv.Atoi(v.Time[1:5])
	if err != nil {
		return 0
	}
	return y
}

// resolveLabels turns every Wikidata item id in the outcomes into an English
// name, fifty ids per request. Newer items keep their label under "mul"
// (multiple languages) rather than "en", so both are asked for.
func (r *resolver) resolveLabels(ctx context.Context, outcomes []outcome) error {
	ids := map[string]bool{}
	for _, o := range outcomes {
		for _, id := range []string{o.developerID, o.publisherID, o.genreID} {
			if id != "" {
				ids[id] = true
			}
		}
	}
	all := make([]string, 0, len(ids))
	for id := range ids {
		all = append(all, id)
	}
	sort.Strings(all)

	labels := map[string]string{}
	for start := 0; start < len(all); start += 50 {
		batch := all[start:min(start+50, len(all))]
		q := url.Values{
			"action":    {"wbgetentities"},
			"ids":       {strings.Join(batch, "|")},
			"props":     {"labels"},
			"languages": {"en|mul"},
			"format":    {"json"},
		}
		var res struct {
			Entities map[string]struct {
				Labels map[string]struct {
					Value string `json:"value"`
				} `json:"labels"`
			} `json:"entities"`
		}
		status, err := r.get(ctx, wikidataAPI+"?"+q.Encode(), &res)
		if err != nil {
			return err
		}
		if status != http.StatusOK {
			return fmt.Errorf("wbgetentities: HTTP %d", status)
		}
		for id, e := range res.Entities {
			if l, ok := e.Labels["en"]; ok {
				labels[id] = l.Value
			} else if l, ok := e.Labels["mul"]; ok {
				labels[id] = l.Value
			}
		}
	}
	for i := range outcomes {
		o := &outcomes[i]
		o.developer = labels[o.developerID]
		o.publisher = labels[o.publisherID]
		o.genre = genreLabel(labels[o.genreID])
	}
	return nil
}

// genreLabel turns Wikidata's "action-adventure game" into "Action-adventure".
func genreLabel(l string) string {
	l = strings.TrimSpace(l)
	for _, suffix := range []string{" video game", " game"} {
		l = strings.TrimSuffix(l, suffix)
	}
	if l == "" {
		return ""
	}
	r := []rune(l)
	r[0] = unicode.ToUpper(r[0])
	return string(r)
}

// get fetches JSON, backing off and retrying when Wikimedia answers 429 or
// a 5xx, honouring Retry-After when it is sent.
func (r *resolver) get(ctx context.Context, u string, into any) (int, error) {
	backoff := 2 * time.Second
	for attempt := 0; ; attempt++ {
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
		retry := resp.StatusCode == http.StatusTooManyRequests || resp.StatusCode >= 500
		if retry && attempt < maxRetries {
			_, _ = io.Copy(io.Discard, resp.Body)
			resp.Body.Close()
			wait := backoff
			if ra, err := strconv.Atoi(resp.Header.Get("Retry-After")); err == nil && ra > 0 {
				wait = time.Duration(ra) * time.Second
			}
			if r.verbose {
				fmt.Fprintf(os.Stderr, "    HTTP %d, retrying in %s: %s\n", resp.StatusCode, wait, u)
			}
			select {
			case <-time.After(wait):
			case <-ctx.Done():
				return 0, ctx.Err()
			}
			backoff *= 2
			continue
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

// abbreviations end with a period without ending a sentence.
var abbreviations = map[string]bool{"vs": true, "inc": true, "ltd": true, "co": true, "dr": true, "mr": true, "jr": true, "no": true, "st": true}

// firstSentences returns up to n sentences of text, within maxChars, so a
// Wikipedia lead becomes a two-line about paragraph. It backs off to fewer
// sentences rather than cutting one in half.
func firstSentences(text string, n, maxChars int) string {
	text = strings.Join(strings.Fields(text), " ")
	var ends []int
	rs := []rune(text)
	for i := 0; i < len(rs)-1; i++ {
		if rs[i] != '.' && rs[i] != '!' && rs[i] != '?' {
			continue
		}
		if rs[i+1] != ' ' || i+2 >= len(rs) || !unicode.IsUpper(rs[i+2]) {
			continue
		}
		// The word before the period must not be an abbreviation.
		j := i - 1
		for j >= 0 && rs[j] != ' ' {
			j--
		}
		if abbreviations[strings.ToLower(string(rs[j+1:i]))] {
			continue
		}
		ends = append(ends, i+1)
		if len(ends) == n {
			break
		}
	}
	if len(ends) == 0 {
		if len(rs) <= maxChars && strings.HasSuffix(text, ".") {
			return text
		}
		return ""
	}
	for k := len(ends) - 1; k >= 0; k-- {
		if ends[k] <= maxChars {
			return string(rs[:ends[k]])
		}
	}
	return ""
}

// applyEdits writes new info fields into one platform file. It works on the
// text rather than re-marshalling YAML so nothing else in the file moves.
func applyEdits(path string, byGame map[string]map[string]string) error {
	raw, err := os.ReadFile(path)
	if err != nil {
		return err
	}
	lines := strings.Split(string(raw), "\n")
	ids := make([]string, 0, len(byGame))
	for id := range byGame {
		ids = append(ids, id)
	}
	sort.Strings(ids)
	for _, id := range ids {
		var ok bool
		if lines, ok = setInfoFields(lines, id, byGame[id]); !ok {
			return fmt.Errorf("entry %q not found in %s", id, path)
		}
	}
	return os.WriteFile(path, []byte(strings.Join(lines, "\n")), 0o644)
}

// setInfoFields adds or replaces keys in one entry's info block, opening the
// block after the title when the entry has none. Keys are laid out in
// fieldOrder; year is written as a number, everything else quoted.
func setInfoFields(lines []string, id string, fields map[string]string) ([]string, bool) {
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
	entryEnd := func() int {
		for i := start + 1; i < len(lines); i++ {
			if strings.HasPrefix(lines[i], "  - id: ") {
				return i
			}
		}
		return len(lines)
	}

	infoAt := -1
	for i := start; i < entryEnd(); i++ {
		if strings.TrimRight(lines[i], " ") == "    info:" {
			infoAt = i
			break
		}
	}
	if infoAt < 0 {
		for i := start; i < entryEnd(); i++ {
			if strings.HasPrefix(lines[i], "    title:") {
				lines = insert(lines, i+1, "    info:")
				infoAt = i + 1
				break
			}
		}
		if infoAt < 0 {
			return lines, false
		}
	}

	// Insert in reverse so the final order matches fieldOrder.
	ordered := make([]string, 0, len(fields))
	for _, k := range fieldOrder {
		if _, ok := fields[k]; ok {
			ordered = append(ordered, k)
		}
	}
	for i := len(ordered) - 1; i >= 0; i-- {
		k := ordered[i]
		line := "      " + k + ": " + yamlValue(k, fields[k])
		replaced := false
		for j := infoAt + 1; j < entryEnd(); j++ {
			if strings.HasPrefix(lines[j], "      "+k+":") {
				lines[j] = line
				replaced = true
				break
			}
		}
		if !replaced {
			lines = insert(lines, infoAt+1, line)
		}
	}
	return lines, true
}

func yamlValue(key, v string) string {
	if key == "year" {
		return v
	}
	return strconv.Quote(v)
}

func idSet(csv string) map[string]bool {
	out := map[string]bool{}
	for _, id := range strings.Split(csv, ",") {
		if id = strings.TrimSpace(id); id != "" {
			out[id] = true
		}
	}
	return out
}

func insert(lines []string, at int, add ...string) []string {
	out := make([]string, 0, len(lines)+len(add))
	out = append(out, lines[:at]...)
	out = append(out, add...)
	return append(out, lines[at:]...)
}
