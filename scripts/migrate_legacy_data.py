#!/usr/bin/env python3
"""Conservatively copy legacy public rows into Phase 2 canonical tables.

Does not default to DATABASE_URL. Does not fabricate legal entities, fetch
snapshots, evidence, observation times, or facility-exact map precision.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
from dataclasses import dataclass
from decimal import Decimal
from typing import Any

ASSESSMENT_LEGACY = "legacy/unverified"
STACK_FIELDS = (
    ("hypervisor", "hypervisor"),
    ("container_runtime", "container_runtime"),
    ("orchestration", "orchestration"),
    ("storage", "storage"),
    ("network", "network"),
    ("control_plane", "control_plane"),
    ("virtualization", "virtualization"),
)


class LegacyMigrationError(Exception):
    """Legacy data copy failed and must not be treated as success."""


@dataclass(frozen=True)
class LegacyMigrateResult:
    services: int
    offerings: int
    offering_versions: int
    facilities: int
    deployments: int
    technologies: int
    technology_deployments: int
    claims: int
    legal_entities: int
    fetch_snapshots: int
    evidence: int


def _connect(url: str):
    try:
        import psycopg
    except ImportError as exc:
        raise LegacyMigrationError("psycopg is required to migrate legacy data") from exc
    return psycopg.connect(url)


def _jsonable(value: Any) -> Any:
    if isinstance(value, Decimal):
        return float(value)
    if isinstance(value, dict):
        return {k: _jsonable(v) for k, v in value.items()}
    if isinstance(value, list):
        return [_jsonable(v) for v in value]
    return value


def _json_param(value: dict[str, Any]):
    from psycopg.types.json import Json

    return Json(_jsonable(value))


def _slug(text: str) -> str:
    s = re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")
    return s[:80] or "unknown"


def _tech_id(slug: str) -> str:
    return f"technology:{slug}"


def _counts(conn) -> LegacyMigrateResult:
    def n(table: str) -> int:
        return int(conn.execute(f"SELECT count(*) FROM {table}").fetchone()[0])

    return LegacyMigrateResult(
        services=n("services"),
        offerings=n("offerings"),
        offering_versions=n("offering_versions"),
        facilities=n("facilities"),
        deployments=n("deployments"),
        technologies=n("technologies"),
        technology_deployments=n("technology_deployments"),
        claims=n("claims"),
        legal_entities=n("legal_entities"),
        fetch_snapshots=n("fetch_snapshots"),
        evidence=n("evidence"),
    )


def _migrate_catalog(conn) -> None:
    providers = conn.execute("SELECT id FROM providers").fetchall()
    for (provider_id,) in providers:
        service_id = f"service:{provider_id}:legacy-catalog"
        conn.execute(
            """
            INSERT INTO services (
              id, provider_id, slug, name, category, assessment_state,
              legacy_table, legacy_pk
            ) VALUES (%s, %s, 'legacy-catalog', 'Legacy catalog', 'legacy', %s, 'providers', %s)
            ON CONFLICT (id) DO NOTHING
            """,
            (service_id, provider_id, ASSESSMENT_LEGACY, provider_id),
        )

    tiers = conn.execute(
        """
        SELECT id, provider_id, tier_name, status, vcpu, ram_gb, storage_gb, storage_type,
               price_native, currency, price_usd_month, billing_period,
               dc_location, dc_city, dc_country, hypervisor, orchestration,
               container_runtime, stack_storage, updated_at
        FROM tiers
        """
    ).fetchall()
    for row in tiers:
        (
            tier_id,
            provider_id,
            tier_name,
            status,
            vcpu,
            ram_gb,
            storage_gb,
            storage_type,
            price_native,
            currency,
            price_usd_month,
            billing_period,
            dc_location,
            dc_city,
            dc_country,
            hypervisor,
            orchestration,
            container_runtime,
            stack_storage,
            updated_at,
        ) = row
        service_id = f"service:{provider_id}:legacy-catalog"
        offering_id = f"offering:tiers:{tier_id}"
        version_id = f"offering_version:tiers:{tier_id}:1"
        conn.execute(
            """
            INSERT INTO offerings (
              id, provider_id, service_id, name, status, assessment_state,
              legacy_table, legacy_pk
            ) VALUES (%s, %s, %s, %s, %s, %s, 'tiers', %s)
            ON CONFLICT (id) DO NOTHING
            """,
            (offering_id, provider_id, service_id, tier_name, status, ASSESSMENT_LEGACY, tier_id),
        )
        attributes = {
            "vcpu": vcpu,
            "ram_gb": ram_gb,
            "storage_gb": storage_gb,
            "storage_type": storage_type,
            "price_native": price_native,
            "currency": currency,
            "price_usd_month": price_usd_month,
            "billing_period": billing_period,
            "dc_location": dc_location,
            "dc_city": dc_city,
            "dc_country": dc_country,
            "hypervisor": hypervisor,
            "orchestration": orchestration,
            "container_runtime": container_runtime,
            "stack_storage": stack_storage,
        }
        conn.execute(
            """
            INSERT INTO offering_versions (
              id, offering_id, version_ordinal, attributes, observed_at,
              valid_from, valid_to, assessment_state, legacy_table, legacy_pk
            ) VALUES (%s, %s, 1, %s, %s, %s, NULL, %s, 'tiers', %s)
            ON CONFLICT (id) DO NOTHING
            """,
            (
                version_id,
                offering_id,
                _json_param(attributes),
                updated_at,
                updated_at,
                ASSESSMENT_LEGACY,
                tier_id,
            ),
        )


def _migrate_geography(conn) -> None:
    buildings = conn.execute(
        """
        SELECT id, name, city, country, address, operator, lat, lng, listed
        FROM buildings
        """
    ).fetchall()
    for b_id, name, city, country, address, operator, lat, lng, listed in buildings:
        loc = conn.execute(
            "SELECT id FROM locations WHERE city = %s AND country = %s",
            (city, country),
        ).fetchone()
        location_id = loc[0] if loc else None
        facility_id = f"facility:buildings:{b_id}"
        conn.execute(
            """
            INSERT INTO facilities (
              id, name, location_id, address, operator, lat, lng, map_precision,
              listed, assessment_state, legacy_table, legacy_pk
            ) VALUES (
              %s, %s, %s, %s, %s, %s, %s, 'undisclosed', %s, %s, 'buildings', %s
            )
            ON CONFLICT (id) DO NOTHING
            """,
            (
                facility_id,
                name,
                location_id,
                address,
                operator,
                lat,
                lng,
                listed,
                ASSESSMENT_LEGACY,
                str(b_id),
            ),
        )

    links = conn.execute(
        "SELECT provider_id, location_id FROM provider_locations"
    ).fetchall()
    for provider_id, location_id in links:
        dep_id = f"deployment:provider_locations:{provider_id}:{location_id}"
        conn.execute(
            """
            INSERT INTO deployments (
              id, provider_id, offering_id, location_id, assessment_state,
              legacy_table, legacy_pk
            ) VALUES (%s, %s, NULL, %s, %s, 'provider_locations', %s)
            ON CONFLICT (id) DO NOTHING
            """,
            (dep_id, provider_id, location_id, ASSESSMENT_LEGACY, f"{provider_id}:{location_id}"),
        )

    conn.execute(
        """
        INSERT INTO deployment_facilities (deployment_id, facility_id)
        SELECT d.id, f.id
        FROM deployments d
        JOIN locations l ON l.id = d.location_id
        JOIN facilities f ON f.legacy_table = 'buildings'
        JOIN buildings b ON b.id::text = f.legacy_pk
          AND b.city = l.city AND b.country = l.country
        JOIN provider_buildings pb ON pb.building_id = b.id AND pb.provider_id = d.provider_id
        ON CONFLICT DO NOTHING
        """
    )


def _ensure_technology(conn, name: str, category: str) -> str:
    slug = _slug(name)
    tech_id = _tech_id(slug)
    conn.execute(
        """
        INSERT INTO technologies (id, slug, name, category)
        VALUES (%s, %s, %s, %s)
        ON CONFLICT (id) DO NOTHING
        """,
        (tech_id, slug, name.strip(), category),
    )
    return tech_id


def _migrate_technology(conn) -> None:
    rows = conn.execute(
        """
        SELECT provider_id, hypervisor, container_runtime, orchestration, storage,
               network, control_plane, virtualization
        FROM stacks
        """
    ).fetchall()
    for row in rows:
        provider_id = row[0]
        values = {
            "hypervisor": row[1],
            "container_runtime": row[2],
            "orchestration": row[3],
            "storage": row[4],
            "network": row[5],
            "control_plane": row[6],
            "virtualization": row[7],
        }
        for column, category in STACK_FIELDS:
            raw = values[column]
            if raw is None or str(raw).strip() == "":
                continue
            tech_id = _ensure_technology(conn, str(raw), category)
            dep_id = f"techdep:stacks:{provider_id}:{column}"
            conn.execute(
                """
                INSERT INTO technology_deployments (
                  id, technology_id, technology_version_id, scope, scope_id,
                  has_universal_scope_evidence, assessment_state,
                  legacy_table, legacy_pk, legacy_column
                ) VALUES (
                  %s, %s, NULL, 'provider', %s, FALSE, %s, 'stacks', %s, %s
                )
                ON CONFLICT (id) DO NOTHING
                """,
                (dep_id, tech_id, provider_id, ASSESSMENT_LEGACY, provider_id, column),
            )


def _insert_claim(
    conn,
    *,
    subject_type: str,
    subject_id: str,
    claim_type: str,
    value: dict[str, Any],
    knowledge_state: str,
    observed_at,
    legacy_table: str,
    legacy_pk: str,
    legacy_column: str,
) -> None:
    digest = hashlib.sha256(
        json.dumps(
            {
                "table": legacy_table,
                "pk": legacy_pk,
                "column": legacy_column,
            },
            sort_keys=True,
            separators=(",", ":"),
        ).encode("utf-8")
    ).hexdigest()[:16]
    claim_id = f"claim:{legacy_table}:{legacy_pk}:{legacy_column}:{digest}"
    conn.execute(
        """
        INSERT INTO claims (
          id, subject_type, subject_id, claim_type, value,
          knowledge_state, assessment_state, observed_at,
          legacy_table, legacy_pk, legacy_column
        ) VALUES (
          %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s
        )
        ON CONFLICT (id) DO NOTHING
        """,
        (
            claim_id,
            subject_type,
            subject_id,
            claim_type,
            _json_param(value),
            knowledge_state,
            ASSESSMENT_LEGACY,
            observed_at,
            legacy_table,
            str(legacy_pk),
            legacy_column,
        ),
    )


def _migrate_claims(conn) -> None:
    providers = conn.execute(
        "SELECT id, legal_country FROM providers"
    ).fetchall()
    for provider_id, legal_country in providers:
        if legal_country is None or str(legal_country).strip() == "":
            continue
        _insert_claim(
            conn,
            subject_type="provider",
            subject_id=provider_id,
            claim_type="legal_country",
            value={"text": str(legal_country)},
            knowledge_state="present",
            observed_at=None,
            legacy_table="providers",
            legacy_pk=provider_id,
            legacy_column="legal_country",
        )

    stacks = conn.execute(
        """
        SELECT provider_id, hypervisor, container_runtime, orchestration, storage,
               network, control_plane, virtualization
        FROM stacks
        """
    ).fetchall()
    for row in stacks:
        provider_id = row[0]
        values = {
            "hypervisor": row[1],
            "container_runtime": row[2],
            "orchestration": row[3],
            "storage": row[4],
            "network": row[5],
            "control_plane": row[6],
            "virtualization": row[7],
        }
        for column, _category in STACK_FIELDS:
            raw = values[column]
            if raw is None or str(raw).strip() == "":
                continue
            _insert_claim(
                conn,
                subject_type="provider",
                subject_id=provider_id,
                claim_type=column,
                value={"text": str(raw)},
                knowledge_state="present",
                observed_at=None,
                legacy_table="stacks",
                legacy_pk=provider_id,
                legacy_column=column,
            )

    sources = conn.execute(
        "SELECT id, provider_id, url, scraped_at FROM sources"
    ).fetchall()
    for source_id, provider_id, url, scraped_at in sources:
        if url is None or str(url).strip() == "":
            continue
        subject = provider_id or f"source:{source_id}"
        _insert_claim(
            conn,
            subject_type="provider",
            subject_id=subject,
            claim_type="source_url",
            value={"url": str(url)},
            knowledge_state="present",
            observed_at=scraped_at,
            legacy_table="sources",
            legacy_pk=str(source_id),
            legacy_column="url",
        )


def migrate_legacy_data(database_url: str) -> LegacyMigrateResult:
    if not database_url or not str(database_url).strip():
        raise LegacyMigrationError("database url is required")
    conn = _connect(database_url)
    try:
        with conn.transaction():
            _migrate_catalog(conn)
            _migrate_geography(conn)
            _migrate_technology(conn)
            _migrate_claims(conn)
        conn.commit()
        result = _counts(conn)
        conn.commit()
        return result
    except LegacyMigrationError:
        raise
    except Exception as exc:
        raise LegacyMigrationError(f"legacy data migration failed: {exc}") from exc
    finally:
        conn.close()


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    p = argparse.ArgumentParser(
        prog="migrate_legacy_data.py",
        description="Copy legacy directory rows into Phase 2 canonical tables without fabricating evidence.",
    )
    p.add_argument(
        "--database-url",
        help="PostgreSQL URL (required; not inferred from DATABASE_URL)",
    )
    return p.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    try:
        if not args.database_url:
            raise SystemExit("error: --database-url is required")
        result = migrate_legacy_data(args.database_url)
        print(
            "legacy-data:",
            f"offerings={result.offerings}",
            f"claims={result.claims}",
            f"facilities={result.facilities}",
            f"snapshots={result.fetch_snapshots}",
            f"legal_entities={result.legal_entities}",
        )
        return 0
    except LegacyMigrationError as exc:
        print(f"legacy migration error: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
