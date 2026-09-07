// Command replay rebuilds history points from archived listings with the
// classifier in force now. After a rule change, download the month's archives
// (`gh release download raw-YYYY-MM -D raw --pattern 'raw-*.json.gz'`), run
// this, and commit the rewritten history: no API calls, nothing wiped.
package main

import (
	"flag"
	"fmt"
	"log/slog"
	"os"
	"time"

	"github.com/rflpazini/retroheat/internal/replay"
)

func main() { os.Exit(run()) }

func run() int {
	var (
		archiveDir = flag.String("archive", "./raw", "directory holding raw-*.json.gz archives")
		dataDir    = flag.String("data", "./data", "directory holding the history to rewrite")
		catalogDir = flag.String("catalog", "./catalog", "directory holding the game catalog")
		from       = flag.String("from", "", "first run day to replay, YYYY-MM-DD (default: all)")
		to         = flag.String("to", "", "last run day to replay, YYYY-MM-DD (default: all)")
		dryRun     = flag.Bool("dry-run", false, "report what would change without writing")
		verbose    = flag.Bool("v", false, "verbose logging")
	)
	flag.Parse()

	level := slog.LevelWarn
	if *verbose {
		level = slog.LevelInfo
	}
	log := slog.New(slog.NewTextHandler(os.Stderr, &slog.HandlerOptions{Level: level}))

	sum, err := replay.Run(replay.Options{
		ArchiveDir: *archiveDir,
		DataDir:    *dataDir,
		CatalogDir: *catalogDir,
		From:       *from,
		To:         *to,
		DryRun:     *dryRun,
		Now:        time.Now().UTC(),
		Log:        log,
	})
	if err != nil {
		log.Error("replay failed", slog.String("err", err.Error()))
		return 1
	}

	verb := "changed"
	if *dryRun {
		verb = "would change"
	}
	fmt.Printf("replay: %d archives read; %d history files %s: %d points replaced, %d added, %d removed; %d records for games no longer tracked\n",
		sum.Runs, sum.Games, verb, sum.Replaced, sum.Added, sum.Removed, sum.Skipped)
	if sum.Removed > 0 {
		fmt.Println("replay: points were removed because their listings yield no publishable price under the current rules." +
			" The data guard refuses removals, so the commit needs a `Data-Reset: <reason>` trailer.")
	}
	return 0
}
