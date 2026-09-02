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
	}
	junkWords = []string{
		"repro", "console", "bundle", "poster", "graded", "wata",
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
	cibWords = []string{"cib", "complete"}

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

// Classify buckets a listing by its title, using the marketplace's own
// condition string only when the title is inconclusive.
func Classify(title, ebayCondition string) Result {
	t := strings.ToLower(strings.TrimSpace(title))

	if reason, ok := match(t, junkPhrases, junkRe); ok {
		return Result{Rejected: true, Reason: reason}
	}
	if reason, ok := match(t, newPhrases, newRe); ok {
		return Result{Condition: New, Reason: reason}
	}

	cibText := t
	for _, p := range titlePhrases {
		cibText = strings.ReplaceAll(cibText, p, " ")
	}
	if reason, ok := match(cibText, cibPhrases, cibRe); ok {
		return Result{Condition: CIB, Reason: reason}
	}
	if reason, ok := match(t, loosePhrases, looseRe); ok {
		return Result{Condition: Loose, Reason: reason}
	}

	switch strings.ToLower(strings.TrimSpace(ebayCondition)) {
	case "new", "brand new":
		return Result{Condition: New, Reason: "ebay-condition"}
	}
	return Result{Condition: Unknown, Reason: "no-match"}
}
