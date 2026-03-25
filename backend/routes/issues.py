from fastapi import APIRouter, HTTPException, Request
from typing import Optional
from datetime import datetime, timezone

from database import db
from models import UserRole, Issue
from auth_utils import get_current_user, require_roles

router = APIRouter()


@router.post("/issues")
async def create_issue(request: Request):
    user = await get_current_user(request)
    body = await request.json()

    issue = Issue(**body, raised_by=user["user_id"], raised_by_role=user["role"])
    issue_dict = issue.model_dump()
    issue_dict["created_at"] = issue_dict["created_at"].isoformat()
    if issue_dict.get("resolved_at"):
        issue_dict["resolved_at"] = issue_dict["resolved_at"].isoformat()

    await db.issues.insert_one(issue_dict)
    issue_dict.pop("_id", None)
    return issue_dict


@router.get("/issues")
async def get_issues(
    request: Request,
    status: Optional[str] = None,
    category: Optional[str] = None,
    raised_by: Optional[str] = None
):
    user = await get_current_user(request)
    query = {}

    if user["role"] not in [UserRole.ADMIN, UserRole.TEACHER]:
        query["raised_by"] = user["user_id"]
    elif raised_by:
        query["raised_by"] = raised_by

    if status:
        query["status"] = status
    if category:
        query["category"] = category

    issues = await db.issues.find(query, {"_id": 0}).sort("created_at", -1).to_list(500)
    return issues


@router.put("/issues/{issue_id}")
async def update_issue(issue_id: str, request: Request):
    user = await get_current_user(request)
    body = await request.json()

    issue = await db.issues.find_one({"issue_id": issue_id}, {"_id": 0})
    if not issue:
        raise HTTPException(status_code=404, detail="Issue not found")

    if user["role"] not in [UserRole.ADMIN, UserRole.TEACHER]:
        if issue["raised_by"] != user["user_id"]:
            raise HTTPException(status_code=403, detail="Not authorized")
        body = {"description": body.get("description", issue["description"])}

    if body.get("status") == "resolved" and issue["status"] != "resolved":
        body["resolved_at"] = datetime.now(timezone.utc).isoformat()

    await db.issues.update_one({"issue_id": issue_id}, {"$set": body})
    updated = await db.issues.find_one({"issue_id": issue_id}, {"_id": 0})
    return updated
