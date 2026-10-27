# `make check` is what CI runs: a change is verified when it passes.

.DEFAULT_GOAL := help
.PHONY: help check lint format test bundle panel catalog catalog-check meta meta-check fixtures fixtures-check brand brand-check harness snapshots e2e qa openapi symbols suggest-eval

help: ## List the targets
	@awk 'BEGIN {FS = ":.*## "} /^[a-z0-9-]+:.*## / {printf "  %-16s %s\n", $$1, $$2}' $(MAKEFILE_LIST)

check: lint test panel catalog-check meta-check fixtures-check brand-check ## Everything CI runs

lint: ## Lint and format check the Python and the panel, type check the Python
	uv run ruff check .
	uv run ruff format --check .
	uv run ty check
	npx biome ci --error-on-warnings

format: ## Format and apply lint fixes: ruff for the Python, Biome for the panel
	uv run ruff check --fix .
	uv run ruff format .
	npx biome check --write

test: ## The integration's tests, with the coverage gate
	uv run pytest -q

# Built every time: Vite is fast enough that tracking staleness is not
# worth it. The bundle is gitignored; releases build it into the zip.
bundle: ## Build the panel bundle
	npm run build

panel: bundle ## Type check and test the panel, with its coverage gate and size budgets
	uv run python scripts/check_bundle_size.py
	npm run typecheck
	npm test
	for f in frontend/harness/*.js; do node --check "$$f" || exit 1; done

# strings.json is the source of the English copy; the Home Assistant
# translation and the panel's bundled catalog are derived from it.
catalog: ## Regenerate the English catalogs from strings.json
	uv run python scripts/refresh_catalog.py

catalog-check:
	uv run python scripts/refresh_catalog.py --check

meta: ## Regenerate the harness's template metadata
	uv run python scripts/refresh_harness_meta.py

meta-check:
	uv run python scripts/refresh_harness_meta.py --check

# The panel's mirrored rules, and the integration's answers to the requests
# the panel's tests make (recorded by running them).
fixtures: ## Regenerate the panel tests' fixtures from the integration
	uv run python scripts/refresh_fixtures.py

fixtures-check:
	uv run python scripts/refresh_fixtures.py --check

brand: ## Regenerate the panel's inline brand mark from the brand icon
	uv run --with pillow python scripts/refresh_brand_mark.py

brand-check:
	uv run --with pillow python scripts/refresh_brand_mark.py --check

# Pass a URL or a file path: make openapi OPENAPI_SOURCE=path/to/openapi.json
OPENAPI_SOURCE ?= https://api.getaivi.app/openapi.json
openapi: ## Re-vendor the Aivi API's OpenAPI document
	uv run python scripts/refresh_openapi.py $(OPENAPI_SOURCE)

# Reads Apple's symbol metadata on this Mac; run it after a macOS update.
symbols: ## Regenerate the icon picker's SF Symbols index (macOS)
	uv run python scripts/refresh_sf_symbols.py

harness: bundle ## The panel in a browser at http://127.0.0.1:8777/frontend/harness/index.html
	uv run python scripts/harness_server.py

# Playwright Test over the harness (tests/e2e/harness/); it starts the dev
# server itself. On failure: npx playwright show-report playwright-report/harness
# Requires: npx playwright install chromium
snapshots: bundle ## Panel screenshots into snapshots/, with interaction and accessibility checks
	npx playwright test -c tests/e2e/harness

# The compose file mounts custom_components/ into Home Assistant, so the
# bundle is rebuilt first. With OPENROUTER_API_KEY set, Home Assistant also
# gets a working AI Task model (qa/README.md).
qa: bundle ## A throwaway Home Assistant with the integration and a mock Aivi API
	COMPOSE_PROFILES=$(if $(OPENROUTER_API_KEY),llm,) docker compose -f qa/docker-compose.yml up --build

# Needs the qa stack running with a model. Not part of `make check`: it asks
# a real model.
suggest-eval: ## Score Suggest against qa/suggest-evals.json
	uv run python scripts/suggest_eval.py

# Boots the qa stack, drives the config flow and the panel with Playwright
# Test (tests/e2e/qa/), and asserts the pushes land on the mock. Home
# Assistant starts from a fresh config dir of its own (.e2e/), so the state
# of a `make qa` stack is left alone. On failure, traces and screenshots are
# in the report: npx playwright show-report playwright-report/qa
# Requires: docker, and npx playwright install chromium
e2e: bundle ## End-to-end journeys over the qa stack
	rm -rf .e2e && mkdir -p .e2e/homeassistant
	cp qa/homeassistant/configuration.yaml .e2e/homeassistant/
	# Its own compose project (the journeys' outage test inherits it), so
	# tearing it down leaves a `make qa` stack alone; the two still share
	# ports, so stop that one first.
	COMPOSE_PROJECT_NAME=aivi-e2e AIVI_QA_CONFIG=$(CURDIR)/.e2e/homeassistant bash -c 'trap "docker compose -f qa/docker-compose.yml down -v" EXIT; \
	  docker compose -f qa/docker-compose.yml up -d --build \
	  && npx playwright test -c tests/e2e/qa'
