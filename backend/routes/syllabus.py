from fastapi import APIRouter, Request
from typing import Optional

from database import db
from models import UserRole, Syllabus
from auth_utils import get_current_user, require_roles

router = APIRouter()


@router.post("/syllabus")
async def create_syllabus(request: Request):
    user = await require_roles(UserRole.ADMIN, UserRole.TEACHER)(request)
    body = await request.json()

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
    await get_current_user(request)
    query = {"is_active": True}
    if class_name:
        query["class_name"] = class_name
    if subject:
        query["subject"] = subject

    syllabus_list = await db.syllabus.find(query, {"_id": 0}).to_list(100)
    return syllabus_list
