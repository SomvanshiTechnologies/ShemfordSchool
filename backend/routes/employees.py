from fastapi import APIRouter, HTTPException, Request
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
    hash_password, require_roles, create_audit_log, get_current_user
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

    employee_obj = EmployeeBase(**employee.model_dump())
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
        employee_dict["_temp_password"] = temp_password

    # (#17) Pop temp password BEFORE inserting into DB so it's never stored
    temp_pw = employee_dict.pop("_temp_password", None)

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
    department: Optional[str] = None,
    is_active: Optional[bool] = True
):
    await require_roles(UserRole.ADMIN, UserRole.ACCOUNTANT)(request)
    query = {}
    if department:
        query["department"] = department
    if is_active is not None:
        query["is_active"] = is_active

    employees = await db.employees.find(query, {"_id": 0}).to_list(500)
    return [decrypt_bank_fields(e) for e in employees]


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
    updated = await db.employees.find_one({"employee_id": employee_id}, {"_id": 0})

    if changes:
        await create_audit_log("employee", employee_id, "update", changes, user)

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
        {"$set": {"user_id": user_obj.user_id}}
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
