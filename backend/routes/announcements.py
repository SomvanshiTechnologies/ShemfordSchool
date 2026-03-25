from fastapi import APIRouter, HTTPException, Request
from typing import Optional
from datetime import datetime, timezone

from database import db
from models import UserRole, Announcement
from auth_utils import get_current_user, require_roles

router = APIRouter()


@router.post("/announcements")
async def create_announcement(request: Request):
    user = await require_roles(UserRole.ADMIN, UserRole.TEACHER)(request)
    body = await request.json()

    announcement = Announcement(**body, created_by=user["user_id"])
    ann_dict = announcement.model_dump()
    ann_dict["created_at"] = ann_dict["created_at"].isoformat()

    await db.announcements.insert_one(ann_dict)
    ann_dict.pop("_id", None)
    return ann_dict


@router.get("/announcements")
async def get_announcements(
    request: Request,
    target_type: Optional[str] = None,
    target_value: Optional[str] = None
):
    user = await get_current_user(request)
    query = {"is_active": True}

    if user["role"] == UserRole.STUDENT:
        student = await db.students.find_one({"user_id": user["user_id"]}, {"_id": 0, "class_name": 1, "section": 1, "student_id": 1})
        student_class = student.get("class_name") if student else None
        query["$or"] = [
            {"target_type": "all"},
            {"target_type": "student"},
        ]
        if student_class:
            query["$or"].append({"target_type": "class", "target_value": student_class})
        if student:
            query["$or"].append({"target_value": student.get("student_id")})
    elif user["role"] == UserRole.PARENT:
        children = await db.students.find({"parent_id": user["user_id"]}, {"_id": 0, "class_name": 1}).to_list(20)
        child_classes = list(set(c["class_name"] for c in children if c.get("class_name")))
        query["$or"] = [
            {"target_type": "all"},
            {"target_type": "parent"}
        ]
        for cls in child_classes:
            query["$or"].append({"target_type": "class", "target_value": cls})
    elif user["role"] == UserRole.TEACHER:
        query["$or"] = [
            {"target_type": "all"},
            {"target_type": "teacher"},
        ]

    if target_type:
        if user["role"] in [UserRole.ADMIN, UserRole.TEACHER, UserRole.ACCOUNTANT]:
            query["target_type"] = target_type
    if target_value:
        if user["role"] in [UserRole.ADMIN, UserRole.TEACHER, UserRole.ACCOUNTANT]:
            query["target_value"] = target_value

    announcements = await db.announcements.find(query, {"_id": 0}).sort("created_at", -1).to_list(100)
    return announcements


@router.put("/announcements/{announcement_id}")
async def update_announcement(announcement_id: str, request: Request):
    await require_roles(UserRole.ADMIN, UserRole.TEACHER)(request)
    body = await request.json()

    await db.announcements.update_one({"announcement_id": announcement_id}, {"$set": body})
    updated = await db.announcements.find_one({"announcement_id": announcement_id}, {"_id": 0})
    return updated


@router.delete("/announcements/{announcement_id}")
async def delete_announcement(announcement_id: str, request: Request):
    """Soft-delete an announcement. Creator or admin only. (#23)"""
    user = await require_roles(UserRole.ADMIN, UserRole.TEACHER)(request)
    ann = await db.announcements.find_one({"announcement_id": announcement_id}, {"_id": 0})
    if not ann:
        raise HTTPException(status_code=404, detail="Announcement not found")
    if not ann.get("is_active", True):
        raise HTTPException(status_code=400, detail="Announcement is already deleted")

    # Only the creator or an admin can delete
    if user["role"] != UserRole.ADMIN and ann.get("created_by") != user["user_id"]:
        raise HTTPException(status_code=403, detail="You can only delete your own announcements")

    await db.announcements.update_one(
        {"announcement_id": announcement_id},
        {"$set": {
            "is_active": False,
            "deleted_at": datetime.now(timezone.utc).isoformat(),
            "deleted_by": user["user_id"],
        }}
    )
    return {"message": "Announcement deleted", "announcement_id": announcement_id}
