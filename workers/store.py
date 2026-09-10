"""Durable collection-task and model-run state. Lease-owned, idempotent."""
from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any, Iterable, Protocol
from uuid import uuid4

from workers.collector.fetch import FetchReceipt
from workers.submissions import (
    MAX_REQUIRED_SUBMISSIONS,
    SubmissionOutcome,
    bound_reason_codes,
    bound_required_submission_count,
    submission_identity_matches,
)

RETRYABLE_FETCH_STATES = frozenset({"timeout"})
TERMINAL_NO_RETRY = frozenset(
    {
        "ok",
        "redirect",
        "forbidden",
        "not_found",
        "blocked",
        "oversized",
        "malformed",
        "unsupported_content_type",
    }
)
TASK_STATUSES = frozenset(
    {
        "queued",
        "leased",
        "fetched",
        "extracted",
        "verified",
        "proposed",
        "failed",
        "needs_review",
        "ambiguous",
    }
)
ACTOR_RE = r"^[a-z][a-z0-9_-]{0,63}$"


class StoreError(ValueError):
    """Collection store failed closed."""


class LeaseHeld(StoreError):
    """Another worker owns the lease."""


def _iso(now: datetime) -> str:
    if now.tzinfo is None:
        now = now.replace(tzinfo=timezone.utc)
    return now.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


def _parse_iso(value: str | None) -> datetime | None:
    if not value:
        return None
    text = value.replace("Z", "+00:00")
    dt = datetime.fromisoformat(text)
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt


@dataclass
class CollectionTask:
    id: str
    idempotency_key: str
    source_url: str
    provider_id: str | None
    status: str
    fetch_state: str | None = None
    lease_owner: str | None = None
    lease_until: str | None = None
    attempt_count: int = 0
    snapshot_id: str | None = None
    last_error: str | None = None
    fetched_at: str | None = None
    required_submission_count: int | None = None
    created_at: str = ""
    updated_at: str = ""


@dataclass
class StoredSnapshot:
    id: str
    receipt: FetchReceipt
    recorded_at: str


@dataclass
class StoredModelRun:
    id: str
    collection_task_id: str
    adapter_name: str
    model_provider: str
    model_name: str
    ruleset_version: str
    input_digest: str
    output_digest: str
    envelope: dict[str, Any]
    output: dict[str, Any]
    started_at: str
    finished_at: str
    recorded_at: str


class CollectionStore(Protocol):
    def get_task_by_key(self, idempotency_key: str) -> CollectionTask | None:
        ...

    def put_task(self, task: CollectionTask) -> CollectionTask:
        ...

    def acquire_lease(
        self,
        idempotency_key: str,
        owner: str,
        now: datetime,
        ttl: timedelta,
        source_url: str,
        provider_id: str | None,
    ) -> CollectionTask:
        ...

    def save_snapshot(self, receipt: FetchReceipt, recorded_at: datetime) -> StoredSnapshot:
        ...

    def get_snapshot(self, snapshot_id: str) -> StoredSnapshot | None:
        ...

    def attach_snapshot(self, task: CollectionTask, snapshot: StoredSnapshot, now: datetime) -> CollectionTask:
        ...

    def save_model_run(self, run: StoredModelRun) -> StoredModelRun:
        ...

    def get_model_run(self, task_id: str, adapter_name: str, input_digest: str) -> StoredModelRun | None:
        ...

    def mark_status(self, task: CollectionTask, status: str, now: datetime, error: str | None = None) -> CollectionTask:
        ...

    def get_submission_outcome(self, idempotency_key: str) -> SubmissionOutcome | None:
        ...

    def list_submission_outcomes(self, task_id: str) -> list[SubmissionOutcome]:
        ...

    def record_submission_outcome(self, outcome: SubmissionOutcome) -> SubmissionOutcome:
        ...

    def set_required_submission_count(
        self, task: CollectionTask, count: int, now: datetime
    ) -> CollectionTask:
        ...


def can_retry(fetch_state: str | None, http_status: int | None) -> bool:
    if http_status is not None:
        return False
    return fetch_state in RETRYABLE_FETCH_STATES


def _assert_proposed_allowed(task: CollectionTask, outcomes: Iterable[SubmissionOutcome]) -> None:
    count = task.required_submission_count
    if count is None or count < 1:
        raise StoreError("zero or missing required submissions prevent proposed")
    rows = [row for row in outcomes if row.task_id == task.id]
    if any(row.outcome in {"rejected", "ambiguous"} for row in rows):
        raise StoreError("rejected or ambiguous required submissions prevent proposed")
    success_keys = {
        row.idempotency_key for row in rows if row.outcome in {"created", "replayed"}
    }
    if len(success_keys) != count:
        raise StoreError("incomplete required submissions prevent proposed")


class MemoryCollectionStore:
    def __init__(self) -> None:
        self.tasks: dict[str, CollectionTask] = {}
        self.snapshots: dict[str, StoredSnapshot] = {}
        self.model_runs: dict[tuple[str, str, str], StoredModelRun] = {}
        self.outcomes: dict[str, SubmissionOutcome] = {}
        self.fail_next_outcome_writes = 0

    def get_task_by_key(self, idempotency_key: str) -> CollectionTask | None:
        return self.tasks.get(idempotency_key)

    def put_task(self, task: CollectionTask) -> CollectionTask:
        self.tasks[task.idempotency_key] = task
        return task

    def acquire_lease(
        self,
        idempotency_key: str,
        owner: str,
        now: datetime,
        ttl: timedelta,
        source_url: str,
        provider_id: str | None,
    ) -> CollectionTask:
        import re

        if not re.fullmatch(ACTOR_RE, owner):
            raise StoreError("lease owner is not a canonical principal")
        existing = self.tasks.get(idempotency_key)
        now_s = _iso(now)
        if existing is None:
            task = CollectionTask(
                id="task-" + uuid4().hex,
                idempotency_key=idempotency_key,
                source_url=source_url,
                provider_id=provider_id,
                status="leased",
                lease_owner=owner,
                lease_until=_iso(now + ttl),
                attempt_count=1,
                created_at=now_s,
                updated_at=now_s,
            )
            self.tasks[idempotency_key] = task
            return task
        if existing.status in {"needs_review", "ambiguous"}:
            return existing
        if existing.snapshot_id and existing.status in {
            "fetched",
            "extracted",
            "verified",
            "proposed",
            "needs_review",
            "ambiguous",
        }:
            return existing
        held_until = _parse_iso(existing.lease_until)
        if (
            existing.lease_owner
            and existing.lease_owner != owner
            and held_until is not None
            and held_until > now
        ):
            raise LeaseHeld(f"lease held by {existing.lease_owner}")
        if existing.fetch_state in TERMINAL_NO_RETRY and existing.status == "failed":
            return existing
        if existing.fetch_state in TERMINAL_NO_RETRY and existing.snapshot_id:
            return existing
        existing.lease_owner = owner
        existing.lease_until = _iso(now + ttl)
        existing.status = "leased"
        existing.attempt_count += 1
        existing.updated_at = now_s
        return existing

    def save_snapshot(self, receipt: FetchReceipt, recorded_at: datetime) -> StoredSnapshot:
        snap_id = receipt.snapshot_id()
        existing = self.snapshots.get(snap_id)
        if existing is not None:
            return existing
        stored = StoredSnapshot(id=snap_id, receipt=receipt, recorded_at=_iso(recorded_at))
        self.snapshots[snap_id] = stored
        return stored

    def get_snapshot(self, snapshot_id: str) -> StoredSnapshot | None:
        return self.snapshots.get(snapshot_id)

    def attach_snapshot(self, task: CollectionTask, snapshot: StoredSnapshot, now: datetime) -> CollectionTask:
        task.snapshot_id = snapshot.id
        task.fetch_state = snapshot.receipt.fetch_state
        if task.fetched_at is None:
            task.fetched_at = snapshot.receipt.fetched_at
        task.status = "fetched"
        task.updated_at = _iso(now)
        self.tasks[task.idempotency_key] = task
        return task

    def save_model_run(self, run: StoredModelRun) -> StoredModelRun:
        key = (run.collection_task_id, run.adapter_name, run.input_digest)
        existing = self.model_runs.get(key)
        if existing is not None:
            if existing.output_digest != run.output_digest:
                raise StoreError("model run digest conflict")
            return existing
        self.model_runs[key] = run
        return run

    def get_model_run(self, task_id: str, adapter_name: str, input_digest: str) -> StoredModelRun | None:
        return self.model_runs.get((task_id, adapter_name, input_digest))

    def mark_status(self, task: CollectionTask, status: str, now: datetime, error: str | None = None) -> CollectionTask:
        if status not in TASK_STATUSES:
            raise StoreError(f"unknown task status: {status}")
        if status == "proposed":
            _assert_proposed_allowed(task, self.outcomes.values())
        task.status = status
        task.last_error = error
        task.updated_at = _iso(now)
        self.tasks[task.idempotency_key] = task
        return task

    def get_submission_outcome(self, idempotency_key: str) -> SubmissionOutcome | None:
        return self.outcomes.get(idempotency_key)

    def list_submission_outcomes(self, task_id: str) -> list[SubmissionOutcome]:
        return [row for row in self.outcomes.values() if row.task_id == task_id]

    def record_submission_outcome(self, outcome: SubmissionOutcome) -> SubmissionOutcome:
        if self.fail_next_outcome_writes > 0:
            self.fail_next_outcome_writes -= 1
            raise StoreError("simulated crash")
        bound_reason_codes(outcome.reason_codes)
        existing = self.outcomes.get(outcome.idempotency_key)
        if existing is not None:
            if not submission_identity_matches(
                existing,
                task_id=outcome.task_id,
                tool_name=outcome.tool_name,
                idempotency_key=outcome.idempotency_key,
                request_digest=outcome.request_digest,
            ):
                raise StoreError("idempotency identity collision")
            return existing
        self.outcomes[outcome.idempotency_key] = outcome
        return outcome

    def set_required_submission_count(self, task: CollectionTask, count: int, now: datetime) -> CollectionTask:
        bounded = bound_required_submission_count(count)
        if task.required_submission_count is not None:
            if task.required_submission_count != bounded:
                raise StoreError("required_submission_count is immutable once set")
            return task
        task.required_submission_count = bounded
        task.updated_at = _iso(now)
        self.tasks[task.idempotency_key] = task
        return task


class PgCollectionStore:
    """PostgreSQL-backed collection state. Does not write public catalog tables."""

    def __init__(self, conn) -> None:
        self.conn = conn
        self._memory = MemoryCollectionStore()
        self.fail_next_outcome_writes = 0

    def get_task_by_key(self, idempotency_key: str) -> CollectionTask | None:
        row = self.conn.execute(
            """
            SELECT id, idempotency_key, source_url, provider_id, status, fetch_state,
                   lease_owner, lease_until, attempt_count, snapshot_id, last_error,
                   fetched_at, created_at, updated_at, required_submission_count
            FROM collection_tasks WHERE idempotency_key = %s
            """,
            (idempotency_key,),
        ).fetchone()
        if row is None:
            return None
        return _task_from_row(row)

    def put_task(self, task: CollectionTask) -> CollectionTask:
        self.conn.execute(
            """
            INSERT INTO collection_tasks (
              id, idempotency_key, source_url, provider_id, status, fetch_state,
              lease_owner, lease_until, attempt_count, snapshot_id, last_error,
              fetched_at, created_at, updated_at, required_submission_count
            ) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
            ON CONFLICT (idempotency_key) DO UPDATE SET
              status = EXCLUDED.status,
              fetch_state = EXCLUDED.fetch_state,
              lease_owner = EXCLUDED.lease_owner,
              lease_until = EXCLUDED.lease_until,
              attempt_count = EXCLUDED.attempt_count,
              snapshot_id = EXCLUDED.snapshot_id,
              last_error = EXCLUDED.last_error,
              fetched_at = COALESCE(collection_tasks.fetched_at, EXCLUDED.fetched_at),
              updated_at = EXCLUDED.updated_at,
              required_submission_count = COALESCE(
                collection_tasks.required_submission_count, EXCLUDED.required_submission_count
              )
            """,
            (
                task.id,
                task.idempotency_key,
                task.source_url,
                task.provider_id,
                task.status,
                task.fetch_state,
                task.lease_owner,
                task.lease_until,
                task.attempt_count,
                task.snapshot_id,
                task.last_error,
                task.fetched_at,
                task.created_at,
                task.updated_at,
                task.required_submission_count,
            ),
        )
        self.conn.commit()
        stored = self.get_task_by_key(task.idempotency_key)
        assert stored is not None
        return stored

    def acquire_lease(
        self,
        idempotency_key: str,
        owner: str,
        now: datetime,
        ttl: timedelta,
        source_url: str,
        provider_id: str | None,
    ) -> CollectionTask:
        existing = self.get_task_by_key(idempotency_key)
        if existing is None:
            task = CollectionTask(
                id="task-" + uuid4().hex,
                idempotency_key=idempotency_key,
                source_url=source_url,
                provider_id=provider_id,
                status="leased",
                lease_owner=owner,
                lease_until=_iso(now + ttl),
                attempt_count=1,
                created_at=_iso(now),
                updated_at=_iso(now),
            )
            return self.put_task(task)
        self._memory.tasks[existing.idempotency_key] = existing
        leased = self._memory.acquire_lease(
            idempotency_key, owner, now, ttl, source_url, provider_id
        )
        return self.put_task(leased)

    def save_snapshot(self, receipt: FetchReceipt, recorded_at: datetime) -> StoredSnapshot:
        snap_id = receipt.snapshot_id()
        existing = self.get_snapshot(snap_id)
        if existing is not None:
            return existing
        import json

        self.conn.execute(
            """
            INSERT INTO fetch_snapshots (
              id, source_url, final_url, fetched_at, http_status, content_type,
              content_sha256, body, byte_length, fetch_state, redirect_chain, truncated
            ) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s::jsonb,%s)
            """,
            (
                snap_id,
                receipt.source_url,
                receipt.final_url,
                receipt.fetched_at,
                receipt.http_status,
                receipt.content_type,
                receipt.content_sha256,
                receipt.body,
                receipt.byte_length,
                receipt.fetch_state,
                json.dumps(list(receipt.redirect_chain)),
                receipt.truncated,
            ),
        )
        self.conn.commit()
        return StoredSnapshot(id=snap_id, receipt=receipt, recorded_at=_iso(recorded_at))

    def get_snapshot(self, snapshot_id: str) -> StoredSnapshot | None:
        row = self.conn.execute(
            """
            SELECT id, source_url, final_url, fetched_at, http_status, content_type,
                   content_sha256, body, byte_length, fetch_state, redirect_chain,
                   truncated, recorded_at
            FROM fetch_snapshots WHERE id = %s
            """,
            (snapshot_id,),
        ).fetchone()
        if row is None:
            return None
        chain = row[10] or []
        if isinstance(chain, str):
            import json

            chain = json.loads(chain)
        receipt = FetchReceipt(
            source_url=row[1],
            final_url=row[2],
            fetched_at=_as_iso(row[3]),
            http_status=row[4],
            fetch_state=row[9] or "ok",
            content_type=row[5],
            content_sha256=row[6],
            body=row[7] or "",
            byte_length=row[8] or 0,
            redirect_chain=tuple(chain),
            truncated=bool(row[11]),
        )
        return StoredSnapshot(id=row[0], receipt=receipt, recorded_at=_as_iso(row[12]))

    def attach_snapshot(self, task: CollectionTask, snapshot: StoredSnapshot, now: datetime) -> CollectionTask:
        if task.fetched_at is None:
            task.fetched_at = snapshot.receipt.fetched_at
        task.snapshot_id = snapshot.id
        task.fetch_state = snapshot.receipt.fetch_state
        task.status = "fetched"
        task.updated_at = _iso(now)
        return self.put_task(task)

    def save_model_run(self, run: StoredModelRun) -> StoredModelRun:
        existing = self.get_model_run(run.collection_task_id, run.adapter_name, run.input_digest)
        if existing is not None:
            if existing.output_digest != run.output_digest:
                raise StoreError("model run digest conflict")
            return existing
        import json

        self.conn.execute(
            """
            INSERT INTO model_runs (
              id, collection_task_id, adapter_name, model_provider, model_name,
              ruleset_version, input_digest, output_digest, envelope, output,
              started_at, finished_at, recorded_at
            ) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s::jsonb,%s::jsonb,%s,%s,%s)
            """,
            (
                run.id,
                run.collection_task_id,
                run.adapter_name,
                run.model_provider,
                run.model_name,
                run.ruleset_version,
                run.input_digest,
                run.output_digest,
                json.dumps(run.envelope, ensure_ascii=False),
                json.dumps(run.output, ensure_ascii=False),
                run.started_at,
                run.finished_at,
                run.recorded_at,
            ),
        )
        self.conn.commit()
        return run

    def get_model_run(self, task_id: str, adapter_name: str, input_digest: str) -> StoredModelRun | None:
        row = self.conn.execute(
            """
            SELECT id, collection_task_id, adapter_name, model_provider, model_name,
                   ruleset_version, input_digest, output_digest, envelope, output,
                   started_at, finished_at, recorded_at
            FROM model_runs
            WHERE collection_task_id = %s AND adapter_name = %s AND input_digest = %s
            """,
            (task_id, adapter_name, input_digest),
        ).fetchone()
        if row is None:
            return None
        return StoredModelRun(
            id=row[0],
            collection_task_id=row[1],
            adapter_name=row[2],
            model_provider=row[3],
            model_name=row[4],
            ruleset_version=row[5],
            input_digest=row[6],
            output_digest=row[7],
            envelope=row[8],
            output=row[9],
            started_at=_as_iso(row[10]),
            finished_at=_as_iso(row[11]),
            recorded_at=_as_iso(row[12]),
        )

    def mark_status(self, task: CollectionTask, status: str, now: datetime, error: str | None = None) -> CollectionTask:
        task.status = status
        task.last_error = error
        task.updated_at = _iso(now)
        return self.put_task(task)

    def get_submission_outcome(self, idempotency_key: str) -> SubmissionOutcome | None:
        row = self.conn.execute(
            """
            SELECT id, task_id, tool_name, idempotency_key, request_digest, outcome,
                   proposal_id, reason_codes, created_at
            FROM collection_submission_outcomes WHERE idempotency_key = %s
            """,
            (idempotency_key,),
        ).fetchone()
        if row is None:
            return None
        return _outcome_from_row(row)

    def list_submission_outcomes(self, task_id: str) -> list[SubmissionOutcome]:
        rows = self.conn.execute(
            """
            SELECT id, task_id, tool_name, idempotency_key, request_digest, outcome,
                   proposal_id, reason_codes, created_at
            FROM collection_submission_outcomes WHERE task_id = %s
            ORDER BY created_at, id
            """,
            (task_id,),
        ).fetchall()
        return [_outcome_from_row(row) for row in rows]

    def record_submission_outcome(self, outcome: SubmissionOutcome) -> SubmissionOutcome:
        if self.fail_next_outcome_writes > 0:
            self.fail_next_outcome_writes -= 1
            raise StoreError("simulated crash")
        bound_reason_codes(outcome.reason_codes)
        existing = self.get_submission_outcome(outcome.idempotency_key)
        if existing is not None:
            if not submission_identity_matches(
                existing,
                task_id=outcome.task_id,
                tool_name=outcome.tool_name,
                idempotency_key=outcome.idempotency_key,
                request_digest=outcome.request_digest,
            ):
                raise StoreError("idempotency identity collision")
            return existing
        self.conn.execute(
            """
            INSERT INTO collection_submission_outcomes (
              id, task_id, tool_name, idempotency_key, request_digest, outcome,
              proposal_id, reason_codes, created_at
            ) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s)
            ON CONFLICT (idempotency_key) DO NOTHING
            """,
            (
                outcome.id,
                outcome.task_id,
                outcome.tool_name,
                outcome.idempotency_key,
                outcome.request_digest,
                outcome.outcome,
                outcome.proposal_id,
                list(outcome.reason_codes),
                outcome.created_at,
            ),
        )
        self.conn.commit()
        stored = self.get_submission_outcome(outcome.idempotency_key)
        if stored is None:
            raise StoreError("submission outcome was not confirmed")
        if not submission_identity_matches(
            stored,
            task_id=outcome.task_id,
            tool_name=outcome.tool_name,
            idempotency_key=outcome.idempotency_key,
            request_digest=outcome.request_digest,
        ):
            raise StoreError("idempotency identity collision")
        return stored

    def set_required_submission_count(self, task: CollectionTask, count: int, now: datetime) -> CollectionTask:
        bounded = bound_required_submission_count(count)
        current = self.get_task_by_key(task.idempotency_key) or task
        if current.required_submission_count is not None:
            if current.required_submission_count != bounded:
                raise StoreError("required_submission_count is immutable once set")
            task.required_submission_count = current.required_submission_count
            return current
        task.required_submission_count = bounded
        task.updated_at = _iso(now)
        return self.put_task(task)


def _as_iso(value: Any) -> str:
    if isinstance(value, datetime):
        return _iso(value)
    return str(value)


def _task_from_row(row: Any) -> CollectionTask:
    return CollectionTask(
        id=row[0],
        idempotency_key=row[1],
        source_url=row[2],
        provider_id=row[3],
        status=row[4],
        fetch_state=row[5],
        lease_owner=row[6],
        lease_until=_as_iso(row[7]) if row[7] else None,
        attempt_count=row[8] or 0,
        snapshot_id=row[9],
        last_error=row[10],
        fetched_at=_as_iso(row[11]) if row[11] else None,
        created_at=_as_iso(row[12]),
        updated_at=_as_iso(row[13]),
        required_submission_count=row[14] if len(row) > 14 else None,
    )


def _outcome_from_row(row: Any) -> SubmissionOutcome:
    codes = row[7] or []
    if isinstance(codes, str):
        import json

        codes = json.loads(codes)
    return SubmissionOutcome(
        id=row[0],
        task_id=row[1],
        tool_name=row[2],
        idempotency_key=row[3],
        request_digest=row[4],
        outcome=row[5],
        proposal_id=row[6],
        reason_codes=tuple(codes),
        created_at=_as_iso(row[8]),
    )

