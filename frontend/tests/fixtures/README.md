# Test fixtures

The JSON files here are generated. `make fixtures` writes them from the
integration's own Python code (`scripts/refresh_fixtures.py`), and the
panel's test suite replays them:

- `rules.json`: the rules the panel mirrors from the integration, checked
  by `fixtures.test.ts`.
- `engine.json`: the integration's answers to the preview, save and
  defaults requests the suite makes. A request with no recorded answer
  fails its test.

Do not edit them by hand. After changing the engine, blocks, templates,
switchboard rules or the requests the panel makes, run `make fixtures`;
`make check` fails while they are stale.
