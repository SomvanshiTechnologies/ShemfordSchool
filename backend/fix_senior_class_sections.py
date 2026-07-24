"""
Fix 11th/12th class structures: for stream classes the sections must be the
streams themselves (Science / Humanities), not the 7 rainbow colour sections.
Older seeds created senior classes with colour sections, which the Edit Class
dialog then displayed. Applies to every academic year / session.

Idempotent — safe to re-run. Preserves capacity / class-teacher of any
existing section whose name already matches a stream.

Run: python fix_senior_class_sections.py
"""
import asyncio
import os
from pathlib import Path

from dotenv import load_dotenv
from motor.motor_asyncio import AsyncIOMotorClient

load_dotenv(Path(__file__).parent / ".env")
client = AsyncIOMotorClient(os.environ["MONGO_URL"])
db = client[os.environ["DB_NAME"]]

SENIOR_STREAMS = ["Science", "Humanities"]


def stream_sections_from(streams, existing):
    """Mirror of routes/classes.py:_stream_sections_from."""
    by_name = {(s.get("section_name") or "").strip().lower(): s for s in (existing or [])}
    out = []
    for st in streams:
        prev = by_name.get(st.strip().lower(), {})
        out.append({
            "section_name": st,
            "capacity": prev.get("capacity", 45),
            "class_teacher_id": prev.get("class_teacher_id"),
            "class_teacher_name": prev.get("class_teacher_name"),
        })
    return out


async def main():
    fixed = 0
    async for cls in db.class_structures.find(
        {"has_streams": True},
        {"_id": 0, "class_id": 1, "name": 1, "academic_year": 1, "sections": 1},
    ):
        existing = cls.get("sections", [])
        names = [(s.get("section_name") or "").strip().lower() for s in existing]
        if names == [s.lower() for s in SENIOR_STREAMS]:
            continue  # already correct
        new_sections = stream_sections_from(SENIOR_STREAMS, existing)
        await db.class_structures.update_one(
            {"class_id": cls["class_id"]}, {"$set": {"sections": new_sections}}
        )
        print(f"  fixed {cls['name']} ({cls.get('academic_year', '?')}): "
              f"{[s.get('section_name') for s in existing]} -> "
              f"{[s['section_name'] for s in new_sections]}")
        fixed += 1
    print(f"Done. {fixed} class structure(s) updated.")
    client.close()


if __name__ == "__main__":
    asyncio.run(main())
