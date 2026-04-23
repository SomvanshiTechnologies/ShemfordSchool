from fastapi import APIRouter, HTTPException, Request
from typing import Optional

from database import db
from models import UserRole, Syllabus
from auth_utils import get_current_user, require_roles, get_teacher_assigned_classes

router = APIRouter()


@router.post("/syllabus")
async def create_syllabus(request: Request):
    user = await require_roles(UserRole.ADMIN, UserRole.TEACHER)(request)
    body = await request.json()

    if user["role"] == UserRole.TEACHER:
        assigned = await get_teacher_assigned_classes(user["user_id"])
        if assigned:
            allowed_classes = [a["class_name"] for a in assigned]
            if body.get("class_name") not in allowed_classes:
                raise HTTPException(status_code=403, detail="You can only upload syllabus for your assigned class")

    syllabus = Syllabus(**body, uploaded_by=user["user_id"])
    syl_dict = syllabus.model_dump()
    syl_dict["created_at"] = syl_dict["created_at"].isoformat()

    await db.syllabus.insert_one(syl_dict)
    syl_dict.pop("_id", None)
    return syl_dict


@router.get("/syllabus")
async def get_syllabus(
    request: Request,
    class_name: Optional[str] = None,
    subject: Optional[str] = None
):
    user = await get_current_user(request)
    query = {"is_active": True}

    if user["role"] == UserRole.STUDENT:
        student = await db.students.find_one(
            {"user_id": user["user_id"], "is_active": True},
            {"_id": 0, "class_name": 1}
        )
        if student:
            query["class_name"] = student["class_name"]
        else:
            return []

    elif user["role"] == UserRole.PARENT:
        children = await db.students.find(
            {"$or": [{"parent_email": user.get("email", "")}, {"parent_id": user["user_id"]}], "is_active": True},
            {"_id": 0, "class_name": 1}
        ).to_list(20)
        child_classes = list(set(c["class_name"] for c in children if c.get("class_name")))
        if child_classes:
            query["class_name"] = {"$in": child_classes}
        else:
            return []

    elif user["role"] == UserRole.TEACHER:
        assigned = await get_teacher_assigned_classes(user["user_id"])
        if assigned:
            query["class_name"] = {"$in": list(set(a["class_name"] for a in assigned))}

    # Admin/Accountant see all — explicit filter still respected
    if class_name:
        query["class_name"] = class_name
    if subject:
        query["subject"] = subject

    syllabus_list = await db.syllabus.find(query, {"_id": 0}).to_list(100)
    return syllabus_list
