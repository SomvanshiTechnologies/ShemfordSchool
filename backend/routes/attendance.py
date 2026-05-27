"""
Realistic Attendance System.
- Teacher: Class -> Section -> Date -> mark all -> Submit (locks)
- One entry per student per day
- Locked after submit; admin override only
- Holiday calendar: prevents attendance on holidays
- Auto-notify parents when child is marked absent
- Attendance threshold alerts (below 75%)
- Employee/Teacher attendance tracking
"""
from fastapi import APIRouter, HTTPException, Request
from typing import Optional
import logging
from datetime import datetime, timezone

from database import db
from models import UserRole, AttendanceRecord, AttendanceSession, Holiday
from auth_utils import get_current_user, require_roles, create_audit_log, get_teacher_assigned_classes, request_session, active_session_name, session_date_bounds, ensure_active_session

router = APIRouter()
logger = logging.getLogger(__name__)


async def notify_absent_parents(absent_students: list, date: str):
    """Send email notification to parents of absent students."""
    try:
        from routes.payments import send_email
    except ImportError:
        logger.warning("Email service not available")
        return 0

    sent = 0
    for student_id in absent_students:
        student = await db.students.find_one({"student_id": student_id}, {"_id": 0})
        if not student or not student.get("parent_email"):
            continue

        html = f"""
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <div style="background: #E88A1A; padding: 20px; text-align: center;">
                <h1 style="color: white; margin: 0; font-size: 18px;">Shemford Futuristic School</h1>
            </div>
            <div style="padding: 30px; background: #f9f9f9;">
                <h2 style="color: #1A1A1A;">Absence Notification</h2>
                <p>Dear Parent/Guardian,</p>
                <p>This is to inform you that your child <strong>{student['first_name']} {student['last_name']}</strong>
                   (Class {student['class_name']}-{student['section']}) was marked <strong>absent</strong> on <strong>{date}</strong>.</p>
                <p>If this is unexpected, please contact the school office.</p>
                <p style="color: #888; font-size: 12px; margin-top: 20px;">This is an automated notification.</p>
            </div>
        </div>
        """
        try:
            await send_email(student["parent_email"], f"Absence Alert — {student['first_name']} on {date}", html)
            sent += 1
        except Exception as e:
            logger.error(f"Failed to notify parent for {student_id}: {e}")
    return sent


@router.post("/attendance")
async def submit_attendance(request: Request):
    """Teacher submits attendance for a class/section/date. Locks after submission."""
    user = await require_roles(UserRole.ADMIN, UserRole.TEACHER)(request)
    body = await request.json()

    class_name = body.get("class_name")
    section = body.get("section")
    date = body.get("date", datetime.now().strftime("%Y-%m-%d"))
    records = body.get("records", [])

    if not class_name or not section:
        raise HTTPException(status_code=400, detail="class_name and section are required")
    if not records:
        raise HTTPException(status_code=400, detail="No attendance records provided")

    # Archive protection — derive the academic year from the attendance date
    # and block writes into an archived session.
    from routes.fees import ensure_session_writable
    try:
        _y, _m = int(date[:4]), int(date[5:7])
        _ay = f"{_y}-{_y + 1}" if _m >= 4 else f"{_y - 1}-{_y}"
        await ensure_session_writable(_ay)
    except (ValueError, IndexError):
        pass

    # Teachers can only mark attendance for their assigned class/section
    if user["role"] == UserRole.TEACHER:
        assigned = await get_teacher_assigned_classes(user["user_id"])
        if assigned and not any(a["class_name"] == class_name and a["section"] == section for a in assigned):
            raise HTTPException(status_code=403, detail=f"You are not assigned as class teacher for {class_name}-{section}")

    # Check if date is a holiday
    holiday = await db.holidays.find_one({"date": date, "is_active": True}, {"_id": 0})
    if holiday:
        raise HTTPException(status_code=400, detail=f"Cannot mark attendance on {date} — {holiday['name']} (Holiday)")

    # Check if already locked
    existing_session = await db.attendance_sessions.find_one({
        "class_name": class_name, "section": section, "date": date
    }, {"_id": 0})

    if existing_session and existing_session.get("is_locked") and user["role"] != UserRole.ADMIN:
        raise HTTPException(
            status_code=400,
            detail=f"Attendance for {class_name}-{section} on {date} is already submitted and locked. Contact admin to override."
        )

    present_count = 0
    absent_count = 0
    leave_count = 0
    success_count = 0
    absent_student_ids = []

    for record in records:
        student_id = record.get("entity_id") or record.get("student_id")
        status = record.get("status", "present")
        if status not in ["present", "absent", "leave"]:
            continue

        # (#11) Verify student exists and belongs to this class before marking
        if not await db.students.find_one(
            {"student_id": student_id, "is_active": True, "class_name": class_name},
            {"_id": 0, "student_id": 1}
        ):
            logger.warning("Skipping attendance for unknown/inactive student %s in %s", student_id, class_name)
            continue

        att = AttendanceRecord(
            entity_type="student", entity_id=student_id, date=date,
            status=status, class_name=class_name, section=section,
            marked_by=user["user_id"], remarks=record.get("remarks"), is_locked=True
        )
        att_dict = att.model_dump()
        att_dict["created_at"] = att_dict["created_at"].isoformat()

        await db.attendance.update_one(
            {"entity_type": "student", "entity_id": student_id, "date": date},
            {"$set": att_dict}, upsert=True
        )

        if status == "present": present_count += 1
        elif status == "absent":
            absent_count += 1
            absent_student_ids.append(student_id)
        elif status == "leave": leave_count += 1
        success_count += 1

    # Create/update session
    session = AttendanceSession(
        class_name=class_name, section=section, date=date,
        marked_by=user["user_id"],
        student_count=success_count, present_count=present_count,
        absent_count=absent_count, leave_count=leave_count, is_locked=True
    )
    sess_dict = session.model_dump()
    sess_dict["created_at"] = sess_dict["created_at"].isoformat()
    await db.attendance_sessions.update_one(
        {"class_name": class_name, "section": section, "date": date},
        {"$set": sess_dict}, upsert=True
    )

    # Auto-notify parents of absent students (fire-and-forget)
    notified = 0
    if absent_student_ids:
        notified = await notify_absent_parents(absent_student_ids, date)

    is_override = existing_session and existing_session.get("is_locked")
    if is_override:
        await create_audit_log("attendance", f"{class_name}-{section}-{date}", "admin_override", {
            "class": class_name, "section": section, "date": date, "records": success_count
        }, user)

    return {
        "success": success_count, "present": present_count,
        "absent": absent_count, "leave": leave_count,
        "is_locked": True, "parents_notified": notified,
        "message": f"Attendance submitted for {class_name}-{section} on {date}"
    }


@router.get("/attendance")
async def get_attendance(
    request: Request, entity_type: str = "student",
    entity_id: Optional[str] = None, date: Optional[str] = None,
    class_name: Optional[str] = None, section: Optional[str] = None,
    month: Optional[str] = None
):
    user = await get_current_user(request)
    query = {"entity_type": entity_type}

    if user["role"] == UserRole.STUDENT:
        student = await db.students.find_one({"user_id": user["user_id"]}, {"_id": 0, "student_id": 1})
        if student:
            query["entity_id"] = student["student_id"]
        else:
            return []
    elif user["role"] == UserRole.PARENT:
        children = await db.students.find(
            {"$or": [{"parent_email": user.get("email", "")}, {"parent_id": user["user_id"]}], "is_active": True},
            {"_id": 0, "student_id": 1}
        ).to_list(20)
        child_ids = [c["student_id"] for c in children]
        if entity_id and entity_id in child_ids:
            query["entity_id"] = entity_id
        else:
            query["entity_id"] = {"$in": child_ids}
    elif user["role"] == UserRole.TEACHER:
        assigned = await get_teacher_assigned_classes(user["user_id"])
        if assigned:
            query["$or"] = [{"class_name": a["class_name"], "section": a["section"]} for a in assigned]
        if entity_id:
            query["entity_id"] = entity_id
    else:
        if entity_id:
            query["entity_id"] = entity_id

    if date: query["date"] = date
    if class_name: query["class_name"] = class_name
    if section: query["section"] = section
    if month: query["date"] = {"$regex": f"^{month}"}

    records = await db.attendance.find(query, {"_id": 0}).sort("date", -1).to_list(5000)
    return records


@router.get("/attendance/session-status")
async def get_session_status(request: Request, class_name: str, section: str, date: str):
    await get_current_user(request)

    # Check holiday
    holiday = await db.holidays.find_one({"date": date, "is_active": True}, {"_id": 0})

    session = await db.attendance_sessions.find_one({
        "class_name": class_name, "section": section, "date": date
    }, {"_id": 0})

    if not session:
        return {
            "submitted": False, "is_locked": False,
            "is_holiday": bool(holiday),
            "holiday_name": holiday["name"] if holiday else None
        }

    return {
        "submitted": True,
        "is_locked": session.get("is_locked", False),
        "marked_by": session.get("marked_by", ""),
        "present_count": session.get("present_count", 0),
        "absent_count": session.get("absent_count", 0),
        "leave_count": session.get("leave_count", 0),
        "student_count": session.get("student_count", 0),
        "is_holiday": bool(holiday),
        "holiday_name": holiday["name"] if holiday else None
    }


@router.post("/attendance/unlock")
async def unlock_attendance(request: Request):
    user = await require_roles(UserRole.ADMIN)(request)
    body = await request.json()
    class_name, section, date = body.get("class_name"), body.get("section"), body.get("date")

    session = await db.attendance_sessions.find_one({
        "class_name": class_name, "section": section, "date": date
    }, {"_id": 0})
    if not session:
        raise HTTPException(status_code=404, detail="Attendance session not found")

    await db.attendance_sessions.update_one(
        {"class_name": class_name, "section": section, "date": date},
        {"$set": {"is_locked": False}}
    )
    await db.attendance.update_many(
        {"class_name": class_name, "section": section, "date": date},
        {"$set": {"is_locked": False}}
    )
    await create_audit_log("attendance", f"{class_name}-{section}-{date}", "unlock", {
        "class": class_name, "section": section, "date": date
    }, user)
    return {"message": f"Attendance unlocked for {class_name}-{section} on {date}"}


@router.post("/attendance/bulk-unlock")
async def bulk_unlock_attendance(request: Request):
    """Admin: unlock multiple attendance sessions at once. (#8)"""
    user = await require_roles(UserRole.ADMIN)(request)
    await ensure_active_session(request)  # previous sessions are read-only
    body = await request.json()
    sessions = body.get("sessions", [])  # [{class_name, section, date}, ...]
    if not sessions:
        raise HTTPException(status_code=400, detail="sessions list is required")

    unlocked = 0
    for s in sessions:
        cls = s.get("class_name")
        sec = s.get("section")
        dt = s.get("date")
        if not all([cls, sec, dt]):
            continue
        await db.attendance_sessions.update_one(
            {"class_name": cls, "section": sec, "date": dt},
            {"$set": {"is_locked": False}}
        )
        await db.attendance.update_many(
            {"class_name": cls, "section": sec, "date": dt},
            {"$set": {"is_locked": False}}
        )
        unlocked += 1

    await create_audit_log("attendance", "bulk", "bulk_unlock", {"sessions_unlocked": unlocked}, user)
    return {"message": f"Unlocked {unlocked} attendance sessions", "unlocked": unlocked}


@router.get("/attendance/summary/{class_name}/{month}")
async def get_class_attendance_summary(
    class_name: str,
    month: str,
    request: Request,
    section: Optional[str] = None
):
    """Get month-wise attendance summary for a class. (#24)"""
    await require_roles(UserRole.ADMIN, UserRole.TEACHER)(request)
    query: dict = {
        "entity_type": "student",
        "class_name": class_name,
        "date": {"$regex": f"^{month}"},
    }
    if section:
        query["section"] = section

    records = await db.attendance.find(query, {"_id": 0, "entity_id": 1, "status": 1}).to_list(20000)

    summary: dict = {}
    for r in records:
        eid = r["entity_id"]
        if eid not in summary:
            summary[eid] = {"present": 0, "absent": 0, "leave": 0, "total": 0}
        summary[eid][r["status"]] = summary[eid].get(r["status"], 0) + 1
        summary[eid]["total"] += 1

    # Attach student names
    if summary:
        students = await db.students.find(
            {"student_id": {"$in": list(summary.keys())}},
            {"_id": 0, "student_id": 1, "first_name": 1, "last_name": 1, "section": 1}
        ).to_list(1000)
        name_map = {s["student_id"]: f"{s['first_name']} {s['last_name']}" for s in students}
        sec_map = {s["student_id"]: s.get("section", "") for s in students}
        result = [
            {
                "student_id": sid,
                "name": name_map.get(sid, sid),
                "section": sec_map.get(sid, ""),
                **data,
                "attendance_pct": round(data["present"] / data["total"] * 100, 1) if data["total"] else 0
            }
            for sid, data in summary.items()
        ]
    else:
        result = []

    return {"class_name": class_name, "month": month, "section": section, "students": result}


@router.get("/attendance/alerts")
async def get_attendance_alerts(request: Request, threshold: float = 75.0):
    """Get students below attendance threshold (default 75%)."""
    user = await require_roles(UserRole.ADMIN, UserRole.TEACHER)(request)

    # Scope to the session the client is operating in: only that session's
    # students, and only attendance dates within the session's window (the
    # active session extends to today). Otherwise the alert is identical across
    # every session.
    ay = request_session(request) or await active_session_name()
    student_query = {"is_active": True}
    if ay:
        student_query["academic_year"] = ay
    students = await db.students.find(
        student_query,
        {"_id": 0, "student_id": 1, "first_name": 1, "last_name": 1,
         "class_name": 1, "section": 1, "admission_number": 1}
    ).to_list(5000)
    sids = [s["student_id"] for s in students]

    att_match = {"entity_type": "student"}
    if sids:
        att_match["entity_id"] = {"$in": sids}
    if ay:
        start, end = session_date_bounds(ay)
        if start:
            end_eff = end
            active = await db.sessions.find_one({"is_active": True}, {"_id": 0, "session_name": 1})
            today = datetime.now().strftime("%Y-%m-%d")
            if active and active.get("session_name") == ay and today > end:
                end_eff = today
            att_match["date"] = {"$gte": start, "$lte": end_eff}

    # Single aggregation — count total and present days per student in one query
    pipeline = [
        {"$match": att_match},
        {"$group": {
            "_id": "$entity_id",
            "total": {"$sum": 1},
            "present": {"$sum": {"$cond": [{"$eq": ["$status", "present"]}, 1, 0]}},
        }},
    ]
    stats_list = await db.attendance.aggregate(pipeline).to_list(10000)
    stats_map = {s["_id"]: s for s in stats_list}

    alerts = []
    for student in students:
        st = stats_map.get(student["student_id"])
        if not st or st["total"] == 0:
            continue
        total   = st["total"]
        present = st["present"]
        pct     = round(present / total * 100, 1)
        if pct < threshold:
            alerts.append({
                "student_id":           student["student_id"],
                "student_name":         f"{student['first_name']} {student['last_name']}",
                "class_name":           student["class_name"],
                "section":              student["section"],
                "admission_number":     student["admission_number"],
                "total_days":           total,
                "present_days":         present,
                "absent_days":          total - present,
                "attendance_percentage": pct,
                "shortfall":            round(threshold - pct, 1),
            })

    alerts.sort(key=lambda x: x["attendance_percentage"])
    return {"threshold": threshold, "alerts": alerts, "total_flagged": len(alerts)}


@router.post("/attendance/employee")
async def submit_employee_attendance(request: Request):
    """Mark attendance for employees/teachers."""
    user = await require_roles(UserRole.ADMIN)(request)
    await ensure_active_session(request)  # previous sessions are read-only
    body = await request.json()

    date = body.get("date", datetime.now().strftime("%Y-%m-%d"))
    records = body.get("records", [])

    if not records:
        raise HTTPException(status_code=400, detail="No records provided")

    # Check holiday
    holiday = await db.holidays.find_one({"date": date, "is_active": True}, {"_id": 0})
    if holiday:
        raise HTTPException(status_code=400, detail=f"Cannot mark attendance on {date} — {holiday['name']} (Holiday)")

    success = 0
    for record in records:
        emp_id = record.get("employee_id")
        status = record.get("status", "present")
        if status not in ["present", "absent", "leave", "half_day"]:
            continue

        att = AttendanceRecord(
            entity_type="employee", entity_id=emp_id, date=date,
            status=status, marked_by=user["user_id"],
            remarks=record.get("remarks"), is_locked=True
        )
        att_dict = att.model_dump()
        att_dict["created_at"] = att_dict["created_at"].isoformat()

        await db.attendance.update_one(
            {"entity_type": "employee", "entity_id": emp_id, "date": date},
            {"$set": att_dict}, upsert=True
        )
        success += 1

    return {"success": success, "date": date, "message": f"Employee attendance recorded for {date}"}


@router.get("/attendance/employees")
async def get_employee_attendance(request: Request, date: Optional[str] = None, month: Optional[str] = None):
    """Get employee attendance records."""
    await require_roles(UserRole.ADMIN)(request)
    query = {"entity_type": "employee"}
    if date: query["date"] = date
    if month: query["date"] = {"$regex": f"^{month}"}

    records = await db.attendance.find(query, {"_id": 0}).sort("date", -1).to_list(5000)
    return records


# ==================== HOLIDAY CRUD ====================

@router.get("/holidays")
async def get_holidays(request: Request, year: Optional[str] = None):
    await get_current_user(request)
    query = {"is_active": True}
    if year:
        query["date"] = {"$regex": f"^{year}"}
    else:
        # Scope holidays to the session being viewed (they're date-based and
        # dates don't repeat across academic years). The active session extends
        # to today.
        ay = request_session(request) or await active_session_name()
        if ay:
            start, end = session_date_bounds(ay)
            if start:
                end_eff = end
                active = await db.sessions.find_one({"is_active": True}, {"_id": 0, "session_name": 1})
                today = datetime.now().strftime("%Y-%m-%d")
                if active and active.get("session_name") == ay and today > end:
                    end_eff = today
                query["date"] = {"$gte": start, "$lte": end_eff}
    holidays = await db.holidays.find(query, {"_id": 0}).sort("date", 1).to_list(500)
    return holidays


@router.post("/holidays")
async def create_holiday(request: Request):
    user = await require_roles(UserRole.ADMIN)(request)
    await ensure_active_session(request)  # previous sessions are read-only
    body = await request.json()

    date = body.get("date")
    name = body.get("name")
    hol_type = body.get("type", "public")

    if not date or not name:
        raise HTTPException(status_code=400, detail="date and name are required")

    # Check duplicate
    existing = await db.holidays.find_one({"date": date, "is_active": True}, {"_id": 0})
    if existing:
        raise HTTPException(status_code=400, detail=f"Holiday already exists on {date}: {existing['name']}")

    holiday = Holiday(date=date, name=name, type=hol_type)
    hol_dict = holiday.model_dump()
    hol_dict["created_at"] = hol_dict["created_at"].isoformat()
    await db.holidays.insert_one(hol_dict)

    return {"message": f"Holiday '{name}' added on {date}", "holiday_id": holiday.holiday_id}


@router.delete("/holidays/{holiday_id}")
async def delete_holiday(holiday_id: str, request: Request):
    user = await require_roles(UserRole.ADMIN)(request)

    holiday = await db.holidays.find_one({"holiday_id": holiday_id}, {"_id": 0})
    if not holiday:
        raise HTTPException(status_code=404, detail="Holiday not found")
    if not holiday.get("is_active", True):
        raise HTTPException(status_code=400, detail="Holiday already removed")

    await db.holidays.update_one(
        {"holiday_id": holiday_id},
        {"$set": {"is_active": False}}
    )
    await create_audit_log("holiday", holiday_id, "deactivate", {
        "name": holiday.get("name", ""),
        "date": holiday.get("date", ""),
    }, user)
    return {"message": "Holiday removed"}


@router.get("/attendance/report")
async def get_attendance_report(
    request: Request, entity_type: str = "student",
    class_name: Optional[str] = None, section: Optional[str] = None,
    start_date: Optional[str] = None, end_date: Optional[str] = None
):
    user = await get_current_user(request)
    if user["role"] not in [UserRole.ADMIN, UserRole.TEACHER]:
        raise HTTPException(status_code=403, detail="Insufficient permissions")

    query = {"entity_type": entity_type}
    if class_name: query["class_name"] = class_name
    if section: query["section"] = section
    if start_date and end_date:
        query["date"] = {"$gte": start_date, "$lte": end_date}

    records = await db.attendance.find(query, {"_id": 0}).to_list(10000)
    report = {}
    for r in records:
        eid = r["entity_id"]
        if eid not in report:
            report[eid] = {"present": 0, "absent": 0, "leave": 0, "total": 0}
        status = r["status"]
        if status in report[eid]:
            report[eid][status] += 1
        report[eid]["total"] += 1
    return report


@router.get("/attendance/summary/{student_id}")
async def get_student_attendance_summary(student_id: str, request: Request, month: Optional[str] = None):
    user = await get_current_user(request)
    if user["role"] == UserRole.PARENT:
        children = await db.students.find(
            {"$or": [{"parent_email": user.get("email", "")}, {"parent_id": user["user_id"]}], "is_active": True},
            {"_id": 0, "student_id": 1}
        ).to_list(20)
        child_ids = [c["student_id"] for c in children]
        if student_id not in child_ids:
            raise HTTPException(status_code=403, detail="Not authorized")
    elif user["role"] == UserRole.STUDENT:
        student = await db.students.find_one({"user_id": user["user_id"]}, {"_id": 0, "student_id": 1})
        if not student or student["student_id"] != student_id:
            raise HTTPException(status_code=403, detail="Not authorized")

    query = {"entity_type": "student", "entity_id": student_id}
    if month: query["date"] = {"$regex": f"^{month}"}

    records = await db.attendance.find(query, {"_id": 0}).sort("date", 1).to_list(1000)
    present = sum(1 for r in records if r["status"] == "present")
    absent = sum(1 for r in records if r["status"] == "absent")
    leave = sum(1 for r in records if r["status"] == "leave")
    total = len(records)
    percentage = round(present / total * 100, 1) if total > 0 else 0

    return {
        "student_id": student_id, "month": month,
        "present": present, "absent": absent, "leave": leave,
        "total": total, "percentage": percentage, "records": records
    }
