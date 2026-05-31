"""
Shemford Futuristic School — Student Management

All student records must flow through the onboarding process for proper fee ledger creation.
Direct student creation (this file) is for admin convenience only — it will also
attempt to create fee ledger entries if a fee config exists.
"""
from fastapi import APIRouter, HTTPException, Request, Response, UploadFile, File, Form
from typing import Optional, List, Dict, Any
from datetime import datetime, timezone
import asyncio
import csv
import io
import logging
import re
import secrets
import string

logger = logging.getLogger(__name__)

from database import db
from models import UserRole, UserBase, StudentBase, StudentCreate, CLASSES_WITH_STREAMS
from auth_utils import (
    get_current_user, require_roles, generate_admission_number, create_audit_log,
    hash_password, get_teacher_assigned_classes, request_session, ensure_active_session
)

router = APIRouter()


# ─── Helpers ──────────────────────────────────────────────────────────────────

def _class_needs_stream(class_name: str) -> bool:
    """Return True if this class requires a stream (11th / 12th only)."""
    return class_name in CLASSES_WITH_STREAMS


async def get_next_roll_number(class_name: str, section: str, stream: Optional[str] = None) -> int:
    """
    Return the next sequential roll number for the given class-section
    (and stream for 11th/12th). Uses an atomic MongoDB counter to prevent
    race conditions when two students are admitted simultaneously.
    """
    key = f"roll_{class_name}_{section}"
    if stream:
        key += f"_{stream}"
    counter = await db.counters.find_one_and_update(
        {"_id": key},
        {"$inc": {"seq": 1}},
        upsert=True,
        return_document=True,
    )
    return counter["seq"]


async def _try_create_fee_ledger(student: dict):
    """
    Non-blocking: attempt to create fee ledger for a newly created student.
    If no fee config exists, skip silently — admin can generate later via
    POST /fees/ledger/generate/{student_id}.
    """
    try:
        from routes.fees import get_fee_config, create_admission_ledger, current_academic_year
        academic_year = student.get("academic_year") or current_academic_year()
        cfg = await get_fee_config(student["class_name"], academic_year, student.get("stream"))
        if cfg:
            admission_month = student.get("admission_date", datetime.now().strftime("%Y-%m-%d"))[:7]
            await create_admission_ledger(student, cfg, academic_year, admission_month)
    except Exception as e:
        import logging
        logging.getLogger(__name__).warning(
            f"Fee ledger auto-create skipped for {student.get('student_id')}: {e}"
        )


# ─── Endpoints ────────────────────────────────────────────────────────────────

@router.post("/students")
async def create_student(student: StudentCreate, request: Request):
    user = await require_roles(UserRole.ADMIN)(request)

    # ── Required field validation ───────────────────────────────────────────
    # Parent / guardian details are intentionally optional — they can be filled in later.
    errors = {}
    if not student.date_of_birth:
        errors["date_of_birth"] = "Date of Birth is required"
    if errors:
        raise HTTPException(status_code=422, detail={"validation_errors": errors})

    # Duplicate check
    if student.date_of_birth:
        existing = await db.students.find_one({
            "first_name": student.first_name,
            "last_name": student.last_name,
            "date_of_birth": student.date_of_birth,
            "is_active": True
        }, {"_id": 0})
        if existing:
            raise HTTPException(
                status_code=400,
                detail=f"Duplicate student: {existing['first_name']} {existing['last_name']} "
                       f"(Adm# {existing.get('admission_number', 'N/A')})"
            )

    # Validate class exists
    cls = await db.class_structures.find_one({"name": student.class_name, "is_active": True}, {"_id": 0})
    if not cls:
        raise HTTPException(status_code=400, detail=f"Class '{student.class_name}' does not exist")

    # Validate section exists
    section_valid = any(s["section_name"] == student.section for s in cls.get("sections", []))
    if not section_valid:
        raise HTTPException(status_code=400, detail=f"Section '{student.section}' not found in {student.class_name}")

    # Stream validation: mandatory for 11th/12th, forbidden otherwise
    if _class_needs_stream(student.class_name):
        if not student.stream:
            raise HTTPException(
                status_code=400,
                detail=f"Stream is required for {student.class_name}. Choose 'science' or 'humanities'."
            )
        allowed_streams = cls.get("streams", ["science", "humanities"])
        if student.stream not in allowed_streams:
            raise HTTPException(
                status_code=400,
                detail=f"Invalid stream '{student.stream}' for {student.class_name}. Allowed: {allowed_streams}"
            )
    else:
        if student.stream:
            raise HTTPException(
                status_code=400,
                detail=f"Stream cannot be assigned to {student.class_name}. Streams are only for Class 11th and 12th."
            )

    # Auto-assign roll number (atomic — no race condition)
    roll_number = str(await get_next_roll_number(student.class_name, student.section, student.stream))

    # Resolve parent_id from parent_email so parent can see their child
    parent_id = None
    if student.parent_email:
        parent_user = await db.users.find_one(
            {"email": str(student.parent_email), "role": UserRole.PARENT, "is_active": True},
            {"_id": 0, "user_id": 1}
        )
        if parent_user:
            parent_id = parent_user["user_id"]
        else:
            # (#15) Warn when parent_email is provided but no matching parent account found
            logger.warning(
                "parent_email '%s' provided but no active parent user found. "
                "Student will be created without parent linkage.",
                student.parent_email
            )

    admission_number = await generate_admission_number()
    from routes.fees import active_session, ensure_session_writable
    payload = student.model_dump()
    payload.pop("academic_year", None)
    # Student is created in the session the admin is operating in. Past
    # (archived) years are read-only.
    academic_year = request_session(request) or await active_session()
    await ensure_session_writable(academic_year)
    student_obj = StudentBase(
        **payload,
        admission_number=admission_number,
        academic_year=academic_year,
        roll_number=roll_number,
        parent_id=parent_id,
    )
    student_dict = student_obj.model_dump()
    student_dict["created_at"] = student_dict["created_at"].isoformat()

    await db.students.insert_one(student_dict)
    student_dict.pop("_id", None)

    # Attempt fee ledger creation (non-blocking)
    await _try_create_fee_ledger(student_dict)

    await create_audit_log("student", student_obj.student_id, "create", {
        "admission_number": admission_number, "class": student.class_name
    }, user)
    return student_dict


@router.get("/students")
async def get_students(
    request: Request,
    response: Response,
    class_name: Optional[str] = None,
    section: Optional[str] = None,
    fee_status: Optional[str] = None,
    search: Optional[str] = None,
    academic_year: Optional[str] = None,
    all_sessions: bool = False,  # bypass session scoping (e.g. upgradation search)
    name_only: bool = False,  # search only student name/admission, not parent fields
    status: Optional[str] = "active",  # active | inactive | all
    page: int = 1,
    limit: int = 50,
):
    user = await get_current_user(request)
    if status == "inactive":
        query: Dict[str, Any] = {"is_active": False}
    elif status == "all":
        query = {}
    else:
        query = {"is_active": True}

    # Role-scoped filtering
    if user["role"] == UserRole.STUDENT:
        student = await db.students.find_one({"user_id": user["user_id"]}, {"_id": 0})
        return {"students": [student] if student else [], "total": 1, "page": 1, "pages": 1}
    elif user["role"] == UserRole.PARENT:
        query["parent_id"] = user["user_id"]
    elif user["role"] == UserRole.TEACHER:
        assigned = await get_teacher_assigned_classes(user["user_id"])
        if assigned:
            query["$or"] = [{"class_name": a["class_name"], "section": a["section"]} for a in assigned]
        else:
            taught = await db.attendance.distinct("class_name", {"marked_by": user["user_id"]})
            if taught:
                query["class_name"] = {"$in": taught}

    if class_name:
        query["class_name"] = class_name
    if section:
        # For 11th/12th the "section" passed is really the stream (the section
        # IS the stream). Students carry legacy colour sections, so match the
        # student's stream (case-insensitive) instead of the section field.
        if class_name and _class_needs_stream(class_name):
            query["stream"] = {"$regex": f"^{re.escape(section)}$", "$options": "i"}
        else:
            query["section"] = section
    if fee_status:
        query["fee_status"] = fee_status
    # Default to the session the client is operating in (X-Academic-Year header)
    # when no explicit academic_year is given, so every /students consumer is
    # session-scoped. `all_sessions=true` bypasses this for cross-year flows like
    # the Upgradation search (which promotes prior-year students forward).
    ay = academic_year or (None if all_sessions else request_session(request))
    if ay:
        query["academic_year"] = ay
    if search:
        term = search.strip()
        # Escape regex special characters so a search like "S.K." doesn't
        # accidentally turn dots into "any character".
        s = re.escape(term)
        # Anchor to the start of the field so MongoDB can use an index
        # (^prefix regexes are index-friendly; an unanchored .*term.* on a
        # 30k+ collection forces a full scan and is what made this slow).
        prefix = f"^{s}"
        parts = [re.escape(p) for p in term.split() if p]

        ors = [
            {"first_name": {"$regex": prefix, "$options": "i"}},
            {"last_name": {"$regex": prefix, "$options": "i"}},
            {"admission_number": {"$regex": prefix, "$options": "i"}},
            {"email": {"$regex": prefix, "$options": "i"}},
        ]
        # Full-name search ("Pooja Sharma") → first token on first_name AND
        # second token on last_name. Index-friendly (no $expr/$concat scan).
        if len(parts) >= 2:
            ors.append({"$and": [
                {"first_name": {"$regex": f"^{parts[0]}", "$options": "i"}},
                {"last_name":  {"$regex": f"^{parts[1]}", "$options": "i"}},
            ]})
        # Parent fields only for longer terms, so typing a common first name
        # doesn't surface every student whose parent shares that name. Skipped
        # entirely when name_only is set (e.g. the upgradation student search,
        # which should match the student's own name, not their parent's).
        if not name_only and len(term) >= 4:
            ors.extend([
                {"father_name":  {"$regex": prefix, "$options": "i"}},
                {"mother_name":  {"$regex": prefix, "$options": "i"}},
                {"parent_name":  {"$regex": prefix, "$options": "i"}},
                {"father_phone": {"$regex": prefix, "$options": "i"}},
                {"mother_phone": {"$regex": prefix, "$options": "i"}},
                {"parent_phone": {"$regex": prefix, "$options": "i"}},
                {"parent_email": {"$regex": prefix, "$options": "i"}},
            ])
        query["$or"] = ors

    LIST_FIELDS = {
        "_id": 0, "student_id": 1, "admission_number": 1,
        "first_name": 1, "last_name": 1, "email": 1,
        "phone": 1, "gender": 1, "date_of_birth": 1, "address": 1,
        "class_name": 1, "section": 1, "stream": 1, "academic_year": 1,
        "parent_name": 1, "parent_phone": 1,
        "father_name": 1, "father_phone": 1,
        "mother_name": 1, "mother_phone": 1,
        "fee_status": 1, "is_active": 1, "app_locked": 1,
        "roll_number": 1, "user_id": 1, "parent_id": 1,
        "is_sibling": 1, "admission_date": 1,
    }

    limit = max(1, min(limit, 200))
    skip = (page - 1) * limit

    total, students = await asyncio.gather(
        db.students.count_documents(query),
        db.students.find(query, LIST_FIELDS)
            .sort([("class_name", 1), ("section", 1), ("first_name", 1)])
            .skip(skip)
            .limit(limit)
            .to_list(limit),
    )

    pages = max(1, -(-total // limit))
    response.headers["X-Total-Count"] = str(total)
    response.headers["X-Total-Pages"] = str(pages)
    response.headers["X-Page"] = str(page)
    return students


@router.get("/students/{student_id}")
async def get_student(student_id: str, request: Request):
    user = await get_current_user(request)

    student = await db.students.find_one({"student_id": student_id, "is_active": True}, {"_id": 0})
    if not student:
        raise HTTPException(status_code=404, detail="Student not found")

    # Access control
    if user["role"] == UserRole.STUDENT:
        if student.get("user_id") != user["user_id"]:
            raise HTTPException(status_code=403, detail="Access denied")
    elif user["role"] == UserRole.PARENT:
        if student.get("parent_id") != user["user_id"]:
            raise HTTPException(status_code=403, detail="Access denied")
    elif user["role"] == UserRole.TEACHER:
        pass  # Teachers can view any student in their class

    return student


@router.put("/students/{student_id}")
async def update_student(student_id: str, request: Request):
    user = await require_roles(UserRole.ADMIN)(request)
    body = await request.json()

    old_student = await db.students.find_one({"student_id": student_id, "is_active": True}, {"_id": 0})
    if not old_student:
        raise HTTPException(status_code=404, detail="Student not found")

    # Archive protection — can't edit a student belonging to an archived session.
    from routes.fees import ensure_session_writable
    await ensure_session_writable(old_student.get("academic_year"))

    # Never allow these to be changed via simple update
    IMMUTABLE = ["student_id", "admission_number", "created_at", "onboarding_id"]
    for f in IMMUTABLE:
        body.pop(f, None)

    # Phone numbers must be exactly 10 digits. Normalize to digits-only before
    # persisting so the DB never stores an over-/under-length number.
    phone_errors = {}
    for _pf, _plabel in (("phone", "Phone"), ("parent_phone", "Father/Guardian phone"),
                         ("father_phone", "Father phone"), ("mother_phone", "Mother phone"),
                         ("emergency_contact", "Emergency contact")):
        if _pf not in body:
            continue
        _val = (str(body.get(_pf) or "")).strip()
        if not _val:
            continue  # blank = leave/clear; only validate provided values
        _digits = re.sub(r"\D", "", _val)
        if len(_digits) != 10:
            phone_errors[_pf] = f"{_plabel} must be exactly 10 digits"
        else:
            body[_pf] = _digits
    if phone_errors:
        raise HTTPException(status_code=400, detail=" | ".join(phone_errors.values()))

    # Validate class/section change
    new_class = body.get("class_name", old_student["class_name"])
    new_section = body.get("section", old_student["section"])
    if "class_name" in body or "section" in body:
        cls = await db.class_structures.find_one({"name": new_class, "is_active": True}, {"_id": 0})
        if not cls:
            raise HTTPException(status_code=400, detail=f"Class '{new_class}' does not exist")
        section_valid = any(s["section_name"] == new_section for s in cls.get("sections", []))
        if not section_valid:
            raise HTTPException(status_code=400, detail=f"Section '{new_section}' not in {new_class}")
        if new_class != old_student["class_name"] or new_section != old_student["section"]:
            current_count = await db.students.count_documents({
                "class_name": new_class, "section": new_section,
                "is_active": True, "student_id": {"$ne": student_id}
            })
            for s in cls.get("sections", []):
                if s["section_name"] == new_section and current_count >= s.get("capacity", 40):
                    raise HTTPException(
                        status_code=400,
                        detail=f"Section {new_section} is full ({current_count}/{s['capacity']}). "
                               "Use the Upgradation flow for class promotions."
                    )

    # Compute diff
    changes = {
        k: {"old": old_student.get(k), "new": v}
        for k, v in body.items()
        if old_student.get(k) != v
    }
    if not changes:
        return old_student

    await db.students.update_one({"student_id": student_id}, {"$set": body})
    updated = await db.students.find_one({"student_id": student_id}, {"_id": 0})

    # Keep the linked LOGIN account's email in sync. A login email must be
    # unique to one account — reusing another account's email would merge two
    # people (e.g. two students sharing one login → attendance/marks/fees bleed).
    if "email" in body:
        new_email = (body.get("email") or "").strip().lower()
        uid = updated.get("user_id")
        if new_email:
            clash = await db.users.find_one(
                {"email": new_email, "user_id": {"$ne": uid}}, {"_id": 0, "user_id": 1})
            if clash:
                raise HTTPException(status_code=400, detail="That email is already used by another account. Please use a unique email.")
            if uid:
                await db.users.update_one({"user_id": uid}, {"$set": {"email": new_email}})

    # If class or stream changed, refresh fee status (full regen via upgradation flow)
    if "class_name" in changes or "stream" in changes:
        from routes.fees import refresh_overdue_for_student
        await refresh_overdue_for_student(student_id)

    await create_audit_log("student", student_id, "update", changes, user)
    return updated


@router.delete("/students/{student_id}")
async def deactivate_student(student_id: str, request: Request):
    """Soft-delete (deactivate) a student. Hard delete is not permitted."""
    user = await require_roles(UserRole.ADMIN)(request)

    student = await db.students.find_one({"student_id": student_id}, {"_id": 0})
    if not student:
        raise HTTPException(status_code=404, detail="Student not found")
    if not student.get("is_active", True):
        raise HTTPException(status_code=400, detail="Student is already inactive")

    await db.students.update_one(
        {"student_id": student_id},
        {"$set": {"is_active": False, "deactivated_at": datetime.now(timezone.utc).isoformat()}}
    )
    # Also deactivate the linked user account so student cannot log in
    if student.get("email"):
        await db.users.update_one(
            {"email": student["email"], "role": "student"},
            {"$set": {"is_active": False}}
        )
    if student.get("user_id"):
        await db.users.update_one(
            {"user_id": student["user_id"]},
            {"$set": {"is_active": False}}
        )
    await create_audit_log("student", student_id, "deactivate", {
        "name": f"{student['first_name']} {student['last_name']}"
    }, user)
    return {"message": "Student deactivated successfully", "student_id": student_id}


@router.put("/students/{student_id}/reactivate")
async def reactivate_student(student_id: str, request: Request):
    """Reactivate a previously deactivated student."""
    user = await require_roles(UserRole.ADMIN)(request)

    student = await db.students.find_one({"student_id": student_id}, {"_id": 0})
    if not student:
        raise HTTPException(status_code=404, detail="Student not found")
    if student.get("is_active", True):
        raise HTTPException(status_code=400, detail="Student is already active")

    await db.students.update_one(
        {"student_id": student_id},
        {"$set": {"is_active": True}, "$unset": {"deactivated_at": ""}}
    )
    # Reactivate linked user account
    if student.get("email"):
        await db.users.update_one(
            {"email": student["email"], "role": "student"},
            {"$set": {"is_active": True}}
        )
    if student.get("user_id"):
        await db.users.update_one(
            {"user_id": student["user_id"]},
            {"$set": {"is_active": True}}
        )
    await create_audit_log("student", student_id, "reactivate", {
        "name": f"{student['first_name']} {student['last_name']}"
    }, user)
    return {"message": "Student reactivated successfully", "student_id": student_id}


@router.post("/students/{student_id}/reset-password")
async def reset_student_password(student_id: str, request: Request):
    await require_roles(UserRole.ADMIN)(request)
    body = await request.json()

    student = await db.students.find_one({"student_id": student_id}, {"_id": 0})
    if not student:
        raise HTTPException(status_code=404, detail="Student not found")

    new_password = body.get("password")
    if not new_password:
        # Generate a secure random 10-char password
        alphabet = string.ascii_letters + string.digits
        new_password = ''.join(secrets.choice(alphabet) for _ in range(10))

    if len(new_password) < 6:
        raise HTTPException(status_code=400, detail="Password must be at least 6 characters")

    # Look up user account: prefer the explicit user_id link.
    user_account = None
    if student.get("user_id"):
        user_account = await db.users.find_one({"user_id": student["user_id"]}, {"_id": 0})
    # Fall back to email ONLY when that account isn't already owned by a
    # DIFFERENT student — sharing one login account between two students bleeds
    # their attendance/marks/fees data.
    if not user_account and student.get("email"):
        candidate = await db.users.find_one({"email": student["email"]}, {"_id": 0})
        if candidate:
            owner = await db.students.find_one(
                {"user_id": candidate["user_id"], "student_id": {"$ne": student_id}},
                {"_id": 0, "student_id": 1},
            )
            if not owner:
                user_account = candidate

    # If still no account, create a DEDICATED one. Use the student's email only
    # when it's free; otherwise use a unique synthetic address so two students
    # never share a login.
    if not user_account:
        email = (student.get("email") or "").strip().lower()
        if not email or await db.users.find_one({"email": email}, {"_id": 0, "user_id": 1}):
            email = f"{student_id.lower()}@student.shemford.in"
        student_user = UserBase(
            email=email,
            name=f"{student.get('first_name', '')} {student.get('last_name', '')}".strip(),
            role=UserRole.STUDENT,
            phone=student.get("phone"),
        )
        u_dict = student_user.model_dump()
        u_dict["password_hash"] = hash_password(new_password)
        u_dict["created_at"] = u_dict["created_at"].isoformat()
        await db.users.insert_one(u_dict)
        await db.students.update_one(
            {"student_id": student_id},
            {"$set": {
                "user_id": student_user.user_id,
                "email": email,
                "temp_password": new_password,
            }}
        )
        return {"message": "Student account created and password set", "password": new_password, "email": email}

    # Hash for auth; also persist plaintext on student record so admin can re-view/share.
    await db.users.update_one(
        {"user_id": user_account["user_id"]},
        {"$set": {"password_hash": hash_password(new_password), "is_active": True}}
    )
    # Persist the new password AND ensure the student is LINKED to this account.
    # Older records resolved the account only by email and never stored user_id;
    # without the link, admission-number login can't find the account.
    await db.students.update_one(
        {"student_id": student_id},
        {"$set": {"temp_password": new_password, "user_id": user_account["user_id"]}}
    )

    return {
        "message": "Password reset successfully",
        "password": new_password,
        "email": student.get("email")
    }


@router.get("/students/{student_id}/password")
async def get_student_password_hint(student_id: str, request: Request):
    """
    Returns the auto-generated / last-reset password stored on the student record.
    Admin-only. Empty if never generated or wiped after a self-service change.
    """
    await require_roles(UserRole.ADMIN)(request)
    student = await db.students.find_one({"student_id": student_id}, {"_id": 0})
    if not student:
        raise HTTPException(status_code=404, detail="Student not found")
    return {
        "password": student.get("temp_password") or None,
        "email": student.get("email"),
        "has_account": bool(student.get("user_id") or student.get("email")),
    }


@router.get("/students/{student_id}/parent-password")
async def get_parent_password_hint(student_id: str, request: Request):
    await require_roles(UserRole.ADMIN)(request)
    student = await db.students.find_one({"student_id": student_id}, {"_id": 0})
    if not student:
        raise HTTPException(status_code=404, detail="Student not found")
    parent_email = student.get("parent_email")
    return {
        "password": student.get("parent_temp_password") or None,
        "email": parent_email or None,
        "has_account": bool(parent_email),
        "parent_name": student.get("parent_name", "")
    }


@router.post("/students/bulk-upload")
async def bulk_upload_students(request: Request):
    user = await require_roles(UserRole.ADMIN)(request)
    await ensure_active_session(request)  # previous sessions are read-only
    body = await request.json()
    students_data = body.get("students", [])
    if not students_data:
        raise HTTPException(status_code=400, detail="No student data provided")

    from routes.fees import active_session
    _ay = await active_session()
    results = {"success": 0, "failed": 0, "errors": [], "admission_numbers": []}

    for idx, s in enumerate(students_data):
        try:
            admission_number = await generate_admission_number()
            student_obj = StudentBase(**s, admission_number=admission_number, academic_year=_ay)
            student_dict = student_obj.model_dump()
            student_dict["created_at"] = student_dict["created_at"].isoformat()
            await db.students.insert_one(student_dict)
            student_dict.pop("_id", None)
            await _try_create_fee_ledger(student_dict)
            results["success"] += 1
            results["admission_numbers"].append(admission_number)
        except Exception as e:
            results["failed"] += 1
            results["errors"].append({"row": idx + 1, "error": str(e)})

    return results


@router.post("/students/upload-csv")
async def upload_students_csv(request: Request, file: UploadFile = File(...)):
    user = await require_roles(UserRole.ADMIN)(request)
    await ensure_active_session(request)  # previous sessions are read-only

    if not file.filename.lower().endswith(".csv"):
        raise HTTPException(status_code=400, detail="Only CSV files are accepted")

    content = await file.read()
    try:
        decoded = content.decode("utf-8")
    except UnicodeDecodeError:
        decoded = content.decode("latin-1")

    reader = csv.DictReader(io.StringIO(decoded))
    from routes.fees import current_academic_year
    results = {"success": 0, "failed": 0, "errors": [], "admission_numbers": []}

    for idx, row in enumerate(reader):
        try:
            def _get(row, *keys, default=""):
                for k in keys:
                    if row.get(k):
                        return row[k].strip()
                return default

            student_data = {
                "first_name": _get(row, "first_name", "First Name"),
                "last_name": _get(row, "last_name", "Last Name"),
                "email": _get(row, "email", "Email") or None,
                "phone": _get(row, "phone", "Phone") or None,
                "date_of_birth": _get(row, "date_of_birth", "DOB", "Date of Birth") or None,
                "gender": _get(row, "gender", "Gender", default="male").lower(),
                "address": _get(row, "address", "Address") or None,
                "class_name": _get(row, "class_name", "Class"),
                "section": _get(row, "section", "Section"),
                "stream": _get(row, "stream", "Stream") or None,
                "roll_number": _get(row, "roll_number", "Roll Number") or None,
                "parent_name": _get(row, "parent_name", "Parent Name") or None,
                "parent_phone": _get(row, "parent_phone", "Parent Phone") or None,
                "parent_email": _get(row, "parent_email", "Parent Email") or None,
            }

            if not student_data["first_name"] or not student_data["class_name"] or not student_data["section"]:
                raise ValueError("Missing required: first_name, class_name, section")

            admission_number = await generate_admission_number()
            student_obj = StudentBase(**student_data, admission_number=admission_number, academic_year=current_academic_year())
            student_dict = student_obj.model_dump()
            student_dict["created_at"] = student_dict["created_at"].isoformat()
            await db.students.insert_one(student_dict)
            student_dict.pop("_id", None)
            await _try_create_fee_ledger(student_dict)
            results["success"] += 1
            results["admission_numbers"].append(admission_number)
        except Exception as e:
            results["failed"] += 1
            results["errors"].append({"row": idx + 2, "error": str(e)})

    return results


# ─────────────────────────────────────────────────────────────────────────────
# PRODUCTION CSV IMPORT — Phase 1: Preview + Validate
#                         Phase 2: Commit
# ─────────────────────────────────────────────────────────────────────────────

_DATE_FORMATS = ["%Y-%m-%d", "%d-%m-%Y", "%d/%m/%Y", "%m/%d/%Y", "%d.%m.%Y"]
_GENDER_MAP = {
    "male": "male", "m": "male", "boy": "male",
    "female": "female", "f": "female", "girl": "female",
    "other": "other", "o": "other",
}
_PHONE_RE = re.compile(r'^[\d\s\-\+\(\)]{7,15}$')


def _csv_get(row: dict, *keys: str) -> str:
    """Return first non-empty value from row matching any of the given keys (case-insensitive)."""
    row_lower = {k.lower().strip().replace(" ", "_"): v.strip() for k, v in row.items()}
    for key in keys:
        v = row_lower.get(key.lower().replace(" ", "_"), "").strip()
        if v:
            return v
    return ""


def _parse_date(val: str) -> Optional[str]:
    if not val:
        return None
    for fmt in _DATE_FORMATS:
        try:
            return datetime.strptime(val.strip(), fmt).strftime("%Y-%m-%d")
        except ValueError:
            pass
    return None


def _clean_phone(val: str) -> Optional[str]:
    if not val:
        return None
    digits = re.sub(r'[\s\-\+\(\)]', '', val)
    if 7 <= len(digits) <= 15 and digits.lstrip('+').isdigit():
        return digits
    return None


def _clean_email(val: str) -> Optional[str]:
    if not val:
        return None
    val = val.strip().lower()
    if re.match(r'^[a-zA-Z0-9_.+\-]+@[a-zA-Z0-9\-]+\.[a-zA-Z0-9.\-]+$', val):
        return val
    return None


def _validate_row(
    row: dict,
    row_number: int,
    class_name: str,
    section: str,
    stream: Optional[str],
    seen_admission_nos: set,
    seen_combos: set,
) -> Dict[str, Any]:
    """
    Parse and validate one CSV row.
    Returns {"row_number", "status": "valid"|"invalid", "errors": [...], "data": {...}|None}
    """
    errors: List[str] = []

    # ── Core fields ──────────────────────────────────────────────────────────
    first_name  = _csv_get(row, "first_name", "First Name", "firstname")
    middle_name = _csv_get(row, "middlename", "middle_name", "Middle Name")
    last_name   = _csv_get(row, "last_name",  "Last Name",  "lastname")
    gender_raw  = _csv_get(row, "gender",     "Gender")
    dob_raw     = _csv_get(row, "date_of_birth", "dob", "DOB", "Date of Birth")
    adm_date_raw = _csv_get(row, "admission_date", "Admission Date")
    adm_no_raw  = _csv_get(row, "admission_no", "admission_number", "Admission No")
    roll_raw    = _csv_get(row, "roll_no", "roll_number", "Roll No")

    # ── Contact ──────────────────────────────────────────────────────────────
    mobile_raw  = _csv_get(row, "mobile_no", "mobile", "phone", "Mobile")
    email_raw   = _csv_get(row, "email", "Email")

    # ── Family ───────────────────────────────────────────────────────────────
    father_name  = _csv_get(row, "father_name",       "Father Name")
    father_phone_raw = _csv_get(row, "father_phone",  "Father Phone")
    father_occ   = _csv_get(row, "father_occupation", "Father Occupation")
    mother_name  = _csv_get(row, "mother_name",       "Mother Name")
    mother_phone_raw = _csv_get(row, "mother_phone",  "Mother Phone")
    mother_occ   = _csv_get(row, "mother_occupation", "Mother Occupation")

    # ── Guardian ─────────────────────────────────────────────────────────────
    guardian_is   = _csv_get(row, "guardian_is",         "Guardian Is")
    guardian_name = _csv_get(row, "guardian_name",       "Guardian Name")
    guardian_rel  = _csv_get(row, "guardian_relation",   "Guardian Relation")
    guardian_email_raw = _csv_get(row, "guardian_email", "Guardian Email")
    guardian_phone_raw = _csv_get(row, "guardian_phone", "Guardian Phone")
    guardian_occ  = _csv_get(row, "guardian_occupation", "Guardian Occupation")
    guardian_addr = _csv_get(row, "guardian_address",    "Guardian Address")

    # ── Address ──────────────────────────────────────────────────────────────
    current_addr   = _csv_get(row, "current_address",   "Current Address", "address", "Address")
    permanent_addr = _csv_get(row, "permanent_address", "Permanent Address")

    # ── Identity ─────────────────────────────────────────────────────────────
    national_id = _csv_get(row, "national_identification_no", "National ID", "aadhaar")
    local_id    = _csv_get(row, "local_identification_no",    "Local ID")

    # ── Bank ─────────────────────────────────────────────────────────────────
    bank_acct  = _csv_get(row, "bank_account_no", "Bank Account")
    bank_name  = _csv_get(row, "bank_name",       "Bank Name")
    ifsc_code  = _csv_get(row, "ifsc_code",       "IFSC Code")

    # ── Other ────────────────────────────────────────────────────────────────
    category       = _csv_get(row, "category",       "Category")
    religion       = _csv_get(row, "religion",       "Religion")
    caste          = _csv_get(row, "caste",          "Caste")
    rte_raw        = _csv_get(row, "rte",            "RTE")
    previous_school = _csv_get(row, "previous_school", "Previous School")
    note           = _csv_get(row, "note", "notes", "Notes")

    # ── VALIDATION ───────────────────────────────────────────────────────────

    # Required: first_name
    if not first_name:
        errors.append("first_name is required")

    # Gender
    gender = _GENDER_MAP.get(gender_raw.lower()) if gender_raw else "male"
    if gender_raw and gender is None:
        errors.append(f"Invalid gender '{gender_raw}' — expected: male / female / other")
    if not gender:
        gender = "male"

    # Date of birth
    dob = _parse_date(dob_raw) if dob_raw else None
    if dob_raw and not dob:
        errors.append(f"Invalid date_of_birth '{dob_raw}' — use YYYY-MM-DD or DD-MM-YYYY")

    # Admission date
    adm_date = _parse_date(adm_date_raw) if adm_date_raw else datetime.now().strftime("%Y-%m-%d")
    if adm_date_raw and not adm_date:
        errors.append(f"Invalid admission_date '{adm_date_raw}'")

    # Parent or guardian required
    if not father_name and not guardian_name:
        errors.append("Either father_name or guardian_name must be provided")

    # Phone cleaning & validation
    mobile        = _clean_phone(mobile_raw)
    father_phone  = _clean_phone(father_phone_raw)
    mother_phone  = _clean_phone(mother_phone_raw)
    guardian_phone = _clean_phone(guardian_phone_raw)
    if mobile_raw       and not mobile:        errors.append(f"Invalid mobile_no '{mobile_raw}'")
    if father_phone_raw and not father_phone:  errors.append(f"Invalid father_phone '{father_phone_raw}'")
    if mother_phone_raw and not mother_phone:  errors.append(f"Invalid mother_phone '{mother_phone_raw}'")
    if guardian_phone_raw and not guardian_phone: errors.append(f"Invalid guardian_phone '{guardian_phone_raw}'")

    # Email validation
    email          = _clean_email(email_raw)
    guardian_email = _clean_email(guardian_email_raw)
    if email_raw         and not email:          errors.append(f"Invalid email '{email_raw}'")
    if guardian_email_raw and not guardian_email: errors.append(f"Invalid guardian_email '{guardian_email_raw}'")

    # Admission number uniqueness within this file
    if adm_no_raw:
        if adm_no_raw in seen_admission_nos:
            errors.append(f"Duplicate admission_no '{adm_no_raw}' in this file")
        else:
            seen_admission_nos.add(adm_no_raw)

    # Roll number parsing
    roll_no: Optional[int] = None
    if roll_raw:
        try:
            roll_no = int(roll_raw)
            if roll_no <= 0:
                errors.append(f"roll_no must be a positive integer, got {roll_no}")
                roll_no = None
        except ValueError:
            errors.append(f"roll_no must be a number, got '{roll_raw}'")

    # Within-file duplicate: same name + DOB + primary contact phone
    primary_phone = father_phone or guardian_phone or mobile
    combo = f"{first_name.lower()}|{last_name.lower()}|{dob}|{primary_phone}"
    if first_name and combo in seen_combos:
        errors.append("Duplicate row: same name, date of birth, and phone already appears in this file")
    elif first_name:
        seen_combos.add(combo)

    # ── Assemble parsed data ──────────────────────────────────────────────────
    if errors:
        return {"row_number": row_number, "status": "invalid", "errors": errors, "data": None,
                "preview": {"name": f"{first_name} {last_name}".strip(), "dob": dob_raw, "gender": gender_raw}}

    parent_name  = father_name or guardian_name
    parent_phone = father_phone or guardian_phone or mobile
    parent_email = _clean_email(_csv_get(row, "parent_email", "Parent Email")) or email

    data = {
        # StudentBase-compatible fields
        "first_name":    first_name,
        "last_name":     last_name or "",
        "email":         email,
        "phone":         mobile,
        "date_of_birth": dob,
        "gender":        gender,
        "address":       current_addr or permanent_addr or None,
        "class_name":    class_name,
        "section":       section,
        "stream":        stream or None,
        "parent_name":   parent_name,
        "parent_phone":  parent_phone,
        "parent_email":  parent_email,
        "admission_date": adm_date,
        # Override hints (used at import time)
        "_admission_no_override": adm_no_raw or None,
        "_roll_no_override":      roll_no,
        # Extended profile (stored as sub-object in MongoDB)
        "_extended": {
            "middle_name":       middle_name or None,
            "father_name":       father_name or None,
            "father_phone":      father_phone,
            "father_occupation": father_occ or None,
            "mother_name":       mother_name or None,
            "mother_phone":      mother_phone,
            "mother_occupation": mother_occ or None,
            "guardian_is":       guardian_is or None,
            "guardian_name":     guardian_name or None,
            "guardian_relation": guardian_rel or None,
            "guardian_email":    guardian_email,
            "guardian_phone":    guardian_phone,
            "guardian_occupation": guardian_occ or None,
            "guardian_address":  guardian_addr or None,
            "current_address":   current_addr or None,
            "permanent_address": permanent_addr or None,
            "national_identification_no": national_id or None,
            "local_identification_no":    local_id or None,
            "bank_account_no":   bank_acct or None,
            "bank_name":         bank_name or None,
            "ifsc_code":         ifsc_code or None,
            "category":          category or None,
            "religion":          religion or None,
            "caste":             caste or None,
            "rte":               rte_raw.lower() in ("yes", "true", "1", "y") if rte_raw else False,
            "previous_school":   previous_school or None,
            "note":              note or None,
        },
    }

    return {
        "row_number": row_number,
        "status": "valid",
        "errors": [],
        "data": data,
        "preview": {
            "name":    f"{first_name} {middle_name} {last_name}".replace("  ", " ").strip(),
            "gender":  gender,
            "dob":     dob,
            "father":  father_name or guardian_name or "",
            "phone":   parent_phone or "",
            "adm_no":  adm_no_raw or "(auto)",
            "roll_no": str(roll_no) if roll_no else "(auto)",
        },
    }


@router.post("/students/csv-preview")
async def csv_preview(
    request: Request,
    file: UploadFile = File(...),
    class_name: str = Form(...),
    section: str = Form(...),
    stream: Optional[str] = Form(None),
):
    """
    Phase 1 — Parse and validate CSV. Returns row-level validation results.
    Does NOT write to the database.
    """
    await require_roles(UserRole.ADMIN)(request)

    if not file.filename.lower().endswith(".csv"):
        raise HTTPException(status_code=400, detail="Only .csv files are accepted")

    # Verify class/section exist
    cls = await db.class_structures.find_one({"name": class_name, "is_active": True}, {"_id": 0})
    if not cls:
        raise HTTPException(status_code=400, detail=f"Class '{class_name}' not found")
    valid_sections = [s["section_name"] for s in cls.get("sections", [])]
    if valid_sections and section not in valid_sections:
        raise HTTPException(
            status_code=400,
            detail=f"Section '{section}' not found in {class_name}. Available: {', '.join(valid_sections)}"
        )
    if _class_needs_stream(class_name) and not stream:
        raise HTTPException(status_code=400, detail="Stream (science/humanities) is required for Class 11th/12th")

    content = await file.read()
    try:
        text = content.decode("utf-8-sig")   # utf-8-sig handles BOM from Excel exports
    except UnicodeDecodeError:
        text = content.decode("latin-1")

    reader = csv.DictReader(io.StringIO(text))
    if not reader.fieldnames:
        raise HTTPException(status_code=400, detail="CSV file is empty or has no header row")

    # Pre-load existing admission numbers from DB for duplicate check
    existing_adm_cursor = db.students.find({}, {"_id": 0, "admission_number": 1})
    existing_adm_nos = {s["admission_number"] async for s in existing_adm_cursor if s.get("admission_number")}

    rows = []
    seen_admission_nos = set(existing_adm_nos)  # start with DB values so file can't collide
    seen_combos: set = set()
    valid_count = 0
    invalid_count = 0

    for idx, row in enumerate(reader):
        if not any(v.strip() for v in row.values()):
            continue  # skip blank rows

        result = _validate_row(
            row=row,
            row_number=idx + 2,   # +2 because row 1 = header
            class_name=class_name,
            section=section,
            stream=stream,
            seen_admission_nos=seen_admission_nos,
            seen_combos=seen_combos,
        )
        rows.append(result)
        if result["status"] == "valid":
            valid_count += 1
        else:
            invalid_count += 1

    return {
        "total":          len(rows),
        "valid":          valid_count,
        "invalid":        invalid_count,
        "class_name":     class_name,
        "section":        section,
        "stream":         stream,
        "rows":           rows,
        "can_import":     valid_count > 0,
    }


@router.post("/students/csv-import")
async def csv_import(request: Request):
    """
    Phase 2 — Commit valid rows returned by /csv-preview.
    Accepts: { class_name, section, stream, rows: [...data dicts from preview...] }
    Skips rows with status != "valid". Re-validates admission_no uniqueness at insert time.
    """
    user = await require_roles(UserRole.ADMIN)(request)
    body = await request.json()

    class_name = body.get("class_name", "")
    section    = body.get("section",    "")
    stream     = body.get("stream")
    rows: List[Dict] = body.get("rows", [])

    if not class_name or not section:
        raise HTTPException(status_code=400, detail="class_name and section are required")
    if not rows:
        raise HTTPException(status_code=400, detail="No rows provided")

    from routes.fees import current_academic_year
    acad_year = current_academic_year()

    results = {
        "success": 0,
        "failed":  0,
        "skipped": 0,
        "errors":  [],
        "admission_numbers": [],
    }

    for row_result in rows:
        # Skip invalid rows (frontend filters these out but backend enforces too)
        if row_result.get("status") != "valid":
            results["skipped"] += 1
            continue

        data = row_result.get("data")
        if not data:
            results["skipped"] += 1
            continue

        row_number = row_result.get("row_number", "?")

        try:
            # ── Admission number ─────────────────────────────────────────────
            adm_no_override = data.pop("_admission_no_override", None)
            roll_override   = data.pop("_roll_no_override", None)
            extended        = data.pop("_extended", {})

            if adm_no_override:
                # Validate uniqueness at write time (race-condition safe via find_one)
                collision = await db.students.find_one(
                    {"admission_number": adm_no_override}, {"_id": 0, "admission_number": 1}
                )
                if collision:
                    raise ValueError(f"Admission number '{adm_no_override}' already exists in the database")
                admission_number = adm_no_override
            else:
                admission_number = await generate_admission_number()

            # ── Roll number ──────────────────────────────────────────────────
            if roll_override:
                # Check uniqueness within class-section
                clash = await db.students.find_one({
                    "class_name": class_name,
                    "section":    section,
                    "roll_number": str(roll_override),
                    "is_active":  True,
                }, {"_id": 0, "roll_number": 1})
                if clash:
                    raise ValueError(f"Roll number {roll_override} already taken in {class_name}-{section}")
                roll_number = str(roll_override)
            else:
                roll_number = str(await get_next_roll_number(class_name, section, stream))

            # ── Build and insert student ─────────────────────────────────────
            student_obj = StudentBase(
                **data,
                admission_number=admission_number,
                roll_number=roll_number,
                academic_year=acad_year,
            )
            student_dict = student_obj.model_dump()
            student_dict["created_at"] = student_dict["created_at"].isoformat()

            # Attach extended profile fields directly to the document
            if extended:
                student_dict["extended_profile"] = {k: v for k, v in extended.items() if v is not None}

            await db.students.insert_one(student_dict)
            student_dict.pop("_id", None)

            # ── Attempt fee ledger creation ──────────────────────────────────
            await _try_create_fee_ledger(student_dict)

            await create_audit_log("student", student_obj.student_id, "create",
                                   {"source": "csv_import", "admission_number": admission_number}, user)

            results["success"] += 1
            results["admission_numbers"].append(admission_number)

        except Exception as e:
            results["failed"] += 1
            results["errors"].append({"row": row_number, "error": str(e)})

    return results


# ─── Student Document Management ─────────────────────────────────────────────

@router.get("/students/{student_id}/documents")
async def list_student_documents(student_id: str, request: Request):
    """List all documents uploaded for a student (across all onboarding records)."""
    await require_roles(UserRole.ADMIN, UserRole.ACCOUNTANT, UserRole.TEACHER)(request)
    student = await db.students.find_one({"student_id": student_id}, {"_id": 0, "student_id": 1})
    if not student:
        raise HTTPException(status_code=404, detail="Student not found.")
    docs = await db.student_documents.find(
        {"student_id": student_id}, {"_id": 0}
    ).sort("created_at", -1).to_list(50)
    return docs


@router.post("/students/{student_id}/documents")
async def upload_student_document(
    student_id: str,
    request: Request,
    document_type: str = Form(...),
    document_name: str = Form(...),
    file_url: str = Form(""),
    file_name: str = Form(""),
):
    """
    Add or replace a document on an existing student record.
    Used after admission when documents were skipped, or to update documents.
    Admin / Accountant only.
    """
    user = await require_roles(UserRole.ADMIN, UserRole.ACCOUNTANT)(request)

    student = await db.students.find_one({"student_id": student_id}, {"_id": 0})
    if not student:
        raise HTTPException(status_code=404, detail="Student not found.")

    # Replace existing document of same type if it exists
    await db.student_documents.delete_many({
        "student_id": student_id,
        "document_type": document_type,
    })

    now = datetime.now(timezone.utc).isoformat()
    doc = {
        "document_id": f"doc_{__import__('uuid').uuid4().hex[:12]}",
        "student_id": student_id,
        "onboarding_id": student.get("onboarding_id", "direct"),
        "document_type": document_type,
        "document_name": document_name,
        "file_url": file_url or None,
        "file_name": file_name or None,
        "is_mandatory": document_type in {"birth_certificate", "aadhaar_card", "passport_photo"},
        "status": "uploaded",
        "uploaded_by": user["user_id"],
        "created_at": now,
    }
    await db.student_documents.insert_one(doc)
    doc.pop("_id", None)

    await create_audit_log("student_document", student_id, "upload",
                           {"document_type": document_type, "file_name": file_name}, user)
    return doc
