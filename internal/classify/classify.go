// Package classify sorts eBay listing titles into collectible condition
// buckets and rejects listings that are not the retail game itself.
package classify

import (
	"regexp"
	"slices"
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

// SeriesVersion identifies the rules that produced a history point. Bump it in
// the same commit as any change to this package, to the eBay listing filters
// in internal/provider/ebay/query.go, or to internal/aggregate that can move a
// published median. Trending never compares points across versions, so a bump
// reads as a fresh series rather than as a market move; the boards go quiet
// for a week instead of leading with a rule change. Per-game catalog edits
// and refactors that leave every classification identical do not bump it.
//
// 2 (2026-09-08): a bare cartridge or card listing counts as loose.
const SeriesVersion = 2

// Media is how a platform packaged its games, which changes what a manual
// implies. A disc "with manual" sits in its case, so the copy is complete; a
// cartridge "with manual" is usually missing the cardboard box, which is the
// part collectors pay for.
type Media int

const (
	// Cased media is a disc or card in a plastic case: PS2, GameCube, PSP,
	// Vita, Dreamcast.
	Cased Media = iota
	// Boxed media is a cartridge in a cardboard box: N64.
	Boxed
	// Carded media is a game card in a small plastic case: PS Vita. It reads
	// like cased media, except that a bare listing is a loose card.
	Carded
)

var (
	junkPhrases = []string{
		"case only", "box only", "manual only", "insert only", "cover art",
		"artwork only", "disc case only", "empty case", "custom case",
		"replacement case", "no disc", "no game", "reproduction",
		"lot of", "game lot", "strategy guide", "guide book",
		"for parts", "not working", "demo disc", "not for resale", "kiosk",
		"download code", "digital code", "digital download",
		"replacement box", "custom box",
		// Cartridges are never "cards"; the phrase is a reproduction tell.
		"game card", "cartridge card", "cart games for",
		// Storefront listings that sell many titles under one item, and
		// multi-game reproduction carts.
		"pick your", "choose your", "you choose", "choose from", "multi cart",
		"multicart", "in-1", "in 1 ", "options)",
		// Part of a multi-disc set, or a set with a disc missing, is not a
		// copy of the game in any condition.
		"missing disc", "missing disk", "replacement disc", "replacement disk",
		"disc 1 only", "disc 2 only", "disc one only", "disc two only",
		"disk 1 only", "disk 2 only", "only disc 1", "only disc 2",
		// Retail multipacks and merchandise sold under the game's name.
		"dual pack", "twin pack", "double pack", "cd only", "art book",
		"artbook", "poster only", "promo poster",
		"promotional poster", "protector for", "display case", "acrylic",
		"clear case cases",
	}
	// "poster" is deliberately absent: games shipped with posters, and a
	// listing that says "CIB with poster" or "no poster" is a copy of the
	// game. The poster-as-product listings say "flag" or "banner".
	junkWords = []string{
		"repro", "console", "bundle", "graded", "wata", "lot",
		// Graded slabs trade in their own market, at several times the
		// price of the same sealed copy without a plastic case and a number.
		// VGA is matched with its grade (vgaGradeRe): on Dreamcast the word
		// also means the 480p output a "VGA compatible" game supports.
		"psa", "cgc", "ukg",
		// Demo, trial and preview discs carry the game's name and none of
		// its value; so do skins, decals and reprinted boxes.
		"demo", "trial", "preview", "sampler", "skin", "decal", "reprint",
		"bootleg", "flag", "banner", "protectors",
	}

	newPhrases = []string{
		"factory sealed", "brand new", "new sealed", "new in box",
		"shrink wrap", "y-fold", "yfold", "unopened",
	}
	// "bnib" (brand new in box) is a common seller abbreviation and needs its
	// own entry: a word boundary will not find "nib" inside it.
	newWords = []string{"sealed", "nib", "bnib"}

	// Listing the parts is the other way sellers say complete: "Box, Manual
	// and Cart", "w/ Box & Manual".
	cibPhrases = []string{
		"complete in box", "complete w/", "complete with",
		"box and manual", "box & manual", "box, manual", "box/manual",
		"box manual", "box + manual", "box+manual", "manual and box",
		"manual & box", "box+cart+manual", "box, cart", "box and cart",
	}
	cibWords = []string{"cib", "complete"}

	// A manual on its own only implies the rest of the package for Cased
	// media; for Boxed media the title must also name the box. "w manual"
	// (no slash) is common; as a word-bounded pattern it cannot fire inside
	// "new manual".
	manualPhrases = []string{"with manual", "w/ manual", "w/manual", "manual included"}
	manualWords   = []string{"w manual"}
	boxWords      = []string{"box", "boxed"}

	loosePhrases = []string{
		"disc only", "disk only", "cart only", "cartridge only",
		"game only", "umd only", "no manual", "missing manual", "no case",
		"cartridge alone",
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
	// A numbered disc on its own ("Disc 2 only", "Disk 1 won't load") is part
	// of a set, unless the title goes on to name the other discs ("Disc 1 &
	// Disc 2", "Discs 1-2").
	partialDiscRe = regexp.MustCompile(`\bdis[ck]s? ?(1|2|3|4|one|two|three|four)\b`)
	discRangeRe   = regexp.MustCompile(`\b(1|2|3|one|two|three) ?(&|and|,|-|\+|/|to) ?(dis[ck] )?(2|3|4|two|three|four)\b`)
	// A VGA slab always carries its grade: "VGA 85+", "VGA Gold 90".
	vgaGradeRe = regexp.MustCompile(`\bvga (gold |graded? )?\d`)

	// A sealed copy that was tested was opened, and "US Version" on a
	// sealed listing is the bootleg sellers' template. Both are read as
	// whole words, with the honest "untested" set aside first.
	testedRe     = regexp.MustCompile(`\btested\b`)
	usVersionRe  = regexp.MustCompile(`\bu\.?s\.? version\b`)
	negatedTests = strings.NewReplacer("untested", " ", "not tested", " ", "never tested", " ", "cannot test", " ", "can't test", " ")

	// Ways a title names the box only to say it is absent, or names an
	// accessory rather than the box, so that neither can stand in for one.
	boxNegations = strings.NewReplacer(
		"no original box", " ", "no box", " ", "without box", " ", "missing box", " ",
		"not boxed", " ", "box protectors", " ", "box protector", " ",
	)
	// For disc media the box is the case, so saying it is missing says loose.
	casedLoosePhrases = append(slices.Clone(loosePhrases), "no box", "without box", "missing box")
	junkRe            = compileWords(junkWords)
	newRe             = compileWords(newWords)
	cibRe             = compileWords(cibWords)
	manualRe          = compileWords(manualWords)
	boxRe             = compileWords(boxWords)
	looseRe           = compileWords(looseWords)
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

// Classify buckets a listing for Cased media by its title alone. See
// ClassifyMedia.
func Classify(title string) Result { return ClassifyMedia(title, Cased) }

// ClassifyMedia buckets a listing by its title alone. The marketplace's own
// condition field is deliberately ignored: reproduction cartridges and
// merchandise are routinely listed as "New", so a copy only counts as sealed
// when the seller says so in the title.
func ClassifyMedia(title string, media Media) Result {
	t := strings.ToLower(strings.TrimSpace(title))

	if reason, ok := match(t, junkPhrases, junkRe); ok {
		return Result{Rejected: true, Reason: reason}
	}
	if partialDiscRe.MatchString(t) && !discRangeRe.MatchString(t) {
		return Result{Rejected: true, Reason: "partial-set"}
	}
	if vgaGradeRe.MatchString(t) {
		return Result{Rejected: true, Reason: "vga-graded"}
	}
	if reason, ok := match(t, newPhrases, newRe); ok {
		// A sealed copy cannot have been tested, and "Factory Sealed US
		// Version" at a fraction of the complete-in-box price is the
		// template bootleg sellers use. Both describe something other than
		// a factory-sealed retail copy, and neither belongs in any bucket.
		if testedRe.MatchString(negatedTests.Replace(t)) || usVersionRe.MatchString(t) {
			return Result{Rejected: true, Reason: "sealed-" + reason + "-doubtful"}
		}
		return Result{Condition: New, Reason: reason}
	}

	// An explicit statement of what is missing ("disc only", "no manual")
	// outranks "complete": a seller who writes "Complete Case Disc Only - No
	// Manual" is describing an incomplete copy, whatever else the title says.
	loose := loosePhrases
	if media != Boxed {
		loose = casedLoosePhrases
	}
	if reason, ok := match(t, loose, nil); ok {
		return Result{Condition: Loose, Reason: reason}
	}

	cibText := boxNegations.Replace(t)
	for _, p := range titlePhrases {
		cibText = strings.ReplaceAll(cibText, p, " ")
	}
	if reason, ok := match(cibText, cibPhrases, cibRe); ok {
		return Result{Condition: CIB, Reason: reason}
	}
	if reason, ok := match(cibText, manualPhrases, manualRe); ok {
		if media == Boxed {
			if _, boxed := match(cibText, nil, boxRe); !boxed {
				// Cartridge and manual, no box: worth more than loose and
				// much less than complete, so it belongs in neither bucket.
				return Result{Condition: Unknown, Reason: "manual-no-box"}
			}
		}
		return Result{Condition: CIB, Reason: reason}
	}
	if reason, ok := match(t, nil, looseRe); ok {
		return Result{Condition: Loose, Reason: reason}
	}
	// A cartridge or card whose seller wrote nothing at all about completeness
	// is a loose one: the box and the manual are where the value is, and a
	// seller who has them says so. A title that names a manual, box or case
	// without fitting a rule above is ambiguous and stays unknown, as does any
	// bare disc listing, which is usually the disc in its case.
	if (media == Boxed || media == Carded) && !completenessRe.MatchString(t) {
		return Result{Condition: Loose, Reason: "bare"}
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
	listing := tokens(platformNumbersRe.ReplaceAllString(strings.ToLower(listingTitle), " "))
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
	// Half of a two-word title is one word, and one word is how "La Pucelle
	// Tactics" gets counted as Suikoden Tactics; a two-word title needs both.
	need := (len(game) + 1) / 2
	if len(game) == 2 {
		need = 2
	}
	if shared >= need && numbersPresent(game, listing) {
		return true
	}
	return containsRunTogether(strings.Join(listing, ""), strings.Join(game, ""))
}

// containsRunTogether is the "killer7"/"Killer 7" fallback, with one guard:
// a title that ends in a digit must not match inside a longer number, or
// "Dark Cloud 2001" would be Dark Cloud 2.
func containsRunTogether(listing, game string) bool {
	if game == "" {
		return false
	}
	endsInDigit := game[len(game)-1] >= '0' && game[len(game)-1] <= '9'
	for from := 0; ; {
		i := strings.Index(listing[from:], game)
		if i < 0 {
			return false
		}
		end := from + i + len(game)
		if !endsInDigit || end == len(listing) || listing[end] < '0' || listing[end] > '9' {
			return true
		}
		from = end
	}
}

// platformNumbers strips platform names whose number would otherwise stand in
// for a sequel number: "Dark Cloud (Sony PlayStation 2)" is not Dark Cloud 2,
// and "Silent Hill Origins PlayStation 2" is not Silent Hill 2. Nintendo 64 is
// left alone because its games carry the 64 in their own titles.
var platformNumbersRe = regexp.MustCompile(`\b(play ?station ?(2|two)|ps 2)\b`)

// completenessRe is any word about what came with the game. A cartridge or
// card title that uses one and still reached the end of the rules is
// ambiguous, not bare.
var completenessRe = regexp.MustCompile(`\b(manuals?|booklets?|instructions?|box|boxed|cases?|cased|inserts?|map|poster|complete|cib|sleeve|artwork|cover)\b`)

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
