"""E-Learning is its own monthly fee component: config -> admission breakdown -> ledger.

Runs against a throwaway database on the local Mongo (dropped afterwards), never the app's DB.
"""
import asyncio
import os
import sys
import uuid

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))
os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
os.environ.setdefault("DB_NAME", "test_db")

from motor.motor_asyncio import AsyncIOMotorClient  # noqa: E402

from models import FEE_COMPONENT_FREQUENCY, FeeComponentConfig  # noqa: E402
from routes import fees  # noqa: E402

YEAR = "2027-2028"
CFG = {"class_name": "3rd", "registration_fee": 500, "monthly_tuition": 1250, "e_learning_fee": 100,
       "annual_charge": 4000, "due_day": 10, "sibling_tuition_discount_amount": 50}


def test_model_and_frequency():
    assert FeeComponentConfig(class_name="3rd", academic_year=YEAR, e_learning_fee=100).e_learning_fee == 100
    assert FEE_COMPONENT_FREQUENCY["e_learning"] == "monthly"
    assert fees.CFG_FIELD_TO_COMPONENT["e_learning_fee"] == "e_learning"


def test_admission_breakdown_has_first_month_e_learning():
    items = {i["fee_component"]: i for i in fees.build_admission_fee_breakdown(CFG, is_sibling=True)}
    assert items["e_learning"]["net_amount"] == 100          # no sibling discount on e-learning
    assert items["tuition"]["net_amount"] == 1200            # sibling discount only on tuition
    assert fees.build_admission_fee_breakdown({**CFG, "e_learning_fee": 0}, False).__len__() == len(items) - 1


def test_admission_ledger_creates_monthly_e_learning(monkeypatch):
    async def scenario():
        client = AsyncIOMotorClient(os.environ["MONGO_URL"], serverSelectionTimeoutMS=2000)
        name = f"e_learning_test_{uuid.uuid4().hex[:8]}"
        tmp_db = client[name]
        monkeypatch.setattr(fees, "db", tmp_db)
        try:
            student = {"student_id": "stu_x", "admission_number": "A1", "class_name": "3rd", "is_sibling": False}
            created = await fees.create_admission_ledger(student, CFG, YEAR, "2027-04")
            rows = await tmp_db.student_ledger.find({"student_id": "stu_x"}, {"_id": 0}).to_list(100)
            el = [r for r in rows if r["fee_component"] == "e_learning"]
            tu = [r for r in rows if r["fee_component"] == "tuition"]
            assert len(el) == len(tu) == 12
            assert {r["month"] for r in el} == {r["month"] for r in tu}
            assert all(r["gross_amount"] == r["net_amount"] == 100 and r["fee_type"] == "monthly" for r in el)
            assert created == len(rows)
            # re-running must not duplicate
            assert await fees.create_admission_ledger(student, CFG, YEAR, "2027-04") == 0
        finally:
            await client.drop_database(name)
            client.close()

    asyncio.run(scenario())
