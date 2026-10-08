// Command barcodes fills each catalog entry's barcodes from eBay's catalog,
// so the site's scanner can tell which game a box is.
//
// A listing on eBay is often attached to an eBay product, one per edition,
// and the product carries the codes printed on that edition's box. For every
// entry the command runs the entry's own search, tallies the products of the
// listings the classifier keeps, reads each well-attested product once, and
// writes the codes into the entry. Reprints an entry keeps out of its prices
// (Greatest Hits and the like) get a search of their own, so their boxes scan
// too. With -reports it instead reviews the pairings people made by hand in
// the scanner, checking each against eBay before it joins the catalog.
//
// Searches and item reads draw on the same daily Browse quota as the
// collector, so by default a run spends only what is left after the next
// collector run's share, and remembers what it learned in -cache so the next
// day carries on where this one stopped.
package main

import (
	"cmp"
	"context"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"os"
	"os/signal"
	"path/filepath"
	"slices"
	"strings"
	"syscall"
	"time"

	"github.com/rflpazini/retroheat/internal/budget"
	"github.com/rflpazini/retroheat/internal/catalog"
	"github.com/rflpazini/retroheat/internal/mirror"
	"github.com/rflpazini/retroheat/internal/provider"
	"github.com/rflpazini/retroheat/internal/provider/ebay"
)

func main() { os.Exit(run()) }

// cacheSchema changes when the cache's shape does; an older cache is
// ignored rather than misread.
const cacheSchema = 1

type cacheFile struct {
	Schema   int                     `json:"schema"`
	Games    map[string]found        `json:"games"`
	Products map[string]ebay.Product `json:"products"`
}

// scrapeTimes are the collector's scheduled runs, in UTC, as the cron in
// .github/workflows/scrape.yml has them ("23 9,21 * * *"); a test keeps the
// two in step. eBay's daily quota resets once a day, so every one of these
// still to come before the reset needs its calls left over.
var scrapeTimes = []time.Duration{9*time.Hour + 23*time.Minute, 21*time.Hour + 23*time.Minute}

// perRunMargin is room above one call per game for a run's token and retries.
const perRunMargin = 100

// collectorReserve is how many calls to leave for the collector: a catalog's
// worth for each scheduled run between now and the quota's reset, and never
// less than one run's worth, for a run started by hand.
func collectorReserve(now, reset time.Time, games int) int {
	if !reset.After(now) {
		reset = now.Add(24 * time.Hour)
	}
	runs := 0
	for day := now.UTC().Truncate(24 * time.Hour); day.Before(reset); day = day.Add(24 * time.Hour) {
		for _, at := range scrapeTimes {
			if t := day.Add(at); t.After(now) && t.Before(reset) {
				runs++
			}
		}
	}
	return max(runs, 1) * (games + perRunMargin)
}

// failuresInARow is how many games in a row may fail before the run stops:
// one bad answer is that game's problem, a run of them is eBay's.
const failuresInARow = 5

func run() int {
	var (
		catalogDir  = flag.String("catalog", "./catalog", "directory holding the game catalog")
		platforms   = flag.String("platforms", "", "comma-separated platforms to process (default: all)")
		onlyIDs     = flag.String("only", "", "comma-separated entry ids to process")
		limit       = flag.Int("limit", 0, "ask eBay about at most this many entries (0: no limit), for a pilot; remembered answers do not count")
		force       = flag.Bool("force", false, "ask again about entries that already list barcodes; codes are only ever added (-rejudge removes)")
		dryRun      = flag.Bool("dry-run", false, "ask eBay and report, but do not edit the catalog")
		budgetN     = flag.Int("budget", 0, "most Browse calls to spend (0: what is left today minus -reserve)")
		reserve     = flag.Int("reserve", -1, "calls to leave for the collector when -budget is 0 (-1: a catalog's worth for every scheduled run before the quota resets)")
		minListings = flag.Int("min-listings", 3, "kept listings a product needs before its codes are trusted")
		maxProducts = flag.Int("max-products", 4, "most products read per search")
		cachePath   = flag.String("cache", "./.cache/barcodes.json", "what earlier runs learned, so a run can resume")
		reports     = flag.Bool("reports", false, "review the pairings people made in the scanner instead of harvesting")
		rejudgeOnly = flag.Bool("rejudge", false, "re-check the catalog's codes against the products in -cache, with no calls, and drop the ones today's rules turn down")
		verbose     = flag.Bool("v", false, "print every entry, including those with no codes and rejected products")
	)
	flag.Parse()
	if *budgetN < 0 || *limit < 0 || *minListings < 1 || *maxProducts < 1 {
		fmt.Fprintln(os.Stderr, "barcodes: -budget and -limit cannot be negative, and -min-listings and -max-products must be at least 1")
		return 2
	}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	games, err := catalog.Load(*catalogDir)
	if err == nil {
		err = catalog.Validate(games)
	}
	if err != nil {
		fmt.Fprintln(os.Stderr, "barcodes: catalog:", err)
		return 2
	}

	if *rejudgeOnly {
		cache := loadCache(*cachePath)
		codes, dropped := rejudge(games, cache.Products)
		for _, d := range dropped {
			fmt.Println(d)
		}
		fmt.Printf("%d codes dropped from %d entries\n", len(dropped), len(codes))
		if *dryRun {
			return 0
		}
		if len(codes) > 0 {
			if err := writeBarcodes(*catalogDir, games, codes); err != nil {
				fmt.Fprintln(os.Stderr, "barcodes:", err)
				return 1
			}
		}
		// The remembered answers follow the catalog, or the next harvest
		// would hand the dropped codes straight back.
		pruneCache(cache, games)
		if err := saveCache(*cachePath, cache); err != nil {
			fmt.Fprintln(os.Stderr, "barcodes: cache:", err)
			return 1
		}
		return 0
	}

	id, secret := os.Getenv("EBAY_CLIENT_ID"), os.Getenv("EBAY_CLIENT_SECRET")
	if id == "" || secret == "" {
		fmt.Fprintln(os.Stderr, "barcodes: set EBAY_CLIENT_ID and EBAY_CLIENT_SECRET")
		return 2
	}
	var opts []ebay.Option
	if base := os.Getenv("EBAY_BASE_URL"); base != "" {
		opts = append(opts, ebay.WithBaseURL(base))
	}
	client := ebay.New(id, secret, opts...)

	calls := *budgetN
	if calls == 0 {
		left, reset, err := client.CallsLeft(ctx)
		if err != nil {
			fmt.Fprintln(os.Stderr, "barcodes:", err, "(pass -budget to set it by hand)")
			return 1
		}
		keep := *reserve
		if keep < 0 {
			keep = collectorReserve(time.Now(), reset, len(games))
		}
		calls = left - keep
		if calls <= 0 {
			when := "the quota resets"
			if !reset.IsZero() {
				when = reset.Local().Format("Mon 15:04")
			}
			fmt.Fprintf(os.Stderr, "barcodes: %d Browse calls left today and the collector needs %d; try after %s\n", left, keep, when)
			return 1
		}
		fmt.Fprintf(os.Stderr, "barcodes: %d calls left today, %d kept for the collector, spending at most %d\n", left, keep, calls)
	}
	b := budget.New(calls)

	if *reports {
		return runReports(ctx, client, games, *catalogDir, b, *dryRun)
	}

	todo, err := selectGames(games, *platforms, *onlyIDs, *force)
	if err != nil {
		fmt.Fprintln(os.Stderr, "barcodes:", err)
		return 2
	}

	cache := loadCache(*cachePath)
	// Whatever was learned is kept however the run ends, so a stopped run
	// never pays for the same answers twice.
	defer func() {
		if err := saveCache(*cachePath, cache); err != nil {
			fmt.Fprintln(os.Stderr, "barcodes: cache:", err)
		}
	}()
	carrying := carriedBy(cache.Products)
	s := settings{minListings: *minListings, maxProducts: *maxProducts}
	harvested := map[string]found{}
	var stopped error
	asked, failed := 0, 0
	for i, g := range todo {
		// -force asks again; otherwise a game already asked about under the
		// same query is not paid for twice, and what it found is held to
		// today's rules.
		if f, ok := cache.Games[g.ID]; ok && f.Query == g.Ebay.Query && !*force {
			f.Codes = stillVouched(g, f.Codes, carrying)
			harvested[g.ID] = f
			continue
		}
		// Past the limit only remembered answers are used, so a pilot still
		// reports every entry it has already asked about.
		if *limit > 0 && asked == *limit {
			continue
		}
		asked++
		f, err := harvestGame(ctx, client, g, b, cache.Products, s)
		if errors.Is(err, errBudget) || errors.Is(err, provider.ErrRateLimited) || ctx.Err() != nil {
			stopped = cmp.Or(ctx.Err(), err)
			fmt.Fprintf(os.Stderr, "barcodes: stopped at %s (%d of %d): %v\n", g.ID, i+1, len(todo), stopped)
			break
		}
		if err != nil {
			failed++
			fmt.Fprintf(os.Stderr, "barcodes: %s: %v; asked again next run\n", g.ID, err)
			if failed == failuresInARow {
				stopped = err
				fmt.Fprintf(os.Stderr, "barcodes: %d games in a row failed; stopping\n", failed)
				break
			}
			continue
		}
		failed = 0
		harvested[g.ID] = f
		if !f.Retry {
			cache.Games[g.ID] = f
		}
		if asked%10 == 0 {
			if err := saveCache(*cachePath, cache); err != nil {
				fmt.Fprintln(os.Stderr, "barcodes: cache:", err)
				return 1
			}
		}
	}

	codes, conflicts := assign(games, harvested)
	report(os.Stdout, todo, harvested, codes, conflicts, b.Used(), *verbose)

	if !*dryRun && len(codes) > 0 {
		if err := writeBarcodes(*catalogDir, games, codes); err != nil {
			fmt.Fprintln(os.Stderr, "barcodes:", err)
			return 1
		}
		fmt.Printf("\nwrote barcodes for %d entries; run `collector -catalog-only` to publish data/barcodes.json\n", len(codes))
	}
	switch {
	case errors.Is(stopped, errBudget):
		fmt.Println("\nthe day's share is spent; run again after the quota resets and it carries on from -cache")
	case errors.Is(stopped, provider.ErrRateLimited):
		fmt.Println("\neBay is rate limiting; run again later and it carries on from -cache")
	case stopped != nil:
		return 1
	}
	return 0
}

func runReports(ctx context.Context, src source, games []catalog.Game, catalogDir string, b *budget.Budget, dryRun bool) int {
	url, key := os.Getenv("SUPABASE_URL"), os.Getenv("SUPABASE_SERVICE_ROLE_KEY")
	if url == "" || key == "" {
		fmt.Fprintln(os.Stderr, "barcodes: -reports needs SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (Project Settings → API → service_role)")
		return 2
	}
	rs, err := mirror.NewSupabase(url, key).BarcodeReports(ctx)
	if err != nil {
		fmt.Fprintln(os.Stderr, "barcodes:", err)
		return 1
	}
	// A stop part-way (budget, rate limit, interrupt) keeps what was
	// confirmed before it; anything else is a failure.
	accepted, notes, err := review(ctx, src, games, rs, b)
	partial := errors.Is(err, errBudget) || errors.Is(err, provider.ErrRateLimited) || ctx.Err() != nil
	if err != nil && !partial {
		fmt.Fprintln(os.Stderr, "barcodes:", err)
		return 1
	}
	n := 0
	for _, bcs := range accepted {
		n += len(bcs)
	}
	fmt.Printf("%d pairings from people, %d codes confirmed, %d calls spent\n", len(rs), n, b.Used())
	for _, note := range notes {
		fmt.Println("  ", note)
	}
	if partial {
		fmt.Printf("stopped part-way (%v); the rest wait for the next run\n", err)
	}
	if dryRun || len(accepted) == 0 {
		return 0
	}
	if err := writeBarcodes(catalogDir, games, withExisting(games, accepted)); err != nil {
		fmt.Fprintln(os.Stderr, "barcodes:", err)
		return 1
	}
	fmt.Println("run `collector -catalog-only` to publish data/barcodes.json")
	return 0
}

// selectGames narrows the catalog to what this run should ask about: by
// platform and id, skipping entries that already list codes unless forced.
func selectGames(games []catalog.Game, platforms, only string, force bool) ([]catalog.Game, error) {
	onPlatform := set(platforms)
	ids := set(only)
	known := map[string]bool{}
	for _, g := range games {
		known[g.ID] = true
	}
	for id := range ids {
		if !known[id] {
			return nil, fmt.Errorf("no such catalog entry: %s", id)
		}
	}
	var todo []catalog.Game
	for _, g := range games {
		switch {
		case len(onPlatform) > 0 && !onPlatform[string(g.Platform)]:
		case len(ids) > 0 && !ids[g.ID]:
		case len(g.Barcodes) > 0 && !force:
		default:
			todo = append(todo, g)
		}
	}
	return todo, nil
}

func set(csv string) map[string]bool {
	out := map[string]bool{}
	for _, v := range strings.Split(csv, ",") {
		if v = strings.ToLower(strings.TrimSpace(v)); v != "" {
			out[v] = true
		}
	}
	return out
}

func loadCache(path string) cacheFile {
	c := cacheFile{Schema: cacheSchema, Games: map[string]found{}, Products: map[string]ebay.Product{}}
	raw, err := os.ReadFile(path)
	if err != nil {
		return c
	}
	var onDisk cacheFile
	if json.Unmarshal(raw, &onDisk) != nil || onDisk.Schema != cacheSchema {
		return c
	}
	if onDisk.Games != nil {
		c.Games = onDisk.Games
	}
	if onDisk.Products != nil {
		c.Products = onDisk.Products
	}
	return c
}

func saveCache(path string, c cacheFile) error {
	raw, err := json.MarshalIndent(c, "", " ")
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	tmp := path + ".tmp"
	if err := os.WriteFile(tmp, raw, 0o644); err != nil {
		return err
	}
	return os.Rename(tmp, path)
}

// report prints coverage per platform, then every conflict, then (with -v)
// each entry's codes and the products that were turned down.
func report(w *os.File, todo []catalog.Game, harvested map[string]found, codes map[string][]catalog.Barcode, conflicts []string, used int, verbose bool) {
	type tally struct{ asked, coded int }
	per := map[catalog.Platform]*tally{}
	for _, g := range todo {
		if _, ok := harvested[g.ID]; !ok {
			continue
		}
		if per[g.Platform] == nil {
			per[g.Platform] = &tally{}
		}
		per[g.Platform].asked++
		if len(codes[g.ID]) > 0 {
			per[g.Platform].coded++
		}
	}
	fmt.Fprintf(w, "%d Browse calls spent\n\n", used)
	for _, p := range catalog.Platforms {
		if t := per[p]; t != nil {
			fmt.Fprintf(w, "  %-10s %4d of %4d entries have a code (%.0f%%)\n", p, t.coded, t.asked, 100*float64(t.coded)/float64(t.asked))
		}
	}
	if len(conflicts) > 0 {
		fmt.Fprintf(w, "\n%d codes left out because more than one entry claims them:\n", len(conflicts))
		for _, c := range conflicts {
			fmt.Fprintln(w, "  ", c)
		}
	}
	if !verbose {
		return
	}
	fmt.Fprintln(w)
	ids := make([]string, 0, len(harvested))
	for id := range harvested {
		ids = append(ids, id)
	}
	slices.Sort(ids)
	for _, id := range ids {
		f := harvested[id]
		var cs []string
		for _, b := range codes[id] {
			c := b.Code
			if b.Variant != "" {
				c += " (" + string(b.Variant) + ")"
			}
			cs = append(cs, c)
		}
		if len(cs) == 0 {
			cs = []string{"—"}
		}
		fmt.Fprintf(w, "%-48s kept %3d  %s\n", id, f.Kept, strings.Join(cs, ", "))
		for _, r := range f.Rejected {
			fmt.Fprintln(w, "    turned down:", r)
		}
	}
}
