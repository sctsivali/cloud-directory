"""Canonical JSON and SHA-256 digests matching mcp/src/digest.ts."""
from __future__ import annotations

import hashlib
import json
from typing import Any


def canonical_json(value: Any) -> str:
    if value is None or not isinstance(value, (dict, list)):
        return json.dumps(value, ensure_ascii=False, separators=(",", ":"))
    if isinstance(value, list):
        return "[" + ",".join(canonical_json(item) for item in value) + "]"
    keys = sorted(value.keys())
    inner = ",".join(
        json.dumps(str(key), ensure_ascii=False) + ":" + canonical_json(value[key])
        for key in keys
    )
    return "{" + inner + "}"


def sha256_hex(value: str | bytes) -> str:
    data = value.encode("utf-8") if isinstance(value, str) else value
    return hashlib.sha256(data).hexdigest()


def body_digest(value: Any) -> str:
    return sha256_hex(canonical_json(value))


def proposal_body_for_digest(tool_name: str, payload: dict[str, Any]) -> dict[str, Any]:
    body = {
        key: val
        for key, val in payload.items()
        if key not in {"idempotencyKey", "actorId", "reviewerId"}
    }
    return {"toolName": tool_name, **body}
