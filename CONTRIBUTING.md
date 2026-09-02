# Contributing

The two most useful contributions are small ones: adding a game worth tracking,
and explaining why a price moved.

## Add a game, an annotation, or the story behind a price

All three are one-file changes to `catalog/`. The `info` block on a game — the
developer, the year, a piece of trivia, and why collectors chase it — is the
most valuable thing you can write, because it is the part no price site has. The format and the tuning workflow are
in [`catalog/SCHEMA.md`](catalog/SCHEMA.md). CI validates every entry, so a
typo fails the pull request rather than quietly producing bad data.

## Working on the code

```bash
go test ./...                                    # unit tests
go tool golangci-lint run ./...                  # lint, same version as CI
go run ./cmd/collector -fake -data ./data        # generate sample data
cd web && npm ci && npm run dev                  # the site, against that data
```

Linters are pinned as `go.mod` tool dependencies, so `go tool golangci-lint`
runs exactly what CI runs with no separate install.

## How the code is organised

| Package | Responsibility |
| --- | --- |
| `internal/catalog` | Loads and validates the YAML catalog |
| `internal/provider` | The `PriceProvider` seam; eBay, PriceCharting and fake implementations |
| `internal/classify` | Sorts listing titles into loose / CIB / sealed, rejects non-games |
| `internal/aggregate` | IQR trim and median |
| `internal/history` | Append-only price series, same-day replace, weekly rollup |
| `internal/trending` | Smoothing, percentage changes, momentum score, gates |
| `internal/snapshot` | Writes the JSON the site reads |
| `internal/pipeline` | One collection pass, wiring the above together |

## Conventions

- **Tests first for pipeline logic.** `classify`, `aggregate`, `history` and
  `trending` are pure functions with table-driven tests; the test file is the
  specification. Write the failing test, then the code.
- **No network in tests.** The eBay client is tested against recorded responses
  in `internal/provider/ebay/testdata/` via `httptest`.
- **Determinism is a hard requirement.** The collector commits its output to
  git. Identical inputs must produce identical bytes, or every scheduled run
  would commit a spurious diff across the whole catalog. Two tests enforce this;
  do not break them.
- **No clocks in logic.** Pass the time in. Every function that needs "now"
  takes it as an argument so tests can pin it.
- **Comments explain constraints, not mechanics.** Say why there is one API call
  per game, not what the next line does.

## Before opening a pull request

```bash
go test ./... -race
go tool golangci-lint run ./...
go tool govulncheck ./...
cd web && npm run typecheck && npm test && npm run build
```

Say in the description what you verified by running, and what you did not. A
change that compiles is not a change that works.

## Scope

Out of scope for now, and deliberately: graded copies, promo and demo discs,
hardware, non-US regions, and user accounts or collection tracking. Plenty of
tools already track a personal collection; none explain the market.
