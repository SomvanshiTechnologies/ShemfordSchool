from fastapi import APIRouter, HTTPException, Request

from database import db
from models import UserRole, Message
from auth_utils import get_current_user

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
