package ebay

import (
	"regexp"
	"strings"
	"sync"

	"github.com/rflpazini/retroheat/internal/catalog"
	"github.com/rflpazini/retroheat/internal/classify"
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
// is there to keep, not to remove. Apostrophes are dropped on both sides, so
// "players choice" also catches "Player's Choice" and the curly "Player’s".
func excluded(title string, negatives []string) bool {
	lower := apostrophes.Replace(strings.ToLower(title))
	for _, n := range negatives {
		n = apostrophes.Replace(strings.ToLower(strings.TrimSpace(n)))
		if n == "" {
			continue
		}
		if negativeRe(n).MatchString(lower) {
			return true
		}
	}
	return false
}

var apostrophes = strings.NewReplacer("'", "", "’", "", "‘", "")

// Terms that mark a copy from another region. The catalog tracks the North
// American release unless an entry says otherwise, and a Japanese Mario Kart
// 64 complete in box asks a quarter of what the US one does, so letting it
// into the bucket is as wrong as counting a different game. Sellers
// abbreviate freely ("JP", "JPN") and Asian, Korean and Russian pressings
// turn up on the US site too.
var (
	japaneseTerms = []string{"japan", "japanese", "jpn", "jp", "ntsc-j", "ntsc j"}
	palTerms      = []string{
		"pal", "european", "europe", "euro", "uk", "germany", "german",
		"australia", "australian",
	}
	otherTerms = []string{
		"import", "imports", "korea", "korean", "taiwan", "asia", "asian",
		"russia", "russian",
	}
	// "Made in Japan" is printed on North American cartridges and some
	// sellers copy it into the title; it says where the cart was made, not
	// which market it was sold in.
	madeInJapan = strings.NewReplacer("made in japan", " ")
)

// foreign reports whether a listing is a copy from a region other than the
// one the catalog entry tracks. A North American entry drops Japanese, PAL
// and other imports; a PAL entry drops Japanese copies, which are cheaper
// and sold with exactly the words a US entry would use to spot them; a
// Japanese entry drops PAL copies. The entry's own region is never used as
// an exclusion, since its listings are described with those very words.
func foreign(title string, g catalog.Game) bool {
	title = madeInJapan.Replace(strings.ToLower(title))
	switch g.Region {
	case catalog.RegionPAL:
		return excluded(title, japaneseTerms)
	case catalog.RegionNTSCJ:
		return excluded(title, palTerms)
	default:
		return excluded(title, japaneseTerms) || excluded(title, palTerms) || excluded(title, otherTerms)
	}
}

// mediaOf tells the classifier how the platform packaged its games.
func mediaOf(g catalog.Game) classify.Media {
	if g.Platform.Boxed() {
		return classify.Boxed
	}
	return classify.Cased
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
