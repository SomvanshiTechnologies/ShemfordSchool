from fastapi import APIRouter, HTTPException, Request
import logging

from database import db
from models import UserRole
from auth_utils import require_roles
from routes.payments import send_email

router = APIRouter()
logger = logging.getLogger(__name__)


async def send_fee_reminder_email(student: dict, due_amount: float, due_months: list):
    parent_email = student.get("parent_email")
    if not parent_email:
        return
    months_str = ", ".join(due_months[:3])
    if len(due_months) > 3:
        months_str += f" and {len(due_months) - 3} more"

    html = f"""
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <div style="background: #E88A1A; padding: 20px; text-align: center;">
            <h1 style="color: white; margin: 0;">Shemford Futuristic School</h1>
        </div>
        <div style="padding: 30px; background: #f9f9f9;">
            <h2 style="color: #ef4444;">Fee Payment Reminder</h2>
            <p>Dear Parent/Guardian,</p>
            <p>Fee payment pending for <strong>{student['first_name']} {student['last_name']}</strong>.</p>
            <p>Total Due: <strong>Rs. {due_amount:,.2f}</strong></p>
            <p>Pending Months: <strong>{months_str}</strong></p>
        </div>
    </div>
    """
    await send_email(parent_email, "Fee Payment Reminder - Action Required", html)


@router.post("/notifications/send-fee-reminders")
async def send_fee_reminders(request: Request):
    await require_roles(UserRole.ADMIN, UserRole.ACCOUNTANT)(request)

    from datetime import datetime
    today = datetime.now().strftime("%Y-%m-%d")

    # Find all overdue installments: status "overdue" OR pending with past due date
    overdue_installments = await db.fee_installments.find(
        {"$or": [
            {"status": "overdue"},
            {"status": "pending", "due_date": {"$lt": today}}
        ]}, {"_id": 0}
    ).to_list(10000)

    # Group by student_id
    student_dues = {}
    for inst in overdue_installments:
        sid = inst["student_id"]
        if sid not in student_dues:
            student_dues[sid] = {"total_due": 0, "months": []}
        student_dues[sid]["total_due"] += inst.get("total_due", inst.get("amount", 0))
        student_dues[sid]["months"].append(inst.get("month", ""))

    sent_count = 0
    failed_count = 0
    details = []

    for student_id, dues in student_dues.items():
        student = await db.students.find_one({"student_id": student_id}, {"_id": 0})
        if not student:
            continue

        parent_email = student.get("parent_email")
        student_name = f"{student.get('first_name', '')} {student.get('last_name', '')}"

        try:
            await send_fee_reminder_email(student, dues["total_due"], dues["months"])
            sent_count += 1
            details.append({
                "student_id": student_id,
                "student_name": student_name,
                "parent_email": parent_email or "N/A",
                "overdue_amount": dues["total_due"],
                "overdue_months": len(dues["months"]),
                "status": "sent" if parent_email else "no_email"
            })
        except Exception as e:
            logger.error(f"Failed to send reminder to {student_id}: {e}")
            failed_count += 1
            details.append({
                "student_id": student_id,
                "student_name": student_name,
                "parent_email": parent_email or "N/A",
                "overdue_amount": dues["total_due"],
                "overdue_months": len(dues["months"]),
                "status": "failed"
            })

    return {
        "sent": sent_count,
        "failed": failed_count,
        "total_overdue_students": len(student_dues),
        "details": details
    }


@router.post("/notifications/send-announcement-email")
async def send_announcement_notification(request: Request):
    await require_roles(UserRole.ADMIN, UserRole.TEACHER)(request)
    body = await request.json()

    announcement_id = body.get("announcement_id")
    announcement = await db.announcements.find_one({"announcement_id": announcement_id}, {"_id": 0})

    if not announcement:
        raise HTTPException(status_code=404, detail="Announcement not found")

    query = {"is_active": True}
    if announcement["target_type"] == "class":
        query["class_name"] = announcement["target_value"]
    elif announcement["target_type"] == "section":
        query["section"] = announcement["target_value"]

    students = await db.students.find(query, {"_id": 0}).to_list(2000)

    sent_count = 0
    for student in students:
        parent_email = student.get("parent_email")
        if parent_email:
            html = f"""
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                <div style="background: #E88A1A; padding: 20px; text-align: center;">
                    <h1 style="color: white; margin: 0;">Shemford Futuristic School</h1>
                </div>
                <div style="padding: 30px; background: #f9f9f9;">
                    <h2>{announcement['title']}</h2>
                    <p style="white-space: pre-wrap;">{announcement['content']}</p>
                    <p style="color: #666; font-size: 12px; margin-top: 30px;">
                        Regarding: {student['first_name']} {student['last_name']} (Class {student['class_name']} - {student['section']})
                    </p>
                </div>
            </div>
            """
            try:
                await send_email(parent_email, f"School Notice: {announcement['title']}", html)
                sent_count += 1
            except Exception as e:
                logger.error(f"Failed to send announcement to {parent_email}: {e}")

    return {"sent": sent_count, "total_students": len(students)}
