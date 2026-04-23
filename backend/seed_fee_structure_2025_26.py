"""
Shemford Futuristic School — Fee Structure Seed Script (2025-2026)

Populates fee_component_configs for academic year 2025-2026 per the official
fee schedule. Run once after the database is initialised.

Usage:
    python seed_fee_structure_2025_26.py

NOTE: "SF.JR" does not currently exist as a class in the system.
      The SF.JR & SR rates have been applied to "SF. SR." only.
      Add "SF. JR." to SHEMFORD_CLASSES in models.py and re-run if needed.
"""

import asyncio
import uuid
from datetime import datetime, timezone

from database import db

ACADEMIC_YEAR = "2025-2026"

# ---------------------------------------------------------------------------
# Fee amounts per class group
# ---------------------------------------------------------------------------
# Fields common to every class
COMMON = {
    "registration_fee": 500,
    "admission_fee": 2500,
    "caution_deposit": 1000,
    "annual_charge": 3600,
    "upgradation_fee": 0,
    "due_day": 10,
    "late_fee": 0,
    "late_fee_enabled": False,
    "sibling_admission_discount_amount": 1000,
    "sibling_tuition_discount_amount": 300,
}

# class_name → class-specific overrides
CLASS_FEES = {
    # SF.JR & SR group — applied to "SF. SR." (SF.JR not yet in system)
    "SF. SR.": {
        "activity_fee":    1500,
        "exam_fee":         300,
        "lab_fee":            0,
        "ai_robotics_fee":    0,
        "monthly_tuition": 1000,
    },
    # LKG & UKG group
    "LKG": {
        "activity_fee":    2000,
        "exam_fee":         300,
        "lab_fee":            0,
        "ai_robotics_fee":    0,
        "monthly_tuition": 1100,
    },
    "UKG": {
        "activity_fee":    2000,
        "exam_fee":         300,
        "lab_fee":            0,
        "ai_robotics_fee":    0,
        "monthly_tuition": 1100,
    },
    # I & II group
    "1st": {
        "activity_fee":    2400,
        "exam_fee":         300,
        "lab_fee":         1500,
        "ai_robotics_fee":    0,
        "monthly_tuition": 1150,
    },
    "2nd": {
        "activity_fee":    2400,
        "exam_fee":         300,
        "lab_fee":         1500,
        "ai_robotics_fee":    0,
        "monthly_tuition": 1150,
    },
    # III & IV group
    "3rd": {
        "activity_fee":    2900,
        "exam_fee":         300,
        "lab_fee":         1500,
        "ai_robotics_fee":    0,
        "monthly_tuition": 1250,
    },
    "4th": {
        "activity_fee":    2900,
        "exam_fee":         300,
        "lab_fee":         1500,
        "ai_robotics_fee":    0,
        "monthly_tuition": 1250,
    },
    # V & VI group
    "5th": {
        "activity_fee":    3400,
        "exam_fee":         300,
        "lab_fee":         1500,
        "ai_robotics_fee":    0,
        "monthly_tuition": 1350,
    },
    "6th": {
        "activity_fee":    3400,
        "exam_fee":         300,
        "lab_fee":         1500,
        "ai_robotics_fee":    0,
        "monthly_tuition": 1350,
    },
    # VII & VIII group
    "7th": {
        "activity_fee":    3900,
        "exam_fee":         300,
        "lab_fee":         1500,
        "ai_robotics_fee":    0,
        "monthly_tuition": 1400,
    },
    "8th": {
        "activity_fee":    3900,
        "exam_fee":         300,
        "lab_fee":         1500,
        "ai_robotics_fee":    0,
        "monthly_tuition": 1400,
    },
    # IX & X group
    "9th": {
        "activity_fee":    4500,
        "exam_fee":         450,
        "lab_fee":         1500,
        "ai_robotics_fee": 2400,
        "monthly_tuition": 1900,
    },
    "10th": {
        "activity_fee":    4500,
        "exam_fee":         450,
        "lab_fee":         1500,
        "ai_robotics_fee": 2400,
        "monthly_tuition": 1900,
    },
}

# ---------------------------------------------------------------------------
# Expected TOTAL ADMISSION totals (one-time + yearly + 1st month tuition)
# Used only for verification printout — not stored.
# ---------------------------------------------------------------------------
EXPECTED_TOTALS = {
    "SF. SR.": 10400,
    "LKG":     11000,
    "UKG":     11000,
    "1st":     12950,
    "2nd":     12950,
    "3rd":     13550,
    "4th":     13550,
    "5th":     14150,
    "6th":     14150,
    "7th":     14700,
    "8th":     14700,
    "9th":     18350,
    "10th":    18350,
}


def _total_admission(cfg: dict) -> float:
    return sum([
        cfg["registration_fee"],
        cfg["admission_fee"],
        cfg["caution_deposit"],
        cfg["annual_charge"],
        cfg["activity_fee"],
        cfg["exam_fee"],
        cfg["lab_fee"],
        cfg["ai_robotics_fee"],
        cfg["monthly_tuition"],  # 1st month
    ])


async def seed():
    now = datetime.now(timezone.utc).isoformat()
    inserted = 0
    errors = []

    for class_name, overrides in CLASS_FEES.items():
        cfg = {**COMMON, **overrides}

        # Verify total matches expected
        total = _total_admission(cfg)
        expected = EXPECTED_TOTALS.get(class_name)
        if expected and total != expected:
            errors.append(
                f"  MISMATCH {class_name}: computed ₹{total}, expected ₹{expected}"
            )

        # Deactivate any existing config for this class + year
        await db.fee_component_configs.update_many(
            {"class_name": class_name, "stream": None, "academic_year": ACADEMIC_YEAR},
            {"$set": {"is_active": False}},
        )

        doc = {
            "config_id": f"fcc_{uuid.uuid4().hex[:10]}",
            "class_name": class_name,
            "stream": None,
            "academic_year": ACADEMIC_YEAR,
            **cfg,
            "is_active": True,
            "notes": "Seeded from official fee schedule 2025-26",
            "created_by": "seed_script",
            "created_at": now,
            "updated_at": None,
        }
        await db.fee_component_configs.insert_one(doc)
        inserted += 1
        total_str = f"₹{int(total):,}"
        print(f"  [{class_name}] tuition=₹{cfg['monthly_tuition']}/mo  "
              f"activity=₹{cfg['activity_fee']}  "
              f"ai_robotics=₹{cfg['ai_robotics_fee']}  "
              f"total_admission={total_str}")

    print(f"\nDone. Inserted {inserted} fee configs for {ACADEMIC_YEAR}.")
    if errors:
        print("\nWARNINGS:")
        for e in errors:
            print(e)
    else:
        print("All admission totals verified successfully.")


if __name__ == "__main__":
    asyncio.run(seed())
