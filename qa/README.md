# Try the integration locally

A throwaway Home Assistant with the Aivi integration already mounted and a
mock Aivi API, so you can experiment without a real account or the production
backend.

```bash
# From the repo root (requires docker and a one-time `npm ci`):
make qa
```

`make qa` rebuilds the panel bundle and then runs the stack in the
foreground (ctrl-c stops it). Always prefer it over a bare `docker compose
up`: the bundle is generated, not committed, and the compose file mounts
`custom_components/` straight into Home Assistant. With a stale bundle on
disk you would test an old panel without noticing (or, on a fresh clone,
the sidebar panel answers 404). The manual equivalent is:

```bash
npm run build   # or: make bundle
cd qa
docker compose up --build
```

- **Home Assistant:** http://localhost:8123 boots **already onboarded and
  logged in** (user `dev` / `dev` if it ever asks). No account to create.
- **Mock Aivi API:** http://localhost:8099 lists the pushes the
  integration sends. Refresh to see new ones. The same data is
  available as JSON for scripts:

  ```bash
  curl -s http://localhost:8099/pushes.json | python3 -m json.tool
  ```

### Which panel bundle am I looking at?

Every bundle is stamped with the commit it was built from. Open the panel,
then the browser console: the first line reads

```
Aivi panel build <short-sha>[-dirty] <commit-time>
```

If the SHA isn't your current `git rev-parse --short HEAD` (or lacks
`-dirty` while you have local changes), the bundle on disk is stale:
rerun `make qa` (or `make bundle`) and hard-reload the browser tab.

> The integration is **mounted directly** into Home Assistant (not installed
> through HACS), so it does not show up in HACS: it is already installed.
> Its default API base URL points at the mock, so any token works.

## Bind a widget

1. **Connect the account once.** Settings, Devices & services, Add
   integration, "Aivi". Paste any token (e.g. `dev`) and submit; it validates
   against the mock.
2. **Open the "Aivi" panel** in the sidebar. This is the custom UI. Every
   demo widget has a card: click **Set up** on one. Each opens a form for its
   template and a live preview:
   - **Laundry** (`progress`): Progress -> `input_number.washer_progress`.
   - **Front door** (`status`): State -> `input_boolean.front_door`.
   - **Home batteries** (`battery`): tick the two battery sensors.
   - **Living room** (`gauge`): Value -> `input_number.vacuum_battery`.
   - **Garbage day** (`countdown`): Target -> `sensor.sun_next_dawn`.
   - **Home** (`list`): tick any handful of entities.
   - **Porch** (`switchboard`): tick *Porch light*, *Garden fountain*
     and the *Movie night* scene; the two booleans become toggle tiles,
     the scene a button.
   - **Spending** (`budget`): starts in Home Assistant's currency;
     Spent -> `sensor.spent_this_month`, type a budget.
   - **Indoor** (`trend`): Value -> any sensor with a recorded history.
   - **Electricity** (`prices`): starts on `sensor.electricity_price`, a
     template sensor shaped like Nord Pool's, in cents.
   - **Energy** (`energy`): Generation -> `sensor.solar_power_now`, Grid
     power -> `sensor.grid_power_now` (set up the Energy dashboard first
     and a new binding starts wired from it).

   For Live Activities, the mock lists `washer` and `grill` (GET
   /activities; pushes to any other slug 404, like the real API): the
   panel's Live Activities section shows both. Click **Set up** on
   **Washer**, pick active entity `input_boolean.front_door`, progress ->
   `input_number.washer_progress`.
3. **Drive it.** On the Overview dashboard, move the *Washer progress* slider
   (or toggle *Front door open*) and watch the push land at
   http://localhost:8099 (the panel's preview updates too).
4. **Press a tile.** There is no device in the loop, so the mock stands
   in for one: a tile press posted to it is delivered on the
   event stream the integration holds open, exactly like a real press.

   ```bash
   curl -s -X POST localhost:8099/command \
     -d '{"widget": "porch", "action": "input_boolean_porch_light", "value": true}'
   curl -s -X POST localhost:8099/command -d '{"widget": "porch", "action": "scene_movie_night"}'
   ```

   The porch light turns on, the scene runs, and the resulting state
   change pushes back to the mock (the status page counts open streams, so
   you can see the integration is listening). A tile's action id is its
   entity id with the dot folded to an underscore. Every tile press also
   lands on the Home Assistant event bus as `aivi_action`
   (Developer tools -> Events), played back or not.

   A remote Live Activity's button is pressed the same way, named by the
   activity instead of the widget. The activity must be ongoing, since a
   press is made on its current card:

   ```bash
   curl -s -X POST localhost:8099/command -d '{"activity": "vacuum", "action": "script_vacuum_dock"}'
   ```

   The status page has a button for every action of the switchboards and
   remotes pushed so far.

The demo helpers live in `homeassistant/configuration.yaml`. The mock's widget
list is in `mock-aivi/mock_aivi/state.py`; its slugs and templates line up
with the helpers. The panel is the only place to bind; the integration card on
the integrations page manages just the account.

## The mock holds you to the real API

The mock validates every request against the API's OpenAPI document
(`contract/aivi-openapi.json`, mounted into the container; refresh it with
`make openapi`), and its own responses too. A push the real API would
refuse is refused here the same way: a 422 with a `detail` list naming the
field (`"loc": ["body", "content", ...]`), 404 for a slug the account does
not have, 400 for content of another template, and 422 for widget content
over 4 KiB as Aivi stores it. The refusal shows up in the integration's
repair issues, in the mock's log (`docker compose logs mock-aivi`) and at
http://localhost:8099/refusals.json; the e2e journeys fail if anything
lands there.

It also behaves like the real API where it matters for the integration:

- `GET /widgets` and `GET /activities` page with opaque cursors, three items
  per page (`AIVI_MOCK_PAGE_SIZE`), so paging is always exercised.
- The token `invalid` is refused with 401; any other token works.
- `GET /events` sends `retry:`, `id: u:<n>` cursors and a `: ping` every 20
  seconds, replays the unexpired events after a `Last-Event-ID` (all of
  them for an id it does not know), and refuses a fifth open stream with
  429.

To see events arrive, open http://localhost:8099/ : under "Send an event"
there is a button for every tile of each bound switchboard (On / Off /
Press). A click sends what a device would, and it shows up in the panel's
Events (the pulse in the top bar) and in the widget's Recent presses.

Switches for the cases a real account cannot produce on demand:

```bash
# The subscription lapses: every API call answers 402.
curl -s -X POST localhost:8099/admin/subscription -d '{"active": false, "expired_at": "2026-09-01T00:00:00Z"}'
# Active until a date, without renewing (the Subscription sensor's attributes).
curl -s -X POST localhost:8099/admin/subscription -d '{"active": true, "expires_at": "2026-11-01T00:00:00Z", "renews": false}'
# The next stream only sends retry: and ends (the server could not set it up).
curl -s -X POST localhost:8099/admin/events -d '{"refuse": 1}'
# End the open streams, as their 15-minute lifetime does.
curl -s -X POST localhost:8099/admin/events -d '{"close": true}'
# At most one ongoing Live Activity.
curl -s -X POST localhost:8099/admin/activities -d '{"max_ongoing": 1}'
# Back to normal, pushes cleared.
curl -s -X POST localhost:8099/admin/reset -d '{}'
# The switches, and how many API calls were answered 402 since the
# subscription last changed (the lapse journey checks it stays put).
curl -s localhost:8099/state.json
```

## Suggest, with a real model

The panel's Suggest button (and the chat after it) asks the AI Task model
Home Assistant is set up with. Give the qa box one through Home
Assistant's own OpenRouter integration by starting the stack with an
OpenRouter key:

```bash
OPENROUTER_API_KEY=sk-or-... make qa
# another model with structured outputs (the default is google/gemini-2.5-flash):
OPENROUTER_API_KEY=sk-or-... OPENROUTER_MODEL=anthropic/claude-haiku-4.5 make qa
```

Suggest's answer is a short list of operations in one fixed structure, so
it works on any provider with structured output, Anthropic's models
included (`OPENROUTER_MODEL=anthropic/claude-haiku-4.5`). To compare models,
add more AI Task models to the OpenRouter entry in Home Assistant and pass
one to the eval with `--model ai_task.<entity>`.

To score Suggest rather than poke at it, run `make suggest-eval` with the
stack up: it sends the scenarios in `suggest-evals.json` (fill a list, count,
restyle, things that cannot be done, first setups) to the model and grades
each answer in code, twice per scenario; a scenario passes only when every
run does. `uv run python scripts/suggest_eval.py --help` has the options
(`--only fill`, `--model ai_task.other`, `--out results.json`). Add a
scenario whenever Suggest gets something wrong.

The `llm-seed` service then logs in, connects OpenRouter with the key,
adds the model as an AI Task entity and makes it the AI Task preference
(`docker compose logs llm-seed` tells what it did). A second boot leaves
an existing connection alone and swaps the model when `OPENROUTER_MODEL`
changed. Without the key nothing runs and Suggest explains what is
missing, as on a fresh install.

Not OpenAI-hosted models (`openai/gpt-*`): Home Assistant's OpenRouter
integration sends OpenAI's strict mode a schema without the
`additionalProperties: false` it insists on, so every suggestion fails
with `Invalid schema for response_format` until
[home-assistant/core#150294](https://github.com/home-assistant/core/issues/150294)
is fixed. Google and Anthropic models accept the same schema.

## First-run states (empty account)

To try the panel's first-run experience against a real Home Assistant:

- **No account yet:** connect once, then remove the Aivi entry (Settings →
  Devices & services). The sidebar panel leaves with the last account, as
  on a fresh install, where Home Assistant only loads an integration once
  a config entry exists. The onboarding card's **Connect account** link,
  Home Assistant's own `/_my_redirect/config_flow_start?domain=aivi`
  redirect, opens the Aivi config flow from any page; the card itself is
  in the panel harness (`?noaccount=1`).
- **Connected but no widgets:** start the mock with an empty account, then
  connect as usual:

  ```bash
  AIVI_MOCK_EMPTY=1 make qa   # or, from qa/: AIVI_MOCK_EMPTY=1 docker compose up --build
  ```

  `GET /widgets` then returns an empty page and the panel shows its empty
  state. Leave the variable unset (the default) to get the
  demo widgets back. The e2e journeys rely on them.

## End-to-end journeys

`make e2e` boots this stack from a clean state, runs the Playwright Test
journeys in `tests/e2e/qa/` (connect the account, bind widgets, a Live
Activity and a switchboard, a subscription lapse, an outage of the mock)
and takes the stack down again with its volumes. Its Home Assistant gets a
config dir of its own (`.e2e/` at the repo root), so whatever you set up in
the `make qa` stack survives a run; the two share ports, so stop that one
first. With the stack already up
from `make qa`, run them against it instead, one or all:

```bash
npm run test:qa
npm run test:qa -- --grep "switchboard"
```

They log in as `dev`, reset the mock first, and stop and start its
container for the outage journey. `E2E_HA_URL` and `E2E_MOCK_URL` point
them at other ports. A failed journey is retried once; its screenshot and
trace are in `npx playwright show-report playwright-report/qa`.

## Reset

```bash
# from qa/
docker compose down
git clean -fdx homeassistant   # wipe the runtime config, keep configuration.yaml
```

## How the no-onboarding boot works

`qa/seed/.storage/` holds a pre-onboarded admin user and the onboarding
marker. The compose entrypoint copies them into the config on first boot
(only if absent), so Home Assistant skips the setup wizard. Everything else
Home Assistant writes is ignored by git.

> Modeled on the quick-start pattern in
> [getaivi/ha-blueprints](https://github.com/getaivi/ha-blueprints).
