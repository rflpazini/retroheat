package ebay

import (
	"strings"

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

func excluded(title string, negatives []string) bool {
	lower := strings.ToLower(title)
	for _, n := range negatives {
		n = strings.ToLower(strings.TrimSpace(n))
		if n != "" && strings.Contains(lower, n) {
			return true
		}
	}
	return false
}
