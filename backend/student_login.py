from datetime import datetime
from typing import Optional

from database import db
from models import UserBase, UserRole
from auth_utils import hash_password

_DOB_FORMATS = ["%Y-%m-%d", "%d-%m-%Y", "%d/%m/%Y", "%d.%m.%Y", "%d%m%Y"]


def dob_password(dob) -> Optional[str]:
    """Date of birth as ddmmyyyy (12.04.2008 -> 12042008), or None if unparseable."""
    if not dob:
        return None
    for fmt in _DOB_FORMATS:
        try:
            return datetime.strptime(str(dob).strip(), fmt).strftime("%d%m%Y")
        except ValueError:
            pass
    return None


async def ensure_student_login(student: dict) -> bool:
    """Create the student's login (login ID = admission number, password = DOB ddmmyyyy).

    Returns False when the student has no usable date of birth.
    """
    if student.get("user_id"):
        return True
    password = dob_password(student.get("date_of_birth"))
    if not password:
        return False

    email = (student.get("email") or "").strip().lower()
    if not email or await db.users.find_one({"email": email}, {"_id": 0, "user_id": 1}):
        email = f"{student['student_id'].lower()}@student.shemford.in"

    account = UserBase(
        email=email,
        name=f"{student.get('first_name', '')} {student.get('last_name', '')}".strip(),
        role=UserRole.STUDENT,
        phone=student.get("phone"),
    )
    doc = account.model_dump()
    doc["password_hash"] = hash_password(password)
    doc["created_at"] = doc["created_at"].isoformat()
    await db.users.insert_one(doc)
    await db.students.update_one(
        {"student_id": student["student_id"]},
        {"$set": {"user_id": account.user_id, "email": email}},
    )
    student["user_id"] = account.user_id
    student["email"] = email
    return True
