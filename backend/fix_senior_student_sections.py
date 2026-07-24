"""
Migrate 11th/12th student records so their SECTION is the stream
(Science / Humanities) instead of a colour section. Applies to every
academic year / session.

Background: seniors were seeded with a colour section (Violet, Indigo, ...)
plus a separate `stream` field. The school's model is that for 11th/12th the
section IS the stream, so lists showing the raw section field wrongly display
colours. This aligns the data with routes/classes.py (which already treats the
stream as the section for these classes).

What it does, per academic_year + class (11th/12th):
  1. Students with stream science/humanities  -> section = "Science"/"Humanities".
  2. Roll numbers are unique on
     (academic_year, class_name, section, stream, roll_number). Collapsing many
     colour sections into one stream section collides rolls, so rolls are
     renumbered sequentially within each (year, class, new-section), ordered by
     the existing (roll_number, admission_number) for a stable result.
  3. Students whose stream is NOT science/humanities (corrupt rows where stream
     holds a colour) are SKIPPED and reported — they need manual placement.

Idempotent: re-running once sections are already Science/Humanities is a no-op
(rolls stay stable because ordering is deterministic).

DRY RUN by default. Pass --apply to write changes.

Run: python fix_senior_student_sections.py            # preview
     python fix_senior_student_sections.py --apply    # write
"""
import asyncio
import os
import sys
from pathlib import Path

from dotenv import load_dotenv
from motor.motor_asyncio import AsyncIOMotorClient

load_dotenv(Path(__file__).parent / ".env")
client = AsyncIOMotorClient(os.environ["MONGO_URL"])
db = client[os.environ["DB_NAME"]]

SENIOR = ["11th", "12th"]
STREAM_TO_SECTION = {"science": "Science", "humanities": "Humanities"}


def target_section(stream):
    return STREAM_TO_SECTION.get((stream or "").strip().lower())


async def main(apply: bool):
    students = await db.students.find(
        {"class_name": {"$in": SENIOR}},
        {"_id": 0, "student_id": 1, "academic_year": 1, "class_name": 1,
         "section": 1, "stream": 1, "roll_number": 1, "admission_number": 1,
         "is_active": 1},
    ).to_list(100000)

    # Bucket by (year, class, new-section) so we can renumber rolls within each.
    buckets = {}
    skipped = []
    for s in students:
        sec = target_section(s.get("stream"))
        if not sec:
            skipped.append(s)
            continue
        key = (s.get("academic_year", ""), s["class_name"], sec)
        buckets.setdefault(key, []).append(s)

    updates = 0          # docs whose section or roll actually changes
    section_changes = 0  # docs whose section value changes
    for (ay, cls, sec), group in sorted(buckets.items()):
        # Deterministic order: existing roll (numeric if possible), then admission no.
        def sort_key(s):
            r = s.get("roll_number")
            try:
                rn = int(r)
            except (TypeError, ValueError):
                rn = 10**9
            return (rn, str(s.get("admission_number") or ""))

        group.sort(key=sort_key)
        for i, s in enumerate(group, start=1):
            new_roll = str(i)
            cur_sec = s.get("section")
            cur_roll = str(s.get("roll_number") or "")
            if cur_sec != sec:
                section_changes += 1
            if cur_sec != sec or cur_roll != new_roll:
                updates += 1
                if apply:
                    await db.students.update_one(
                        {"student_id": s["student_id"]},
                        {"$set": {"section": sec, "roll_number": new_roll}},
                    )

    # Report
    print(f"{'APPLIED' if apply else 'DRY RUN'} — senior student section migration")
    print(f"  senior students scanned : {len(students)}")
    print(f"  section value changes   : {section_changes}")
    print(f"  docs updated (sec+roll) : {updates}")
    print(f"  new section buckets     : {len(buckets)}")
    for (ay, cls, sec), group in sorted(buckets.items()):
        print(f"    {ay}  {cls}  {sec}: {len(group)} students (rolls 1..{len(group)})")
    if skipped:
        print(f"  SKIPPED (stream not science/humanities) — place manually: {len(skipped)}")
        for s in skipped:
            print(f"    {s.get('academic_year')} {s['class_name']} "
                  f"section={s.get('section')} stream={s.get('stream')} "
                  f"adm={s.get('admission_number')} id={s['student_id']}")
    if not apply:
        print("\n  This was a DRY RUN. Re-run with --apply to write changes.")
    client.close()


if __name__ == "__main__":
    asyncio.run(main("--apply" in sys.argv))
