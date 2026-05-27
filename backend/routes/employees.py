from fastapi import APIRouter, HTTPException, Request, Response
from typing import Optional
from datetime import datetime, timezone
import secrets
import re
import logging

from database import db
from models import (
    UserRole, UserBase, EmployeeBase, EmployeeCreate
)
from auth_utils import (
    hash_password, require_roles, create_audit_log, get_current_user, session_window
)
from security import encrypt_bank_fields, decrypt_bank_fields, BANK_FIELDS, strip_pii_for_audit

router = APIRouter()
logger = logging.getLogger(__name__)

# IFSC: 4 capital letters + '0' + 6 alphanumeric characters
_IFSC_RE = re.compile(r'^[A-Z]{4}0[A-Z0-9]{6}$')
# Bank account: 8–18 digits
_ACCOUNT_RE = re.compile(r'^\d{8,18}$')


def _validate_bank_fields(account: Optional[str], ifsc: Optional[str], holder: Optional[str]):
    """Raise HTTPException if any mandatory bank field is missing or malformed."""
    if not account or not account.strip():
        raise HTTPException(status_code=400, detail="bank_account_number is required for payroll.")
    if not _ACCOUNT_RE.match(account.strip()):
        raise HTTPException(status_code=400, detail="bank_account_number must be 8–18 digits.")
    if not ifsc or not ifsc.strip():
        raise HTTPException(status_code=400, detail="bank_ifsc (IFSC code) is required for payroll.")
    if not _IFSC_RE.match(ifsc.strip().upper()):
        raise HTTPException(status_code=400, detail="Invalid IFSC code format. Expected: ABCD0123456.")
    if not holder or not holder.strip():
        raise HTTPException(status_code=400, detail="bank_account_holder (account holder name) is required for payroll.")


@router.post("/employees")
async def create_employee(employee: EmployeeCreate, request: Request):
    user = await require_roles(UserRole.ADMIN)(request)

    # Validate mandatory bank details (required for payroll disbursement)
    _validate_bank_fields(
        employee.bank_account_number,
        employee.bank_ifsc,
        employee.bank_account_holder,
    )

    # Normalize IFSC to uppercase
    if employee.bank_ifsc:
        employee = employee.model_copy(update={"bank_ifsc": employee.bank_ifsc.strip().upper()})

    # Ensure monthly_salary is set
    if employee.monthly_salary <= 0 and (not employee.salary or employee.salary <= 0):
        raise HTTPException(status_code=400, detail="monthly_salary must be greater than 0.")

    # Honor admin-supplied employee_id; otherwise EmployeeBase auto-generates one.
    create_payload = employee.model_dump()
    custom_id = (create_payload.get("employee_id") or "").strip()
    if custom_id:
        existing_with_id = await db.employees.find_one({"employee_id": custom_id}, {"_id": 0, "employee_id": 1})
        if existing_with_id:
            raise HTTPException(status_code=409, detail=f"Employee ID '{custom_id}' is already in use.")
        create_payload["employee_id"] = custom_id
    else:
        create_payload.pop("employee_id", None)  # let the model factory fire

    employee_obj = EmployeeBase(**create_payload)
    employee_dict = employee_obj.model_dump()
    employee_dict["created_at"] = employee_dict["created_at"].isoformat()

    # ===== EMPLOYEE-USER LINKING =====
    # Auto-create a user account for the employee so they can log in
    existing_user = await db.users.find_one({"email": employee.email}, {"_id": 0})
    if existing_user:
        # Link to existing user
        employee_dict["user_id"] = existing_user["user_id"]
    else:
        # Determine role from designation
        role = UserRole.TEACHER if employee.department.lower() in ["teaching", "academics", "faculty"] else UserRole.ACCOUNTANT if "account" in employee.designation.lower() or "finance" in employee.department.lower() else UserRole.TEACHER

        temp_password = secrets.token_urlsafe(8)
        user_obj = UserBase(
            email=employee.email,
            name=f"{employee.first_name} {employee.last_name}",
            role=role,
            phone=employee.phone
        )
        user_dict = user_obj.model_dump()
        user_dict["password_hash"] = hash_password(temp_password)
        user_dict["created_at"] = user_dict["created_at"].isoformat()
        await db.users.insert_one(user_dict)

        employee_dict["user_id"] = user_obj.user_id
        # Persist plaintext temp password on employee record so admin can view/share
        # later from the edit dialog — same UX choice as the students collection.
        employee_dict["temp_password"] = temp_password

    temp_pw = employee_dict.get("temp_password")

    # Encrypt PII bank fields before storage
    encrypt_bank_fields(employee_dict)

    await db.employees.insert_one(employee_dict)
    employee_dict.pop("_id", None)

    await create_audit_log("employee", employee_obj.employee_id, "create",
                          {"employee": strip_pii_for_audit(employee.model_dump())}, user)

    result = decrypt_bank_fields(employee_dict)
    if temp_pw:
        result["linked_account"] = {
            "email": employee.email,
            "temp_password": temp_pw,
            "message": "Login account auto-created. Share credentials securely."
        }

    return result


@router.get("/employees")
async def get_employees(
    request: Request,
    response: Response,
    department: Optional[str] = None,
    is_active: Optional[bool] = True,
    page: int = 1,
    limit: int = 30,
):
    await require_roles(UserRole.ADMIN, UserRole.ACCOUNTANT)(request)
    query = {}
    if department:
        query["department"] = department
    if is_active is not None:
        query["is_active"] = is_active

    # Active-period scoping: an employee belongs to the session if they joined on
    # or before the session ends AND hadn't left before it starts.
    win_start, win_end = await session_window(request)
    if win_start:
        query["joining_date"] = {"$lte": win_end}
        query["$or"] = [{"date_left": None}, {"date_left": {"$exists": False}}, {"date_left": {"$gte": win_start}}]

    import asyncio
    total, employees = await asyncio.gather(
        db.employees.count_documents(query),
        db.employees.find(query, {"_id": 0})
            .sort("first_name", 1)
            .skip((page - 1) * limit)
            .limit(limit)
            .to_list(limit),
    )
    pages = max(1, -(-total // limit))
    response.headers["X-Total-Count"] = str(total)
    response.headers["X-Total-Pages"] = str(pages)
    response.headers["X-Page"] = str(page)
    return [decrypt_bank_fields(e) for e in employees]


@router.get("/employees/departments")
async def list_employee_departments(request: Request):
    """List distinct active departments. Used by the announcement composer to scope announcements."""
    await require_roles(UserRole.ADMIN, UserRole.TEACHER, UserRole.ACCOUNTANT)(request)
    depts = await db.employees.distinct("department", {"is_active": True})
    return sorted([d for d in depts if d])


@router.post("/employees/{employee_id}/reset-password")
async def reset_employee_password(employee_id: str, request: Request):
    """
    Admin sets / regenerates the linked-user password for an employee.
    Body: {} → generate a random 10-char password.
          {"password": "..."} → set explicitly (min 6 chars).
    Mirrors the student reset-password endpoint so the EmployeesPage edit
    dialog can use the same UX.
    """
    import string
    await require_roles(UserRole.ADMIN)(request)
    body = await request.json()

    employee = await db.employees.find_one({"employee_id": employee_id}, {"_id": 0})
    if not employee:
        raise HTTPException(status_code=404, detail="Employee not found")

    new_password = body.get("password")
    if not new_password:
        alphabet = string.ascii_letters + string.digits
        new_password = "".join(secrets.choice(alphabet) for _ in range(10))

    if len(new_password) < 6:
        raise HTTPException(status_code=400, detail="Password must be at least 6 characters")

    # Resolve the linked users row; create one if missing (legacy employees
    # onboarded before auto-account creation).
    user_account = None
    if employee.get("user_id"):
        user_account = await db.users.find_one({"user_id": employee["user_id"]}, {"_id": 0})
    if not user_account and employee.get("email"):
        user_account = await db.users.find_one({"email": employee["email"]}, {"_id": 0})

    if not user_account:
        email = employee.get("email") or f"{employee_id.lower()}@employee.shemford.in"
        dept = (employee.get("department") or "").lower()
        designation = (employee.get("designation") or "").lower()
        if "account" in designation or "finance" in dept:
            role = UserRole.ACCOUNTANT
        else:
            role = UserRole.TEACHER
        new_user = UserBase(
            email=email,
            name=f"{employee.get('first_name','')} {employee.get('last_name','')}".strip() or email,
            role=role,
            phone=employee.get("phone"),
        )
        u_dict = new_user.model_dump()
        u_dict["password_hash"] = hash_password(new_password)
        u_dict["created_at"] = u_dict["created_at"].isoformat()
        await db.users.insert_one(u_dict)
        await db.employees.update_one(
            {"employee_id": employee_id},
            {"$set": {"user_id": new_user.user_id, "email": email, "temp_password": new_password}},
        )
        return {
            "message": "Employee account created and password set",
            "password": new_password,
            "email": email,
        }

    await db.users.update_one(
        {"user_id": user_account["user_id"]},
        {"$set": {"password_hash": hash_password(new_password)}},
    )
    await db.employees.update_one(
        {"employee_id": employee_id},
        {"$set": {"temp_password": new_password}},
    )
    return {
        "message": "Password reset successfully",
        "password": new_password,
        "email": employee.get("email"),
    }


@router.get("/employees/{employee_id}/password")
async def get_employee_password_hint(employee_id: str, request: Request):
    """Admin-only: returns the last-reset password stored on the employee
    record. Empty if never generated or wiped after a self-service change."""
    await require_roles(UserRole.ADMIN)(request)
    employee = await db.employees.find_one({"employee_id": employee_id}, {"_id": 0})
    if not employee:
        raise HTTPException(status_code=404, detail="Employee not found")
    return {
        "password": employee.get("temp_password") or None,
        "email": employee.get("email"),
        "has_account": bool(employee.get("user_id") or employee.get("email")),
    }


@router.get("/employees/me")
async def get_my_employee_record(request: Request):
    """Any logged-in user can fetch their own employee record (used by teachers for payroll)."""
    user = await get_current_user(request)
    employee = await db.employees.find_one(
        {"$or": [{"user_id": user["user_id"]}, {"email": user["email"]}]},
        {"_id": 0}
    )
    if not employee:
        raise HTTPException(status_code=404, detail="No employee record linked to your account")
    return decrypt_bank_fields(employee)


@router.get("/employees/me/payroll")
async def get_my_payroll(
    request: Request,
    year: Optional[int] = None,
    limit: int = 24,
):
    """Employee: returns their own payroll records directly (no employee_id needed)."""
    user = await get_current_user(request)
    if user["role"] not in (UserRole.TEACHER, UserRole.ACCOUNTANT):
        raise HTTPException(status_code=403, detail="Only employees can access this endpoint.")

    emp = await db.employees.find_one(
        {"$or": [{"user_id": user["user_id"]}, {"email": user["email"]}]},
        {"_id": 0, "employee_id": 1, "first_name": 1, "last_name": 1, "designation": 1, "monthly_salary": 1}
    )
    if not emp:
        raise HTTPException(status_code=404, detail="No employee record linked to your account.")

    query: dict = {"employee_id": emp["employee_id"]}
    if year:
        query["year"] = year

    records = await db.payroll.find(query, {"_id": 0}).sort(
        [("year", -1), ("month", -1)]
    ).limit(limit).to_list(limit)

    logger.info("Self-payroll accessed by employee %s (user=%s)", emp["employee_id"], user["user_id"])
    return {
        "employee": emp,
        "records": records,
        "total": len(records),
    }


@router.get("/employees/{employee_id}")
async def get_employee(employee_id: str, request: Request):
    await require_roles(UserRole.ADMIN, UserRole.ACCOUNTANT)(request)
    employee = await db.employees.find_one({"employee_id": employee_id}, {"_id": 0})
    if not employee:
        raise HTTPException(status_code=404, detail="Employee not found")
    return decrypt_bank_fields(employee)


@router.put("/employees/{employee_id}")
async def update_employee(employee_id: str, request: Request):
    user = await require_roles(UserRole.ADMIN)(request)
    body = await request.json()

    old_employee = await db.employees.find_one({"employee_id": employee_id}, {"_id": 0})
    if not old_employee:
        raise HTTPException(status_code=404, detail="Employee not found")

    # Allow admin to rename the Employee ID — validate uniqueness first.
    # If the new id matches the current one, just drop the field so we don't
    # trigger the no-op rename branch below.
    new_employee_id = (body.get("employee_id") or "").strip() or None
    if new_employee_id and new_employee_id != employee_id:
        clash = await db.employees.find_one(
            {"employee_id": new_employee_id}, {"_id": 0, "employee_id": 1}
        )
        if clash:
            raise HTTPException(
                status_code=409,
                detail=f"Employee ID '{new_employee_id}' is already in use."
            )
    elif "employee_id" in body:
        body.pop("employee_id", None)

    # STRICT: Cannot delete employees, only deactivate
    if "is_active" in body and not body["is_active"]:
        body["deactivated_at"] = datetime.now(timezone.utc).isoformat()

        # Also deactivate linked user account
        if old_employee.get("user_id"):
            await db.users.update_one(
                {"user_id": old_employee["user_id"]},
                {"$set": {"is_active": False}}
            )

    # Track changes for audit
    changes = {}
    for key, new_val in body.items():
        old_val = old_employee.get(key)
        if old_val != new_val:
            changes[key] = {"old": old_val, "new": new_val}

    # Email change — propagate to the linked users row so the employee can
    # still log in with the new address. Reject duplicates against other users.
    if "email" in body:
        new_email = (body.get("email") or "").strip().lower()
        body["email"] = new_email
        if new_email and new_email != (old_employee.get("email") or "").lower():
            existing_user_id = old_employee.get("user_id")
            clash = await db.users.find_one(
                {"email": new_email, "user_id": {"$ne": existing_user_id}},
                {"_id": 0, "user_id": 1},
            )
            if clash:
                raise HTTPException(
                    status_code=409,
                    detail=f"Email '{new_email}' is already used by another user account."
                )
            if existing_user_id:
                await db.users.update_one(
                    {"user_id": existing_user_id},
                    {"$set": {"email": new_email}},
                )

    # Validate and normalize bank fields if any are being updated
    if any(f in body for f in BANK_FIELDS):
        # Only validate the specific fields being changed (allow partial bank updates)
        new_account = body.get("bank_account_number")
        new_ifsc    = body.get("bank_ifsc")
        new_holder  = body.get("bank_account_holder")
        if new_account and not _ACCOUNT_RE.match(new_account.strip()):
            raise HTTPException(status_code=400, detail="bank_account_number must be 8–18 digits.")
        if new_ifsc:
            if not _IFSC_RE.match(new_ifsc.strip().upper()):
                raise HTTPException(status_code=400, detail="Invalid IFSC code format. Expected: ABCD0123456.")
            body["bank_ifsc"] = new_ifsc.strip().upper()
        encrypt_bank_fields(body)

    await db.employees.update_one({"employee_id": employee_id}, {"$set": body})

    # If the employee_id was renamed, look up by the new id; otherwise the original.
    lookup_id = new_employee_id if new_employee_id and new_employee_id != employee_id else employee_id
    updated = await db.employees.find_one({"employee_id": lookup_id}, {"_id": 0})

    if changes:
        await create_audit_log("employee", lookup_id, "update", changes, user)

    return decrypt_bank_fields(updated)



@router.post("/employees/{employee_id}/link-user")
async def link_employee_user(employee_id: str, request: Request):
    user = await require_roles(UserRole.ADMIN)(request)

    employee = await db.employees.find_one({"employee_id": employee_id}, {"_id": 0})
    if not employee:
        raise HTTPException(status_code=404, detail="Employee not found")

    if employee.get("user_id"):
        raise HTTPException(status_code=400, detail="Employee already has a linked user account")

    existing_user = await db.users.find_one({"email": employee["email"]}, {"_id": 0})
    if existing_user:
        await db.employees.update_one(
            {"employee_id": employee_id},
            {"$set": {"user_id": existing_user["user_id"]}}
        )
        await create_audit_log("employee", employee_id, "link-user", {"user_id": existing_user["user_id"]}, user)
        return {"message": "Linked to existing user", "user_id": existing_user["user_id"]}

    dept = employee.get("department", "").lower()
    desig = employee.get("designation", "").lower()
    role = UserRole.TEACHER if dept in ["teaching", "academics", "faculty"] else UserRole.ACCOUNTANT if "account" in desig or "finance" in dept else UserRole.TEACHER

    temp_password = secrets.token_urlsafe(8)
    user_obj = UserBase(
        email=employee["email"],
        name=f"{employee['first_name']} {employee['last_name']}",
        role=role,
        phone=employee.get("phone")
    )
    user_dict = user_obj.model_dump()
    user_dict["password_hash"] = hash_password(temp_password)
    user_dict["created_at"] = user_dict["created_at"].isoformat()
    await db.users.insert_one(user_dict)

    await db.employees.update_one(
        {"employee_id": employee_id},
        {"$set": {"user_id": user_obj.user_id, "temp_password": temp_password}}
    )

    await create_audit_log("employee", employee_id, "link-user", {"user_id": user_obj.user_id, "role": role}, user)

    return {
        "message": "User account created and linked",
        "user_id": user_obj.user_id,
        "email": employee["email"],
        "temp_password": temp_password,
        "role": role
    }


@router.delete("/employees/{employee_id}")
async def deactivate_employee(employee_id: str, request: Request):
    """Soft-delete an employee and revoke their login access. (#21)"""
    user = await require_roles(UserRole.ADMIN)(request)
    employee = await db.employees.find_one({"employee_id": employee_id}, {"_id": 0})
    if not employee:
        raise HTTPException(status_code=404, detail="Employee not found")
    if not employee.get("is_active", True):
        raise HTTPException(status_code=400, detail="Employee is already deactivated")

    now = datetime.now(timezone.utc).isoformat()
    await db.employees.update_one(
        {"employee_id": employee_id},
        {"$set": {"is_active": False, "deactivated_at": now}}
    )
    # Revoke user account access immediately
    if employee.get("user_id"):
        await db.users.update_one(
            {"user_id": employee["user_id"]},
            {"$set": {"is_active": False}}
        )

    await create_audit_log("employee", employee_id, "deactivate", {
        "name": f"{employee['first_name']} {employee['last_name']}"
    }, user)
    return {"message": f"Employee {employee['first_name']} {employee['last_name']} deactivated", "employee_id": employee_id}
