"""Manually queue the daily-collection job for a date in the TEST environment (no waiting for 23:59).

It enqueues the same job, with the same idempotency key, that the scheduler queues; the running
local backend's worker picks it up. Prints the delivery log entry and how many POSTs the mock got.

    python trigger_report.py 2026-11-10 [--twice]
"""
import asyncio
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "..", "..", "backend"))
if not os.environ.get("DB_NAME", "").startswith("postman_test"):
    sys.exit("test DB only (DB_NAME must start with postman_test)")
os.environ.setdefault("JWT_SECRET", "local-test-jwt-secret")

from database import db  # noqa: E402
from job_queue import enqueue_job  # noqa: E402

RECEIVED = os.path.join(HERE, "received.jsonl")


def posts_for(day):
    if not os.path.exists(RECEIVED):
        return 0
    return sum(1 for line in open(RECEIVED, encoding="utf-8") if json.loads(line)["idempotency_key"] == f"daily-collection-{day}")


async def run_once(day):
    before = posts_for(day)
    await enqueue_job("daily_collection_report", {"report_date": day}, idempotency_key=f"daily_collection_report:{day}")
    for _ in range(40):
        await asyncio.sleep(1)
        log = await db.daily_collection_reports.find_one({"_id": day})
        if log and log.get("status") in ("sent", "skipped", "failed") and (log.get("status") != "sent" or posts_for(day) > before or before):
            break
    log = await db.daily_collection_reports.find_one({"_id": day}) or {}
    log.pop("_id", None)
    print(f"  delivery log: {json.dumps(log, default=str)}")
    print(f"  POSTs received by the mock for {day}: {before} -> {posts_for(day)}")


async def main():
    day = sys.argv[1]
    print(f"Trigger #1 for {day}")
    await run_once(day)
    if "--twice" in sys.argv:
        print(f"Trigger #2 for {day} (duplicate trigger, must NOT POST again)")
        await run_once(day)


asyncio.run(main())
