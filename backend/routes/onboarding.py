"""
Shemford Futuristic School — Admission / Onboarding Flow

Status flow:
  draft → class_selected → docs_uploaded → fee_collected → completed
                                           ↑
                         (docs_verified is tracked separately)

Steps:
  1. POST /onboarding/start          — collect student + parent info
  2. PUT  /onboarding/{id}/class     — select class, section, stream; get fee preview
  3. POST /onboarding/{id}/documents — upload mandatory documents
  4. PUT  /onboarding/{id}/documents/{doc_id}/verify  — admin verifies a document
  5. POST /onboarding/{id}/complete  — finalize: generate admission number,
                                       create student record, create ledger entries,
                                       create parent account
"""
from fastapi import APIRouter, HTTPException, Request
from typing import Optional
from datetime import datetime, timezone
import secrets

from database import db
from models import (
    UserRole, UserBase, StudentBase, OnboardingApplication, StudentDocument,
    REQUIRED_DOCUMENTS, CLASSES_WITH_STREAMS
)
from auth_utils import hash_password, require_roles, generate_admission_number, create_audit_log
from routes.fees import get_fee_config, create_admission_ledger, build_admission_fee_breakdown, current_academic_year
from routes.students import get_next_roll_number

router = APIRouter()


def needs_stream(class_name: str) -> bool:
    return any(c in class_name for c in CLASSES_WITH_STREAMS)


# ─────────────────────────────────────────────────────────────────────────────
# Step 1: Start application
# ─────────────────────────────────────────────────────────────────────────────

@router.post("/onboarding/start")
async def start_onboarding(request: Request):
    user = await require_roles(UserRole.ADMIN, UserRole.ACCOUNTANT)(request)
    
    try:
        body = await request.json()
    except Exception as e:
        raise HTTPException(
            status_code=400,
            detail="Invalid request format. Please check the submitted data."
        )

    # ── Required field validation ───────────────────────────────────────────
    REQUIRED_FIELDS = {
        "first_name": "First Name",
        "last_name": "Last Name",
        "gender": "Gender",
        "date_of_birth": "Date of Birth",
        "parent_name": "Father / Guardian Name",
        "parent_phone": "Contact Number",
        "mother_name": "Mother Name",
        "mother_phone": "Mother Contact Number",
    }
    validation_errors = {}
    for field, label in REQUIRED_FIELDS.items():
        val = body.get(field)
        if not val or (isinstance(val, str) and not val.strip()):
            validation_errors[field] = f"{label} is required"
    
    if validation_errors:
        error_messages = " | ".join([f"{k}: {v}" for k, v in validation_errors.items()])
        raise HTTPException(
            status_code=400,
            detail=f"Missing required fields: {error_messages}"
        )

    # Duplicate check in existing students and onboarding applications
    # Run both queries in parallel for better performance
    if body.get("date_of_birth"):
        import asyncio
        existing_student, existing_onb = await asyncio.gather(
            db.students.find_one({
                "first_name": body.get("first_name", ""),
                "last_name": body.get("last_name", ""),
                "date_of_birth": body["date_of_birth"],
                "is_active": True
            }, {"_id": 0}),
            db.onboarding.find_one({
                "first_name": body.get("first_name", ""),
                "last_name": body.get("last_name", ""),
                "date_of_birth": body["date_of_birth"],
                "status": {"$nin": ["rejected", "completed"]}
            }, {"_id": 0})
        )
        if existing_student:
            raise HTTPException(
                status_code=400,
                detail=f"Duplicate student: {existing_student['first_name']} {existing_student['last_name']} "
                       f"(Admission: {existing_student['admission_number']})"
            )
        if existing_onb:
            raise HTTPException(
                status_code=400,
                detail="An active onboarding application already exists for this student"
            )

    # Sibling check: if sibling_student_id provided, verify it exists
    is_sibling = body.get("is_sibling", False)
    sibling_student_id = body.get("sibling_student_id")
    if is_sibling and sibling_student_id:
        sibling = await db.students.find_one({"student_id": sibling_student_id, "is_active": True}, {"_id": 0})
        if not sibling:
            raise HTTPException(status_code=400, detail="Sibling student not found")
    elif is_sibling and not sibling_student_id and body.get("parent_email"):
        # Auto-detect sibling by parent email
        sibling = await db.students.find_one({"parent_email": body["parent_email"], "is_active": True}, {"_id": 0})
        if sibling:
            sibling_student_id = sibling["student_id"]
        else:
            is_sibling = False

    app_obj = OnboardingApplication(
        **{k: v for k, v in body.items() if k not in ("is_sibling", "sibling_student_id")},
        is_sibling=is_sibling,
        sibling_student_id=sibling_student_id,
        created_by=user["user_id"]
    )
    app_dict = app_obj.model_dump()
    app_dict["created_at"] = app_dict["created_at"].isoformat()

    await db.onboarding.insert_one(app_dict)
    app_dict.pop("_id", None)

    await create_audit_log("onboarding", app_obj.onboarding_id, "create", {}, user)
    return app_dict


# ─────────────────────────────────────────────────────────────────────────────
# Step 2: Select class, section, stream
# ─────────────────────────────────────────────────────────────────────────────

@router.put("/onboarding/{onboarding_id}/class")
async def set_onboarding_class(onboarding_id: str, request: Request):
    await require_roles(UserRole.ADMIN, UserRole.ACCOUNTANT)(request)
    body = await request.json()

    app = await db.onboarding.find_one({"onboarding_id": onboarding_id}, {"_id": 0})
    if not app:
        raise HTTPException(status_code=404, detail="Application not found")
    if app["status"] not in ["draft"]:
        raise HTTPException(status_code=400, detail=f"Cannot change class at status: {app['status']}")

    class_name = body.get("class_name")
    section = body.get("section")
    stream = body.get("stream")  # required for class 11/12
    academic_year = body.get("academic_year") or current_academic_year()

    if not class_name or not section:
        raise HTTPException(status_code=400, detail="class_name and section are required")

    cls = await db.class_structures.find_one({"name": class_name, "is_active": True}, {"_id": 0})
    if not cls:
        raise HTTPException(status_code=400, detail=f"Class '{class_name}' not found")

    # Stream validation
    if needs_stream(class_name):
        if not stream:
            raise HTTPException(
                status_code=400,
                detail="Stream (science or humanities) is required for Class 11th and 12th"
            )
        allowed_streams = cls.get("streams", ["science", "humanities"])
        if stream not in allowed_streams:
            raise HTTPException(
                status_code=400,
                detail=f"Invalid stream '{stream}'. Allowed: {allowed_streams}"
            )
    else:
        if stream:
            raise HTTPException(
                status_code=400,
                detail=f"Stream cannot be assigned to {class_name}. Only Class 11th and 12th have streams."
            )

    # Section capacity check (stream-aware for 11th/12th)
    section_info = next((s for s in cls.get("sections", []) if s["section_name"] == section), None)
    if not section_info:
        raise HTTPException(status_code=400, detail=f"Section '{section}' not found in {class_name}")

    count_query = {"class_name": class_name, "section": section, "is_active": True}
    if stream:
        count_query["stream"] = stream
    current_count = await db.students.count_documents(count_query)
    capacity = section_info.get("capacity", 40)
    if current_count >= capacity:
        raise HTTPException(
            status_code=400,
            detail=f"Section {section} is full ({current_count}/{capacity} seats taken)"
        )

    # Fetch fee component config
    cfg = await get_fee_config(class_name, academic_year, stream)
    if not cfg:
        raise HTTPException(
            status_code=400,
            detail=f"No fee configuration found for {class_name}"
                   + (f" ({stream})" if stream else "")
                   + f" for {academic_year}. "
                   + "Please contact admin to configure fees. "
                   + "Admin can run POST /fees/components/ensure-defaults to auto-create default fees."
        )

    is_sibling = app.get("is_sibling", False)
    fee_breakdown = build_admission_fee_breakdown(cfg, is_sibling)

    admission_time_fee = round(sum(item["net_amount"] for item in fee_breakdown), 2)
    # Total annual = yearly fees + 12 months tuition
    total_annual = (
        sum(item["net_amount"] for item in fee_breakdown if item["fee_type"] in ["one_time", "yearly"])
        + cfg.get("monthly_tuition", 0) * 12
    )

    update = {
        "class_name": class_name,
        "section": section,
        "stream": stream,
        "academic_year": academic_year,
        "status": "class_selected",
        "fee_breakdown": fee_breakdown,
        "admission_time_fee": admission_time_fee,
        "total_annual_fee": round(total_annual, 2),
        "seats_available": capacity - current_count,
    }
    await db.onboarding.update_one({"onboarding_id": onboarding_id}, {"$set": update})

    updated = await db.onboarding.find_one({"onboarding_id": onboarding_id}, {"_id": 0})
    return updated


# ─────────────────────────────────────────────────────────────────────────────
# Step 3: Document upload
# ─────────────────────────────────────────────────────────────────────────────

@router.get("/onboarding/{onboarding_id}/documents/required")
async def get_required_documents(onboarding_id: str, request: Request):
    await require_roles(UserRole.ADMIN)(request)
    app = await db.onboarding.find_one({"onboarding_id": onboarding_id}, {"_id": 0})
    if not app:
        raise HTTPException(status_code=404, detail="Application not found")

    # Fetch already uploaded docs
    uploaded = await db.student_documents.find(
        {"onboarding_id": onboarding_id}, {"_id": 0}
    ).to_list(50)
    uploaded_types = {d["document_type"]: d for d in uploaded}

    result = []
    for req in REQUIRED_DOCUMENTS:
        uploaded_doc = uploaded_types.get(req["type"])
        result.append({
            **req,
            "uploaded": uploaded_doc is not None,
            "document": uploaded_doc,
        })
    return result


@router.post("/onboarding/{onboarding_id}/documents")
async def upload_document(onboarding_id: str, request: Request):
    user = await require_roles(UserRole.ADMIN, UserRole.ACCOUNTANT)(request)
    body = await request.json()

    app = await db.onboarding.find_one({"onboarding_id": onboarding_id}, {"_id": 0})
    if not app:
        raise HTTPException(status_code=404, detail="Application not found")
    if app["status"] == "completed":
        raise HTTPException(status_code=400, detail="Application already completed")

    document_type = body.get("document_type")
    if not document_type:
        raise HTTPException(status_code=400, detail="document_type is required")

    # Replace existing document of same type
    await db.student_documents.delete_many({
        "onboarding_id": onboarding_id, "document_type": document_type
    })

    req_doc = next((d for d in REQUIRED_DOCUMENTS if d["type"] == document_type), None)
    is_mandatory = req_doc["mandatory"] if req_doc else False

    doc = StudentDocument(
        onboarding_id=onboarding_id,
        document_type=document_type,
        document_name=body.get("document_name", document_type.replace("_", " ").title()),
        file_url=body.get("file_url"),
        file_name=body.get("file_name"),
        is_mandatory=is_mandatory,
        status="uploaded",
        uploaded_by=user["user_id"],
    )
    d = doc.model_dump()
    d["created_at"] = d["created_at"].isoformat()
    await db.student_documents.insert_one(d)
    d.pop("_id", None)

    # Check if all mandatory docs are uploaded
    uploaded_mandatory = await db.student_documents.count_documents({
        "onboarding_id": onboarding_id,
        "is_mandatory": True,
        "status": {"$in": ["uploaded", "verified"]}
    })
    required_mandatory = sum(1 for rd in REQUIRED_DOCUMENTS if rd["mandatory"])
    all_uploaded = uploaded_mandatory >= required_mandatory

    if all_uploaded and app["status"] == "class_selected":
        await db.onboarding.update_one(
            {"onboarding_id": onboarding_id},
            {"$set": {"status": "docs_uploaded", "documents_uploaded": True}}
        )

    return {"document": d, "all_mandatory_uploaded": all_uploaded}


@router.put("/onboarding/{onboarding_id}/documents/{document_id}/verify")
async def verify_document(onboarding_id: str, document_id: str, request: Request):
    user = await require_roles(UserRole.ADMIN)(request)
    body = await request.json()
    action = body.get("action", "verify")  # "verify" or "reject"

    doc = await db.student_documents.find_one({
        "document_id": document_id, "onboarding_id": onboarding_id
    }, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")

    update = {
        "verified_by": user["user_id"],
        "verified_at": datetime.now(timezone.utc).isoformat(),
    }
    if action == "verify":
        update["status"] = "verified"
    elif action == "reject":
        update["status"] = "rejected"
        update["rejection_reason"] = body.get("rejection_reason", "Document rejected by admin")
    else:
        raise HTTPException(status_code=400, detail="action must be 'verify' or 'reject'")

    await db.student_documents.update_one({"document_id": document_id}, {"$set": update})

    # Update application documents_verified flag if all mandatory docs are verified
    verified_mandatory = await db.student_documents.count_documents({
        "onboarding_id": onboarding_id, "is_mandatory": True, "status": "verified"
    })
    required_mandatory = sum(1 for rd in REQUIRED_DOCUMENTS if rd["mandatory"])
    if verified_mandatory >= required_mandatory:
        await db.onboarding.update_one(
            {"onboarding_id": onboarding_id},
            {"$set": {"documents_verified": True}}
        )

    return {"message": f"Document {action}ed", "document_id": document_id}


# ─────────────────────────────────────────────────────────────────────────────
# Step 4+5: Complete admission
# ─────────────────────────────────────────────────────────────────────────────

@router.post("/onboarding/{onboarding_id}/complete")
async def complete_onboarding(onboarding_id: str, request: Request):
    """
    Finalize the admission:
    - Validates documents are uploaded (verified if not overridden)
    - Creates student record
    - Creates parent user account
    - Creates full fee ledger (one-time + yearly + all 12 monthly tuition)
    - Marks status = completed
    """
    user = await require_roles(UserRole.ADMIN, UserRole.ACCOUNTANT)(request)
    body = await request.json()
    admin_override = body.get("admin_override", False)

    app = await db.onboarding.find_one({"onboarding_id": onboarding_id}, {"_id": 0})
    if not app:
        raise HTTPException(status_code=404, detail="Application not found")
    if app["status"] == "completed":
        raise HTTPException(status_code=400, detail="Application already completed")
    if app["status"] not in ["class_selected", "docs_uploaded", "fee_collected"] and not admin_override:
        raise HTTPException(
            status_code=400,
            detail=f"Cannot complete at status '{app['status']}'. Please select class first."
        )

    # Document check
    if not admin_override:
        missing_mandatory = []
        for req_doc in REQUIRED_DOCUMENTS:
            if req_doc["mandatory"]:
                uploaded = await db.student_documents.find_one({
                    "onboarding_id": onboarding_id,
                    "document_type": req_doc["type"],
                    "status": {"$in": ["uploaded", "verified"]}
                }, {"_id": 0})
                if not uploaded:
                    missing_mandatory.append(req_doc["name"])
        if missing_mandatory:
            raise HTTPException(
                status_code=400,
                detail=f"Missing mandatory documents: {', '.join(missing_mandatory)}. "
                       "Upload all required documents or use admin_override."
            )

    # Section capacity re-check
    cls = await db.class_structures.find_one({"name": app["class_name"], "is_active": True}, {"_id": 0})
    if cls:
        for s in cls.get("sections", []):
            if s["section_name"] == app["section"]:
                current = await db.students.count_documents(
                    {"class_name": app["class_name"], "section": app["section"], "is_active": True}
                )
                if current >= s.get("capacity", 40) and not admin_override:
                    raise HTTPException(status_code=400, detail="Section is full. Use admin_override if needed.")

    # Generate admission number
    admission_number = await generate_admission_number()
    academic_year = app.get("academic_year") or current_academic_year()

    # Auto-assign roll number (class-section-stream scoped, sequential from 1)
    roll_number = str(await get_next_roll_number(
        app["class_name"], app["section"], app.get("stream")
    ))

    # Create student record
    student_obj = StudentBase(
        first_name=app["first_name"],
        last_name=app["last_name"],
        email=app.get("email"),
        phone=app.get("phone"),
        date_of_birth=app.get("date_of_birth"),
        gender=app.get("gender", "male"),
        address=app.get("address"),
        class_name=app["class_name"],
        section=app["section"],
        stream=app.get("stream"),
        parent_name=app.get("parent_name"),
        parent_phone=app.get("parent_phone"),
        parent_email=app.get("parent_email"),
        admission_number=admission_number,
        academic_year=academic_year,
        roll_number=roll_number,
        is_sibling=app.get("is_sibling", False),
        sibling_student_id=app.get("sibling_student_id"),
        fee_status="pending",
    )
    student_dict = student_obj.model_dump()
    student_dict["created_at"] = student_dict["created_at"].isoformat()
    student_dict["onboarding_id"] = onboarding_id
    await db.students.insert_one(student_dict)
    student_dict.pop("_id", None)

    # Create fee ledger entries
    cfg = await get_fee_config(app["class_name"], academic_year, app.get("stream"))
    ledger_count = 0
    if cfg:
        admission_month = student_obj.admission_date[:7]
        ledger_count = await create_admission_ledger(
            student_dict, cfg, academic_year, admission_month
        )

    # Create / link parent user account
    parent_account = None
    if app.get("parent_email"):
        existing_parent = await db.users.find_one({"email": app["parent_email"]}, {"_id": 0})
        if not existing_parent:
            temp_password = secrets.token_urlsafe(8)
            parent_obj = UserBase(
                email=app["parent_email"],
                name=app.get("parent_name", f"Parent of {app['first_name']}"),
                role=UserRole.PARENT,
                phone=app.get("parent_phone"),
            )
            p_dict = parent_obj.model_dump()
            p_dict["password_hash"] = hash_password(temp_password)
            p_dict["created_at"] = p_dict["created_at"].isoformat()
            await db.users.insert_one(p_dict)
            await db.students.update_one(
                {"student_id": student_obj.student_id},
                {"$set": {"parent_id": parent_obj.user_id}}
            )
            parent_account = {
                "email": app["parent_email"],
                "temp_password": temp_password,
                "user_id": parent_obj.user_id,
            }
        else:
            await db.students.update_one(
                {"student_id": student_obj.student_id},
                {"$set": {"parent_id": existing_parent["user_id"]}}
            )

    # Create student login account with auto-generated password
    student_account = None
    student_email = app.get("email") or f"{student_obj.student_id.lower()}@student.shemford.in"
    existing_student_user = await db.users.find_one({"email": student_email}, {"_id": 0})
    if not existing_student_user:
        student_temp_password = secrets.token_urlsafe(8)
        student_user = UserBase(
            email=student_email,
            name=f"{app['first_name']} {app.get('last_name', '')}".strip(),
            role=UserRole.STUDENT,
            phone=app.get("phone"),
        )
        su_dict = student_user.model_dump()
        su_dict["password_hash"] = hash_password(student_temp_password)
        su_dict["created_at"] = su_dict["created_at"].isoformat()
        await db.users.insert_one(su_dict)
        await db.students.update_one(
            {"student_id": student_obj.student_id},
            {"$set": {"user_id": student_user.user_id, "email": student_email}}
        )
        student_account = {
            "email": student_email,
            "temp_password": student_temp_password,
            "user_id": student_user.user_id,
        }

    # Attach student_id to uploaded documents
    await db.student_documents.update_many(
        {"onboarding_id": onboarding_id},
        {"$set": {"student_id": student_obj.student_id}}
    )

    # Mark application completed
    await db.onboarding.update_one(
        {"onboarding_id": onboarding_id},
        {"$set": {
            "status": "completed",
            "student_id": student_obj.student_id,
            "admission_number": admission_number,
            "admin_override": admin_override,
            "completed_at": datetime.now(timezone.utc).isoformat(),
        }}
    )

    await create_audit_log("student", student_obj.student_id, "onboard", {
        "admission_number": admission_number,
        "class": app["class_name"],
        "section": app["section"],
        "stream": app.get("stream"),
        "academic_year": academic_year,
        "ledger_entries": ledger_count,
    }, user)

    return {
        "student": student_dict,
        "admission_number": admission_number,
        "student_id": student_obj.student_id,
        "academic_year": academic_year,
        "ledger_entries_created": ledger_count,
        "parent_account": parent_account,
        "student_account": student_account,
        "message": f"Student admitted successfully. Admission No: {admission_number}",
    }


# ─────────────────────────────────────────────────────────────────────────────
# List applications
# ─────────────────────────────────────────────────────────────────────────────

@router.get("/onboarding")
async def list_onboarding_applications(request: Request, status: Optional[str] = None):
    await require_roles(UserRole.ADMIN)(request)
    query = {}
    if status:
        query["status"] = status
    apps = await db.onboarding.find(query, {"_id": 0}).sort("created_at", -1).to_list(500)
    return apps


@router.get("/onboarding/{onboarding_id}")
async def get_onboarding_application(onboarding_id: str, request: Request):
    await require_roles(UserRole.ADMIN)(request)
    app = await db.onboarding.find_one({"onboarding_id": onboarding_id}, {"_id": 0})
    if not app:
        raise HTTPException(status_code=404, detail="Application not found")
    # Attach documents
    docs = await db.student_documents.find({"onboarding_id": onboarding_id}, {"_id": 0}).to_list(50)
    app["documents"] = docs
    return app


@router.get("/onboarding/draft/list")
async def list_draft_onboarding_applications(request: Request):
    """
    Get all draft onboarding applications (students not yet fully enrolled).
    These are student profiles that have been created but not completed onboarding.
    """
    await require_roles(UserRole.ADMIN)(request)
    apps = await db.onboarding.find(
        {"status": "draft"},
        {"_id": 0}
    ).sort("created_at", -1).to_list(500)
    
    # Enrich with document count
    for app in apps:
        doc_count = await db.student_documents.count_documents({"onboarding_id": app["onboarding_id"]})
        app["document_count"] = doc_count
    
    return {
        "total": len(apps),
        "draft_applications": apps
    }
