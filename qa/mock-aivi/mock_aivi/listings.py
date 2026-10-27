"""``GET /widgets`` and ``GET /activities``: pages behind opaque cursors."""

from __future__ import annotations

import base64
import binascii
import os

from werkzeug.wrappers import Request, Response

from .responses import json_response, refusal

PAGE_SIZE = int(os.environ.get("AIVI_MOCK_PAGE_SIZE", "3"))


def encode_cursor(kind: str, offset: int) -> str:
    return base64.urlsafe_b64encode(f"{kind}:{offset}".encode()).decode().rstrip("=")


def decode_cursor(kind: str, cursor: str) -> int | None:
    try:
        raw = base64.urlsafe_b64decode(cursor + "=" * (-len(cursor) % 4)).decode()
    except (binascii.Error, UnicodeDecodeError, ValueError):
        return None
    prefix, _, offset = raw.partition(":")
    return int(offset) if prefix == kind and offset.isdigit() else None


def listing(request: Request, kind: str, items: list[dict[str, str]]) -> Response:
    limit = min(int(request.args.get("limit", 50)), PAGE_SIZE)
    offset = 0
    if (cursor := request.args.get("cursor")) is not None:
        decoded = decode_cursor(kind, cursor)
        if decoded is None:
            return refusal(
                [
                    {
                        "type": "value_error",
                        "loc": ["query", "cursor"],
                        "msg": "Value error, Invalid cursor",
                        "input": cursor,
                    }
                ]
            )
        offset = decoded
    page = items[offset : offset + limit]
    more = offset + limit < len(items)
    return json_response(
        200,
        {
            "items": page,
            "next_cursor": encode_cursor(kind, offset + limit) if more else None,
        },
    )
