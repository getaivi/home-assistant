"""A stand-in for the Aivi public API, for manual QA and the e2e journeys.

Serves what the integration calls, validated both ways against the
vendored OpenAPI document (``contract/aivi-openapi.json``, via
openapi-core): a request that breaks the schema is answered 422 with a
FastAPI-style ``detail`` list, and a response of the mock's own that
breaks it is a 500, so drift shows up as a failing journey.

- ``GET /account``: the subscription status, answered whatever the
  subscription (``expired`` with a lapse's ``expired_at``, else ``none``), in its
  per-state shape.
- ``GET /widgets``, ``GET /activities``: real pagination (``limit``,
  opaque ``cursor``, ``next_cursor``); pages hold at most
  ``AIVI_MOCK_PAGE_SIZE`` items (default 3) so paging is exercised.
- ``PATCH /widgets/{slug}``, ``PATCH /activities/{slug}``: 404 for an
  unknown slug, 400 for content of another template, 422 for widget
  content over 4 KiB measured as Aivi stores it (every field present),
  and 422 for what Aivi checks beyond the schema: price periods out of
  order, an energy widget without a node. A widget keeps the last
  ``stale_after`` it was sent (omitted: unchanged, null: cleared) and
  answers with it.
- ``GET /events``: server-sent events with ``retry:``, ``id:`` cursors
  (``u:<n>``), a ``: ping`` every 20 s, ``Last-Event-ID`` replay of the
  unexpired events after it (an unknown one replays them all), the
  ``types`` and ``subject`` filters, 429 past four open streams, and a
  15-minute lifetime.
- Auth: the ``Authorization: Token <token>`` header is required; the
  token ``invalid`` is refused with 401.

Mock-only routes (not validated, not in the schema):

- ``GET /`` lists recent pushes; ``GET /pushes.json`` is the same as JSON,
  and ``GET /refusals.json`` the API requests answered 400 or 422.
  ``GET /state.json`` shows the switches below, ``answered_402``, the
  API requests answered 402 since the subscription last changed, and
  ``account_checks``, the ``GET /account`` calls over the same span.
- ``POST /command`` stands in for a tile press on the phone: it wraps
  ``{"widget": slug, "action": id, "value"?: bool}`` in the real event
  envelope (``value`` makes it a toggle) and delivers it to every open
  stream.
- ``POST /admin/subscription {"active": false, "expired_at"?: str}``
  makes the account inactive (402 everywhere but ``GET /account``); ``{"active": true,
  "expires_at"?: str, "renews"?: bool}`` restores it, with the end of the
  paid period ``GET /account`` reports (none and renewing by default).
- ``POST /admin/events {"refuse": n, "close"?: true}``: the next n
  streams only send ``retry:`` and end, as the real API does when it
  cannot set one up; ``close`` ends the open streams, as their 15-minute
  lifetime does.
- ``POST /admin/activities {"max_ongoing": n}``: an ONGOING push past n
  live activities is refused ("Too many ongoing activities"); null lifts
  the limit.
- ``POST /admin/reset`` restores all of the above and clears the pushes.

``AIVI_MOCK_EMPTY=1`` serves an account with no widgets or activities.
Listens on 8080; the compose stack maps it to 8099.
"""

from __future__ import annotations

import logging

from mock_aivi import app
from werkzeug.serving import run_simple

if __name__ == "__main__":
    logging.getLogger("werkzeug").setLevel(logging.WARNING)
    print("Mock Aivi listening on :8080", flush=True)
    # All interfaces: the server runs in a container and is reached from outside.
    run_simple("0.0.0.0", 8080, app, threaded=True)  # noqa: S104
