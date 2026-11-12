# Contributing

Avanzel is an npm workspace (`apps/mac`, `packages/engine`, `packages/ui`) plus the v0.1 Python
command line in `src/avanzel`. You need Node 22+ and [uv](https://docs.astral.sh/uv/).

Interface work has its own rules: read [AGENTS.md](AGENTS.md) and `packages/ui/DESIGN.md` first, and run
`npm run design:check` before you finish.

## Tests

```bash
# TypeScript engine and Mac app
npm install
npm test                                   # engine + app unit tests
npm run e2e -w @avanzel/mac                # the real app driven by Playwright, with a fake agent
AVANZEL_E2E_SHOTS=1 npm run e2e -w @avanzel/mac   # the same, and collect the windows' screenshots in apps/mac/test-results/shots/
AVANZEL_TEST_ASR=1 npm test -w @avanzel/engine   # real Parakeet (macOS `say` voices)

# Python CLI (v0.1)
uv sync
uv run pytest                                              # fast suite, no network or models
AVANZEL_TEST_ASR=1 uv run pytest tests/test_integration.py  # real Parakeet (macOS `say` voices)
AVANZEL_TEST_HARNESS=claude uv run pytest tests/test_integration.py -k harness   # real agent run
```

## Designs

Specs and plans live in [`docs/superpowers/`](docs/superpowers):
[v0.1 design](docs/superpowers/specs/2026-10-20-avanzel-design.md),
[Mac app design](docs/superpowers/specs/2026-10-20-avanzel-mac-design.md).

Releasing the Mac app: [apps/mac/RELEASING.md](apps/mac/RELEASING.md).
