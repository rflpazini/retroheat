package ebay

import (
	"regexp"
	"strings"
	"sync"

	"github.com/rflpazini/retroheat/internal/catalog"
)

// BuildQuery turns a catalog entry into an eBay keyword query, pushing the
// per-game exclusions into the search itself so that sequels, bundles and
// reprints never reach the classifier.
func BuildQuery(g catalog.Game) string {
	var b strings.Builder
	b.WriteString(strings.TrimSpace(g.Ebay.Query))
	for _, n := range g.Ebay.Negative {
		n = strings.TrimSpace(n)
		if n == "" {
			continue
		}
		b.WriteString(" -")
		if strings.ContainsRune(n, ' ') {
			b.WriteString(`"` + n + `"`)
		} else {
			b.WriteString(n)
		}
	}
	return b.String()
}

// excluded reports whether a listing title contains one of the catalog's
// negative terms as whole words. Substring matching would make "episode i"
// exclude "Episode II" and "Episode III", which is exactly the sequel the term
// is there to keep, not to remove.
func excluded(title string, negatives []string) bool {
	lower := strings.ToLower(title)
	for _, n := range negatives {
		n = strings.ToLower(strings.TrimSpace(n))
		if n == "" {
			continue
		}
		if negativeRe(n).MatchString(lower) {
			return true
		}
	}
	return false
}

var (
	negMu    sync.Mutex
	negCache = map[string]*regexp.Regexp{}
)

func negativeRe(term string) *regexp.Regexp {
	negMu.Lock()
	defer negMu.Unlock()
	if re, ok := negCache[term]; ok {
		return re
	}
	re := regexp.MustCompile(`\b` + regexp.QuoteMeta(term) + `\b`)
	negCache[term] = re
	return re
}
