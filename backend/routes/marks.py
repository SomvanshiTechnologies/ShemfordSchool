"""
CBSE-Style Marks & Exam System.
- Admin defines exams (with subjects and max marks)
- Teacher enters marks per student per subject
- Teacher can edit until "Final Submit" → locks
- Admin can unlock
- CBSE grading: A1-E
- Marksheet generation
"""
from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import StreamingResponse
from typing import Optional
from datetime import datetime, timezone
import io
import logging

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import inch
from reportlab.platypus import SimpleDocTemplate, Table, TableStyle, Paragraph, Spacer
from reportlab.lib.enums import TA_CENTER

from database import db
from models import UserRole, ExamDefinition, MarkRecord
from auth_utils import get_current_user, require_roles, calculate_grade, create_audit_log, get_teacher_assigned_classes, request_session, ensure_active_session

router = APIRouter()
logger = logging.getLogger(__name__)


# ==================== EXAM DEFINITIONS ====================

@router.post("/exams")
async def create_exam(request: Request):
    """Admin defines an exam with subjects and max marks."""
    user = await require_roles(UserRole.ADMIN)(request)
    await ensure_active_session(request)  # previous sessions are read-only
    body = await request.json()

    # The exam (and therefore its marks) belongs to the session the admin is
    # operating in — the session header is authoritative over the body.
    from routes.fees import active_session
    body["academic_year"] = request_session(request) or body.get("academic_year") or await active_session()
    exam = ExamDefinition(**body, created_by=user["user_id"])
    exam_dict = exam.model_dump()
    exam_dict["created_at"] = exam_dict["created_at"].isoformat()

    await db.exam_definitions.insert_one(exam_dict)
    exam_dict.pop("_id", None)

    await create_audit_log("exam", exam.exam_id, "create", {
        "name": exam.name, "class": exam.class_name
    }, user)
    return exam_dict


@router.get("/exams")
async def get_exams(
    request: Request,
    class_name: Optional[str] = None,
    academic_year: Optional[str] = None
):
    """Get exam definitions. Teachers see all, parents/students see published only."""
    user = await get_current_user(request)
    query = {}
    if class_name:
        query["class_name"] = class_name
    if academic_year:
        query["academic_year"] = academic_year

    if user["role"] in [UserRole.STUDENT, UserRole.PARENT]:
        query["is_published"] = True

    exams = await db.exam_definitions.find(query, {"_id": 0}).sort("created_at", -1).to_list(100)
    return exams


@router.put("/exams/{exam_id}")
async def update_exam(exam_id: str, request: Request):
    """Admin updates exam definition."""
    user = await require_roles(UserRole.ADMIN)(request)
    body = await request.json()

    exam = await db.exam_definitions.find_one({"exam_id": exam_id}, {"_id": 0})
    if not exam:
        raise HTTPException(status_code=404, detail="Exam not found")

    body.pop("exam_id", None)
    body.pop("created_at", None)

    await db.exam_definitions.update_one({"exam_id": exam_id}, {"$set": body})
    updated = await db.exam_definitions.find_one({"exam_id": exam_id}, {"_id": 0})
    return updated


@router.post("/exams/{exam_id}/publish")
async def publish_exam(exam_id: str, request: Request):
    """Publish exam results — makes marks visible to parents/students."""
    user = await require_roles(UserRole.ADMIN)(request)

    exam = await db.exam_definitions.find_one({"exam_id": exam_id}, {"_id": 0})
    if not exam:
        raise HTTPException(status_code=404, detail="Exam not found")

    await db.exam_definitions.update_one({"exam_id": exam_id}, {"$set": {"is_published": True}})
    await create_audit_log("exam", exam_id, "publish", {"name": exam["name"]}, user)
    return {"message": f"Exam '{exam['name']}' results published"}


@router.post("/exams/{exam_id}/lock")
async def lock_exam(exam_id: str, request: Request):
    """Lock exam — no more marks editing."""
    user = await require_roles(UserRole.ADMIN)(request)

    await db.exam_definitions.update_one({"exam_id": exam_id}, {"$set": {"is_locked": True}})
    await db.mark_records.update_many({"exam_id": exam_id}, {"$set": {"is_locked": True}})

    await create_audit_log("exam", exam_id, "lock", {}, user)
    return {"message": "Exam locked. No further edits allowed."}


@router.post("/exams/{exam_id}/unlock")
async def unlock_exam(exam_id: str, request: Request):
    """Admin-only: unlock exam for re-editing."""
    user = await require_roles(UserRole.ADMIN)(request)

    await db.exam_definitions.update_one({"exam_id": exam_id}, {"$set": {"is_locked": False}})
    await db.mark_records.update_many({"exam_id": exam_id}, {"$set": {"is_locked": False}})

    await create_audit_log("exam", exam_id, "unlock", {}, user)
    return {"message": "Exam unlocked for editing"}


@router.put("/marks/{mark_id}/unlock")
async def unlock_single_mark(mark_id: str, request: Request):
    """Admin-only: unlock a single mark record for correction. (#22)"""
    user = await require_roles(UserRole.ADMIN)(request)
    mark = await db.mark_records.find_one({"mark_id": mark_id}, {"_id": 0, "mark_id": 1, "student_id": 1, "subject": 1})
    if not mark:
        raise HTTPException(status_code=404, detail="Mark record not found")
    await db.mark_records.update_one({"mark_id": mark_id}, {"$set": {"is_locked": False}})
    await create_audit_log("mark", mark_id, "unlock_single", {
        "student_id": mark["student_id"], "subject": mark["subject"]
    }, user)
    return {"message": f"Mark {mark_id} unlocked for editing"}


# ==================== MARKS ENTRY ====================

@router.post("/marks")
async def add_marks(request: Request):
    """Teacher enters marks. Must reference an exam. Can't edit if exam is locked."""
    user = await require_roles(UserRole.ADMIN, UserRole.TEACHER)(request)
    body = await request.json()

    exam_id = body.get("exam_id")
    records = body.get("records", [])

    if not exam_id:
        raise HTTPException(status_code=400, detail="exam_id is required")

    exam = await db.exam_definitions.find_one({"exam_id": exam_id}, {"_id": 0})
    if not exam:
        raise HTTPException(status_code=404, detail="Exam not found")

    if exam.get("is_locked"):
        raise HTTPException(status_code=400, detail="This exam is locked. Contact admin to unlock.")

    # Archive protection — no marks entry in an archived session.
    from routes.fees import ensure_session_writable
    await ensure_session_writable(exam.get("academic_year"))

    # Teachers can only enter marks for their assigned class
    if user["role"] == UserRole.TEACHER:
        assigned = await get_teacher_assigned_classes(user["user_id"])
        if assigned:
            allowed_classes = [a["class_name"] for a in assigned]
            if exam.get("class_name") not in allowed_classes:
                raise HTTPException(status_code=403, detail="You are not assigned to this class")

    # Build subject max marks map from exam definition
    subject_max = {}
    for s in exam.get("subjects", []):
        subject_max[s["subject"]] = float(s["max_marks"])

    results = {"success": 0, "failed": 0, "errors": []}

    for idx, record in enumerate(records):
        try:
            subject = record.get("subject", "")
            marks_obtained = float(record.get("marks_obtained", 0))

            # (#2) Subject must be in exam definition when subjects are defined
            if subject_max and subject not in subject_max:
                raise ValueError(f"Subject '{subject}' is not defined in this exam")
            max_marks = subject_max.get(subject) or float(record.get("max_marks", 0))
            if max_marks <= 0:
                raise ValueError(f"Invalid max marks for {subject}")
            if marks_obtained < 0:
                raise ValueError("Marks cannot be negative")
            if marks_obtained > max_marks:
                raise ValueError(f"Marks ({marks_obtained}) exceed max ({max_marks})")

            percentage = (marks_obtained / max_marks) * 100
            grade = calculate_grade(percentage)

            mark = MarkRecord(
                student_id=record["student_id"],
                exam_id=exam_id,
                class_name=exam["class_name"],
                section=record.get("section", ""),
                subject=subject,
                exam_type=exam["exam_type"],
                term=exam.get("name", ""),
                academic_year=exam["academic_year"],
                marks_obtained=marks_obtained,
                max_marks=max_marks,
                grade=grade,
                entered_by=user["user_id"]
            )
            # (#12) Prevent overwriting a locked individual mark record
            existing_mark = await db.mark_records.find_one(
                {"student_id": mark.student_id, "exam_id": exam_id, "subject": subject, "is_locked": True},
                {"_id": 0, "mark_id": 1}
            )
            if existing_mark:
                raise ValueError(f"Mark for student {mark.student_id} / {subject} is locked. Use the unlock endpoint first.")

            mark_dict = mark.model_dump()
            mark_dict["created_at"] = mark_dict["created_at"].isoformat()

            await db.mark_records.update_one(
                {
                    "student_id": mark.student_id,
                    "exam_id": exam_id,
                    "subject": subject
                },
                {"$set": mark_dict},
                upsert=True
            )
            results["success"] += 1
        except (ValueError, KeyError) as e:
            results["failed"] += 1
            results["errors"].append({"row": idx + 1, "error": str(e)})
        except Exception as e:
            results["failed"] += 1
            results["errors"].append({"row": idx + 1, "error": str(e)})

    return results


@router.get("/marks")
async def get_marks(
    request: Request,
    student_id: Optional[str] = None,
    exam_id: Optional[str] = None,
    class_name: Optional[str] = None,
    section: Optional[str] = None,
    subject: Optional[str] = None,
    academic_year: Optional[str] = None
):
    """Get marks. Parent/Student see only published exam marks."""
    user = await get_current_user(request)
    query = {}

    if user["role"] == UserRole.STUDENT:
        student = await db.students.find_one({"user_id": user["user_id"]}, {"_id": 0, "student_id": 1})
        if student:
            query["student_id"] = student["student_id"]
        else:
            return []
        # Only show published exams
        published_exams = await db.exam_definitions.find({"is_published": True}, {"_id": 0, "exam_id": 1}).to_list(100)
        query["exam_id"] = {"$in": [e["exam_id"] for e in published_exams]}

    elif user["role"] == UserRole.PARENT:
        children = await db.students.find(
            {"$or": [{"parent_email": user.get("email", "")}, {"parent_id": user["user_id"]}], "is_active": True},
            {"_id": 0, "student_id": 1}
        ).to_list(20)
        child_ids = [c["student_id"] for c in children]
        if student_id and student_id in child_ids:
            query["student_id"] = student_id
        else:
            query["student_id"] = {"$in": child_ids}
        published_exams = await db.exam_definitions.find({"is_published": True}, {"_id": 0, "exam_id": 1}).to_list(100)
        query["exam_id"] = {"$in": [e["exam_id"] for e in published_exams]}

    elif user["role"] == UserRole.TEACHER:
        assigned = await get_teacher_assigned_classes(user["user_id"])
        if assigned:
            query["class_name"] = {"$in": [a["class_name"] for a in assigned]}
        if student_id:
            query["student_id"] = student_id
    else:
        if student_id:
            query["student_id"] = student_id

    if exam_id:
        query["exam_id"] = exam_id
    if class_name:
        query["class_name"] = class_name
    if section:
        query["section"] = section
    if subject:
        query["subject"] = subject
    if academic_year:
        query["academic_year"] = academic_year

    marks = await db.mark_records.find(query, {"_id": 0}).to_list(5000)
    return marks


@router.get("/marks/marksheet/{student_id}")
async def get_marksheet(student_id: str, request: Request, exam_id: Optional[str] = None, academic_year: Optional[str] = None):
    """Get structured marksheet for a student."""
    user = await get_current_user(request)

    # RBAC
    if user["role"] == UserRole.PARENT:
        children = await db.students.find(
            {"$or": [{"parent_email": user.get("email", "")}, {"parent_id": user["user_id"]}], "is_active": True},
            {"_id": 0, "student_id": 1}
        ).to_list(20)
        if student_id not in [c["student_id"] for c in children]:
            raise HTTPException(status_code=403, detail="Not authorized")
    elif user["role"] == UserRole.STUDENT:
        student_rec = await db.students.find_one({"user_id": user["user_id"]}, {"_id": 0, "student_id": 1})
        if not student_rec or student_rec["student_id"] != student_id:
            raise HTTPException(status_code=403, detail="Not authorized")

    student = await db.students.find_one({"student_id": student_id}, {"_id": 0})
    if not student:
        raise HTTPException(status_code=404, detail="Student not found")

    query: dict = {"student_id": student_id}
    if academic_year:
        query["academic_year"] = academic_year
    if exam_id:
        query["exam_id"] = exam_id

    marks = await db.mark_records.find(query, {"_id": 0}).to_list(100)

    subjects = {}
    for m in marks:
        subj = m["subject"]
        if subj not in subjects:
            subjects[subj] = []
        subjects[subj].append(m)

    total_obtained = sum(m["marks_obtained"] for m in marks)
    total_max = sum(m["max_marks"] for m in marks)
    overall_percentage = (total_obtained / total_max * 100) if total_max > 0 else 0
    overall_grade = calculate_grade(overall_percentage)

    return {
        "student": student,
        "academic_year": academic_year,
        "exam_id": exam_id,
        "subjects": subjects,
        "summary": {
            "total_obtained": total_obtained,
            "total_max": total_max,
            "percentage": round(overall_percentage, 2),
            "grade": overall_grade,
            "result": "PASS" if overall_percentage >= 33 else "FAIL"
        }
    }


@router.get("/marks/marksheet/{student_id}/pdf")
async def download_marksheet_pdf(student_id: str, request: Request, exam_id: Optional[str] = None, academic_year: Optional[str] = None):
    """Download PDF marksheet."""
    await get_current_user(request)

    student = await db.students.find_one({"student_id": student_id}, {"_id": 0})
    if not student:
        raise HTTPException(status_code=404, detail="Student not found")

    query: dict = {"student_id": student_id}
    if academic_year:
        query["academic_year"] = academic_year
    if exam_id:
        query["exam_id"] = exam_id

    marks = await db.mark_records.find(query, {"_id": 0}).to_list(500)

    def fmt_num(v: float) -> str:
        """Show integer marks without decimals, fractional marks to 2 dp."""
        return str(int(v)) if v == int(v) else f"{v:.2f}"

    buffer = io.BytesIO()
    PAGE_W = A4[0] - inch          # usable width (0.5in margin each side)
    doc = SimpleDocTemplate(
        buffer, pagesize=A4,
        topMargin=0.5*inch, bottomMargin=0.5*inch,
        leftMargin=0.5*inch, rightMargin=0.5*inch,
    )
    elements = []
    styles = getSampleStyleSheet()

    title_style    = ParagraphStyle('Title', parent=styles['Heading1'], fontSize=18,
                                    alignment=TA_CENTER, textColor=colors.HexColor('#E88A1A'),
                                    spaceAfter=4)
    subtitle_style = ParagraphStyle('Sub',   parent=styles['Normal'],   fontSize=10,
                                    alignment=TA_CENTER, textColor=colors.HexColor('#64748B'),
                                    spaceAfter=2)
    heading_style  = ParagraphStyle('Head',  parent=styles['Heading2'], fontSize=13,
                                    alignment=TA_CENTER, textColor=colors.HexColor('#1E293B'),
                                    spaceAfter=2)

    elements.append(Paragraph("SHEMFORD FUTURISTIC SCHOOL", title_style))
    elements.append(Paragraph("Katwa, West Bengal | CBSE Affiliated", subtitle_style))
    elements.append(Spacer(1, 6))
    elements.append(Paragraph("PROGRESS REPORT", heading_style))
    elements.append(Paragraph(f"Academic Year: {academic_year or 'All'}", subtitle_style))
    elements.append(Spacer(1, 14))

    # ── Student info table ────────────────────────────────────────────────────
    info_data = [
        ["Student Name", f"{student['first_name']} {student['last_name']}",
         "Admission No.", student['admission_number']],
        ["Class", f"{student['class_name']} - {student['section']}",
         "Roll No.", student.get('roll_number', '-')],
    ]
    cw = PAGE_W / 7
    info_table = Table(info_data, colWidths=[1.8*cw, 2.2*cw, 1.5*cw, 1.5*cw])
    info_table.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (0, -1), colors.HexColor('#F1F5F9')),
        ('BACKGROUND', (2, 0), (2, -1), colors.HexColor('#F1F5F9')),
        ('FONTNAME',   (0, 0), (-1, -1), 'Helvetica-Bold'),
        ('FONTNAME',   (1, 0), (1, -1),  'Helvetica'),
        ('FONTNAME',   (3, 0), (3, -1),  'Helvetica'),
        ('FONTSIZE',   (0, 0), (-1, -1), 10),
        ('GRID',       (0, 0), (-1, -1), 0.5, colors.HexColor('#CBD5E1')),
        ('PADDING',    (0, 0), (-1, -1), 7),
        ('VALIGN',     (0, 0), (-1, -1), 'MIDDLE'),
    ]))
    elements.append(info_table)
    elements.append(Spacer(1, 16))

    # ── Marks table ───────────────────────────────────────────────────────────
    marks_data = [["Subject", "Marks\nObtained", "Max\nMarks", "Percentage", "Grade"]]
    total_obtained = 0.0
    total_max      = 0.0

    subject_totals: dict = {}
    for m in marks:
        s = m["subject"]
        if s not in subject_totals:
            subject_totals[s] = {"obtained": 0.0, "max": 0.0}
        subject_totals[s]["obtained"] += float(m["marks_obtained"])
        subject_totals[s]["max"]      += float(m["max_marks"])

    for subject, totals in subject_totals.items():
        obt = totals["obtained"]
        mx  = totals["max"]
        pct = (obt / mx * 100) if mx > 0 else 0.0
        marks_data.append([subject, fmt_num(obt), fmt_num(mx), f"{pct:.2f}%", calculate_grade(pct)])
        total_obtained += obt
        total_max      += mx

    if total_max > 0:
        overall_pct   = (total_obtained / total_max) * 100
        overall_grade = calculate_grade(overall_pct)
        marks_data.append(["TOTAL", fmt_num(total_obtained), fmt_num(total_max),
                            f"{overall_pct:.2f}%", overall_grade])

    # Column widths: Subject gets most space, numbers share the rest
    sub_w = PAGE_W * 0.38
    num_w = (PAGE_W - sub_w) / 4
    marks_table = Table(marks_data, colWidths=[sub_w, num_w, num_w, num_w, num_w])
    n_rows = len(marks_data)
    marks_table.setStyle(TableStyle([
        # Header row
        ('BACKGROUND',  (0, 0),        (-1, 0),        colors.HexColor('#1E293B')),
        ('TEXTCOLOR',   (0, 0),        (-1, 0),        colors.white),
        ('FONTNAME',    (0, 0),        (-1, 0),        'Helvetica-Bold'),
        ('FONTSIZE',    (0, 0),        (-1, 0),        9),
        ('ALIGN',       (0, 0),        (-1, 0),        'CENTER'),
        ('VALIGN',      (0, 0),        (-1, 0),        'MIDDLE'),
        # Data rows
        ('FONTNAME',    (0, 1),        (-1, -1),       'Helvetica'),
        ('FONTSIZE',    (0, 1),        (-1, -1),       10),
        ('ALIGN',       (1, 1),        (-1, -1),       'CENTER'),
        ('VALIGN',      (0, 1),        (-1, -1),       'MIDDLE'),
        # Alternating row shading
        *[('BACKGROUND', (0, r), (-1, r), colors.HexColor('#F8FAFC'))
          for r in range(2, n_rows - 1, 2)],
        # Total row
        ('BACKGROUND',  (0, -1),       (-1, -1),       colors.HexColor('#F1F5F9')),
        ('FONTNAME',    (0, -1),       (-1, -1),       'Helvetica-Bold'),
        # Grid
        ('GRID',        (0, 0),        (-1, -1),       0.5, colors.HexColor('#CBD5E1')),
        ('PADDING',     (0, 0),        (-1, -1),       7),
    ]))
    elements.append(marks_table)
    elements.append(Spacer(1, 20))

    # ── Summary row ───────────────────────────────────────────────────────────
    result      = "PASS" if total_max > 0 and (total_obtained / total_max * 100) >= 33 else "FAIL"
    result_color = colors.HexColor('#16A34A') if result == "PASS" else colors.HexColor('#DC2626')
    overall_pct  = (total_obtained / total_max * 100) if total_max > 0 else 0.0
    overall_grade = calculate_grade(overall_pct)

    summary_data = [
        ["Total Marks", "Percentage", "Grade", "Result"],
        [f"{fmt_num(total_obtained)} / {fmt_num(total_max)}",
         f"{overall_pct:.2f}%", overall_grade, result],
    ]
    summary_table = Table(summary_data, colWidths=[PAGE_W / 4] * 4)
    summary_table.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, 0),  colors.HexColor('#F1F5F9')),
        ('FONTNAME',   (0, 0), (-1, 0),  'Helvetica-Bold'),
        ('FONTSIZE',   (0, 0), (-1, -1), 10),
        ('ALIGN',      (0, 0), (-1, -1), 'CENTER'),
        ('VALIGN',     (0, 0), (-1, -1), 'MIDDLE'),
        ('FONTNAME',   (0, 1), (-1, 1),  'Helvetica-Bold'),
        ('TEXTCOLOR',  (3, 1), (3, 1),   result_color),
        ('GRID',       (0, 0), (-1, -1), 0.5, colors.HexColor('#CBD5E1')),
        ('PADDING',    (0, 0), (-1, -1), 8),
    ]))
    elements.append(summary_table)
    elements.append(Spacer(1, 36))

    # ── Signature line ────────────────────────────────────────────────────────
    sig_data  = [["Class Teacher", "Principal", "Parent / Guardian"]]
    sig_table = Table(sig_data, colWidths=[PAGE_W / 3] * 3)
    sig_table.setStyle(TableStyle([
        ('ALIGN',       (0, 0), (-1, -1), 'CENTER'),
        ('FONTNAME',    (0, 0), (-1, -1), 'Helvetica'),
        ('FONTSIZE',    (0, 0), (-1, -1), 10),
        ('TOPPADDING',  (0, 0), (-1, -1), 36),
        ('LINEABOVE',   (0, 0), (-1, 0),  0.5, colors.HexColor('#94A3B8')),
    ]))
    elements.append(sig_table)

    doc.build(elements)
    buffer.seek(0)
    filename = f"marksheet_{student['admission_number']}_{academic_year}.pdf"
    return StreamingResponse(buffer, media_type="application/pdf",
                             headers={"Content-Disposition": f"attachment; filename={filename}"})
