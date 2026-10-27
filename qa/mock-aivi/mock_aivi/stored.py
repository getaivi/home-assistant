"""Content as Aivi stores it, which is what the 4 KiB limit measures."""

from __future__ import annotations

import json
from typing import Any

from .schema import COMPONENTS, matches

#: Fields Aivi leaves out of the stored form while they are null.
_OMITTED_WHEN_NULL = {"state_text"}
_STATE_TEXT_SCHEMAS = {"ToggleStateText", "ButtonStateText"}


def _resolve(schema: dict[str, Any]) -> dict[str, Any]:
    while "$ref" in schema:
        schema = COMPONENTS["schemas"][schema["$ref"].rsplit("/", 1)[1]]
    return schema


def stored_form(value: Any, schema: dict[str, Any]) -> Any:
    """``value`` as Aivi stores it: every field present, defaults filled
    in, unset optional ones as null (state words aside)."""
    schema = _resolve(schema)
    for union in ("oneOf", "anyOf"):
        if union in schema:
            if value is None:
                return None
            for option in schema[union]:
                if _resolve(option).get("type") != "null" and matches(value, option):
                    return stored_form(value, option)
            return value
    if isinstance(value, list) and "items" in schema:
        return [stored_form(item, schema["items"]) for item in value]
    if not isinstance(value, dict) or "properties" not in schema:
        return value
    words = schema.get("title") in _STATE_TEXT_SCHEMAS
    out: dict[str, Any] = {}
    for name, sub in schema["properties"].items():
        if name in value and value[name] is not None:
            out[name] = stored_form(value[name], sub)
        elif words or name in _OMITTED_WHEN_NULL:
            continue
        elif "default" not in sub and _resolve(sub).get("type") == "array":
            out[name] = []  # a list field defaults to empty
        else:
            out[name] = sub.get("default")
    return out


def stored_size(content: dict[str, Any]) -> int:
    stored = stored_form(content, {"$ref": "#/components/schemas/WidgetContent-Input"})
    return len(json.dumps(stored, separators=(",", ":")))
