# Contributing

Bug reports, translations and pull requests are welcome. For anything
larger than a fix, open an issue first so we can agree on the direction.

## Setup

You need [uv](https://docs.astral.sh/uv/) (it manages Python for you) and
Node.js 22.

```bash
uv sync      # Python environment with the dev dependencies
npm ci       # panel toolchain
make check   # everything CI runs
```

`make help` lists the other targets. The ones you will use most:

| Command | What it does |
|---|---|
| `make check` | Lint, type checks, both test suites and the generated-file checks. Run it before opening a pull request. |
| `make format` | Formats the code and applies lint fixes: ruff for the Python, [Biome](https://biomejs.dev) for the panel and the browser suites. |
| `uv run pytest` | The integration's tests. |
| `npm test` | The panel's tests. |
| `make harness` | The panel in a browser, without Home Assistant. |
| `make qa` | A throwaway Home Assistant with the integration and a mock Aivi API (needs Docker). See [`qa/README.md`](qa/README.md). |
| `make snapshots` | Screenshots of the panel plus interaction and accessibility checks (needs `npx playwright install chromium`). |
| `make e2e` | End-to-end journeys over the QA stack (needs Docker and Playwright). |

Both browser suites run on [Playwright Test](https://playwright.dev/docs/intro):
the harness suite under `tests/e2e/harness/` and the QA stack journeys
under `tests/e2e/qa/`. To run part of one, or to step through it:

```bash
npm run test:harness -- --grep "hub"   # starts the harness server itself
npm run test:harness -- --ui
npm run test:qa                        # against a QA stack that is already up
npx playwright show-report playwright-report/harness
```

## Generated files

Some files are produced by a command and checked by `make check`. Change
the source and regenerate; do not edit them by hand.

| File | Regenerate with |
|---|---|
| `custom_components/aivi/translations/en.json` | `make catalog` |
| `frontend/src/translations/en.ts` | `make catalog` |
| `frontend/tests/fixtures/*.json` | `make fixtures` |
| `frontend/harness/meta.generated.js` | `make meta` |
| `frontend/src/brand-mark.ts` | `make brand` |
| `contract/aivi-openapi.json` | `make openapi` |
| `custom_components/aivi/frontend/sf-symbols.json` | `make symbols` (macOS) |
| `.github/workflows/actions.lock` | `gh actions-lock`, from the [gh-actions-lock](https://github.com/github/gh-actions-lock) extension (CI checks it, `make check` does not) |

The vendored `contract/aivi-openapi.json` can run ahead of the public API
reference at `https://api.getaivi.app/openapi.json` while new features
roll out. `make openapi` refreshes it from that reference; pass
`OPENAPI_SOURCE=<URL or file>` to vendor another copy.

English copy is written only in `custom_components/aivi/strings.json`. A
new panel string goes in its `config_panel` section; then run
`make catalog`, which writes the English translation and the panel's
catalog (and with it the key type that `t()` checks).

## Translating

The panel follows the user's Home Assistant language. Its strings live in
the `config_panel` section of
`custom_components/aivi/translations/<lang>.json`; the other sections are
the config flow, repairs and entity names. Any key a language leaves out
falls back to English, so partial translations are fine.

To correct a shipped language, edit its file. For a new one:

1. Copy `translations/en.json` to `translations/<lang>.json`, using the
   [Home Assistant language code](https://developers.home-assistant.io/docs/voice/languages/).
2. Translate the values, never the keys. Keep `{placeholder}` tokens as
   they are. Keys ending in `-one` and `-other` are plural forms: give the
   ones your language uses (`-few` and `-many` too where it has them, only
   `-other` where it has no plural).
3. Use Home Assistant's own wording for its menus and buttons, and
   Apple's for Apple's terms. The Aivi app is in English, so its labels
   (the **Widgets** tab, "slug") and the template names stay in English.
4. See the panel in your language with `make harness`, adding `?lang=<lang>`
   to the page URL. `npm test` checks the file's keys, placeholders and
   plural forms.
5. Open a pull request with just that file.

## Pull requests

- Titles follow [Conventional Commits](https://www.conventionalcommits.org)
  (`fix: ...`, `feat(panel): ...`); pull requests are squash-merged and the
  changelog is generated from the titles.
- Add or update tests for what you change.
- For a change to the panel's look, include a screenshot.
- Do not bump the version in `manifest.json`; the release workflow owns it.
