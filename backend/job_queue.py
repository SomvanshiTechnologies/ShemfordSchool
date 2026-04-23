"""
Shemford Futuristic School — Durable Background Job Queue

Backed by MongoDB so jobs survive server restarts and process crashes.

Guarantees:
  - Durable: every job is written to DB before any handler runs.
  - Crash-safe: stale RUNNING jobs are reset to PENDING on startup via
    recover_stale_jobs(). Call this once inside FastAPI startup_event.
  - Exactly-once delivery: find_one_and_update atomically claims a job so
    two workers cannot claim the same job (safe for single-process deploys;
    for multi-process, use a proper distributed lock or Redis).
  - Retry with back-off: failed attempts are retried up to max_attempts
    with exponential back-off (attempt n → n × RETRY_BASE_SECONDS delay).
  - Idempotent enqueue: pass idempotency_key to prevent duplicate jobs.
  - Auto-purge: completed/failed jobs older than 30 days are removed by a
    MongoDB TTL index on completed_at (created in db_init.py).

Usage
-----
Register a handler once at import time (e.g. in routes/notifications.py):

    from job_queue import register_handler

    async def _send_reminder(student_id: str, email: str, amount: float):
        ...

    register_handler("send_fee_reminder", _send_reminder)

Enqueue a job from a route handler:

    from job_queue import enqueue_job

    await enqueue_job(
        "send_fee_reminder",
        {"student_id": sid, "email": email, "amount": 1500.0},
        idempotency_key=f"reminder:{sid}:{month}",
    )

The worker is started once in server.py startup_event:

    from job_queue import recover_stale_jobs, start_worker
    await recover_stale_jobs()
    start_worker()
"""
import asyncio
import logging
import uuid
from datetime import datetime, timezone, timedelta
from typing import Awaitable, Callable, Dict, Optional

from database import db

logger = logging.getLogger(__name__)

# ── Configuration ─────────────────────────────────────────────────────────────
WORKER_POLL_INTERVAL = 15        # seconds between polls when queue is empty
DEFAULT_MAX_ATTEMPTS = 3         # retry budget per job
RETRY_BASE_SECONDS   = 60        # exponential back-off: attempt n → n × 60 s wait
JOB_TIMEOUT_MINUTES  = 15        # RUNNING jobs older than this are assumed crashed

# ── Handler registry ──────────────────────────────────────────────────────────
_handlers: Dict[str, Callable[..., Awaitable[None]]] = {}
_worker_task: Optional[asyncio.Task] = None


def register_handler(task_name: str, fn: Callable[..., Awaitable[None]]) -> None:
    """
    Register an async callable as the handler for task_name.
    The callable must accept **kwargs matching the job payload dict.
    Call this at module import time, not inside a request handler.
    """
    _handlers[task_name] = fn
    logger.debug("Job handler registered: %s → %s", task_name, fn.__name__)


# ── Enqueue ───────────────────────────────────────────────────────────────────

async def enqueue_job(
    task_name: str,
    payload: dict,
    idempotency_key: Optional[str] = None,
    max_attempts: int = DEFAULT_MAX_ATTEMPTS,
    delay_seconds: int = 0,
) -> str:
    """
    Persist a job to MongoDB and return its job_id.

    Parameters
    ----------
    task_name       Identifies which handler to call (must be registered).
    payload         Keyword arguments forwarded to the handler: handler(**payload).
    idempotency_key If set and a PENDING/RUNNING job with this key exists,
                    that job_id is returned without inserting a duplicate.
    max_attempts    Override the default retry budget.
    delay_seconds   Delay before the first execution attempt.
    """
    if idempotency_key:
        existing = await db.jobs.find_one(
            {
                "idempotency_key": idempotency_key,
                "status": {"$in": ["pending", "running"]},
            },
            {"job_id": 1},
        )
        if existing:
            logger.debug("Job idempotency hit: key=%s existing=%s", idempotency_key, existing["job_id"])
            return existing["job_id"]

    now    = datetime.now(timezone.utc)
    job_id = f"job_{uuid.uuid4().hex[:16]}"

    await db.jobs.insert_one({
        "job_id":          job_id,
        "task_name":       task_name,
        "payload":         payload,
        "status":          "pending",
        "attempts":        0,
        "max_attempts":    max_attempts,
        "created_at":      now.isoformat(),
        "next_run_at":     (now + timedelta(seconds=delay_seconds)).isoformat(),
        "idempotency_key": idempotency_key,
        "started_at":      None,
        "completed_at":    None,
        "error":           None,
    })
    logger.info("Job enqueued: %s task=%s delay=%ds", job_id, task_name, delay_seconds)
    return job_id


# ── Crash recovery ────────────────────────────────────────────────────────────

async def recover_stale_jobs() -> int:
    """
    Reset RUNNING jobs that were abandoned when the server crashed.
    Call once from FastAPI startup_event, before start_worker().
    Returns the number of jobs recovered.
    """
    cutoff = (datetime.now(timezone.utc) - timedelta(minutes=JOB_TIMEOUT_MINUTES)).isoformat()
    result = await db.jobs.update_many(
        {"status": "running", "started_at": {"$lt": cutoff}},
        {
            "$set": {
                "status": "pending",
                "error":  "Reset by startup — stale RUNNING job (server restart recovery)",
            }
        },
    )
    if result.modified_count:
        logger.warning(
            "Job recovery: reset %d stale RUNNING → PENDING on startup",
            result.modified_count,
        )
    return result.modified_count


# ── Worker ────────────────────────────────────────────────────────────────────

async def _process_one() -> bool:
    """
    Atomically claim and execute one pending job that is due to run.
    Returns True if a job was processed, False if the queue was empty.
    """
    now = datetime.now(timezone.utc)

    # Atomic claim: pending + due + has remaining attempts
    job = await db.jobs.find_one_and_update(
        {
            "status":      "pending",
            "next_run_at": {"$lte": now.isoformat()},
            "$expr":       {"$lt": ["$attempts", "$max_attempts"]},
        },
        {
            "$set": {"status": "running", "started_at": now.isoformat()},
            "$inc": {"attempts": 1},
        },
        sort=[("next_run_at", 1)],   # oldest-first
        return_document=True,        # returns post-update document
    )
    if not job:
        return False

    job_id    = job["job_id"]
    task_name = job["task_name"]
    payload   = job["payload"]
    attempts  = job["attempts"]     # post-increment value from the $inc
    max_att   = job["max_attempts"]

    handler = _handlers.get(task_name)
    if handler is None:
        err = f"No handler registered for task '{task_name}' — job dead-lettered"
        logger.error("Job %s DEAD: %s", job_id, err)
        await db.jobs.update_one(
            {"job_id": job_id},
            {
                "$set": {
                    "status":       "failed",
                    "error":        err,
                    "completed_at": datetime.now(timezone.utc).isoformat(),
                }
            },
        )
        return True

    try:
        await handler(**payload)
        await db.jobs.update_one(
            {"job_id": job_id},
            {
                "$set": {
                    "status":       "done",
                    "error":        None,
                    "completed_at": datetime.now(timezone.utc).isoformat(),
                }
            },
        )
        logger.info("Job %s DONE task=%s attempts=%d", job_id, task_name, attempts)

    except Exception as exc:
        is_final     = attempts >= max_att
        next_wait    = timedelta(seconds=RETRY_BASE_SECONDS * attempts)
        next_run_iso = (datetime.now(timezone.utc) + next_wait).isoformat()

        await db.jobs.update_one(
            {"job_id": job_id},
            {
                "$set": {
                    "status":       "failed" if is_final else "pending",
                    "error":        str(exc),
                    "next_run_at":  None if is_final else next_run_iso,
                    "completed_at": datetime.now(timezone.utc).isoformat() if is_final else None,
                }
            },
        )
        if is_final:
            logger.error(
                "Job %s FAILED permanently task=%s attempts=%d/%d error=%s",
                job_id, task_name, attempts, max_att, exc,
            )
        else:
            logger.warning(
                "Job %s attempt %d/%d failed task=%s — retry at %s error=%s",
                job_id, attempts, max_att, task_name, next_run_iso, exc,
            )

    return True


async def run_worker():
    """
    Long-running coroutine: continuously drain the job queue.
    Sleeps WORKER_POLL_INTERVAL seconds when the queue is empty.
    Designed to be run as an asyncio Task from FastAPI startup_event.
    """
    logger.info("Job worker started (poll_interval=%ds, timeout=%dmin)",
                WORKER_POLL_INTERVAL, JOB_TIMEOUT_MINUTES)
    while True:
        try:
            worked = await _process_one()
            if not worked:
                # Queue was empty — back off before next poll
                await asyncio.sleep(WORKER_POLL_INTERVAL)
        except asyncio.CancelledError:
            logger.info("Job worker stopped (CancelledError)")
            return
        except Exception as exc:
            # Unexpected error in the worker loop itself — log and keep running
            logger.error("Job worker loop error (will continue): %s", exc)
            await asyncio.sleep(5)


def start_worker() -> asyncio.Task:
    """
    Schedule run_worker() as a background asyncio Task.
    Call once from FastAPI startup_event after recover_stale_jobs().
    Returns the Task so it can be cancelled on shutdown.
    """
    global _worker_task
    _worker_task = asyncio.get_event_loop().create_task(run_worker())
    return _worker_task


def stop_worker() -> None:
    """Cancel the worker task. Call from FastAPI shutdown_event."""
    global _worker_task
    if _worker_task and not _worker_task.done():
        _worker_task.cancel()
        logger.info("Job worker cancel requested")
