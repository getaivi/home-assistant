# Panel harness

The panel in a plain browser, with no Home Assistant running.
`mock-hass.js` fakes the `hass` object (entity states and the `aivi/*`
WebSocket commands) over the real template metadata. The commands that
need the integration's logic (`aivi/preview`, `aivi/save`,
`aivi/defaults`) go to the dev server, `scripts/harness_server.py`, which
runs the integration's own WebSocket handlers over a test Home Assistant
holding the sample data. Previews, editor feedback (real Jinja included)
and save checks are therefore the integration's.

```bash
make harness   # builds the bundle, then serves on port 8777
```

The harness loads the built bundle
(`custom_components/aivi/frontend/aivi-panel.js`). After editing
`frontend/src/`, run `make bundle` and reload.

## Files

- `index.html`, `light.html`, `theme.html`: the panel in Home
  Assistant's dark theme, its light theme, and a non-default user theme.
- `mock-hass.js`: the fake `hass`, and `mountPanelHost`, which mounts the
  panel the way Home Assistant's `<ha-panel-custom>` does.
- `meta.generated.js`: the template metadata, generated from the
  integration's registry. Regenerate it with `make meta` after changing
  `templates.py` or `blocks.py`; do not edit it by hand.
- `sample-data.json`: entity states, areas, recorded history, the Energy
  dashboard and currency, the bound subentries, the canned suggestions,
  and sample bindings the tests use.
- `fixtures.js`: the rest of the fixture data (remote widgets and
  activities, entity and device registry slices, the recorded presses
  and pushes).
- `ha-icon.js`: a stand-in for Home Assistant's `<ha-icon>`, so the
  preview's approximate icons draw here too (from the `@mdi/svg`
  devDependency; it is not part of the shipped bundle).

## URLs

All under `http://127.0.0.1:8777/frontend/harness/`.

| URL | Shows |
|---|---|
| `index.html` | The hub, dark |
| `light.html` | The hub, light |
| `theme.html` | The hub in a user theme (green accent) |
| `index.html#/widget/frontdoor` | A bound widget's editor |
| `index.html#/activity/washer` | A bound Live Activity's editor |
| `index.html#/activity/grill` | The editor for a listed, unbound Live Activity |

Query parameters change the mock's state and combine with any page and
route (`index.html?more=1#/widget/home`):

| Parameter | State |
|---|---|
| `?offline=1` | Aivi unreachable: the banner, bound cards only |
| `?inactive=1` | Subscription not active: the subscription banner |
| `?noaccount=1` | No account: the onboarding card |
| `?nowidgets=1` | An account with nothing on it: no widgets, no Live Activities (`?accounts=2&nowidgets=acc2` empties only Cabin) |
| `?accounts=2` | A second account, Cabin, feeding one widget |
| `?noactivities=1` | Widgets but no Live Activities |
| `?activitiesonly=1` | Live Activities but no widgets |
| `?unbound=1` | Widgets exist, none bound: the first-bind journey |
| `?more=1` | Also the budget, trend, prices and energy widgets, and a bound list (`#/widget/home`) |
| `?switchboard=1` | The Living room switchboard is bound: Events in the top bar, Recent presses in its editor (`#/widget/livingroom`) |
| `?stream=reconnecting` or `stopped` | The event stream's state (with `?switchboard=1`) |
| `?suggest=not_loaded` or `no_entity` | The Suggest box, disabled with its setup guidance |
| `?waiting=1` | The Washer's progress follows a sensor that reads unknown: its editor (`#/activity/washer`) and its hub card say nothing is sent, and the Log has its waiting row and a change the throttle held |
| `?templated=1` | The Front door's State is a saved template: its workspace opens from its address, after a reload too (`#/widget/frontdoor/state/template`) |

The default fixtures cover every hub card state: bound and unbound
widgets, a widget whose template is unsupported (Weather), and two
listed Live Activities (Washer bound, Grill unbound).

## Routing

`mountPanelHost` assigns `hass`, `narrow`, `route` and `panel` onto the
element, as Home Assistant does, so host-contract bugs show up here too.
The route path is kept in the URL hash: the panel's own navigations
rewrite it, deep links and reloads restore the view, and browser
back/forward give the panel a fresh `route`.

## Tests and screenshots

The vitest suite uses the same `mock-hass.js` without a server and
replays the integration's recorded answers; see
[`../tests/fixtures/README.md`](../tests/fixtures/README.md).

`make snapshots` runs the Playwright Test suite in `tests/e2e/harness/`:
it starts the dev server itself (on port 8778, so an open `make harness`
is left alone), writes screenshots to `snapshots/`, and runs the
interaction and accessibility checks. The screenshots are for review and
are not compared against earlier ones; serious and critical axe-core
findings fail the run, and minor ones are noted in the HTML report
(`npx playwright show-report playwright-report/harness`).
