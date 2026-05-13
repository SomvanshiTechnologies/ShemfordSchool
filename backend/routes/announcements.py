from fastapi import APIRouter, HTTPException, Request, UploadFile, File, Form
from typing import Optional
from datetime import datetime, timezone
from pathlib import Path
import os
import uuid

from database import db
from models import UserRole, Announcement, VoiceNote
from auth_utils import get_current_user, require_roles, create_audit_log

VOICE_NOTES_DIR = Path(__file__).parent.parent / "uploads" / "voice_notes"
VOICE_NOTES_DIR.mkdir(parents=True, exist_ok=True)

ALLOWED_AUDIO_MIME = {
    "audio/webm", "audio/ogg", "audio/mp4", "audio/x-m4a",
    "audio/mpeg", "audio/wav", "audio/aac",
}
MAX_VOICE_NOTE_BYTES = 5 * 1024 * 1024  # 5 MB

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
    """Soft-delete an announcement. Any admin or teacher may delete. (#23)"""
    user = await require_roles(UserRole.ADMIN, UserRole.TEACHER)(request)
    ann = await db.announcements.find_one({"announcement_id": announcement_id}, {"_id": 0})
    if not ann:
        raise HTTPException(status_code=404, detail="Announcement not found")
    if not ann.get("is_active", True):
        raise HTTPException(status_code=400, detail="Announcement is already deleted")

    await db.announcements.update_one(
        {"announcement_id": announcement_id},
        {"$set": {
            "is_active": False,
            "deleted_at": datetime.now(timezone.utc).isoformat(),
            "deleted_by": user["user_id"],
        }}
    )
    await create_audit_log("announcement", announcement_id, "deactivate", {
        "title": ann.get("title", ""),
        "audience": ann.get("audience"),
        "created_by": ann.get("created_by"),
    }, user)
    return {"message": "Announcement deleted", "announcement_id": announcement_id}


@router.post("/announcements/{announcement_id}/voice-note")
async def attach_voice_note_to_announcement(
    announcement_id: str,
    request: Request,
    file: UploadFile = File(...),
    duration_seconds: Optional[float] = Form(None),
):
    """
    Attach a voice note audio file to an existing announcement.
    Roles: admin, teacher. Max 5 MB. Accepted: webm/ogg/mp4/m4a/mpeg/wav/aac.
    """
    user = await require_roles(UserRole.ADMIN, UserRole.TEACHER)(request)

    ann = await db.announcements.find_one({"announcement_id": announcement_id}, {"_id": 0})
    if not ann:
        raise HTTPException(status_code=404, detail="Announcement not found.")

    # Validate MIME type from Content-Type header (never trust filename alone)
    content_type = file.content_type or ""
    if content_type not in ALLOWED_AUDIO_MIME:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported audio type '{content_type}'. Accepted: webm, ogg, mp4, m4a, mpeg, wav, aac."
        )

    data = await file.read()
    if len(data) > MAX_VOICE_NOTE_BYTES:
        raise HTTPException(status_code=413, detail="Voice note exceeds 5 MB limit.")
    if len(data) == 0:
        raise HTTPException(status_code=400, detail="Uploaded file is empty.")

    ext = content_type.split("/")[-1].replace("x-", "").replace("mpeg", "mp3")
    filename = f"{uuid.uuid4().hex}.{ext}"
    file_path = VOICE_NOTES_DIR / filename
    file_path.write_bytes(data)

    vn = VoiceNote(
        entity_type="announcement",
        entity_id=announcement_id,
        uploaded_by=user["user_id"],
        file_path=f"uploads/voice_notes/{filename}",
        file_size=len(data),
        duration_seconds=duration_seconds,
        mime_type=content_type,
    )
    vn_dict = vn.model_dump()
    vn_dict["created_at"] = vn_dict["created_at"].isoformat()
    await db.voice_notes.insert_one(vn_dict)

    await db.announcements.update_one(
        {"announcement_id": announcement_id},
        {"$set": {"voice_note_id": vn.voice_note_id}}
    )

    return {
        "voice_note_id": vn.voice_note_id,
        "url": f"/api/media/voice-notes/{vn.voice_note_id}",
        "file_size": len(data),
        "mime_type": content_type,
    }
