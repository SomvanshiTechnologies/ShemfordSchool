"""
seed_operational_sessions.py — give every session demo data in the operational
modules (Announcements, Issues, Messages, Audit Trails), tagged with the owning
session (academic_year) and dated within the session window.

Idempotent (keyed by a deterministic _seed_key). Usage (from backend/):
  MONGO_URL="mongodb://localhost:27017/?directConnection=true" .venv/Scripts/python.exe seed_operational_sessions.py
"""
import os
import asyncio
import uuid

from dotenv import load_dotenv
from motor.motor_asyncio import AsyncIOMotorClient
from pymongo import UpdateOne

load_dotenv()
db = AsyncIOMotorClient(os.environ["MONGO_URL"])[os.environ["DB_NAME"]]

SESSIONS = {"2025-2026": 2025, "2024-2025": 2024, "2023-2024": 2023}
ADMIN_ID = "user_374af3d88f49"
ADMIN_NAME = "Admin User"


def _dates(sy):
    # Three timestamps spread across the academic year (Apr-Mar).
    return [f"{sy}-07-15T10:00:00+00:00", f"{sy}-11-20T11:30:00+00:00", f"{sy + 1}-02-10T09:15:00+00:00"]


async def seed():
    for ay, sy in SESSIONS.items():
        d = _dates(sy)
        ann_ops, iss_ops, msg_ops, aud_ops = [], [], [], []

        # ── Announcements ──
        anns = [
            ("general",   f"Session {ay} kick-off",        "Welcome to the new academic session. Classes begin as scheduled."),
            ("homework",  f"Holiday homework — {ay}",      "Submit holiday assignments by the reopening date."),
            ("classwork", f"Annual function rehearsals {ay}", "Rehearsals for the annual function start next week."),
        ]
        for i, (typ, title, content) in enumerate(anns):
            key = f"seed:ann:{ay}:{i}"
            ann_ops.append(UpdateOne({"_seed_key": key},
                {"$setOnInsert": {"announcement_id": f"ann_{uuid.uuid4().hex[:12]}"},
                 "$set": {"_seed_key": key, "title": title, "content": content, "target_type": "all",
                          "target_audiences": ["student", "parent"], "priority": "normal",
                          "announcement_type": typ, "created_by": ADMIN_ID, "is_active": True,
                          "academic_year": ay, "created_at": d[i]}}, upsert=True))

        # ── Issues ──
        issues = [
            ("academic", "high",   "open",     f"Syllabus clarification ({ay})", "Need clarification on the revised syllabus."),
            ("facility", "normal", "resolved", f"Projector not working ({ay})",  "Lab projector was repaired."),
            ("it",       "low",    "open",     f"Email login issue ({ay})",      "Unable to reset staff email password."),
        ]
        for i, (cat, pri, status, title, desc) in enumerate(issues):
            key = f"seed:iss:{ay}:{i}"
            iss_ops.append(UpdateOne({"_seed_key": key},
                {"$setOnInsert": {"issue_id": f"iss_{uuid.uuid4().hex[:12]}"},
                 "$set": {"_seed_key": key, "title": title, "description": desc, "category": cat,
                          "priority": pri, "status": status, "raised_by": ADMIN_ID,
                          "raised_by_role": "admin", "academic_year": ay, "created_at": d[i]}}, upsert=True))

        # ── Messages ──
        msgs = [
            ("all",     f"Fee reminder — {ay}",      "Kindly clear pending fees before the due date."),
            ("teacher", f"Staff meeting — {ay}",     "Staff meeting scheduled this Friday at 3 PM."),
            ("student", f"Exam timetable — {ay}",    "The term exam timetable has been published."),
        ]
        for i, (rtype, subject, content) in enumerate(msgs):
            key = f"seed:msg:{ay}:{i}"
            msg_ops.append(UpdateOne({"_seed_key": key},
                {"$setOnInsert": {"message_id": f"msg_{uuid.uuid4().hex[:12]}"},
                 "$set": {"_seed_key": key, "sender_id": ADMIN_ID, "sender_name": ADMIN_NAME,
                          "recipient_type": rtype, "subject": subject, "content": content,
                          "is_read": False, "academic_year": ay, "created_at": d[i]}}, upsert=True))

        # ── Audit Trail (deactivate events shown in the Audit Trails tab) ──
        audits = [
            ("student",  f"Duplicate admission removed ({ay})"),
            ("student",  f"Transferred-out student ({ay})"),
            ("employee", f"Resigned staff deactivated ({ay})"),
        ]
        for i, (etype, label) in enumerate(audits):
            key = f"seed:aud:{ay}:{i}"
            aud_ops.append(UpdateOne({"_seed_key": key},
                {"$setOnInsert": {"log_id": f"audit_{uuid.uuid4().hex[:10]}"},
                 "$set": {"_seed_key": key, "entity_type": etype, "entity_id": f"seed_{etype}_{ay}_{i}",
                          "action": "deactivate", "changes": {"reason": label}, "performed_by": ADMIN_ID,
                          "performed_by_name": ADMIN_NAME, "performed_by_role": "admin",
                          "restored_at": None, "academic_year": ay, "created_at": d[i]}}, upsert=True))

        if ann_ops: await db.announcements.bulk_write(ann_ops, ordered=False)
        if iss_ops: await db.issues.bulk_write(iss_ops, ordered=False)
        if msg_ops: await db.messages.bulk_write(msg_ops, ordered=False)
        if aud_ops: await db.audit_logs.bulk_write(aud_ops, ordered=False)
        print(f"[{ay}] +{len(ann_ops)} announcements, +{len(iss_ops)} issues, +{len(msg_ops)} messages, +{len(aud_ops)} audit")


async def main():
    await seed()
    print("Done.")


if __name__ == "__main__":
    asyncio.run(main())
