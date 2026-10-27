"""The vendored OpenAPI document, and what breaks it reported as FastAPI
reports it."""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path
from typing import Any

from jsonschema.exceptions import ValidationError, best_match
from openapi_core.contrib.werkzeug import (
    WerkzeugOpenAPIRequest,
    WerkzeugOpenAPIResponse,
)
from openapi_core.exceptions import OpenAPIError
from openapi_core.templating.paths.exceptions import (
    OperationNotFound,
    PathNotFound,
)
from openapi_core.validation.request.exceptions import (
    MissingRequestBody,
    ParameterValidationError,
    RequestBodyValidationError,
    SecurityValidationError,
)
from openapi_schema_validator import OAS31Validator
from werkzeug.wrappers import Request, Response

from .responses import detail, refusal, unauthorized

# Where ``contract/`` is mounted, else the repo root.
sys.path.insert(
    0, os.environ.get("AIVI_CONTRACT_ROOT") or str(Path(__file__).resolve().parents[3])
)
from contract.openapi import document, load

DOCUMENT = document()
OPENAPI = load(server="/")
COMPONENTS = DOCUMENT["components"]
EVENT_SCHEMA = DOCUMENT["paths"]["/events"]["get"]["responses"]["200"]["content"][
    "text/event-stream"
]["x-sse-data-schema"]

_ERROR_TYPES = {
    "maxLength": "string_too_long",
    "minLength": "string_too_short",
    "maximum": "less_than_equal",
    "minimum": "greater_than_equal",
    "maxItems": "too_long",
    "minItems": "too_short",
    "pattern": "string_pattern_mismatch",
    "enum": "enum",
    "const": "literal_error",
    "type": "type_error",
}


def deepest(error: ValidationError) -> ValidationError:
    while error.context:
        error = best_match(error.context)
    return error


def fastapi_errors(schema_errors: Any, base: list[str | int]) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for raw in schema_errors:
        error = deepest(raw)
        loc = [*base, *error.absolute_path]
        instance = error.instance
        if error.validator == "additionalProperties" and isinstance(instance, dict):
            known = set(error.schema.get("properties", {}))
            out += [
                {
                    "type": "extra_forbidden",
                    "loc": [*loc, name],
                    "msg": "Extra inputs are not permitted",
                    "input": instance[name],
                }
                for name in instance
                if name not in known
            ]
        elif error.validator == "required" and isinstance(instance, dict):
            out += [
                {"type": "missing", "loc": [*loc, name], "msg": "Field required"}
                for name in error.validator_value
                if name not in instance
            ]
        else:
            out.append(
                {
                    "type": _ERROR_TYPES.get(str(error.validator), "value_error"),
                    "loc": loc,
                    "msg": error.message,
                    "input": instance,
                }
            )
    return out


def validation_failure(error: OpenAPIError) -> Response:
    """A request the schema rejects, answered as Aivi would."""
    if isinstance(error, SecurityValidationError):
        return unauthorized()
    if isinstance(error, PathNotFound):
        return detail(404, "Not Found")
    if isinstance(error, OperationNotFound):
        return detail(405, "Method Not Allowed")
    cause = error.__cause__
    schema_errors = getattr(cause, "schema_errors", None)
    if isinstance(error, ParameterValidationError):
        base: list[str | int] = [str(error.location), error.name]
        if schema_errors:
            return refusal(fastapi_errors(schema_errors, base))
        return refusal([{"type": "value_error", "loc": base, "msg": str(error)}])
    if isinstance(error, MissingRequestBody):
        return refusal([{"type": "missing", "loc": ["body"], "msg": "Field required"}])
    if isinstance(error, RequestBodyValidationError) and schema_errors:
        return refusal(fastapi_errors(schema_errors, ["body"]))
    return refusal([{"type": "value_error", "loc": ["body"], "msg": str(error)}])


def strict_json(raw: bytes) -> Response | None:
    """JSON as Aivi parses it: NaN and infinity are not numbers."""

    def refuse(name: str) -> None:
        raise ValueError(name)

    try:
        json.loads(raw, parse_constant=refuse)
    except ValueError as err:
        return refusal(
            [
                {
                    "type": "json_invalid",
                    "loc": ["body", 0],
                    "msg": f"JSON decode error: {err}",
                    "input": {},
                }
            ]
        )
    return None


def check_response(request: Request, response: Response) -> Response:
    """The mock's own answer must match the schema too."""
    try:
        OPENAPI.validate_response(
            WerkzeugOpenAPIRequest(request), WerkzeugOpenAPIResponse(response)
        )
    except (PathNotFound, OperationNotFound):
        return response
    except OpenAPIError as err:
        cause = getattr(err.__cause__, "schema_errors", None)
        reasons = fastapi_errors(cause, []) if cause else [str(err)]
        print(f"[schema] mock response violates the schema: {reasons}", flush=True)
        return detail(500, f"Mock response violates the schema: {reasons}")
    return response


def matches(instance: Any, schema: dict[str, Any]) -> bool:
    return OAS31Validator(
        {**schema, "components": COMPONENTS},
        format_checker=OAS31Validator.FORMAT_CHECKER,
    ).is_valid(instance)


def event_errors(event: dict[str, Any]) -> list[str]:
    validator = OAS31Validator(
        {**EVENT_SCHEMA, "components": COMPONENTS},
        format_checker=OAS31Validator.FORMAT_CHECKER,
    )
    return [deepest(error).message for error in validator.iter_errors(event)]
