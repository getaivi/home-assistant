"""An Aivi server that does not take state words: pushes leave them out
until it may accept them again."""

from __future__ import annotations

from collections.abc import Callable
from typing import Any, Final

#: How long (seconds) pushes leave ``state_text`` out after Aivi rejected
#: it, before a push offers the field again (the server may accept it
#: by then).
STATE_TEXT_RETRY_SECONDS: Final = 3600.0


class StateTextSupport:
    """Whether the account's Aivi server takes ``state_text``, inferred from
    its answers; one per account entry. Aivi rejects unknown fields, so a
    server without the field answers a 422 naming ``state_text``: the push is resent
    without the words, and later ones leave them out until
    ``STATE_TEXT_RETRY_SECONDS`` have passed. ``on_refused`` lets the owner
    schedule that retry, since unchanged content would otherwise wait for
    the next state change."""

    def __init__(
        self,
        clock: Callable[[], float],
        on_refused: Callable[[], None] | None = None,
    ) -> None:
        self._clock = clock
        self._on_refused = on_refused
        self._refused_at: float | None = None
        self._confirmed = False
        self._epoch = 0

    @property
    def offered(self) -> bool:
        """Whether the next push should carry the words."""
        if self._refused_at is None:
            return True
        if self._clock() - self._refused_at < STATE_TEXT_RETRY_SECONDS:
            return False
        self._refused_at = None
        self._epoch += 1
        return True

    @property
    def epoch(self) -> int:
        """Bumps when the words are offered again after a refusal. Part of
        the push context, so content sent without its words is re-sent
        with them rather than suppressed as identical."""
        _ = self.offered
        return self._epoch

    @property
    def confirmed(self) -> bool:
        """Whether Aivi has accepted the words (it then stores the field on
        every tile, which the 4 KiB measure must count)."""
        return self._confirmed

    def refused(self) -> None:
        self._refused_at = self._clock()
        self._confirmed = False
        if self._on_refused is not None:
            self._on_refused()

    def accepted(self) -> None:
        self._refused_at = None
        self._confirmed = True


def has_state_text(content: dict[str, Any]) -> bool:
    return any(
        isinstance(action, dict) and "state_text" in action
        for action in content.get("actions") or []
    )


def without_state_text(content: dict[str, Any]) -> dict[str, Any]:
    """The content with every tile's words left out: the tiles keep the
    app's own words."""
    return {
        **content,
        "actions": [
            {k: v for k, v in action.items() if k != "state_text"}
            if isinstance(action, dict)
            else action
            for action in content.get("actions") or []
        ],
    }
