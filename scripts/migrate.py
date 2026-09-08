#!/usr/bin/env python3
"""Versioned PostgreSQL migration runner with a checksum ledger.

Apply with an explicit --database-url. Never defaults to production DATABASE_URL.
Verify file/manifest drift with --verify-manifest (no database).
"""
from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable

LEDGER_SQL = """
CREATE TABLE IF NOT EXISTS schema_migrations (
  version integer PRIMARY KEY,
  name text NOT NULL,
  checksum text NOT NULL,
  applied_at timestamptz NOT NULL DEFAULT now()
)
"""


class MigrationError(Exception):
    """Migration failed and must not be treated as success."""


class ManifestError(MigrationError):
    """Manifest is missing, malformed, or drifted from files."""


class VersionError(MigrationError):
    """Database schema version is newer than this runner supports."""


class ChecksumMismatchError(MigrationError):
    """Recorded or manifest checksum does not match the migration file."""


@dataclass(frozen=True)
class MigrationSpec:
    version: int
    filename: str
    checksum: str
    path: Path


@dataclass(frozen=True)
class Manifest:
    schema_version: int
    migrations: list[MigrationSpec]


@dataclass(frozen=True)
class ApplyResult:
    applied: list[int]


def repo_root() -> Path:
    return Path(__file__).resolve().parent.parent


def default_migrations_dir() -> Path:
    return repo_root() / "migrations"


def sha256_file(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def _lstrip_sql_comments(stmt: str) -> str:
    s = stmt.strip()
    while s:
        if s.startswith("--"):
            s = s.split("\n", 1)[1].strip() if "\n" in s else ""
            continue
        if s.startswith("/*"):
            end = s.find("*/")
            if end == -1:
                return ""
            s = s[end + 2 :].strip()
            continue
        break
    return s


def split_sql_statements(script: str) -> list[str]:
    """Split a SQL script into statements, preserving strings and dollar quotes."""
    stmts: list[str] = []
    buf: list[str] = []
    i = 0
    n = len(script)

    while i < n:
        ch = script[i]
        nxt = script[i + 1] if i + 1 < n else ""

        if ch == "-" and nxt == "-":
            start = i
            i += 2
            while i < n and script[i] != "\n":
                i += 1
            buf.append(script[start:i])
            continue

        if ch == "/" and nxt == "*":
            start = i
            i += 2
            while i + 1 < n and script[i : i + 2] != "*/":
                i += 1
            i = min(n, i + 2)
            buf.append(script[start:i])
            continue

        if ch == "$":
            tag_m = re.match(r"\$[A-Za-z0-9_]*\$", script[i:])
            if tag_m:
                tag = tag_m.group(0)
                start = i
                i += len(tag)
                idx = script.find(tag, i)
                if idx == -1:
                    buf.append(script[start:])
                    i = n
                    break
                i = idx + len(tag)
                buf.append(script[start:i])
                continue

        if ch == "'":
            start = i
            i += 1
            while i < n:
                if script[i] != "'":
                    i += 1
                    continue
                if i + 1 < n and script[i + 1] == "'":
                    i += 2
                    continue
                i += 1
                break
            buf.append(script[start:i])
            continue

        if ch == '"':
            start = i
            i += 1
            while i < n:
                if script[i] != '"':
                    i += 1
                    continue
                if i + 1 < n and script[i + 1] == '"':
                    i += 2
                    continue
                i += 1
                break
            buf.append(script[start:i])
            continue

        if ch == ";":
            raw = "".join(buf)
            stmt = _lstrip_sql_comments(raw)
            if stmt:
                stmts.append(stmt)
            buf = []
            i += 1
            continue

        buf.append(ch)
        i += 1

    tail = _lstrip_sql_comments("".join(buf))
    if tail:
        stmts.append(tail)
    return stmts


def load_manifest(migrations_dir: Path) -> Manifest:
    path = Path(migrations_dir) / "manifest.json"
    if not path.is_file():
        raise ManifestError(f"missing manifest: {path}")
    try:
        data = json.loads(path.read_text())
    except json.JSONDecodeError as exc:
        raise ManifestError(f"invalid manifest JSON: {exc}") from exc
    if not isinstance(data, dict):
        raise ManifestError("manifest must be an object")
    try:
        schema_version = int(data["schema_version"])
        rows = data["migrations"]
    except (KeyError, TypeError, ValueError) as exc:
        raise ManifestError("manifest requires schema_version and migrations[]") from exc
    if not isinstance(rows, list) or not rows:
        raise ManifestError("manifest.migrations must be a non-empty list")
    specs: list[MigrationSpec] = []
    seen: set[int] = set()
    for row in rows:
        if not isinstance(row, dict):
            raise ManifestError("each migration must be an object")
        try:
            version = int(row["version"])
            filename = str(row["filename"])
            checksum = str(row["checksum"])
        except (KeyError, TypeError, ValueError) as exc:
            raise ManifestError("migration requires version, filename, checksum") from exc
        if version in seen:
            raise ManifestError(f"duplicate migration version {version}")
        seen.add(version)
        if not filename or "/" in filename or "\\" in filename:
            raise ManifestError(f"illegal migration filename: {filename}")
        if not re.fullmatch(r"[0-9a-f]{64}", checksum):
            raise ManifestError(f"checksum must be sha256 hex: {filename}")
        specs.append(
            MigrationSpec(
                version=version,
                filename=filename,
                checksum=checksum,
                path=Path(migrations_dir) / filename,
            )
        )
    specs.sort(key=lambda m: m.version)
    versions = [m.version for m in specs]
    if versions != list(range(1, len(versions) + 1)):
        raise ManifestError("migration versions must be contiguous starting at 1")
    if schema_version != specs[-1].version:
        raise ManifestError("schema_version must equal the latest migration version")
    return Manifest(schema_version=schema_version, migrations=specs)


def verify_manifest(migrations_dir: Path) -> Manifest:
    manifest = load_manifest(migrations_dir)
    for spec in manifest.migrations:
        if not spec.path.is_file():
            raise ManifestError(f"missing migration file: {spec.filename}")
        digest = sha256_file(spec.path)
        if digest != spec.checksum:
            raise ManifestError(
                f"checksum drift for {spec.filename}: manifest {spec.checksum} != file {digest}"
            )
    return manifest


def assert_supported_schema_version(applied_max: int | None, manifest_max: int) -> None:
    if applied_max is None:
        return
    if applied_max > manifest_max:
        raise VersionError(
            f"unsupported newer schema version {applied_max} "
            f"(this runner supports up to {manifest_max})"
        )


def assert_checksums_match(recorded: str, expected: str) -> None:
    if recorded != expected:
        raise ChecksumMismatchError(
            f"migration checksum mismatch: recorded {recorded} != expected {expected}"
        )


def _connect(url: str):
    try:
        import psycopg
    except ImportError as exc:
        raise MigrationError("psycopg is required to apply migrations") from exc
    return psycopg.connect(url)


def _execute_statements(conn, statements: Iterable[str]) -> None:
    for stmt in statements:
        conn.execute(stmt)


def apply_migrations(
    database_url: str,
    migrations_dir: Path | None = None,
) -> ApplyResult:
    if not database_url or not str(database_url).strip():
        raise MigrationError("database url is required")
    d = Path(migrations_dir) if migrations_dir is not None else default_migrations_dir()
    manifest = verify_manifest(d)
    conn = _connect(database_url)
    applied_versions: list[int] = []
    try:
        conn.execute(LEDGER_SQL)
        conn.commit()
        rows = conn.execute(
            "SELECT version, name, checksum FROM schema_migrations ORDER BY version"
        ).fetchall()
        conn.commit()
        recorded = {int(r[0]): str(r[2]) for r in rows}
        applied_max = max(recorded) if recorded else None
        assert_supported_schema_version(applied_max, manifest.schema_version)
        by_version = {m.version: m for m in manifest.migrations}
        for version, checksum in recorded.items():
            spec = by_version.get(version)
            if spec is None:
                raise VersionError(
                    f"unsupported schema version {version} is not in this manifest"
                )
            assert_checksums_match(checksum, spec.checksum)
            assert_checksums_match(checksum, sha256_file(spec.path))
        pending = [m for m in manifest.migrations if m.version not in recorded]
        for spec in pending:
            sql = spec.path.read_text()
            try:
                with conn.transaction():
                    _execute_statements(conn, split_sql_statements(sql))
                    conn.execute(
                        """
                        INSERT INTO schema_migrations (version, name, checksum)
                        VALUES (%s, %s, %s)
                        """,
                        (spec.version, spec.filename, spec.checksum),
                    )
            except (ChecksumMismatchError, VersionError, ManifestError, MigrationError):
                raise
            except Exception as exc:
                raise MigrationError(
                    f"migration {spec.version} ({spec.filename}) failed: {exc}"
                ) from exc
            applied_versions.append(spec.version)
    finally:
        conn.close()
    return ApplyResult(applied=applied_versions)


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    p = argparse.ArgumentParser(
        prog="migrate.py",
        description="Apply versioned schema migrations or verify the checksum manifest.",
    )
    p.add_argument(
        "--database-url",
        help="PostgreSQL URL (required to apply; not inferred from DATABASE_URL)",
    )
    p.add_argument(
        "--migrations-dir",
        type=Path,
        default=None,
        help="Defaults to <repo>/migrations",
    )
    p.add_argument(
        "--verify-manifest",
        action="store_true",
        help="Check migration files against manifest.json and exit (no database)",
    )
    return p.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    migrations_dir = args.migrations_dir or default_migrations_dir()
    try:
        if args.verify_manifest:
            verify_manifest(migrations_dir)
            return 0
        if not args.database_url:
            raise SystemExit("error: --database-url is required unless --verify-manifest")
        result = apply_migrations(args.database_url, migrations_dir=migrations_dir)
        if result.applied:
            print("applied:", ",".join(str(v) for v in result.applied))
        else:
            print("applied: none (already up to date)")
        return 0
    except MigrationError as exc:
        print(f"migration error: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
