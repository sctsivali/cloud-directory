"""Deterministic facility extractor. Office addresses are not data centres."""
from __future__ import annotations

from typing import Any, Mapping
import re

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
    adapter_name="facility",
    ruleset_version="extractor.facility.v1",
    task="extract_facilities",
    output_schema={
        "type": "object",
        "additionalProperties": False,
        "required": ["facilities"],
        "properties": {"facilities": {"type": "array"}},
    },
    required_keys=("facilities",),
)

FACILITY_KEYS = ("name", "city", "country", "kind", "map_precision", "address", "excerpt")
KINDS = frozenset({"datacenter", "office", "unknown"})
PRECISIONS = frozenset({"facility_exact", "campus", "city_centroid", "region_centroid", "undisclosed"})


def parse_facility_output(raw: Any) -> dict[str, Any]:
    obj = assert_exact_object(raw, SPEC.required_keys)
    rows = obj["facilities"]
    if not isinstance(rows, list):
        raise ExtractorError("facilities must be an array")
    parsed: list[dict[str, Any]] = []
    for row in rows:
        item = assert_exact_object(row, FACILITY_KEYS)
        if item["kind"] not in KINDS:
            raise ExtractorError("unsupported facility kind")
        if item["map_precision"] not in PRECISIONS:
            raise ExtractorError("unsupported map_precision")
        if item["kind"] == "office" and item["map_precision"] == "facility_exact":
            raise ExtractorError("office address cannot be facility_exact")
        parsed.append(item)
    return {"facilities": parsed}


class DeterministicFacilityAdapter:
    model_provider = "rules"
    model_name = "extractor.facility.v1"

    def complete(self, envelope: Mapping[str, Any]) -> dict[str, Any]:
        text = strip_injection_lines(str(envelope.get("untrusted_source_text") or ""))
        facilities: list[dict[str, Any]] = []
        office = re.search(
            r"(sales office|head office|corporate office|office address)[^\n]{0,24}([A-Za-z0-9][^\n.]{6,120})",
            text,
            re.I,
        )
        dc = re.search(
            r"(primary data ?cent(?:re|er)|dc campus|colocation hall)[^\n]{0,24}([A-Za-z0-9][^\n.]{3,120})",
            text,
            re.I,
        )
        undisclosed_dc = re.search(
            r"data ?cent(?:re|er) locations? are undisclosed|hall name not disclosed",
            text,
            re.I,
        )
        city_m = re.search(
            r"\b(Jakarta|Singapore|Bangkok|Hanoi|Manila|Kuala Lumpur|Phnom Penh|Vientiane|Yangon|Bandar Seri Begawan)\b",
            text,
            re.I,
        )
        country_m = re.search(
            r"\b(Indonesia|Malaysia|Singapore|Thailand|Vietnam|Philippines|Cambodia|Laos|Myanmar|Brunei)\b",
            text,
            re.I,
        )
        city = city_m.group(1) if city_m else None
        country = country_m.group(1) if country_m else None
        if office:
            excerpt = office.group(0).strip()
            facilities.append(
                {
                    "name": "office",
                    "city": city,
                    "country": country,
                    "kind": "office",
                    "map_precision": "undisclosed",
                    "address": office.group(2).strip(),
                    "excerpt": excerpt,
                }
            )
        if dc:
            excerpt = dc.group(0).strip()
            facilities.append(
                {
                    "name": dc.group(2).strip(),
                    "city": city,
                    "country": country,
                    "kind": "datacenter",
                    "map_precision": "campus",
                    "address": None,
                    "excerpt": excerpt,
                }
            )
        elif undisclosed_dc:
            facilities.append(
                {
                    "name": None,
                    "city": city,
                    "country": country,
                    "kind": "datacenter",
                    "map_precision": "undisclosed",
                    "address": None,
                    "excerpt": undisclosed_dc.group(0).strip(),
                }
            )
        return {"facilities": facilities}


def extract_facility(receipt: FetchReceipt, subject: Mapping[str, Any], adapter: ModelAdapter | None = None) -> ExtractionResult:
    return run_extractor(
        SPEC,
        receipt,
        subject,
        adapter or DeterministicFacilityAdapter(),
        parse=parse_facility_output,
    )
