"""The mock Aivi API (see ``server.py`` for what it serves).

One module per concern: ``app`` (routing), ``schema`` (the OpenAPI
document and its errors as FastAPI reports them), ``responses``,
``state`` (the account and what the mock remembers), ``stored`` (the
stored form the 4 KiB limit measures), ``listings``, ``pushes``,
``events`` and ``admin`` (the mock-only routes).
"""

from __future__ import annotations

from .app import app
from .state import LOG, ONGOING, PUSHES, WIDGETS, reset

__all__ = [
    "LOG",
    "ONGOING",
    "PUSHES",
    "WIDGETS",
    "app",
    "reset",
]
