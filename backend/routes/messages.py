from fastapi import APIRouter, HTTPException, Request, UploadFile, File, Form
from typing import Optional
from pathlib import Path
import uuid

from database import db
from models import UserRole, Message, VoiceNote
from auth_utils import get_current_user

VOICE_NOTES_DIR = Path(__file__).parent.parent / "uploads" / "voice_notes"
VOICE_NOTES_DIR.mkdir(parents=True, exist_ok=True)

ALLOWED_AUDIO_MIME = {
    "audio/webm", "audio/ogg", "audio/mp4", "audio/x-m4a",
    "audio/mpeg", "audio/wav", "audio/aac",
}
MAX_VOICE_NOTE_BYTES = 5 * 1024 * 1024

router = APIRouter()


@router.post("/messages")
async def send_message(request: Request):
    user = await get_current_user(request)
    body = await request.json()

    recipient_type = body.get("recipient_type", "user")
    if user["role"] == UserRole.STUDENT:
        if recipient_type in ["all", "student", "parent", "class", "section"]:
            raise HTTPException(status_code=403, detail="Students can only send messages to teachers or admin")
    elif user["role"] == UserRole.PARENT:
        if recipient_type in ["all", "student", "parent", "class", "section"]:
            raise HTTPException(status_code=403, detail="Parents can only send messages to teachers or admin")

    # If sending to a specific user, check if they are an inactive student
    if recipient_type == "user" and body.get("recipient_id"):
        recipient_user = await db.users.find_one({"user_id": body["recipient_id"]}, {"_id": 0})
        if recipient_user and not recipient_user.get("is_active", True):
            raise HTTPException(
                status_code=400,
                detail="Cannot send message: recipient account is inactive"
            )
        # Also check student record directly
        student_rec = await db.students.find_one(
            {"$or": [{"user_id": body["recipient_id"]}, {"student_id": body["recipient_id"]}]},
            {"_id": 0, "is_active": 1}
        )
        if student_rec and not student_rec.get("is_active", True):
            raise HTTPException(
                status_code=400,
                detail="Cannot send message: student is currently deactivated"
            )

    message = Message(**body, sender_id=user["user_id"], sender_name=user["name"])
    msg_dict = message.model_dump()
    msg_dict["created_at"] = msg_dict["created_at"].isoformat()

    await db.messages.insert_one(msg_dict)
    msg_dict.pop("_id", None)
    return msg_dict


@router.get("/messages")
async def get_messages(request: Request, sent: bool = False):
    user = await get_current_user(request)

    if sent:
        query = {"sender_id": user["user_id"]}
    else:
        or_clauses = [
            {"recipient_id": user["user_id"]},
            {"recipient_type": "all"},
            {"recipient_type": user["role"]},
        ]
        # For students, also receive class/section broadcast messages
        if user["role"] == UserRole.STUDENT:
            student_rec = await db.students.find_one(
                {"user_id": user["user_id"]}, {"_id": 0, "class_name": 1, "section": 1, "student_id": 1}
            )
            if student_rec:
                or_clauses.append({
                    "recipient_type": "class",
                    "recipient_value": student_rec.get("class_name", "")
                })
                or_clauses.append({
                    "recipient_type": "section",
                    "recipient_value": f"{student_rec.get('class_name', '')}:{student_rec.get('section', '')}"
                })
                # Also check if messages were sent to student_id (for students without user accounts)
                or_clauses.append({"recipient_id": student_rec.get("student_id", "")})

        query = {"$or": or_clauses}

    messages = await db.messages.find(query, {"_id": 0}).sort("created_at", -1).to_list(500)
    return messages


@router.put("/messages/{message_id}/read")
async def mark_message_read(message_id: str, request: Request):
    await get_current_user(request)
    await db.messages.update_one({"message_id": message_id}, {"$set": {"is_read": True}})
    return {"message": "Marked as read"}


@router.post("/messages/{message_id}/voice-note")
async def attach_voice_note_to_message(
    message_id: str,
    request: Request,
    file: UploadFile = File(...),
    duration_seconds: Optional[float] = Form(None),
):
    """
    Attach a voice note audio file to a message.
    Any authenticated user may attach to their own sent messages.
    Max 5 MB. Accepted: webm/ogg/mp4/m4a/mpeg/wav/aac.
    """
    user = await get_current_user(request)

    msg = await db.messages.find_one({"message_id": message_id}, {"_id": 0})
    if not msg:
        raise HTTPException(status_code=404, detail="Message not found.")
    if msg.get("sender_id") != user["user_id"]:
        raise HTTPException(status_code=403, detail="You can only attach voice notes to your own messages.")

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
        entity_type="message",
        entity_id=message_id,
        uploaded_by=user["user_id"],
        file_path=f"uploads/voice_notes/{filename}",
        file_size=len(data),
        duration_seconds=duration_seconds,
        mime_type=content_type,
    )
    vn_dict = vn.model_dump()
    vn_dict["created_at"] = vn_dict["created_at"].isoformat()
    await db.voice_notes.insert_one(vn_dict)

    await db.messages.update_one(
        {"message_id": message_id},
        {"$set": {"voice_note_id": vn.voice_note_id, "message_type": "voice"}}
    )

    return {
        "voice_note_id": vn.voice_note_id,
        "url": f"/api/media/voice-notes/{vn.voice_note_id}",
        "file_size": len(data),
        "mime_type": content_type,
    }
