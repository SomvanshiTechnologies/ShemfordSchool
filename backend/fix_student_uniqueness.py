"""
Fix student uniqueness violations that block the unique indexes:
  - admission_number must be globally unique
  - (academic_year, class_name, section, stream, roll_number) must be unique

Root cause: the fee-demo seed inserted scenario students (admission SFS2026/*)
into existing class/section slots, colliding with real students' roll numbers,
and produced one duplicate admission number. These leftover collisions prevent
`admission_number_1` and `ay_class_section_stream_roll_uniq` from building.

Strategy — non-destructive, keeps every student:
  - Roll collisions: keep the student whose admission number is NOT a demo
    (SFS2026/*) one; renumber each other colliding student to the next free
    roll in its (year, class, section, stream). If all colliding are demo,
    keep the first and move the rest.
  - Duplicate admission numbers: keep the first; reassign the rest a fresh
    unique admission number (SFS2026/DUP-<n>).

Dry-run by default; pass --apply to write. After --apply it (re)builds the two
unique indexes to confirm the data is now clean.

Run: python fix_student_uniqueness.py            # preview
     python fix_student_uniqueness.py --apply     # write + build indexes
"""
import asyncio
import os
import sys
from pathlib import Path

from dotenv import load_dotenv
from motor.motor_asyncio import AsyncIOMotorClient
from pymongo import ASCENDING

load_dotenv(Path(__file__).parent / ".env")
client = AsyncIOMotorClient(os.environ["MONGO_URL"])
db = client[os.environ["DB_NAME"]]

DEMO_PREFIX = "SFS2026/"


def is_demo(adm):
    return (adm or "").startswith(DEMO_PREFIX)


async def _section_rolls(k):
    existing = set()
    async for s in db.students.find(
        {"academic_year": k["ay"], "class_name": k["c"], "section": k["sec"], "stream": k["st"]},
        {"_id": 0, "roll_number": 1},
    ):
        try:
            existing.add(int(s.get("roll_number")))
        except (TypeError, ValueError):
            pass
    return existing


async def fix_rolls(apply):
    pipe = [
        {"$match": {"roll_number": {"$ne": None}}},
        {"$group": {"_id": {"ay": "$academic_year", "c": "$class_name", "sec": "$section",
                             "st": "$stream", "r": "$roll_number"},
                    "n": {"$sum": 1}, "ids": {"$push": "$student_id"}}},
        {"$match": {"n": {"$gt": 1}}},
    ]
    groups = [g async for g in db.students.aggregate(pipe)]
    changes = 0
    for g in groups:
        k = g["_id"]
        docs = [await db.students.find_one(
            {"student_id": i},
            {"_id": 0, "student_id": 1, "admission_number": 1, "roll_number": 1, "first_name": 1, "last_name": 1},
        ) for i in g["ids"]]
        keep = [d for d in docs if not is_demo(d.get("admission_number"))]
        move = [d for d in docs if is_demo(d.get("admission_number"))]
        if not keep:                 # all demo — keep the first
            keep, move = [docs[0]], docs[1:]
        elif len(keep) > 1:          # >1 real students share a roll — keep first, move the rest
            move += keep[1:]

        existing = await _section_rolls(k)
        for d in move:
            nr = (max(existing) + 1) if existing else 1
            existing.add(nr)
            print(f"  roll: {k['ay']} {k['c']}-{k['sec']} | {d['student_id']} "
                  f"({d.get('first_name')} {d.get('last_name')}, adm={d.get('admission_number')}) "
                  f"roll {d.get('roll_number')} -> {nr}")
            changes += 1
            if apply:
                await db.students.update_one({"student_id": d["student_id"]},
                                             {"$set": {"roll_number": str(nr)}})
    return changes


async def fix_admissions(apply):
    pipe = [
        {"$match": {"admission_number": {"$ne": None}}},
        {"$group": {"_id": "$admission_number", "n": {"$sum": 1}, "ids": {"$push": "$student_id"}}},
        {"$match": {"n": {"$gt": 1}}},
    ]
    groups = [g async for g in db.students.aggregate(pipe)]
    changes = 0
    seq = 1
    for g in groups:
        for sid in g["ids"][1:]:     # keep the first, reassign the rest
            new_adm = f"SFS2026/DUP-{seq}"
            seq += 1
            while await db.students.find_one({"admission_number": new_adm}):
                new_adm = f"SFS2026/DUP-{seq}"
                seq += 1
            s = await db.students.find_one({"student_id": sid}, {"_id": 0, "first_name": 1, "last_name": 1})
            print(f"  adm: {g['_id']} | {sid} ({s.get('first_name')} {s.get('last_name')}) -> {new_adm}")
            changes += 1
            if apply:
                await db.students.update_one({"student_id": sid},
                                             {"$set": {"admission_number": new_adm}})
    return changes


async def build_indexes():
    out = {}
    try:
        await db.students.create_index([("admission_number", ASCENDING)],
                                       unique=True, sparse=True, background=True, name="admission_number_1")
        out["admission_number_1"] = "OK"
    except Exception as e:
        out["admission_number_1"] = f"FAIL: {e}"
    try:
        await db.students.create_index(
            [("academic_year", ASCENDING), ("class_name", ASCENDING), ("section", ASCENDING),
             ("stream", ASCENDING), ("roll_number", ASCENDING)],
            unique=True, sparse=True, background=True, name="ay_class_section_stream_roll_uniq")
        out["ay_class_section_stream_roll_uniq"] = "OK"
    except Exception as e:
        out["ay_class_section_stream_roll_uniq"] = f"FAIL: {e}"
    return out


async def main(apply):
    print(("APPLY" if apply else "DRY RUN") + " — student uniqueness fix\n")
    print("Duplicate admission numbers:")
    a = await fix_admissions(apply)
    print("Roll-number collisions:")
    r = await fix_rolls(apply)
    print(f"\nTotal changes: admissions={a}, rolls={r}")
    if apply:
        print("\nBuilding unique indexes:")
        for name, res in (await build_indexes()).items():
            print(f"  {name}: {res}")
    else:
        print("\nDRY RUN — re-run with --apply to write the changes and build the indexes.")
    client.close()


if __name__ == "__main__":
    asyncio.run(main("--apply" in sys.argv))
