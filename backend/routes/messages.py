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
        if recipient_type in ["all", "student", "parent"]:
            raise HTTPException(status_code=403, detail="Students can only send messages to teachers or admin")
    elif user["role"] == UserRole.PARENT:
        if recipient_type in ["all", "student", "parent"]:
            raise HTTPException(status_code=403, detail="Parents can only send messages to teachers or admin")

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
        query = {
            "$or": [
                {"recipient_id": user["user_id"]},
                {"recipient_type": "all"},
                {"recipient_type": user["role"]}
            ]
        }

    messages = await db.messages.find(query, {"_id": 0}).sort("created_at", -1).to_list(500)
    return messages


@router.put("/messages/{message_id}/read")
async def mark_message_read(message_id: str, request: Request):
    await get_current_user(request)
    await db.messages.update_one({"message_id": message_id}, {"$set": {"is_read": True}})
    return {"message": "Marked as read"}
