// Package classify sorts eBay listing titles into collectible condition
// buckets and rejects listings that are not the retail game itself.
package classify

import (
	"regexp"
	"strings"
)

type Condition string

const (
	Unknown Condition = ""
	Loose   Condition = "loose"
	CIB     Condition = "cib"
	New     Condition = "new"
)

type Result struct {
	Condition Condition
	Rejected  bool
	Reason    string
}

var (
	junkPhrases = []string{
		"case only", "box only", "manual only", "insert only", "cover art",
		"artwork only", "disc case only", "empty case", "custom case",
		"replacement case", "no disc", "no game", "reproduction",
		"lot of", "game lot", "strategy guide", "guide book",
		"for parts", "not working", "demo disc", "not for resale", "kiosk",
		"download code", "digital code", "digital download",
		// Storefront listings that sell many titles under one item, and
		// multi-game reproduction carts.
		"pick your", "choose your", "you choose", "choose from", "multi cart",
		"multicart", "in-1", "in 1 ", "options)",
	}
	junkWords = []string{
		"repro", "console", "bundle", "poster", "graded", "wata", "lot",
	}

	newPhrases = []string{
		"factory sealed", "brand new", "new sealed", "new in box",
		"shrink wrap", "y-fold", "yfold", "unopened",
	}
	// "bnib" (brand new in box) is a common seller abbreviation and needs its
	// own entry: a word boundary will not find "nib" inside it.
	newWords = []string{"sealed", "nib", "bnib"}

	cibPhrases = []string{
		"complete in box", "complete w/", "complete with",
		"with manual", "w/ manual", "w/manual", "manual included",
	}
	// "w manual" (no slash) is common; as a word-bounded pattern it cannot
	// fire inside "new manual".
	cibWords = []string{"cib", "complete", "w manual"}

	loosePhrases = []string{
		"disc only", "disk only", "cart only", "cartridge only",
		"game only", "umd only", "no manual", "no case", "cartridge alone",
	}
	looseWords = []string{"loose", "unboxed"}

	// Phrases where "complete" belongs to the product name rather than the
	// condition, stripped before the CIB rules run.
	titlePhrases = []string{
		"complete edition", "complete collection", "complete series",
		"complete saga", "complete first", "complete second",
	}
)

var (
	junkRe  = compileWords(junkWords)
	newRe   = compileWords(newWords)
	cibRe   = compileWords(cibWords)
	looseRe = compileWords(looseWords)
)

func compileWords(words []string) []*regexp.Regexp {
	res := make([]*regexp.Regexp, len(words))
	for i, w := range words {
		res[i] = regexp.MustCompile(`\b` + regexp.QuoteMeta(w) + `\b`)
	}
	return res
}

func match(text string, phrases []string, words []*regexp.Regexp) (string, bool) {
	for _, p := range phrases {
		if strings.Contains(text, p) {
			return p, true
		}
	}
	for _, re := range words {
		if re.MatchString(text) {
			return re.String(), true
		}
	}
	return "", false
}

// Classify buckets a listing by its title alone. The marketplace's own
// condition field is deliberately ignored: reproduction cartridges and
// merchandise are routinely listed as "New", so a copy only counts as sealed
// when the seller says so in the title.
func Classify(title string) Result {
	t := strings.ToLower(strings.TrimSpace(title))

	if reason, ok := match(t, junkPhrases, junkRe); ok {
		return Result{Rejected: true, Reason: reason}
	}
	if reason, ok := match(t, newPhrases, newRe); ok {
		return Result{Condition: New, Reason: reason}
	}

	// An explicit statement of what is missing ("disc only", "no manual")
	// outranks "complete": a seller who writes "Complete Case Disc Only - No
	// Manual" is describing an incomplete copy, whatever else the title says.
	if reason, ok := match(t, loosePhrases, nil); ok {
		return Result{Condition: Loose, Reason: reason}
	}

	cibText := t
	for _, p := range titlePhrases {
		cibText = strings.ReplaceAll(cibText, p, " ")
	}
	if reason, ok := match(cibText, cibPhrases, cibRe); ok {
		return Result{Condition: CIB, Reason: reason}
	}
	if reason, ok := match(t, nil, looseRe); ok {
		return Result{Condition: Loose, Reason: reason}
	}
	return Result{Condition: Unknown, Reason: "no-match"}
}

// stopwords carry no identity: "The Legend of Zelda" is identified by
// "legend" and "zelda".
var stopwords = map[string]bool{
	"the": true, "of": true, "a": true, "an": true, "and": true, "vs": true,
	"in": true, "on": true, "at": true, "to": true, "for": true,
}

// romans maps the numerals sellers and publishers use interchangeably, so
// "Shenmue II" and "Shenmue 2" are the same title.
var romans = map[string]string{
	"i": "1", "ii": "2", "iii": "3", "iv": "4", "v": "5", "vi": "6",
	"vii": "7", "viii": "8", "ix": "9", "x": "10", "xi": "11", "xii": "12",
}

// Mentions reports whether a listing is about the named game at all. A
// keyword search also returns storefront listings ("PS2 Games A-C Disc Only
// Tested") and unrelated items that never name the game; those would otherwise
// be bucketed by condition and drag a median toward whatever they cost. At
// least half of the title's significant words must appear, or the title run
// together must appear, since sellers write "Killer 7" for killer7 and the
// reverse.
func Mentions(listingTitle, gameTitle string) bool {
	game := tokens(gameTitle)
	if len(game) == 0 {
		return true
	}
	listing := tokens(listingTitle)
	have := make(map[string]bool, len(listing))
	for _, w := range listing {
		have[w] = true
	}
	shared := 0
	for _, w := range game {
		if have[w] {
			shared++
		}
	}
	if shared*2 >= len(game) && numbersPresent(game, listing) {
		return true
	}
	return strings.Contains(strings.Join(listing, ""), strings.Join(game, ""))
}

// numbersPresent requires every number in the game's title to appear in the
// listing. Half the words of "Persona 4" are in "Persona 3 FES", but a sequel
// number is the whole difference, so it is never optional. "3rd" counts as 3.
func numbersPresent(game, listing []string) bool {
	for _, w := range game {
		if !isNumber(w) {
			continue
		}
		found := false
		for _, l := range listing {
			if l == w || ordinalBase(l) == w {
				found = true
				break
			}
		}
		if !found {
			return false
		}
	}
	return true
}

func isNumber(s string) bool {
	if s == "" {
		return false
	}
	for _, r := range s {
		if r < '0' || r > '9' {
			return false
		}
	}
	return true
}

func ordinalBase(s string) string {
	for _, suffix := range []string{"st", "nd", "rd", "th"} {
		if base, ok := strings.CutSuffix(s, suffix); ok && isNumber(base) {
			return base
		}
	}
	return s
}

// tokens lower-cases, folds accents, drops punctuation and stopwords, and
// normalises roman numerals.
func tokens(s string) []string {
	var b strings.Builder
	for _, r := range strings.ToLower(s) {
		switch {
		case r >= 'a' && r <= 'z', r >= '0' && r <= '9':
			b.WriteRune(r)
		case r == '&':
			b.WriteString(" and ")
		default:
			if f, ok := accentFold[r]; ok {
				b.WriteRune(f)
			} else {
				b.WriteByte(' ')
			}
		}
	}
	var out []string
	for _, w := range strings.Fields(b.String()) {
		if stopwords[w] {
			continue
		}
		if d, ok := romans[w]; ok {
			w = d
		} else if d, ok := numberWords[w]; ok {
			w = d
		}
		out = append(out, w)
	}
	return out
}

// numberWords lets "Resident Evil Zero" and "Resident Evil 0" agree.
var numberWords = map[string]string{
	"zero": "0", "one": "1", "two": "2", "three": "3", "four": "4", "five": "5",
	"six": "6", "seven": "7", "eight": "8", "nine": "9", "ten": "10",
}

var accentFold = map[rune]rune{
	'á': 'a', 'à': 'a', 'â': 'a', 'ä': 'a', 'ã': 'a', 'å': 'a',
	'é': 'e', 'è': 'e', 'ê': 'e', 'ë': 'e',
	'í': 'i', 'ì': 'i', 'î': 'i', 'ï': 'i',
	'ó': 'o', 'ò': 'o', 'ô': 'o', 'ö': 'o', 'õ': 'o', 'ō': 'o',
	'ú': 'u', 'ù': 'u', 'û': 'u', 'ü': 'u', 'ū': 'u',
	'ñ': 'n', 'ç': 'c',
}
