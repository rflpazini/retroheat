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

// WideQuery is the second search for a game the first one could not price: the
// entry's query with every group of alternatives cut to its first one and no
// exclusions. eBay matches each word of a query literally once it holds an
// exclusion or a group, so "Garou Mark of the Wolves" misses the listing that
// says "Garou: MOTW"; a plain query lets eBay match spellings and drop a word
// when few listings carry them all. That also brings in other games and other
// consoles, so the exclusions still apply to every title locally, and a title
// that never names the entry's console is dropped. It returns "" when the
// first search already was the plain one.
func WideQuery(g catalog.Game) string {
	q := groupRe.ReplaceAllStringFunc(strings.TrimSpace(g.Ebay.Query), func(group string) string {
		first, _, _ := strings.Cut(strings.Trim(group, "()"), ",")
		return strings.Trim(strings.TrimSpace(first), `"`)
	})
	q = strings.Join(strings.Fields(q), " ")
	if q == BuildQuery(g) {
		return ""
	}
	return q
}

var groupRe = regexp.MustCompile(`\([^()]*\)`)

// platformNames is every way sellers write each console in a title. The long
// names are matched even when glued to a neighbour ("GameCube2002", "2PS2"),
// which is how eBay itself reads them; the short ones need a word of their
// own, and a console number must not run on into a year ("Sony PlayStation,
// 2001" is the first PlayStation). Handhelds that also play an earlier one's
// cartridges accept its name: a Game Boy Color cartridge is often listed as
// plain "Game Boy".
var platformNames = map[catalog.Platform]*regexp.Regexp{
	catalog.PS2:       regexp.MustCompile(`(ps ?2|play ?station ?(2|two))([^0-9]|$)`),
	catalog.PS3:       regexp.MustCompile(`(ps ?3|play ?station ?(3|three))([^0-9]|$)`),
	catalog.GameCube:  regexp.MustCompile(`game ?cube|\b(gcn|ngc|gc)\b`),
	catalog.PSP:       regexp.MustCompile(`psp|play ?station portable|\bumd\b`),
	catalog.Vita:      regexp.MustCompile(`vita|\bpsv\b`),
	catalog.N64:       regexp.MustCompile(`(n64|nintendo ?64)([^0-9]|$)|\bn 64\b`),
	catalog.Dreamcast: regexp.MustCompile(`dream ?cast|\bdc\b`),
	catalog.GB:        regexp.MustCompile(`game ?boy|\b(gb|dmg)\b`),
	catalog.GBC:       regexp.MustCompile(`game ?boy|gbc|\bgb\b`),
	catalog.GBA:       regexp.MustCompile(`game ?boy|gba|\bgb\b`),
}

var notAlnum = regexp.MustCompile(`[^a-z0-9]+`)

// namesPlatform reports whether a listing title names the entry's console in
// any spelling sellers use. A widened search returns the same game on other
// consoles, and a title that never says which console it is for cannot be
// told apart from them. A literal search finds a few honest titles that leave
// the console out (eBay also matches the listing's item specifics); dropping
// those costs about one kept listing in three thousand.
func namesPlatform(title string, p catalog.Platform) bool {
	re, ok := platformNames[p]
	if !ok {
		return true
	}
	return re.MatchString(notAlnum.ReplaceAllString(strings.ToLower(title), " "))
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

// hasRequired reports whether a listing title contains every one of the
// entry's required words, matched the way exclusions are.
func hasRequired(title string, required []string) bool {
	for _, r := range required {
		if strings.TrimSpace(r) != "" && !excluded(title, []string{r}) {
			return false
		}
	}
	return true
}

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
	// A region word in the game's own name says nothing about the copy:
	// every listing of PGA European Tour says "European".
	own := strings.ToLower(g.Title)
	for _, terms := range [][]string{japaneseTerms, palTerms, otherTerms} {
		for _, t := range terms {
			if re := negativeRe(t); re.MatchString(own) {
				title = re.ReplaceAllString(title, " ")
			}
		}
	}
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
	switch {
	case g.Platform.Boxed():
		return classify.Boxed
	case g.Platform.Carded():
		return classify.Carded
	default:
		return classify.Cased
	}
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
