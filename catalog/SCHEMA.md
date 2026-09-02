# Catalog format

Each platform has one file: `ps2.yaml`, `gamecube.yaml`, `psp.yaml`,
`vita.yaml`, `n64.yaml`, `dreamcast.yaml`. Keeping them separate keeps pull
request diffs small.

```yaml
platform: ps2          # must match the filename's console
games:
  - id: silent-hill-2-ps2
    title: "Silent Hill 2"
    region: NTSC-U           # optional, defaults to NTSC-U
    variant: black-label     # optional, defaults to none
    igdb_id: 1904            # optional
    ebay:
      query: "Silent Hill 2 PS2"
      negative: ["greatest hits", "hd collection", "silent hill 3"]
```

## Fields

| Field | Required | Notes |
| --- | --- | --- |
| `id` | yes | Lowercase slug, globally unique, must end in `-<platform>` |
| `title` | yes | Display name, proper capitalisation and punctuation |
| `region` | no | `NTSC-U`, `NTSC-J` or `PAL` |
| `variant` | no | `none`, `black-label`, `greatest-hits`, `players-choice`, `platinum` |
| `igdb_id` | no | Reserved for a future IGDB link-up; cover art comes from `info.cover_url` |
| `ebay.query` | yes | Search terms; **must name the platform** |
| `ebay.negative` | no | Terms that disqualify a listing |

Parsing is strict: an unknown key fails CI rather than being ignored, so a typo
in a pull request is caught immediately.

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
one by hand:

```bash
go run ./cmd/coverart -catalog ./catalog
```

fills every missing `cover_url` from the game's English Wikipedia article. It
edits only that line, leaves everything else in the file untouched, and lists
the entries it could not match so you can fill those in manually. It needs no
credentials.

## Print variants

Track a variant separately when it prices differently — a PS2 black label
against its Greatest Hits reprint, or a GameCube original against Player's
Choice. Give each its own `id`, set `variant`, and exclude the other in
`negative` so the two do not contaminate each other.

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
