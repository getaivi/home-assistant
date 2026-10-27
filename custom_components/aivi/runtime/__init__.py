"""What one account entry runs: a push manager per binding subentry and,
while the account binds anything that accepts input (a switchboard), the
event stream that plays presses back into services.

Bindings change in place: adding, editing or removing one subentry starts,
replaces or stops only that binding's manager and updates the stream's
routing without reconnecting it. A replaced manager for the same widget
keeps its predecessor's last delivered digest, so an edit that does not
change the content sends nothing to the phone. Each binding is one
``Binding`` record that outlives its managers; the binding's entities
listen there.

The account's subscription is runtime state too, kept as ``GET /account``
or a 402 last described it. The first 402 from any call pauses every
binding and stops the stream, and one fixable repair issue says so. Aivi
is asked again every hour (and from the repair flow); once it answers,
every binding pushes its current content and the stream reconnects. While
active, the status is refreshed every 12 hours.

Each event the stream handles becomes a record of what it was and what
became of it: kept in the account's recent list for the panel and handed
to the event entity of the binding it was for.

The package splits by concern: ``account`` (the runtime itself),
``binding`` (one binding's record), ``delivery`` (how a binding's content
goes out), ``issues`` (the repair issues bindings raise), ``subscription``
(the account's subscription) and ``stream`` (the event stream, as the
account runs it).
"""

from __future__ import annotations

from .account import AiviConfigEntry, AiviRuntime, account_of
from .binding import (
    Binding,
    async_end_activity,
    binding_content,
    binding_model,
    registered_device,
    signal_binding_changed,
)
from .delivery import push_switchboard
from .issues import prune_stale_issues
from .subscription import (
    DATA_INACTIVE,
    PROBE_INTERVAL,
    REFRESH_INTERVAL,
    subscription_issue_id,
)

__all__ = [
    "DATA_INACTIVE",
    "PROBE_INTERVAL",
    "REFRESH_INTERVAL",
    "AiviConfigEntry",
    "AiviRuntime",
    "Binding",
    "account_of",
    "async_end_activity",
    "binding_content",
    "binding_model",
    "prune_stale_issues",
    "push_switchboard",
    "registered_device",
    "signal_binding_changed",
    "subscription_issue_id",
]
