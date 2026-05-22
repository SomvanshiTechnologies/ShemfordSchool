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
            {"_id": 0, "is_active": 1, "first_name": 1, "last_name": 1}
        )
        if student_rec and not student_rec.get("is_active", True):
            raise HTTPException(
                status_code=400,
                detail="Cannot send message: student is currently deactivated"
            )

        # Denormalize the recipient's display name onto the message so the
        # Sent folder doesn't render "TO: user". Prefer the users row's name;
        # fall back to the students row for student recipients without a
        # populated users.name; finally fall back to the email local-part.
        if not body.get("recipient_label"):
            name = None
            if recipient_user:
                name = recipient_user.get("name") or recipient_user.get("email")
            if not name and student_rec:
                name = f"{student_rec.get('first_name','')} {student_rec.get('last_name','')}".strip() or None
            if name and "@" in name:
                name = name.split("@", 1)[0]
            if name:
                body["recipient_label"] = name

    message = Message(**body, sender_id=user["user_id"], sender_name=user["name"])
    msg_dict = message.model_dump()
    msg_dict["created_at"] = msg_dict["created_at"].isoformat()

    await db.messages.insert_one(msg_dict)
    msg_dict.pop("_id", None)
    return msg_dict


@router.get("/messages/contacts")
async def list_messageable_contacts(request: Request, q: Optional[str] = None):
    """
    Return the list of users the caller is allowed to message, scoped by role:

      - admin / accountant : full active-user directory
      - teacher            : assigned-class students + all staff
      - student            : classmates (same class+section) + all teachers
                             + all accountants + all admins
      - parent             : children's class teachers + all teachers
                             + accountants + admins

    Always callable (no 403 for students/parents — messaging is self-service).
    q is an optional substring filter on name + email + admission_number.
    """
    user = await get_current_user(request)
    role = user["role"]
    me   = user["user_id"]

    contacts: list[dict] = []
    seen_ids: set[str] = set()

    def add(item: dict) -> None:
        uid = item.get("user_id")
        if not uid or uid == me or uid in seen_ids:
            return
        seen_ids.add(uid)
        contacts.append(item)

    async def add_users_with_roles(roles: list[str], scope: str) -> None:
        async for u in db.users.find(
            {"role": {"$in": roles}, "is_active": True},
            {"_id": 0, "password_hash": 0},
        ):
            add({
                "user_id": u["user_id"], "name": u.get("name"),
                "email":   u.get("email", ""), "role": u.get("role"),
                "scope":   scope,
            })

    if role in (UserRole.ADMIN, UserRole.ACCOUNTANT):
        await add_users_with_roles(
            [UserRole.ADMIN, UserRole.TEACHER, UserRole.ACCOUNTANT,
             UserRole.STUDENT, UserRole.PARENT],
            "directory",
        )

    elif role == UserRole.TEACHER:
        # Teachers see ALL students (their primary audience) plus admins and
        # accountants for escalation. They do NOT see other teachers — keeps
        # the picker focused on people they'd actually message in practice.
        async for s in db.students.find({"is_active": {"$ne": False}}, {"_id": 0}):
            uid = s.get("user_id") or s.get("student_id")
            if uid and uid not in seen_ids and uid != me:
                seen_ids.add(uid)
                contacts.append({
                    "user_id":          uid,
                    "name":             f"{s.get('first_name','')} {s.get('last_name','')}".strip(),
                    "email":            s.get("email", ""),
                    "role":             "student",
                    "class_name":       s.get("class_name"),
                    "section":          s.get("section"),
                    "admission_number": s.get("admission_number"),
                    "scope":            "student",
                })
        await add_users_with_roles([UserRole.ADMIN],      "school_office")
        await add_users_with_roles([UserRole.ACCOUNTANT], "accounts")

    elif role == UserRole.STUDENT:
        # Classmates first (same class + section), then all teachers,
        # then accountant (for fee queries), then admins (school office).
        student = await db.students.find_one(
            {"user_id": me}, {"_id": 0, "class_name": 1, "section": 1},
        )
        if student and student.get("class_name"):
            cq: dict = {"is_active": True, "class_name": student["class_name"]}
            if student.get("section"):
                cq["section"] = student["section"]
            async for s in db.students.find(cq, {"_id": 0}):
                uid = s.get("user_id") or s.get("student_id")
                if uid and uid not in seen_ids and uid != me:
                    seen_ids.add(uid)
                    contacts.append({
                        "user_id":          uid,
                        "name":             f"{s.get('first_name','')} {s.get('last_name','')}".strip(),
                        "email":            s.get("email", ""),
                        "role":             "student",
                        "class_name":       s.get("class_name"),
                        "section":          s.get("section"),
                        "admission_number": s.get("admission_number"),
                        "scope":            "classmate",
                    })
        await add_users_with_roles([UserRole.TEACHER],    "teacher")
        await add_users_with_roles([UserRole.ACCOUNTANT], "accounts")
        await add_users_with_roles([UserRole.ADMIN],      "school_office")

    elif role == UserRole.PARENT:
        await add_users_with_roles([UserRole.TEACHER],    "teacher")
        await add_users_with_roles([UserRole.ACCOUNTANT], "accounts")
        await add_users_with_roles([UserRole.ADMIN],      "school_office")

    if q:
        n = q.lower().strip()
        contacts = [
            c for c in contacts
            if n in (c.get("name") or "").lower()
            or n in (c.get("email") or "").lower()
            or n in (c.get("admission_number") or "").lower()
        ]

    return contacts[:120]


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

    # Enrich messages sent to specific users with the recipient's display
    # name when recipient_label is missing — this covers messages stored
    # before the send-time denormalization was added, so the Sent folder
    # stops showing "TO: user" / "TO: student".
    missing_label_ids = list({
        m.get("recipient_id") for m in messages
        if m.get("recipient_type") == "user"
        and m.get("recipient_id")
        and not m.get("recipient_label")
    })
    if missing_label_ids:
        name_by_id: dict[str, str] = {}
        async for u in db.users.find(
            {"user_id": {"$in": missing_label_ids}},
            {"_id": 0, "user_id": 1, "name": 1, "email": 1},
        ):
            nm = u.get("name") or (u.get("email") or "").split("@")[0]
            if nm:
                name_by_id[u["user_id"]] = nm
        unresolved = [i for i in missing_label_ids if i not in name_by_id]
        if unresolved:
            async for s in db.students.find(
                {"$or": [{"user_id": {"$in": unresolved}}, {"student_id": {"$in": unresolved}}]},
                {"_id": 0, "user_id": 1, "student_id": 1, "first_name": 1, "last_name": 1},
            ):
                nm = f"{s.get('first_name','')} {s.get('last_name','')}".strip()
                if nm:
                    if s.get("user_id"):    name_by_id[s["user_id"]]    = nm
                    if s.get("student_id"): name_by_id[s["student_id"]] = nm
        for m in messages:
            if not m.get("recipient_label"):
                resolved = name_by_id.get(m.get("recipient_id"))
                if resolved:
                    m["recipient_label"] = resolved

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
