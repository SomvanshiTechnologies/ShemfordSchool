"""Accountant role rules.

Accountant may: view/edit student details, run admissions, run upgradations, collect fees.
Accountant may NOT: back-date a payment, or grant any discount (concession, sibling flag, sibling discount amounts).
Admins keep every ability.

The handlers are called directly with a stand-in for require_roles that enforces the same role list the real
dependency would, so no server, token or database is needed.
"""
import inspect
import os
import re
import sys
from datetime import datetime, timedelta

import pytest
from fastapi import HTTPException

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))
os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
os.environ.setdefault("DB_NAME", "test_db")

from models import UserRole  # noqa: E402
from routes import fees, onboarding, students, upgradation  # noqa: E402


class FakeRequest:
    def __init__(self, body=None):
        self._body = body or {}
        self.headers, self.cookies, self.query_params = {}, {}, {}

    async def json(self):
        return self._body


def as_role(monkeypatch, module, role):
    """Make require_roles / get_current_user in `module` behave as a logged-in user with `role`."""
    user = {"user_id": f"u_{role}", "role": role, "email": f"{role}@test.local", "name": role}

    def factory(*allowed):
        async def dep(request):
            if role not in allowed:
                raise HTTPException(status_code=403, detail="Access denied")
            return user
        return dep

    async def current(request):
        return user

    monkeypatch.setattr(module, "require_roles", factory)
    if hasattr(module, "get_current_user"):
        monkeypatch.setattr(module, "get_current_user", current)


class _Coll:
    def __init__(self, doc=None):
        self.doc = doc
        self.updates = []

    async def find_one(self, *a, **k):
        return dict(self.doc) if self.doc else None

    async def update_one(self, flt, upd, **k):
        self.updates.append(upd)

    async def count_documents(self, *a, **k):
        return 0


class _Db:
    def __init__(self, student=None):
        self.students = _Coll(student)
        self.class_structures = _Coll({"name": "5th", "sections": [{"section_name": "Blue", "capacity": 40}]})


def role_args(handler):
    """The roles passed to require_roles(...) inside a handler's source."""
    m = re.search(r"require_roles\(([^)]*)\)", inspect.getsource(handler))
    return {a.strip().replace("UserRole.", "") for a in m.group(1).split(",")}


# ───────────────────────────────── role lists ─────────────────────────────────

@pytest.mark.parametrize("handler", [
    students.update_student,                       # edit student details
    onboarding.start_onboarding, onboarding.complete_onboarding,
    onboarding.list_onboarding_applications, onboarding.get_onboarding_application,
    onboarding.list_draft_onboarding_applications, onboarding.get_required_documents,   # admission screens
    upgradation.request_upgrade, upgradation.create_upgrade_fee_entry,                  # upgradation
])
def test_accountant_has_the_permissions_they_need(handler):
    assert "ACCOUNTANT" in role_args(handler) and "ADMIN" in role_args(handler)


def test_accountant_cannot_apply_concessions():
    assert role_args(fees.apply_concession) == {"ADMIN"}


def test_upgradation_approval_stays_with_admin():
    for h in (upgradation.approve_upgrade, upgradation.reject_upgrade):
        assert role_args(h) == {"ADMIN"}


# ───────────────────────────────── no discounts ─────────────────────────────────

@pytest.mark.anyio
async def test_concession_refused_for_accountant_but_reaches_logic_for_admin(monkeypatch):
    monkeypatch.setattr(fees, "db", _Db(student=None))
    body = {"student_id": "stu_1", "concession_percent": 10}
    as_role(monkeypatch, fees, UserRole.ACCOUNTANT)
    with pytest.raises(HTTPException) as e:
        await fees.apply_concession(FakeRequest(body))
    assert e.value.status_code == 403
    as_role(monkeypatch, fees, UserRole.ADMIN)
    with pytest.raises(HTTPException) as e:
        await fees.apply_concession(FakeRequest(body))
    assert e.value.status_code == 404            # got past the role check (student simply not found)


@pytest.mark.anyio
async def test_accountant_cannot_set_sibling_discount_amounts_in_fee_config(monkeypatch):
    as_role(monkeypatch, fees, UserRole.ACCOUNTANT)
    for field in ("sibling_admission_discount_amount", "sibling_tuition_discount_amount"):
        with pytest.raises(HTTPException) as e:
            await fees.create_fee_component_config(FakeRequest({"class_name": "5th", field: 500}))
        assert e.value.status_code == 403 and "admin" in e.value.detail.lower()


@pytest.mark.anyio
async def test_accountant_cannot_change_existing_sibling_discount_but_can_edit_other_fees(monkeypatch):
    class Cfg(_Coll):
        async def find_one(self, *a, **k):
            return {"config_id": "c1", "class_name": "5th", "academic_year": "2026-2027",
                    "sibling_admission_discount_amount": 1000, "sibling_tuition_discount_amount": 300}

    db = _Db()
    db.fee_component_configs = Cfg()
    monkeypatch.setattr(fees, "db", db)
    as_role(monkeypatch, fees, UserRole.ACCOUNTANT)
    with pytest.raises(HTTPException) as e:        # changing the discount: refused
        await fees.update_fee_component_config("c1", FakeRequest({"sibling_tuition_discount_amount": 999}))
    assert e.value.status_code == 403
    # echoing the unchanged discount value while editing a fee is not a discount change: must not be a 403
    try:
        await fees.update_fee_component_config("c1", FakeRequest(
            {"monthly_tuition": 1200, "sibling_tuition_discount_amount": 300, "sibling_admission_discount_amount": 1000}))
    except HTTPException as exc:
        assert exc.status_code != 403, exc.detail
    except Exception:
        pass                                        # later steps need the full database; the role rule is what is under test


@pytest.mark.anyio
async def test_accountant_cannot_flag_a_student_as_sibling_in_admission(monkeypatch):
    as_role(monkeypatch, onboarding, UserRole.ACCOUNTANT)
    for body in ({"is_sibling": True}, {"sibling_student_id": "stu_9"}):
        with pytest.raises(HTTPException) as e:
            await onboarding.start_onboarding(FakeRequest(body))
        assert e.value.status_code == 403 and "sibling" in e.value.detail.lower()


@pytest.mark.anyio
async def test_accountant_cannot_edit_discount_or_access_fields_on_a_student(monkeypatch):
    old = {"student_id": "stu_1", "class_name": "5th", "section": "Blue", "academic_year": "2026-2027",
           "is_active": True, "is_sibling": False, "first_name": "Aarav"}

    async def writable(year):
        return None

    monkeypatch.setattr(students, "db", _Db(old))
    monkeypatch.setattr("routes.fees.ensure_session_writable", writable)
    as_role(monkeypatch, students, UserRole.ACCOUNTANT)
    for field, value in (("is_sibling", True), ("is_active", False), ("fee_status", "paid"), ("user_id", "x")):
        with pytest.raises(HTTPException) as e:
            await students.update_student("stu_1", FakeRequest({field: value}))
        assert e.value.status_code == 403, field
    # an ordinary detail edit is allowed (reaches the database update)
    db = _Db(old)
    monkeypatch.setattr(students, "db", db)
    await students.update_student("stu_1", FakeRequest({"first_name": "Aarav K", "is_sibling": False}))
    assert db.students.updates and db.students.updates[0]["$set"]["first_name"] == "Aarav K"


@pytest.mark.anyio
async def test_admin_may_still_set_the_sibling_flag_when_editing_a_student(monkeypatch):
    old = {"student_id": "stu_1", "class_name": "5th", "section": "Blue", "academic_year": "2026-2027",
           "is_active": True, "is_sibling": False}

    async def writable(year):
        return None

    db = _Db(old)
    monkeypatch.setattr(students, "db", db)
    monkeypatch.setattr("routes.fees.ensure_session_writable", writable)
    as_role(monkeypatch, students, UserRole.ADMIN)
    await students.update_student("stu_1", FakeRequest({"is_sibling": True}))
    assert db.students.updates[0]["$set"] == {"is_sibling": True}


# ───────────────────────────────── upgradation ─────────────────────────────────

@pytest.mark.anyio
async def test_accountant_cannot_force_an_upgrade_or_override_capacity(monkeypatch):
    as_role(monkeypatch, upgradation, UserRole.ACCOUNTANT)
    for flag in ("force_upgrade", "admin_override"):
        with pytest.raises(HTTPException) as e:
            await upgradation.request_upgrade("stu_1", FakeRequest({"to_class": "6th", "to_section": "Blue", flag: True}))
        assert e.value.status_code == 403


@pytest.mark.anyio
async def test_accountant_can_start_an_upgrade(monkeypatch):
    monkeypatch.setattr(upgradation, "db", _Db({"student_id": "stu_1", "class_name": "5th"}))
    as_role(monkeypatch, upgradation, UserRole.ACCOUNTANT)
    with pytest.raises(HTTPException) as e:        # no to_class: passes the role gate, fails validation
        await upgradation.request_upgrade("stu_1", FakeRequest({}))
    assert e.value.status_code == 400 and "to_class" in e.value.detail


# ───────────────────────────────── no back-dating ─────────────────────────────────

class _Stop(Exception):
    pass


def _today():
    return datetime.now().strftime("%Y-%m-%d")


@pytest.mark.anyio
async def test_accountant_cannot_back_date_a_fee_payment(monkeypatch):
    monkeypatch.setattr(fees, "db", _Db({"student_id": "stu_1"}))

    async def stop(*a, **k):
        raise _Stop()

    monkeypatch.setattr(fees, "refresh_overdue_for_student", stop)     # first step after the date rule
    as_role(monkeypatch, fees, UserRole.ACCOUNTANT)
    yesterday = (datetime.now() - timedelta(days=3)).strftime("%Y-%m-%d")
    with pytest.raises(HTTPException) as e:
        await fees.pay_fee(FakeRequest({"student_id": "stu_1", "payment_date": yesterday}))
    assert e.value.status_code == 403 and "back-dated" in e.value.detail.lower()
    # today's date (what the collect dialog sends by default) and no date at all are fine
    for body in ({"student_id": "stu_1", "payment_date": _today()}, {"student_id": "stu_1"}):
        with pytest.raises(_Stop):
            await fees.pay_fee(FakeRequest(body))


@pytest.mark.anyio
async def test_admin_can_still_back_date(monkeypatch):
    monkeypatch.setattr(fees, "db", _Db({"student_id": "stu_1"}))

    async def stop(*a, **k):
        raise _Stop()

    monkeypatch.setattr(fees, "refresh_overdue_for_student", stop)
    as_role(monkeypatch, fees, UserRole.ADMIN)
    old = (datetime.now() - timedelta(days=30)).strftime("%Y-%m-%d")
    with pytest.raises(_Stop):                      # not refused: reaches the payment logic
        await fees.pay_fee(FakeRequest({"student_id": "stu_1", "payment_date": old}))
