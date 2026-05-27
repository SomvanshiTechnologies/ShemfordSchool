"""
seed_payroll_prior.py — make staff & payroll session-aware for the demo.

1. Spreads employee `joining_date` across years (2021-2025) so each session
   shows a different roster (active-period scoping in GET /employees).
2. Generates monthly payroll (Apr-Mar) for the two prior sessions, only for
   employees employed that month, marked PAID — so each session's Payroll has
   realistic, distinct data.

Idempotent. Usage (from backend/):
  MONGO_URL="mongodb://localhost:27017/?directConnection=true" .venv/Scripts/python.exe seed_payroll_prior.py
"""
import os
import asyncio
from datetime import datetime, timezone

from dotenv import load_dotenv
from motor.motor_asyncio import AsyncIOMotorClient
from pymongo import UpdateOne

load_dotenv()
db = AsyncIOMotorClient(os.environ["MONGO_URL"])[os.environ["DB_NAME"]]

from routes.payroll import calculate_payroll          # noqa: E402
from models import PayrollRecord, PayrollStatus        # noqa: E402

# Academic-year months: Apr..Mar (month, calendar-year-offset from start year)
AY_MONTHS = [(m, 0) for m in range(4, 13)] + [(m, 1) for m in range(1, 4)]
PRIOR = {"2025-2026": 2025, "2024-2025": 2024, "2023-2024": 2023}


async def vary_joining_dates():
    emps = await db.employees.find({}, {"_id": 0, "employee_id": 1, "monthly_salary": 1, "salary": 1}).to_list(500)
    years = [2021, 2022, 2023, 2024, 2025]
    ops = []
    for i, e in enumerate(emps):
        yr = years[i % len(years)]
        ops.append(UpdateOne({"employee_id": e["employee_id"]},
                             {"$set": {"joining_date": f"{yr}-06-01"}}))
    if ops:
        await db.employees.bulk_write(ops, ordered=False)
    print(f"Spread joining dates across {years} for {len(ops)} employees")


async def seed_payroll(ay: str, sy: int, generated_by="seed"):
    emps = await db.employees.find({"is_active": True}, {"_id": 0}).to_list(500)
    total = 0
    for month, off in AY_MONTHS:
        year = sy + off
        month_year = f"{year}-{month:02d}"
        month_end = f"{year}-{month:02d}-28"
        ops = []
        for emp in emps:
            jd = emp.get("joining_date") or "2000-01-01"
            left = emp.get("date_left")
            # Employed this month?
            if jd > month_end:
                continue
            if left and left < f"{year}-{month:02d}-01":
                continue
            calc = calculate_payroll(emp, month, year)
            rec = PayrollRecord(
                employee_id=emp["employee_id"], month=month, year=year, month_year=month_year,
                generated_by=generated_by, status=PayrollStatus.PAID,
                paid_at=datetime.now(timezone.utc).isoformat(),
                bank_account_number=emp.get("bank_account_number"),
                bank_ifsc=emp.get("bank_ifsc"), bank_name=emp.get("bank_name"),
                **calc,
            )
            d = rec.model_dump()
            d["created_at"] = d["created_at"].isoformat()
            d["updated_at"] = d["updated_at"].isoformat()
            d.pop("payroll_id", None)  # let upsert key on (employee_id, month_year)
            ops.append(UpdateOne({"employee_id": emp["employee_id"], "month_year": month_year},
                                 {"$setOnInsert": {"payroll_id": rec.payroll_id}, "$set": d}, upsert=True))
        if ops:
            await db.payroll.bulk_write(ops, ordered=False)
            total += len(ops)
    print(f"[{ay}] {total} payroll records upserted across {len(AY_MONTHS)} months")


async def main():
    await vary_joining_dates()
    for ay, sy in PRIOR.items():
        await seed_payroll(ay, sy)
    print("Done.")


if __name__ == "__main__":
    asyncio.run(main())
