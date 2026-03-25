from fastapi import APIRouter, HTTPException, Request
from typing import Optional
from datetime import datetime

from database import db
from models import UserRole, ClassStructure, SHEMFORD_CLASSES, SHEMFORD_SECTIONS
from auth_utils import get_current_user, require_roles, create_audit_log
from routes.fees import current_academic_year

router = APIRouter()

# ─── Default section structure ─────────────────────────────────────────────────

def _default_sections(capacity: int = 45) -> list:
    """Return the 7 rainbow-colour sections for a class."""
    return [
        {"section_name": s, "capacity": capacity, "class_teacher_id": None, "class_teacher_name": None}
        for s in SHEMFORD_SECTIONS
    ]


def _build_shemford_defaults() -> list:
    """
    Return the full default class list for Shemford Futuristic School.
    Called once when the DB has no class_structures yet.
    """
    fee_map = {
        "SF. SR.": 30000, "LKG": 36000, "UKG": 40000,
        "1st": 48000,  "2nd": 50000,  "3rd": 52000,
        "4th": 54000,  "5th": 56000,  "6th": 60000,
        "7th": 62000,  "8th": 64000,  "9th": 72000,
        "10th": 75000, "11th": 85000, "12th": 88000,
    }

    defaults = []
    for order, cls_name in enumerate(SHEMFORD_CLASSES):
        is_senior = cls_name in ("11th", "12th")
        entry = {
            "name": cls_name,
            "display_name": cls_name if cls_name in ("SF. SR.", "LKG", "UKG") else f"Class {cls_name}",
            "sort_order": order,
            "sections": _default_sections(45),
            "has_streams": is_senior,
            "streams": ["science", "humanities"] if is_senior else [],
            "annual_fee": fee_map.get(cls_name, 50000),
        }
        defaults.append(entry)
    return defaults


# ─── Endpoints ─────────────────────────────────────────────────────────────────

@router.post("/classes")
async def create_class(request: Request):
    user = await require_roles(UserRole.ADMIN)(request)
    body = await request.json()

    existing = await db.class_structures.find_one({
        "name": body["name"],
        "academic_year": body.get("academic_year", current_academic_year())
    }, {"_id": 0})
    if existing:
        raise HTTPException(status_code=400, detail=f"Class '{body['name']}' already exists for this academic year")

    cls = ClassStructure(**body)
    cls_dict = cls.model_dump()
    cls_dict["created_at"] = cls_dict["created_at"].isoformat()

    await db.class_structures.insert_one(cls_dict)
    cls_dict.pop("_id", None)

    await create_audit_log("class", cls.class_id, "create", {"class": cls_dict}, user)
    return cls_dict


@router.get("/classes")
async def get_classes(request: Request):
    await get_current_user(request)

    classes = await db.class_structures.find({"is_active": True}, {"_id": 0}).sort("sort_order", 1).to_list(100)

    if not classes:
        for dc in _build_shemford_defaults():
            cls = ClassStructure(**dc)
            cls_dict = cls.model_dump()
            cls_dict["created_at"] = cls_dict["created_at"].isoformat()
            await db.class_structures.insert_one(cls_dict)

        classes = await db.class_structures.find({"is_active": True}, {"_id": 0}).sort("sort_order", 1).to_list(100)

    # Attach live student counts per section (stream-aware for 11th/12th)
    for cls in classes:
        for section in cls.get("sections", []):
            if cls.get("has_streams"):
                # Count per stream-section combination
                stream_counts = {}
                for stream in cls.get("streams", []):
                    count = await db.students.count_documents({
                        "class_name": cls["name"],
                        "stream": stream,
                        "section": section["section_name"],
                        "is_active": True,
                    })
                    stream_counts[stream] = count
                section["stream_student_counts"] = stream_counts
                section["student_count"] = sum(stream_counts.values())
            else:
                count = await db.students.count_documents({
                    "class_name": cls["name"],
                    "section": section["section_name"],
                    "is_active": True,
                })
                section["student_count"] = count

    return classes


@router.get("/classes/{class_id}")
async def get_class_detail(class_id: str, request: Request):
    await get_current_user(request)
    cls = await db.class_structures.find_one({"class_id": class_id}, {"_id": 0})
    if not cls:
        raise HTTPException(status_code=404, detail="Class not found")

    for section in cls.get("sections", []):
        if cls.get("has_streams"):
            stream_counts = {}
            for stream in cls.get("streams", []):
                count = await db.students.count_documents({
                    "class_name": cls["name"],
                    "stream": stream,
                    "section": section["section_name"],
                    "is_active": True,
                })
                stream_counts[stream] = count
            section["stream_student_counts"] = stream_counts
            section["student_count"] = sum(stream_counts.values())
        else:
            count = await db.students.count_documents({
                "class_name": cls["name"],
                "section": section["section_name"],
                "is_active": True,
            })
            section["student_count"] = count

    return cls


@router.put("/classes/{class_id}")
async def update_class(class_id: str, request: Request):
    user = await require_roles(UserRole.ADMIN)(request)
    body = await request.json()

    old = await db.class_structures.find_one({"class_id": class_id}, {"_id": 0})
    if not old:
        raise HTTPException(status_code=404, detail="Class not found")

    # Prevent assigning streams to non-senior classes
    if body.get("has_streams") and old["name"] not in ("11th", "12th"):
        raise HTTPException(
            status_code=400,
            detail=f"Streams can only be assigned to Class 11th or 12th, not '{old['name']}'"
        )

    body.pop("class_id", None)
    await db.class_structures.update_one({"class_id": class_id}, {"$set": body})
    updated = await db.class_structures.find_one({"class_id": class_id}, {"_id": 0})

    await create_audit_log("class", class_id, "update", {"old": old, "new": updated}, user)
    return updated


@router.put("/classes/{class_id}/sections/{section_name}/teacher")
async def assign_class_teacher(class_id: str, section_name: str, request: Request):
    """Assign (or remove) a class teacher for a specific section."""
    user = await require_roles(UserRole.ADMIN)(request)
    body = await request.json()

    cls = await db.class_structures.find_one({"class_id": class_id}, {"_id": 0})
    if not cls:
        raise HTTPException(status_code=404, detail="Class not found")

    sections = cls.get("sections", [])
    matched = False
    for sec in sections:
        if sec["section_name"] == section_name:
            sec["class_teacher_id"] = body.get("teacher_id")
            sec["class_teacher_name"] = body.get("teacher_name")
            matched = True
            break

    if not matched:
        raise HTTPException(status_code=404, detail=f"Section '{section_name}' not found in this class")

    await db.class_structures.update_one({"class_id": class_id}, {"$set": {"sections": sections}})
    await create_audit_log("class", class_id, "assign_teacher", {
        "section": section_name, "teacher_id": body.get("teacher_id")
    }, user)
    return {"message": "Class teacher assigned", "section": section_name, "teacher_id": body.get("teacher_id")}


@router.get("/classes/{class_id}/students")
async def get_class_students(class_id: str, request: Request,
                              section: Optional[str] = None, stream: Optional[str] = None):
    await require_roles(UserRole.ADMIN, UserRole.TEACHER)(request)
    cls = await db.class_structures.find_one({"class_id": class_id}, {"_id": 0})
    if not cls:
        raise HTTPException(status_code=404, detail="Class not found")

    query = {"class_name": cls["name"], "is_active": True}
    if section:
        query["section"] = section
    if stream:
        query["stream"] = stream

    students = await db.students.find(query, {"_id": 0}).sort("roll_number", 1).to_list(2000)
    return students


@router.get("/classes/{class_id}/hierarchy")
async def get_class_hierarchy(class_id: str, request: Request):
    """
    Return full hierarchy: class → streams (if any) → sections → student list.
    Used by the admin drill-down panel.
    """
    await require_roles(UserRole.ADMIN, UserRole.TEACHER)(request)
    cls = await db.class_structures.find_one({"class_id": class_id}, {"_id": 0})
    if not cls:
        raise HTTPException(status_code=404, detail="Class not found")

    result = {
        "class_id": cls["class_id"],
        "name": cls["name"],
        "display_name": cls["display_name"],
        "has_streams": cls.get("has_streams", False),
        "streams": cls.get("streams", []),
        "sections_detail": [],
    }

    if cls.get("has_streams"):
        for stream in cls.get("streams", []):
            stream_entry = {"stream": stream, "sections": []}
            for sec in cls.get("sections", []):
                students = await db.students.find({
                    "class_name": cls["name"],
                    "stream": stream,
                    "section": sec["section_name"],
                    "is_active": True,
                }, {"_id": 0}).sort("roll_number", 1).to_list(200)

                stream_entry["sections"].append({
                    "section_name": sec["section_name"],
                    "capacity": sec.get("capacity", 45),
                    "class_teacher_id": sec.get("class_teacher_id"),
                    "class_teacher_name": sec.get("class_teacher_name"),
                    "student_count": len(students),
                    "students": students,
                })
            result["sections_detail"].append(stream_entry)
    else:
        for sec in cls.get("sections", []):
            students = await db.students.find({
                "class_name": cls["name"],
                "section": sec["section_name"],
                "is_active": True,
            }, {"_id": 0}).sort("roll_number", 1).to_list(200)

            result["sections_detail"].append({
                "section_name": sec["section_name"],
                "capacity": sec.get("capacity", 45),
                "class_teacher_id": sec.get("class_teacher_id"),
                "class_teacher_name": sec.get("class_teacher_name"),
                "student_count": len(students),
                "students": students,
            })

    return result
