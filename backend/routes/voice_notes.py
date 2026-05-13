"""
Shemford School — Voice Notes Media Serving
============================================

GET /media/voice-notes/{voice_note_id}
  Streams the audio file after verifying the requesting user has access
  to the parent announcement or message.

POST /announcements/{id}/voice-note  → see announcements.py
POST /messages/{id}/voice-note       → see messages.py
"""

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import FileResponse
from pathlib import Path

from database import db
from models import UserRole
from auth_utils import get_current_user

router = APIRouter()


@router.get("/media/voice-notes/{voice_note_id}")
async def stream_voice_note(voice_note_id: str, request: Request):
    """
    Stream a voice note file.
    Access control:
      - announcement voice notes: any authenticated user who can see the announcement.
      - message voice notes: sender or recipient of that message, or admin/teacher.
    """
    user = await get_current_user(request)

    vn = await db.voice_notes.find_one({"voice_note_id": voice_note_id}, {"_id": 0})
    if not vn:
        raise HTTPException(status_code=404, detail="Voice note not found.")

    # Permission check based on entity type
    entity_type = vn.get("entity_type", "")
    entity_id = vn.get("entity_id", "")

    if entity_type == "announcement":
        ann = await db.announcements.find_one({"announcement_id": entity_id}, {"_id": 0})
        if not ann or not ann.get("is_active", True):
            raise HTTPException(status_code=404, detail="Parent announcement not found.")
        # Any authenticated user who can reach announcements may stream its voice note
    elif entity_type == "message":
        msg = await db.messages.find_one({"message_id": entity_id}, {"_id": 0})
        if not msg:
            raise HTTPException(status_code=404, detail="Parent message not found.")
        # Sender, specific recipient, or admin/teacher
        is_sender = msg.get("sender_id") == user["user_id"]
        is_recipient = msg.get("recipient_id") == user["user_id"]
        is_privileged = user["role"] in (UserRole.ADMIN, UserRole.TEACHER, UserRole.ACCOUNTANT)
        if not (is_sender or is_recipient or is_privileged):
            raise HTTPException(status_code=403, detail="Access denied to this voice note.")
    else:
        raise HTTPException(status_code=400, detail="Unknown voice note entity type.")

    # file_path stored as "uploads/voice_notes/xxx.webm" relative to backend/
    file_path = Path(__file__).parent.parent / vn["file_path"]

    if not file_path.exists():
        raise HTTPException(status_code=404, detail="Voice note file not found on server.")

    return FileResponse(
        path=str(file_path),
        media_type=vn.get("mime_type", "audio/webm"),
        filename=file_path.name,
    )
