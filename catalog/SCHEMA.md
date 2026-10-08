# Catalog format

Each platform has one file: `ps2.yaml`, `ps3.yaml`, `gamecube.yaml`,
`psp.yaml`, `vita.yaml`, `n64.yaml`, `dreamcast.yaml`, `gb.yaml`, `gbc.yaml`,
`gba.yaml`.
Keeping them separate keeps pull request diffs small.

```yaml
platform: ps2          # must match the filename's console
games:
  - id: silent-hill-2-ps2
    title: "Silent Hill 2"
    region: NTSC-U           # optional, defaults to NTSC-U
    variant: black-label     # optional, defaults to none
    igdb_id: 1904            # optional
    ebay:
      query: "Silent Hill 2 (ps2, \"playstation 2\")"
      negative: ["greatest hits", "hd collection", "silent hill 3"]
    barcodes:                # optional, usually filled by cmd/barcodes
      - {code: "083717200253"}
      - {code: "083717200505", variant: greatest-hits}
```

## Fields

| Field | Required | Notes |
| --- | --- | --- |
| `id` | yes | Lowercase slug, globally unique, must end in `-<platform>` |
| `title` | yes | Display name, proper capitalisation and punctuation |
| `region` | no | `NTSC-U`, `NTSC-J` or `PAL` |
| `variant` | no | `none`, `black-label`, `greatest-hits`, `players-choice`, `platinum` |
| `igdb_id` | no | Reserved for a future IGDB link-up; cover art comes from `info.cover_url` |
| `ebay.query` | yes | Search terms; **must name the platform** (see below for the Game Boy line) |
| `ebay.negative` | no | Terms that disqualify a listing |
| `ebay.require` | no | Words every listing must contain (see below) |
| `barcodes` | no | Codes printed on the game's boxes, so the site's scanner finds the entry; see below |

Parsing is strict: an unknown key fails CI rather than being ignored, so a typo
in a pull request is caught immediately.

### Naming the platform in a query

eBay's search matches words, so a query has to name the console the way its
sellers do, in every spelling they use. Game Boy sellers are the clearest case:
the same cartridge is listed as "Game Boy", "Gameboy", "GBA" or "Game Boy
Advance".
eBay accepts a group of alternatives in parentheses, separated by commas, so
the Game Boy files end every query with the group for their console:

```yaml
query: "Metroid Fusion (gba, \"game boy advance\", \"gameboy advance\")"
```

Measured on 15 September 2026, that group returned the 200-listing page cap
for Metroid Fusion where the plain phrase "Game Boy Advance" returned 154 and
"Gameboy Advance" 37. Use `(gameboy, "game boy")` for `gb.yaml` and
`(gbc, "game boy color", "gameboy color")` for `gbc.yaml`.

The same group matters wherever sellers spell a console two ways, because of
how eBay reads a query with an exclusion in it. A plain `Banjo-Kazooie N64`
also returns listings that only say "Nintendo 64"; add one negative and eBay
matches every word literally, so those listings vanish. Measured on 7 October
2026 with the same negatives on both sides: `Demon's Souls PS3` returned 60
listings and `Demon's Souls (ps3, "playstation 3")` 85, Folklore 73 against
104; across 31 PlayStation 2 entries the group raised the listings found from
828 to 1,156 and brought three thin games up to a price. Entries added since
then end in `(ps2, "playstation 2")`, `(ps3, "playstation 3")` or
`(n64, "nintendo 64")` where sellers commonly use the long name.

The older entries were measured the same way on 8 October 2026, every one
against the same morning's run. Every Nintendo 64 entry gained (kept listings
7,015 to 8,142) and moved to the group. PlayStation 2 entries whose search
returned fewer than the 200-listing page gained 35% (125 entries, 4,242 to
5,732) and moved; the 46 that already filled the page lost 6%, since the group
only reshuffles a full page, and they keep `PS2` alone. GameCube, PSP and Vita
changed by under 2% either way and keep the plain form; new entries for them
may use `(gamecube, "game cube")`, `(psp, "playstation portable")` and
`(vita, psvita)`, which one Vita entry needed for a seller who wrote "PSVITA".
Dreamcast sellers write the name one way.

Keep the words before the group few and spelled the way every seller spells
them. "Beyond Good and Evil GameCube" with an exclusion misses every listing
that says "Beyond Good & Evil", and a roman numeral misses the sellers who
write the digit; a group covers both, `Lost Kingdoms (ii, 2)`. A game the
first search cannot price gets a second, wider one with the same words and no
exclusions or groups, so a thin game still has a chance, but a precise first
query is cheaper and cleaner.

### Requiring a word

A listing counts as the game when half the title's words appear in it, which
is wrong for a game whose title is another game's plus one word: "Soul
Sacrifice Delta" shares two of its three words with "Soul Sacrifice", and no
exclusion can remove the original without removing the game. Name the word in
`require`, matched as a whole word like the exclusions:

```yaml
    ebay:
      query: "Soul Sacrifice Delta (vita, psvita)"
      require: ["delta"]
```

Two things are particular to PlayStation 3. eBay reads the 3 in "PlayStation
3" as the 3 in a title, so a search for `Resistance 3 PS3` came back with 148
listings of the first two games out of 200; the collector drops them, but they
crowd the page, so a third game in a series should name the earlier ones in
`negative` (`"fall of man"`, `"resistance 2"`). And the search also returns
the same title on other consoles (`Demon's Souls` for PS5, `NCAA Football 14`
for Xbox 360), so a game that exists elsewhere takes `"xbox"`, `"ps4"` or
`"ps5"` as negatives.

## Adding a game

1. Pick the platform file and add an entry in the shape above.
2. Make the query specific enough to exclude sequels, collections, remasters and
   other platforms. That is what `negative` is for.
3. Run the checks:

   ```bash
   go test ./internal/catalog/
   ```

4. If you have eBay credentials, see what your query actually returns:

   ```bash
   go run ./cmd/collector -audit -platforms ps2 | grep -A20 your-game-id
   ```

   Every line shows how a listing was bucketed. If you see the wrong game, or a
   pile of `reject:` lines, tighten the query.

## Editorial info

The optional `info` block is what fills the game page: the specs table, the
"did you know" note, and the window that answers why a game costs what it does.

```yaml
  - id: jet-force-gemini-n64
    title: "Jet Force Gemini"
    info:
      developer: "Rare"
      publisher: "Nintendo"
      year: 1999
      genre: "Third-person shooter"
      cover_url: "https://…"   # optional; https only
      about: "One or two factual sentences about the game."
      about_url: "https://en.wikipedia.org/wiki/…"   # where `about` came from
      trivia: "One genuinely interesting fact about the release."
      why: "Why collectors chase it: print run, cancellation, licensing, hype."
    ebay:
      query: "Jet Force Gemini N64"
```

Every field is optional and the page adapts to what is present. Keep `trivia`
to one fact you can source, and keep `why` about supply and demand — a short
print run, a delisted digital version, a studio that closed — rather than
opinion about the game's quality. CI checks the release year is plausible, that
`cover_url` is https, and that the notes are long enough to say something.

Without a `cover_url`, the page draws the title on a CRT instead of showing an
empty frame, so leaving it out is fine. You do not normally need to hunt for
the factual fields by hand:

```bash
go run ./cmd/enrich -catalog ./catalog
```

fills every missing `developer`, `publisher`, `year`, `genre`, `cover_url`,
`about` and `about_url` from the game's English Wikipedia article and its
Wikidata item. It adds only the missing lines, leaves everything a contributor
wrote untouched, never writes `trivia` or `why`, and lists the entries it could
not match so you can fill those in manually. It needs no credentials. When the
automatic match lands on the wrong game in a series, pin the article:
`go run ./cmd/enrich -set dark-cloud-2-ps2="Dark Chronicle"`.

`about` is the lead of the Wikipedia article and is shown with a link back to
it, which satisfies the CC BY-SA attribution Wikipedia text requires.

## Print variants

Track a variant separately when it prices differently — a PS2 black label
against its Greatest Hits reprint, or a GameCube original against Player's
Choice. Give each its own `id`, set `variant`, and exclude the other in
`negative` so the two do not contaminate each other.

## Barcodes

`barcodes` lists the codes printed on the back of the game's boxes, so a phone
pointed at a box lands on this entry. Write each code as the box prints it:
twelve digits for a US UPC, thirteen for a European EAN or a Japanese JAN.
A code without a `variant` was printed on the entry's own edition. A reprint's
code names its reprint (`greatest-hits`, `players-choice`, `platinum`), so a
Greatest Hits box scans to the base game and the copy remembers which print it
is. Barcodes never affect prices.

CI checks every code's check digit and that no code belongs to two entries: a
scan has to land on exactly one game. A variant tracked as its own entry gets
its own codes.

You rarely type them. `go run ./cmd/barcodes` fills them from eBay's catalog:
for each entry it runs the entry's own search, counts the eBay products the
listings the classifier keeps are attached to, and reads the codes off each
product that at least three listings agree on. Reprints an entry keeps out of
its prices get a search of their own. Only codes printed for the entry's
region are kept: eBay's product for a US game sometimes carries only the
European box's code, and some old products carry a filler code (one half
printed twice) that is on no box. The searches use the collector's daily
quota, so by default a run leaves a catalog's worth of calls for every
scheduled collector run before the quota resets, and resumes from
`.cache/barcodes.json` the next day. `-platforms`, `-only`, `-limit` and
`-dry-run` narrow a run; `-v` prints what each entry got and what was turned
down.

A harvest only ever adds codes, `-force` included. When the rules improve,
`go run ./cmd/barcodes -rejudge` re-checks every code against the products the
cache remembers, with no API calls, and drops the ones that no longer hold.

Codes people pair by hand in the scanner (a box eBay did not know) wait in
Supabase until `go run ./cmd/barcodes -reports` reviews them. A pairing joins
the catalog when eBay's listings for that code are this game, or, for a code
eBay US has never listed, when two different people agree. Everything else is
printed for a person to look at.

## Annotations

`annotations.yaml` holds the curated "why is this moving" notes shown on the
boards. This is the most valuable thing you can contribute, and it is the part
no competing price site publishes.

```yaml
- game_id: silent-hill-2-ps2
  date: 2024-10-08                # when the driver happened
  note: "The remake sent new players looking for the PS2 original."
  source_url: "https://example.com/article"
```

Keep the note to one plain sentence about a real driver — a remake or port
announcement, a store closure, a widely seen video, a discovery about print
runs. `game_id` must exist in a platform file and `date` must be `YYYY-MM-DD`;
both are checked in CI. The most recent annotation per game is the one shown.
