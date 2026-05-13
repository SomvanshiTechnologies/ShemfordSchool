"""
End-to-end verification for the Audit Trail feature.
Run against a live backend (default: http://127.0.0.1:8000).

Steps:
  1. Seed an admin and a teacher user directly in MongoDB.
  2. Log in as the teacher via /api/auth/login.
  3. Teacher creates an announcement, then deletes it.
  4. Log in as admin.
  5. GET /api/admin/audit-trail — expect 1 deactivate entry from the teacher.
  6. POST /api/admin/audit-trail/{log_id}/restore — expect 200.
  7. Verify announcement is_active=True and audit log marked restored.
"""
import os
import sys
import uuid
from datetime import datetime, timezone

import requests
from pymongo import MongoClient

import bcrypt

BASE = os.environ.get("VERIFY_BASE_URL", "http://127.0.0.1:8000")
MONGO_URL = os.environ.get("MONGO_URL", "mongodb://localhost:27017/")
DB_NAME = os.environ.get("DB_NAME", "shemford_school")

ADMIN_EMAIL = f"verify_admin_{uuid.uuid4().hex[:6]}@example.com"
TEACHER_EMAIL = f"verify_teacher_{uuid.uuid4().hex[:6]}@example.com"
PASSWORD = "Verify1234!"


def hash_pw(password: str) -> str:
    return bcrypt.hashpw(password.encode(), bcrypt.gensalt(rounds=10)).decode()


def step(n: int, msg: str) -> None:
    print(f"\n[{n}] {msg}")


def must(cond: bool, msg: str) -> None:
    if not cond:
        print(f"  FAIL: {msg}")
        sys.exit(1)
    print(f"  ok: {msg}")


def main() -> None:
    client = MongoClient(MONGO_URL)
    db = client[DB_NAME]

    step(1, "Seeding admin and teacher users")
    now = datetime.now(timezone.utc)
    admin_doc = {
        "user_id": f"user_{uuid.uuid4().hex[:12]}",
        "email": ADMIN_EMAIL.lower(),
        "name": "Verify Admin",
        "role": "admin",
        "password_hash": hash_pw(PASSWORD),
        "is_active": True,
        "created_at": now,
    }
    teacher_doc = {
        "user_id": f"user_{uuid.uuid4().hex[:12]}",
        "email": TEACHER_EMAIL.lower(),
        "name": "Verify Teacher",
        "role": "teacher",
        "password_hash": hash_pw(PASSWORD),
        "is_active": True,
        "created_at": now,
    }
    db.users.insert_many([admin_doc, teacher_doc])
    print(f"  admin   = {ADMIN_EMAIL}")
    print(f"  teacher = {TEACHER_EMAIL}")

    step(2, "Logging in as teacher")
    r = requests.post(f"{BASE}/api/auth/login",
                      json={"email": TEACHER_EMAIL, "password": PASSWORD},
                      timeout=10)
    must(r.status_code == 200, f"teacher login status={r.status_code} body={r.text[:200]}")
    teacher_token = r.json().get("token") or r.json().get("access_token")
    must(bool(teacher_token), "received teacher access token")
    t_hdr = {"Authorization": f"Bearer {teacher_token}"}

    step(3, "Teacher creates an announcement")
    r = requests.post(f"{BASE}/api/announcements",
                      headers=t_hdr,
                      json={"title": "Audit verify test", "content": "delete me",
                            "target_type": "all"},
                      timeout=10)
    must(r.status_code in (200, 201), f"create status={r.status_code} body={r.text[:200]}")
    ann = r.json()
    ann_id = ann.get("announcement_id")
    must(bool(ann_id), f"got announcement_id={ann_id}")

    step(4, "Teacher deletes the announcement (should be audit-logged)")
    r = requests.delete(f"{BASE}/api/announcements/{ann_id}",
                        headers=t_hdr, timeout=10)
    must(r.status_code == 200, f"delete status={r.status_code} body={r.text[:200]}")
    log = db.audit_logs.find_one({"entity_id": ann_id, "action": "deactivate"})
    must(log is not None, "audit_logs has a deactivate entry for the announcement")
    must(log.get("performed_by_role") == "teacher",
         f"performed_by_role recorded correctly: {log.get('performed_by_role')}")

    step(5, "Logging in as admin")
    r = requests.post(f"{BASE}/api/auth/login",
                      json={"email": ADMIN_EMAIL, "password": PASSWORD},
                      timeout=10)
    must(r.status_code == 200, f"admin login status={r.status_code} body={r.text[:200]}")
    admin_token = r.json().get("token") or r.json().get("access_token")
    a_hdr = {"Authorization": f"Bearer {admin_token}"}

    step(6, "Admin GET /api/admin/audit-trail")
    r = requests.get(f"{BASE}/api/admin/audit-trail", headers=a_hdr, timeout=10)
    must(r.status_code == 200, f"list status={r.status_code} body={r.text[:200]}")
    data = r.json()
    matching = [e for e in data.get("entries", []) if e["entity_id"] == ann_id]
    must(len(matching) == 1, f"saw exactly 1 matching entry (saw {len(matching)})")
    entry = matching[0]
    must(entry["performed_by_role"] == "teacher", "entry shows teacher role")
    must(entry.get("restored_at") in (None, ""), "entry not yet restored")

    step(7, "Admin POST /api/admin/audit-trail/{log_id}/restore")
    r = requests.post(f"{BASE}/api/admin/audit-trail/{entry['log_id']}/restore",
                      headers=a_hdr, timeout=10)
    must(r.status_code == 200, f"restore status={r.status_code} body={r.text[:200]}")

    step(8, "Verifying announcement is active again and log is marked restored")
    ann = db.announcements.find_one({"announcement_id": ann_id})
    must(ann is not None and ann.get("is_active") is True,
         "announcement is_active=True after restore")
    log = db.audit_logs.find_one({"log_id": entry["log_id"]})
    must(log.get("restored_at") is not None, "audit log has restored_at set")
    must(log.get("restored_by_name") == "Verify Admin", "restored_by_name recorded")

    step(9, "Restoring again should fail with 400")
    r = requests.post(f"{BASE}/api/admin/audit-trail/{entry['log_id']}/restore",
                      headers=a_hdr, timeout=10)
    must(r.status_code == 400, f"second restore should be 400, got {r.status_code}")

    step(10, "Cleanup")
    db.users.delete_many({"email": {"$in": [ADMIN_EMAIL, TEACHER_EMAIL]}})
    db.announcements.delete_one({"announcement_id": ann_id})
    db.audit_logs.delete_many({"entity_id": ann_id})
    print("  ok: test data removed")

    print("\nALL CHECKS PASSED")


if __name__ == "__main__":
    main()
