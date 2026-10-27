"""The vendored Aivi OpenAPI document, loaded for validation.

Shared by the contract tests and the QA mock. Refresh the document with
``make openapi``.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from openapi_core import OpenAPI

DOCUMENT = Path(__file__).with_name("aivi-openapi.json")


def _unwrap_nullable_parameters(document: dict[str, Any]) -> None:
    """A query or header parameter is never JSON null, and openapi-core
    reads how to split a parameter from its schema's ``type``, which an
    ``anyOf: [X, null]`` hides (a repeated ``types`` query would be read
    as one string). Such parameters are validated against ``X``."""
    for operations in document["paths"].values():
        for operation in operations.values():
            for parameter in operation.get("parameters", []):
                schema = parameter.get("schema", {})
                options = schema.get("anyOf", [])
                rest = [option for option in options if option != {"type": "null"}]
                if len(options) == 2 and len(rest) == 1:
                    del schema["anyOf"]
                    schema.update(rest[0])


def document(path: Path = DOCUMENT) -> dict[str, Any]:
    """The document as validation reads it."""
    loaded = json.loads(path.read_text(encoding="utf-8"))
    _unwrap_nullable_parameters(loaded)
    return loaded


def load(path: Path = DOCUMENT, *, server: str | None = None) -> OpenAPI:
    """The document as an openapi-core validator. ``server`` replaces the
    documented server URL, so requests to another host validate too."""
    loaded = document(path)
    if server is not None:
        loaded["servers"] = [{"url": server}]
    return OpenAPI.from_dict(loaded)
