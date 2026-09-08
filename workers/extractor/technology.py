"""Deterministic technology extractor. Negation is not presence."""
from __future__ import annotations

import re
from typing import Any, Mapping

from workers.collector.fetch import FetchReceipt
from workers.extractor.contract import (
    ExtractorError,
    ExtractorSpec,
    ExtractionResult,
    ModelAdapter,
    assert_exact_object,
    run_extractor,
    strip_injection_lines,
)

SPEC = ExtractorSpec(
    adapter_name="technology",
    ruleset_version="extractor.technology.v1",
    task="extract_technologies",
    output_schema={
        "type": "object",
        "additionalProperties": False,
        "required": ["technologies"],
        "properties": {"technologies": {"type": "array"}},
    },
    required_keys=("technologies",),
)

TECH_KEYS = ("name", "knowledge_state", "hedged", "excerpt", "scope")
KNOWLEDGE = frozenset({"present", "confirmed_absent", "unknown", "not_applicable", "conflicting"})
SCOPES = frozenset({"provider", "service", "offering", "deployment"})

NEGATION_RE = re.compile(
    r"\b(do not|don't|does not|we do not|no longer|not use|not offer|without)\b[^\n.]{0,40}\b(KVM|kvm)\b"
    r"|\b(KVM|kvm)\b[^\n.]{0,40}\b(is not used|not supported|not offered)\b",
    re.I,
)
HEDGE_RE = re.compile(
    r"\b(may|might|possibly|likely|probably|appears to|typically)\b[^\n.]{0,40}\b(KVM|kvm)\b",
    re.I,
)
PRESENT_RE = re.compile(r"Hypervisor:\s*KVM\b|\bKVM\b", re.I)


def parse_technology_output(raw: Any) -> dict[str, Any]:
    obj = assert_exact_object(raw, SPEC.required_keys)
    rows = obj["technologies"]
    if not isinstance(rows, list):
        raise ExtractorError("technologies must be an array")
    parsed: list[dict[str, Any]] = []
    for row in rows:
        item = assert_exact_object(row, TECH_KEYS)
        if item["knowledge_state"] not in KNOWLEDGE:
            raise ExtractorError("unsupported knowledge_state")
        if not isinstance(item["hedged"], bool):
            raise ExtractorError("hedged must be boolean")
        if item["scope"] not in SCOPES:
            raise ExtractorError("unsupported technology scope")
        if not isinstance(item["name"], str) or not item["name"].strip():
            raise ExtractorError("technology name is required")
        if not isinstance(item["excerpt"], str) or not item["excerpt"].strip():
            raise ExtractorError("excerpt is required")
        parsed.append(item)
    return {"technologies": parsed}


class DeterministicTechnologyAdapter:
    model_provider = "rules"
    model_name = "extractor.technology.v1"

    def complete(self, envelope: Mapping[str, Any]) -> dict[str, Any]:
        text = strip_injection_lines(str(envelope.get("untrusted_source_text") or ""))
        rows: list[dict[str, Any]] = []
        neg = NEGATION_RE.search(text)
        hedge = HEDGE_RE.search(text)
        present = PRESENT_RE.search(text)
        if neg:
            rows.append(
                {
                    "name": "KVM",
                    "knowledge_state": "confirmed_absent",
                    "hedged": False,
                    "excerpt": neg.group(0).strip(),
                    "scope": "provider",
                }
            )
        elif hedge:
            rows.append(
                {
                    "name": "KVM",
                    "knowledge_state": "present",
                    "hedged": True,
                    "excerpt": hedge.group(0).strip(),
                    "scope": "provider",
                }
            )
        elif present:
            rows.append(
                {
                    "name": "KVM",
                    "knowledge_state": "present",
                    "hedged": False,
                    "excerpt": present.group(0).strip(),
                    "scope": "provider",
                }
            )
        return {"technologies": rows}


def extract_technology(receipt: FetchReceipt, subject: Mapping[str, Any], adapter: ModelAdapter | None = None) -> ExtractionResult:
    return run_extractor(
        SPEC,
        receipt,
        subject,
        adapter or DeterministicTechnologyAdapter(),
        parse=parse_technology_output,
    )
