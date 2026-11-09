from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import StreamingResponse
from typing import Optional
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo
import asyncio
import hashlib
import hmac
import html
import io
import json
import logging
import os
import re

import httpx
from pymongo.errors import DuplicateKeyError

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4, letter
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import inch, cm
from reportlab.platypus import SimpleDocTemplate, Table, TableStyle, Paragraph, Spacer
from reportlab.lib.enums import TA_CENTER, TA_LEFT
import openpyxl
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side

from database import db
from models import UserRole
from job_queue import enqueue_job, register_handler
from auth_utils import (
    get_current_user, require_roles, calculate_grade, create_audit_log,
    get_teacher_assigned_classes, request_session, enforce_session_scope,
)

router = APIRouter()
logger = logging.getLogger(__name__)


async def _noop():
    """Awaitable placeholder so optional ops can sit in an asyncio.gather()."""
    return None


# ==================== DASHBOARD ====================

@router.get("/reports/dashboard")
async def get_dashboard_stats(request: Request, academic_year: Optional[str] = None):
    import asyncio as _asyncio
    user = await get_current_user(request)
    # Fall back to the X-Academic-Year header so callers that don't pass the
    # query param (e.g. mobile dashboard) still get session-scoped figures.
    # Non-admins are pinned to the active session (admin_all_sessions preserves
    # the admin default of "no year → current-month figures" branch below).
    academic_year = await enforce_session_scope(user, request, academic_year, admin_all_sessions=True)
    stats = {}

    if user["role"] in [UserRole.ADMIN, UserRole.ACCOUNTANT]:
        # Session scoping: when an academic_year is selected, student & fee
        # figures reflect that session only. Employees/issues are global.
        stu_q = {"is_active": True}
        if academic_year:
            stu_q["academic_year"] = academic_year

        # The month/session collection aggregation pipeline depends only on the
        # selected academic_year, so it can run alongside the counts.
        if academic_year:
            coll_pipeline = [
                {"$match": {"academic_year": academic_year}},
                {"$group": {"_id": None, "total": {"$sum": "$amount"}}},
            ]
        else:
            current_month = datetime.now().strftime("%Y-%m")
            coll_pipeline = [
                {"$match": {"payment_date": {"$regex": f"^{current_month}"}}},
                {"$group": {"_id": None, "total": {"$sum": "$amount"}}},
            ]

        # Round-trip 1: every count/lookup that has no dependency on another runs
        # concurrently (mirrors the /reports/financial pattern). This collapses
        # ~6 serial Mongo round-trips into one.
        (
            total_students, total_employees, fee_overdue_count, open_issues,
            active, coll_agg,
        ) = await _asyncio.gather(
            db.students.count_documents(stu_q),
            db.employees.count_documents({"is_active": True}),
            db.students.count_documents({**stu_q, "fee_status": "overdue"}),
            db.issues.count_documents({"status": "open"}),
            db.sessions.find_one({"is_active": True}, {"_id": 0, "session_name": 1})
            if academic_year else _noop(),
            db.fee_payments.aggregate(coll_pipeline).to_list(1),
        )
        stats["total_students"] = total_students
        stats["total_employees"] = total_employees
        stats["fee_overdue_count"] = fee_overdue_count
        stats["open_issues"] = open_issues
        stats["month_collection"] = coll_agg[0]["total"] if coll_agg else 0

        # "Today's present" must reflect the selected session, not the live
        # clock — otherwise every session shows the same number. Use real today
        # for the active session (whose window extends to today); for a past
        # session there is no "today", so anchor to its last day.
        today = datetime.now().strftime("%Y-%m-%d")
        ref_date = today
        if academic_year:
            active_ay = active.get("session_name") if active else None
            try:
                sy = int(academic_year.split("-")[0])
                s_start, s_end = f"{sy}-04-01", f"{sy + 1}-03-31"
                if academic_year == active_ay:
                    ref_date = today if today >= s_start else s_start
                else:
                    ref_date = today if s_start <= today <= s_end else s_end
            except (ValueError, IndexError):
                ref_date = today
        # Round-trip 2: this single count depends on ref_date (derived above).
        stats["today_present"] = await db.attendance.count_documents({
            "entity_type": "student", "date": ref_date, "status": "present"
        })

    if user["role"] == UserRole.TEACHER:
        today = datetime.now().strftime("%Y-%m-%d")
        teacher_attendance, today_marked = await _asyncio.gather(
            db.attendance.find(
                {"marked_by": user["user_id"]}, {"_id": 0, "class_name": 1, "section": 1}
            ).to_list(10000),
            db.attendance.count_documents({"marked_by": user["user_id"], "date": today}),
        )
        unique_classes = set()
        for a in teacher_attendance:
            if a.get("class_name") and a.get("section"):
                unique_classes.add(f"{a['class_name']}-{a['section']}")
        stats["assigned_classes"] = len(unique_classes)
        stats["pending_attendance"] = max(len(unique_classes) - (1 if today_marked > 0 else 0), 0)
        stats["pending_marks_entry"] = 0

    if user["role"] == UserRole.STUDENT:
        student = await db.students.find_one({"user_id": user["user_id"]}, {"_id": 0})
        if student:
            stats["fee_status"] = student["fee_status"]
            stats["app_locked"] = student.get("app_locked", False)
            stats["class_name"] = student.get("class_name", "")
            stats["section"] = student.get("section", "")
            stats["roll_number"] = student.get("roll_number", "")
            stats["admission_number"] = student.get("admission_number", "")
            stats["stream"] = student.get("stream", "")
            attendance = await db.attendance.find({
                "entity_type": "student", "entity_id": student["student_id"]
            }, {"_id": 0}).to_list(1000)
            if attendance:
                present = sum(1 for a in attendance if a["status"] == "present")
                stats["attendance_percentage"] = round(present / len(attendance) * 100, 1)
            else:
                stats["attendance_percentage"] = 0

    if user["role"] == UserRole.PARENT:
        children = await db.students.find(
            {"$or": [{"parent_email": user.get("email", "")}, {"parent_id": user["user_id"]}], "is_active": True},
            {"_id": 0}
        ).to_list(10)
        stats["children_count"] = len(children)
        stats["children"] = children
        # Check if any child is app_locked
        stats["app_locked"] = any(c.get("app_locked", False) for c in children)

    return stats


# ==================== FINANCIAL REPORT ====================

@router.get("/reports/financial")
async def get_financial_report(request: Request, start_date: Optional[str] = None, end_date: Optional[str] = None, academic_year: Optional[str] = None):
    user = await require_roles(UserRole.ADMIN, UserRole.ACCOUNTANT)(request)
    academic_year = await enforce_session_scope(user, request, academic_year, admin_all_sessions=True)
    import asyncio as _asyncio

    # Scope every figure to the selected session so each academic year shows
    # only its own collection/pending totals (not the same global numbers).
    match = {}
    if academic_year:
        match["academic_year"] = academic_year
    if start_date and end_date:
        match["payment_date"] = {"$gte": start_date, "$lte": end_date}

    pending_match = {"status": {"$in": ["pending", "overdue"]}}
    if academic_year:
        pending_match["academic_year"] = academic_year

    # All aggregations run in parallel — no full collection scan needed
    total_agg, method_agg, month_agg, pending_agg, count = await _asyncio.gather(
        db.fee_payments.aggregate([
            {"$match": match},
            {"$group": {"_id": None, "total": {"$sum": "$amount"}}}
        ]).to_list(1),
        db.fee_payments.aggregate([
            {"$match": match},
            {"$group": {"_id": "$payment_method", "total": {"$sum": "$amount"}}}
        ]).to_list(20),
        db.fee_payments.aggregate([
            {"$match": match},
            {"$group": {"_id": {"$substr": ["$payment_date", 0, 7]}, "total": {"$sum": "$amount"}}},
            {"$sort": {"_id": 1}},
        ]).to_list(36),
        db.student_ledger.aggregate([
            {"$match": pending_match},
            {"$group": {"_id": None, "total": {"$sum": "$net_amount"}}}
        ]).to_list(1),
        db.fee_payments.count_documents(match),
    )

    return {
        "total_collection": total_agg[0]["total"] if total_agg else 0,
        "total_pending": pending_agg[0]["total"] if pending_agg else 0,
        "by_payment_method": {r["_id"] or "unknown": r["total"] for r in method_agg},
        "by_month": {r["_id"]: r["total"] for r in month_agg if r["_id"]},
        "transaction_count": count,
    }


@router.get("/reports/financial/export")
async def export_financial_report(request: Request, format: str = "pdf", start_date: Optional[str] = None, end_date: Optional[str] = None, academic_year: Optional[str] = None):
    user = await require_roles(UserRole.ADMIN, UserRole.ACCOUNTANT)(request)
    academic_year = await enforce_session_scope(user, request, academic_year, admin_all_sessions=True)

    query = {}
    if academic_year:
        query["academic_year"] = academic_year
    if start_date and end_date:
        query["payment_date"] = {"$gte": start_date, "$lte": end_date}

    pending_match = {"status": {"$in": ["pending", "overdue"]}}
    if academic_year:
        pending_match["academic_year"] = academic_year

    import asyncio as _asyncio
    payments, total_agg, pending_agg = await _asyncio.gather(
        db.fee_payments.find(query, {"_id": 0}).sort("payment_date", -1).limit(2000).to_list(2000),
        db.fee_payments.aggregate([
            {"$match": query},
            {"$group": {"_id": None, "total": {"$sum": "$amount"}}}
        ]).to_list(1),
        db.student_ledger.aggregate([
            {"$match": pending_match},
            {"$group": {"_id": None, "total": {"$sum": "$net_amount"}}}
        ]).to_list(1),
    )
    total_collection = total_agg[0]["total"] if total_agg else 0
    total_pending = pending_agg[0]["total"] if pending_agg else 0

    if format == "excel":
        return _financial_excel(payments, total_collection, total_pending)
    else:
        return _financial_pdf(payments, total_collection, total_pending)


def _financial_pdf(payments, total_collection, total_pending):
    buffer = io.BytesIO()
    doc = SimpleDocTemplate(buffer, pagesize=A4, topMargin=1*cm, bottomMargin=1*cm)
    styles = getSampleStyleSheet()
    title_style = ParagraphStyle('Title', parent=styles['Heading1'], fontSize=18, alignment=TA_CENTER, spaceAfter=20)
    elements = []

    elements.append(Paragraph("Shemford Futuristic School", title_style))
    elements.append(Paragraph("Financial Report", ParagraphStyle('Sub', parent=styles['Heading2'], alignment=TA_CENTER, spaceAfter=20)))
    elements.append(Paragraph(f"Generated: {datetime.now().strftime('%d %b %Y, %I:%M %p')}", styles['Normal']))
    elements.append(Spacer(1, 12))

    # Summary
    summary_data = [
        ['Metric', 'Value'],
        ['Total Collection', f'Rs.{total_collection:,.2f}'],
        ['Total Pending', f'Rs.{total_pending:,.2f}'],
        ['Transactions', str(len(payments))],
    ]
    t = Table(summary_data, colWidths=[200, 200])
    t.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor('#E88A1A')),
        ('TEXTCOLOR', (0, 0), (-1, 0), colors.white),
        ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
        ('GRID', (0, 0), (-1, -1), 0.5, colors.grey),
        ('ALIGN', (1, 0), (1, -1), 'RIGHT'),
    ]))
    elements.append(t)
    elements.append(Spacer(1, 20))

    # Payment Details
    if payments:
        elements.append(Paragraph("Payment Details", styles['Heading3']))
        elements.append(Spacer(1, 8))
        table_data = [['Receipt', 'Student ID', 'Amount', 'Method', 'Month', 'Date']]
        for p in payments[:100]:
            pd_str = p.get('payment_date', '') or ''
            month_str = pd_str[:7] if len(pd_str) >= 7 else '-'
            date_str = (f"{pd_str[8:10]}/{pd_str[5:7]}/{pd_str[0:4]}"
                        if len(pd_str) >= 10 else pd_str or '-')
            raw_method = p.get('payment_method', '') or ''
            method_str = raw_method.replace('_', ' ').title() if raw_method else '-'
            table_data.append([
                p.get('receipt_number', '-')[:15],
                p.get('student_id', '-')[:15],
                f'Rs.{p["amount"]:,.0f}',
                method_str,
                month_str,
                date_str,
            ])
        t2 = Table(table_data, colWidths=[80, 85, 65, 80, 50, 65])
        t2.setStyle(TableStyle([
            ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor('#333333')),
            ('TEXTCOLOR', (0, 0), (-1, 0), colors.white),
            ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
            ('FONTSIZE', (0, 0), (-1, -1), 7),
            ('GRID', (0, 0), (-1, -1), 0.5, colors.grey),
            ('ROWBACKGROUNDS', (0, 1), (-1, -1), [colors.white, colors.HexColor('#f5f5f5')]),
        ]))
        elements.append(t2)

    doc.build(elements)
    buffer.seek(0)
    return StreamingResponse(
        buffer,
        media_type="application/pdf",
        headers={"Content-Disposition": "attachment; filename=financial_report.pdf"}
    )


def _financial_excel(payments, total_collection, total_pending):
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "Financial Report"

    header_fill = PatternFill(start_color="E88A1A", end_color="E88A1A", fill_type="solid")
    header_font = Font(bold=True, color="FFFFFF", size=11)
    border = Border(
        left=Side(style='thin'), right=Side(style='thin'),
        top=Side(style='thin'), bottom=Side(style='thin')
    )

    # Title
    ws.merge_cells('A1:F1')
    ws['A1'] = "Shemford Futuristic School - Financial Report"
    ws['A1'].font = Font(bold=True, size=14)
    ws['A2'] = f"Generated: {datetime.now().strftime('%d %b %Y, %I:%M %p')}"
    ws.append([])

    # Summary
    ws.append(["Summary"])
    ws.append(["Total Collection", f"Rs.{total_collection:,.2f}"])
    ws.append(["Total Pending", f"Rs.{total_pending:,.2f}"])
    ws.append(["Transactions", len(payments)])
    ws.append([])

    # Headers
    headers = ['Receipt No.', 'Student ID', 'Amount', 'Method', 'Month', 'Date']
    ws.append(headers)
    for col_idx, _ in enumerate(headers, 1):
        cell = ws.cell(row=ws.max_row, column=col_idx)
        cell.fill = header_fill
        cell.font = header_font
        cell.border = border

    # Data
    for p in payments:
        pd_str = p.get('payment_date', '') or ''
        month_str = pd_str[:7] if len(pd_str) >= 7 else ''
        date_str = (f"{pd_str[8:10]}/{pd_str[5:7]}/{pd_str[0:4]}"
                    if len(pd_str) >= 10 else pd_str)
        raw_method = p.get('payment_method', '') or ''
        method_str = raw_method.replace('_', ' ').title() if raw_method else ''
        ws.append([
            p.get('receipt_number', ''),
            p.get('student_id', ''),
            p['amount'],
            method_str,
            month_str,
            date_str,
        ])

    # Auto width
    for col in ws.columns:
        try:
            col_letter = col[0].column_letter
            max_length = max(len(str(cell.value or '')) for cell in col if cell.value is not None)
            ws.column_dimensions[col_letter].width = min(max_length + 2, 30)
        except AttributeError:
            pass

    buffer = io.BytesIO()
    wb.save(buffer)
    buffer.seek(0)
    return StreamingResponse(
        buffer,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": "attachment; filename=financial_report.xlsx"}
    )


# ==================== ATTENDANCE REPORT ====================

@router.get("/reports/attendance")
async def get_attendance_report(
    request: Request,
    class_name: Optional[str] = None,
    date: Optional[str] = None,
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
):
    user = await require_roles(UserRole.ADMIN, UserRole.TEACHER)(request)
    query = {"entity_type": "student"}

    # Teachers can only see their assigned class's attendance report
    if user["role"] == UserRole.TEACHER:
        assigned = await get_teacher_assigned_classes(user["user_id"])
        if assigned:
            allowed_classes = [a["class_name"] for a in assigned]
            if class_name and class_name not in allowed_classes:
                raise HTTPException(status_code=403, detail="You are not assigned to this class")
            if not class_name:
                query["$or"] = [{"class_name": a["class_name"], "section": a["section"]} for a in assigned]

    if class_name:
        query["class_name"] = class_name
    if date:
        query["date"] = date
    elif start_date and end_date:
        query["date"] = {"$gte": start_date, "$lte": end_date}
    elif start_date:
        query["date"] = {"$gte": start_date}
    elif end_date:
        query["date"] = {"$lte": end_date}

    import asyncio as _asyncio

    # Run all queries in parallel — counts done by MongoDB, only 200 rows fetched for display
    total, present, absent, late, records = await _asyncio.gather(
        db.attendance.count_documents(query),
        db.attendance.count_documents({**query, "status": "present"}),
        db.attendance.count_documents({**query, "status": "absent"}),
        db.attendance.count_documents({**query, "status": "late"}),
        db.attendance.find(query, {"_id": 0}).sort("date", -1).limit(200).to_list(200),
    )

    return {
        "total_records": total,
        "present": present,
        "absent": absent,
        "late": late,
        "percentage": round((present / total * 100), 1) if total > 0 else 0,
        "records": records,
    }


@router.get("/reports/attendance/export")
async def export_attendance_report(
    request: Request,
    format: str = "pdf",
    class_name: Optional[str] = None,
    date: Optional[str] = None,
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
):
    user = await require_roles(UserRole.ADMIN, UserRole.TEACHER)(request)
    query = {"entity_type": "student"}
    if user["role"] == UserRole.TEACHER:
        assigned = await get_teacher_assigned_classes(user["user_id"])
        if assigned:
            allowed_classes = [a["class_name"] for a in assigned]
            if class_name and class_name not in allowed_classes:
                raise HTTPException(status_code=403, detail="You are not assigned to this class")
            if not class_name:
                query["$or"] = [{"class_name": a["class_name"], "section": a["section"]} for a in assigned]
    if class_name:
        query["class_name"] = class_name
    if date:
        query["date"] = date
    elif start_date and end_date:
        query["date"] = {"$gte": start_date, "$lte": end_date}
    elif start_date:
        query["date"] = {"$gte": start_date}
    elif end_date:
        query["date"] = {"$lte": end_date}

    records = await db.attendance.find(query, {"_id": 0}).to_list(10000)

    # Batch-fetch all student names in one query instead of N queries
    student_ids = list({r["entity_id"] for r in records})
    students_list = await db.students.find(
        {"student_id": {"$in": student_ids}},
        {"_id": 0, "student_id": 1, "first_name": 1, "last_name": 1, "admission_number": 1}
    ).to_list(len(student_ids))
    student_map = {s["student_id"]: s for s in students_list}

    for r in records:
        student = student_map.get(r["entity_id"])
        if student:
            r["student_name"] = f"{student['first_name']} {student['last_name']}"
            r["admission_number"] = student.get("admission_number", "")
        else:
            r["student_name"] = r["entity_id"]
            r["admission_number"] = ""

    if format == "excel":
        return _attendance_excel(records, class_name, date)
    else:
        return _attendance_pdf(records, class_name, date)


def _attendance_pdf(records, class_name, date):
    buffer = io.BytesIO()
    doc = SimpleDocTemplate(buffer, pagesize=A4, topMargin=1*cm, bottomMargin=1*cm)
    styles = getSampleStyleSheet()
    elements = []

    elements.append(Paragraph("Shemford Futuristic School", ParagraphStyle('T', parent=styles['Heading1'], fontSize=18, alignment=TA_CENTER)))
    subtitle = "Attendance Report"
    if class_name:
        subtitle += f" - Class {class_name}"
    if date:
        subtitle += f" - {date}"
    elements.append(Paragraph(subtitle, ParagraphStyle('S', parent=styles['Heading2'], alignment=TA_CENTER, spaceAfter=20)))

    # Summary
    total = len(records)
    present = sum(1 for r in records if r["status"] == "present")
    absent = sum(1 for r in records if r["status"] == "absent")
    pct = round((present / total * 100), 1) if total > 0 else 0
    elements.append(Paragraph(f"Total: {total} | Present: {present} | Absent: {absent} | Attendance: {pct}%", styles['Normal']))
    elements.append(Spacer(1, 12))

    if records:
        table_data = [['Adm. No.', 'Student Name', 'Class', 'Section', 'Date', 'Status']]
        for r in records[:200]:
            table_data.append([
                r.get('admission_number', '')[:12],
                r.get('student_name', '')[:25],
                r.get('class_name', ''),
                r.get('section', ''),
                r.get('date', ''),
                r.get('status', '').upper(),
            ])
        t = Table(table_data, colWidths=[70, 130, 50, 50, 70, 60])
        t.setStyle(TableStyle([
            ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor('#E88A1A')),
            ('TEXTCOLOR', (0, 0), (-1, 0), colors.white),
            ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
            ('FONTSIZE', (0, 0), (-1, -1), 7),
            ('GRID', (0, 0), (-1, -1), 0.5, colors.grey),
            ('ROWBACKGROUNDS', (0, 1), (-1, -1), [colors.white, colors.HexColor('#f5f5f5')]),
        ]))
        elements.append(t)

    doc.build(elements)
    buffer.seek(0)
    return StreamingResponse(buffer, media_type="application/pdf",
                             headers={"Content-Disposition": "attachment; filename=attendance_report.pdf"})


def _attendance_excel(records, class_name, date):
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "Attendance Report"

    header_fill = PatternFill(start_color="E88A1A", end_color="E88A1A", fill_type="solid")
    header_font = Font(bold=True, color="FFFFFF")

    ws.merge_cells('A1:F1')
    ws['A1'] = f"Attendance Report - {f'Class {class_name}' if class_name else 'All'} - {date or 'All Dates'}"
    ws['A1'].font = Font(bold=True, size=14)
    ws.append([])

    headers = ['Admission No.', 'Student Name', 'Class', 'Section', 'Date', 'Status']
    ws.append(headers)
    for col_idx, _ in enumerate(headers, 1):
        cell = ws.cell(row=ws.max_row, column=col_idx)
        cell.fill = header_fill
        cell.font = header_font

    for r in records:
        ws.append([
            r.get('admission_number', ''),
            r.get('student_name', ''),
            r.get('class_name', ''),
            r.get('section', ''),
            r.get('date', ''),
            r.get('status', ''),
        ])

    for col in ws.columns:
        try:
            col_letter = col[0].column_letter
            max_length = max(len(str(cell.value or '')) for cell in col if cell.value is not None)
            ws.column_dimensions[col_letter].width = min(max_length + 2, 30)
        except AttributeError:
            pass

    buffer = io.BytesIO()
    wb.save(buffer)
    buffer.seek(0)
    return StreamingResponse(buffer,
                             media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                             headers={"Content-Disposition": "attachment; filename=attendance_report.xlsx"})


# ==================== ACADEMIC REPORT ====================

@router.get("/reports/academic")
async def get_academic_report(request: Request, class_name: Optional[str] = None, section: Optional[str] = None, academic_year: str = "2024-2025"):
    await require_roles(UserRole.ADMIN, UserRole.TEACHER)(request)

    query = {"academic_year": academic_year}
    if class_name:
        query["class_name"] = class_name
    if section:
        query["section"] = section

    marks = await db.mark_records.find(query, {"_id": 0}).to_list(10000)

    student_results = {}
    for m in marks:
        sid = m["student_id"]
        if sid not in student_results:
            student_results[sid] = {"marks": [], "total_obtained": 0, "total_max": 0}
        student_results[sid]["marks"].append(m)
        student_results[sid]["total_obtained"] += m["marks_obtained"]
        student_results[sid]["total_max"] += m["max_marks"]

    class_average = 0
    if student_results:
        percentages = []
        for data in student_results.values():
            if data["total_max"] > 0:
                pct = (data["total_obtained"] / data["total_max"]) * 100
                percentages.append(pct)
                data["percentage"] = round(pct, 2)
                data["grade"] = calculate_grade(pct)
        if percentages:
            class_average = round(sum(percentages) / len(percentages), 2)

    return {
        "academic_year": academic_year,
        "class_name": class_name,
        "section": section,
        "student_count": len(student_results),
        "class_average": class_average,
        "student_results": student_results
    }


@router.get("/reports/academic/export")
async def export_academic_report(request: Request, format: str = "pdf", class_name: Optional[str] = None, section: Optional[str] = None, academic_year: str = "2024-2025"):
    await require_roles(UserRole.ADMIN, UserRole.TEACHER)(request)

    query = {"academic_year": academic_year}
    if class_name:
        query["class_name"] = class_name
    if section:
        query["section"] = section

    marks = await db.mark_records.find(query, {"_id": 0}).to_list(10000)

    # Aggregate per student
    student_results = {}
    for m in marks:
        sid = m["student_id"]
        if sid not in student_results:
            student_results[sid] = {"marks": [], "total_obtained": 0, "total_max": 0}
        student_results[sid]["marks"].append(m)
        student_results[sid]["total_obtained"] += m["marks_obtained"]
        student_results[sid]["total_max"] += m["max_marks"]

    # Enrich with names
    for sid in student_results:
        student = await db.students.find_one({"student_id": sid}, {"_id": 0, "first_name": 1, "last_name": 1, "admission_number": 1})
        if student:
            student_results[sid]["name"] = f"{student['first_name']} {student['last_name']}"
            student_results[sid]["admission_number"] = student.get("admission_number", "")
        else:
            student_results[sid]["name"] = sid
            student_results[sid]["admission_number"] = ""
        if student_results[sid]["total_max"] > 0:
            pct = (student_results[sid]["total_obtained"] / student_results[sid]["total_max"]) * 100
            student_results[sid]["percentage"] = round(pct, 2)
            student_results[sid]["grade"] = calculate_grade(pct)

    if format == "excel":
        return _academic_excel(student_results, class_name, section, academic_year)
    else:
        return _academic_pdf(student_results, class_name, section, academic_year)


def _academic_pdf(student_results, class_name, section, academic_year):
    buffer = io.BytesIO()
    doc = SimpleDocTemplate(buffer, pagesize=A4, topMargin=1*cm, bottomMargin=1*cm)
    styles = getSampleStyleSheet()
    elements = []

    elements.append(Paragraph("Shemford Futuristic School", ParagraphStyle('T', parent=styles['Heading1'], fontSize=18, alignment=TA_CENTER)))
    subtitle = f"Academic Report - {academic_year}"
    if class_name:
        subtitle += f" | Class {class_name}"
    if section:
        subtitle += f" - {section}"
    elements.append(Paragraph(subtitle, ParagraphStyle('S', parent=styles['Heading2'], alignment=TA_CENTER, spaceAfter=20)))

    if student_results:
        table_data = [['Adm. No.', 'Student Name', 'Marks', 'Total', 'Percentage', 'Grade']]
        for sid, data in student_results.items():
            table_data.append([
                data.get('admission_number', '')[:12],
                data.get('name', '')[:25],
                f"{data['total_obtained']:.0f}",
                f"{data['total_max']:.0f}",
                f"{data.get('percentage', 0):.1f}%",
                data.get('grade', '-'),
            ])
        t = Table(table_data, colWidths=[75, 150, 55, 55, 60, 40])
        t.setStyle(TableStyle([
            ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor('#E88A1A')),
            ('TEXTCOLOR', (0, 0), (-1, 0), colors.white),
            ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
            ('FONTSIZE', (0, 0), (-1, -1), 8),
            ('GRID', (0, 0), (-1, -1), 0.5, colors.grey),
            ('ROWBACKGROUNDS', (0, 1), (-1, -1), [colors.white, colors.HexColor('#f5f5f5')]),
            ('ALIGN', (2, 0), (-1, -1), 'CENTER'),
        ]))
        elements.append(t)
    else:
        elements.append(Paragraph("No academic records found for the selected criteria.", styles['Normal']))

    doc.build(elements)
    buffer.seek(0)
    return StreamingResponse(buffer, media_type="application/pdf",
                             headers={"Content-Disposition": "attachment; filename=academic_report.pdf"})


def _academic_excel(student_results, class_name, section, academic_year):
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "Academic Report"

    header_fill = PatternFill(start_color="E88A1A", end_color="E88A1A", fill_type="solid")
    header_font = Font(bold=True, color="FFFFFF")

    ws.merge_cells('A1:F1')
    ws['A1'] = f"Academic Report - {academic_year} - {f'Class {class_name}' if class_name else 'All'}"
    ws['A1'].font = Font(bold=True, size=14)
    ws.append([])

    headers = ['Admission No.', 'Student Name', 'Marks Obtained', 'Total Marks', 'Percentage', 'Grade']
    ws.append(headers)
    for col_idx, _ in enumerate(headers, 1):
        cell = ws.cell(row=ws.max_row, column=col_idx)
        cell.fill = header_fill
        cell.font = header_font

    for data in student_results.values():
        ws.append([
            data.get('admission_number', ''),
            data.get('name', ''),
            data['total_obtained'],
            data['total_max'],
            f"{data.get('percentage', 0):.1f}%",
            data.get('grade', '-'),
        ])

    for col in ws.columns:
        try:
            col_letter = col[0].column_letter
            max_length = max(len(str(cell.value or '')) for cell in col if cell.value is not None)
            ws.column_dimensions[col_letter].width = min(max_length + 2, 30)
        except AttributeError:
            pass

    buffer = io.BytesIO()
    wb.save(buffer)
    buffer.seek(0)
    return StreamingResponse(buffer,
                             media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                             headers={"Content-Disposition": "attachment; filename=academic_report.xlsx"})


# ==================== DAILY COLLECTION REPORT ====================
#
# Pull: GET /api/reports/daily-collection[?date=YYYY-MM-DD]   (JWT, admin/accountant)
# Push: a job queued at DAILY_REPORT_TIME (default 23:59) emails the report and,
#       if configured, POSTs it to an external webhook. Both are optional/env-driven.
#
# Source of truth is `fee_payments`, which only ever holds *successful*
# collections: Razorpay/POS/Stripe rows are inserted after verification, and
# failed/cancelled orders never reach it. Refunds are not removed from
# `fee_payments`, so they are read from `razorpay_orders` (refund_id set) and
# reported as a deduction on the day the refund was initiated.

REPORT_TZ = ZoneInfo(os.environ.get("REPORT_TIMEZONE", "Asia/Kolkata"))
BASE_MODES = ("cash", "cheque", "dd", "card", "upi")
_MODE_ALIASES = {
    "pos_card": "card", "debit_card": "card", "credit_card": "card",
    "pos_upi": "upi",
    "pos_cash": "cash",
    "demand_draft": "dd",
}


def _normalize_mode(method) -> str:
    m = str(method or "").strip().lower().replace(" ", "_").replace("-", "_")
    if not m:
        return "unknown"
    return _MODE_ALIASES.get(m, m)


def _parse_report_date(value: Optional[str]) -> str:
    today = datetime.now(REPORT_TZ).date()
    if not value:
        return today.isoformat()
    try:
        if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", value):
            raise ValueError(value)
        d = datetime.strptime(value, "%Y-%m-%d").date()
    except ValueError:
        raise HTTPException(status_code=400, detail="date must be in YYYY-MM-DD format")
    if d > today:
        raise HTTPException(status_code=400, detail="date cannot be in the future")
    return d.isoformat()


async def build_daily_collection_report(report_date: str) -> dict:
    day = datetime.strptime(report_date, "%Y-%m-%d").date()
    next_day = (day + timedelta(days=1)).isoformat()

    # payment_date is stored as YYYY-MM-DD (or an ISO datetime on some paths),
    # so a half-open string range matches both.
    payments = await db.fee_payments.find(
        {"payment_date": {"$gte": report_date, "$lt": next_day}},
        {"_id": 0, "amount": 1, "payment_method": 1, "split_payments": 1},
    ).to_list(None)

    collections = {m: 0.0 for m in BASE_MODES}
    for p in payments:
        split = p.get("split_payments")
        if isinstance(split, dict) and split:
            parts = list(split.items())
        else:
            parts = [(p.get("payment_method"), p.get("amount"))]
        for mode, amt in parts:
            try:
                amt = float(amt or 0)
            except (TypeError, ValueError):
                logger.warning("daily-collection: skipping non-numeric amount %r", amt)
                continue
            key = _normalize_mode(mode)
            collections[key] = collections.get(key, 0.0) + amt
    collections = {k: round(v, 2) for k, v in collections.items()}
    total = round(sum(collections.values()), 2)

    # Refunds are timestamped in UTC; take the report-timezone day's bounds.
    start_utc = datetime(day.year, day.month, day.day, tzinfo=REPORT_TZ).astimezone(timezone.utc)
    end_utc = start_utc + timedelta(days=1)
    refunds = await db.razorpay_orders.find(
        {
            "refund_id": {"$nin": [None, ""]},
            "refund_initiated_at": {"$gte": start_utc.isoformat(), "$lt": end_utc.isoformat()},
        },
        {"_id": 0, "refund_amount": 1, "refund_status": 1},
    ).to_list(None)
    refunds = [r for r in refunds if str(r.get("refund_status") or "").lower() != "failed"]
    refund_total = round(sum(float(r.get("refund_amount") or 0) for r in refunds), 2)

    return {
        "report_date": report_date,
        "currency": "INR",
        "collections": collections,
        "total_collection": total,
        "refunds": {"total": refund_total, "count": len(refunds)},
        "net_collection": round(total - refund_total, 2),
        "transaction_count": len(payments),
    }


@router.get("/reports/daily-collection")
async def get_daily_collection_report(request: Request, date: Optional[str] = None):
    """Collections for one day grouped by payment mode. Defaults to today (REPORT_TIMEZONE)."""
    await require_roles(UserRole.ADMIN, UserRole.ACCOUNTANT)(request)
    report_date = _parse_report_date(date)
    try:
        report = await build_daily_collection_report(report_date)
    except Exception:
        logger.exception("daily-collection: failed to build report for %s", report_date)
        raise HTTPException(status_code=500, detail="Could not generate the collection report")
    report["generated_at"] = datetime.now(timezone.utc).isoformat()
    return report


# ── Scheduled push ────────────────────────────────────────────────────────────

def _report_email_html(report: dict) -> str:
    cell = "padding:6px 12px;border:1px solid #ddd"
    rows = "".join(
        f"<tr><td style='{cell}'>{html.escape(k.replace('_', ' ').upper())}</td>"
        f"<td style='{cell};text-align:right'>Rs.{v:,.2f}</td></tr>"
        for k, v in report["collections"].items()
    )
    return f"""
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <div style="background:#E88A1A;padding:20px;text-align:center">
            <h1 style="color:white;margin:0">Shemford Futuristic School</h1>
        </div>
        <div style="padding:24px;background:#f9f9f9">
            <h2>Daily Collection Report - {report['report_date']}</h2>
            <table style="border-collapse:collapse;width:100%;background:white">{rows}
                <tr><td style='{cell}'><b>Total Collection</b></td>
                    <td style='{cell};text-align:right'><b>Rs.{report['total_collection']:,.2f}</b></td></tr>
                <tr><td style='{cell}'>Refunds ({report['refunds']['count']})</td>
                    <td style='{cell};text-align:right'>- Rs.{report['refunds']['total']:,.2f}</td></tr>
                <tr><td style='{cell}'><b>Net Collection</b></td>
                    <td style='{cell};text-align:right'><b>Rs.{report['net_collection']:,.2f}</b></td></tr>
            </table>
            <p style="color:#666">{report['transaction_count']} transaction(s).</p>
        </div>
    </div>"""


async def _push_webhook(report: dict) -> None:
    url = os.environ.get("DAILY_REPORT_WEBHOOK_URL", "").strip()
    body = json.dumps(report, separators=(",", ":")).encode()
    headers = {
        "Content-Type": "application/json",
        # Receiver can use this to drop duplicate deliveries.
        "Idempotency-Key": f"daily-collection-{report['report_date']}",
    }
    secret = os.environ.get("DAILY_REPORT_WEBHOOK_SECRET", "")
    if secret:
        headers["X-Signature-SHA256"] = hmac.new(secret.encode(), body, hashlib.sha256).hexdigest()
    token = os.environ.get("DAILY_REPORT_WEBHOOK_TOKEN", "")
    if token:
        headers["Authorization"] = f"Bearer {token}"
    async with httpx.AsyncClient(timeout=20) as client:
        resp = await client.post(url, content=body, headers=headers)
    resp.raise_for_status()


async def _claim_report(report_date: str) -> Optional[dict]:
    """Claim the right to deliver `report_date`. Returns the log doc, or None if
    it is already delivered / being delivered by another worker or process."""
    now = datetime.now(timezone.utc)
    doc = {"_id": report_date, "status": "sending", "claimed_at": now.isoformat(),
           "channels": {}, "attempts": 1}
    try:
        await db.daily_collection_reports.insert_one(doc)
        return doc
    except DuplicateKeyError:
        pass
    stale = (now - STALE_SENDING).isoformat()
    return await db.daily_collection_reports.find_one_and_update(
        {"_id": report_date, "$or": [
            {"status": "failed"},
            {"status": "sending", "claimed_at": {"$lt": stale}},
        ]},
        {"$set": {"status": "sending", "claimed_at": now.isoformat()}, "$inc": {"attempts": 1}},
        return_document=True,
    )


async def send_daily_collection_report(report_date: Optional[str] = None) -> None:
    """Job handler. Safe to run more than once for a date: delivered channels are
    never re-sent, and concurrent runs are excluded by `_claim_report`."""
    report_date = report_date or datetime.now(REPORT_TZ).date().isoformat()
    log = await _claim_report(report_date)
    if log is None:
        logger.info("daily-collection: %s already sent or in progress — skipping", report_date)
        return

    done = dict(log.get("channels") or {})
    recipients = [e.strip() for e in os.environ.get("DAILY_REPORT_EMAILS", "").split(",") if e.strip()]
    webhook = os.environ.get("DAILY_REPORT_WEBHOOK_URL", "").strip()
    errors = []
    try:
        report = await build_daily_collection_report(report_date)

        if recipients and not done.get("email"):
            from routes.payments import send_email  # lazy: pulls in Stripe/Resend setup
            subject = f"Daily Collection Report - {report_date}"
            results = await asyncio.gather(
                *(send_email(r, subject, _report_email_html(report)) for r in recipients)
            )
            if all(results):
                done["email"] = True
            else:
                errors.append("email delivery failed for one or more recipients")
        if webhook and not done.get("webhook"):
            try:
                await _push_webhook(report)
                done["webhook"] = True
            except Exception as exc:
                errors.append(f"webhook: {exc}")
        if not recipients and not webhook:
            logger.warning("daily-collection: no DAILY_REPORT_EMAILS or DAILY_REPORT_WEBHOOK_URL configured — nothing sent")
    except Exception as exc:
        logger.exception("daily-collection: failed building/sending report for %s", report_date)
        errors.append(str(exc))

    await db.daily_collection_reports.update_one(
        {"_id": report_date},
        {"$set": {"status": "failed" if errors else ("sent" if done else "skipped"), "channels": done,
                  "error": "; ".join(errors) or None,
                  "finished_at": datetime.now(timezone.utc).isoformat()}},
    )
    if errors:
        # Re-raise so job_queue retries with back-off; delivered channels stay marked.
        raise RuntimeError("; ".join(errors))
    if done:
        logger.info("daily-collection: report for %s sent via %s", report_date, sorted(done))
    else:
        logger.info("daily-collection: report for %s built; no delivery channel configured (skipped)", report_date)


register_handler("daily_collection_report", send_daily_collection_report)


SCHEDULER_POLL_SECONDS = 60
STALE_SENDING = timedelta(minutes=15)   # a claim older than this is a crashed run
FAILED_RETRY_AFTER = timedelta(minutes=30)
MAX_REPORT_ATTEMPTS = 12


def _latest_due_date(now: datetime, hhmm: str) -> str:
    """Most recent report date whose trigger time (hhmm) has already passed."""
    hh, mm = (int(x) for x in hhmm.split(":"))
    due_today = now.replace(hour=hh, minute=mm, second=0, microsecond=0)
    return (now.date() if now >= due_today else now.date() - timedelta(days=1)).isoformat()


def _needs_run(log: Optional[dict], now_utc: datetime) -> bool:
    """Whether the report for a due date still has to be (re)queued, given its log doc."""
    if log is None:
        return True
    status = log.get("status")
    if status in ("sent", "skipped"):
        return False
    if status == "sending":
        # Only a crashed worker leaves a stale claim; a live run is left alone.
        claimed = datetime.fromisoformat(log["claimed_at"])
        return now_utc - claimed > STALE_SENDING
    if status == "failed":
        finished = log.get("finished_at")
        waited = now_utc - datetime.fromisoformat(finished) if finished else FAILED_RETRY_AFTER
        return log.get("attempts", 0) < MAX_REPORT_ATTEMPTS and waited >= FAILED_RETRY_AFTER
    return True


async def _queue_due_report(hhmm: str) -> Optional[str]:
    """Queue the latest due report if it hasn't been delivered. Returns the date queued."""
    due = _latest_due_date(datetime.now(REPORT_TZ), hhmm)
    log = await db.daily_collection_reports.find_one({"_id": due})
    if not _needs_run(log, datetime.now(timezone.utc)):
        return None
    await enqueue_job(
        "daily_collection_report", {"report_date": due},
        idempotency_key=f"daily_collection_report:{due}",
    )
    return due


async def run_daily_report_scheduler():
    """Poll once a minute and queue the latest due report if it hasn't been delivered.

    Polling (rather than sleeping until 23:59) makes recovery automatic: if the app
    was down at the trigger time, the first poll after restart queues the missed
    report; a crashed or failed run is retried. Duplicates are harmless: the queue
    idempotency key, the sent/skipped check above, and `_claim_report` all guard it.
    """
    if os.environ.get("DAILY_REPORT_ENABLED", "true").lower() != "true":
        logger.info("daily-collection scheduler disabled (DAILY_REPORT_ENABLED!=true)")
        return
    hhmm = os.environ.get("DAILY_REPORT_TIME", "23:59")
    try:
        _latest_due_date(datetime.now(REPORT_TZ), hhmm)
    except ValueError:
        logger.error("daily-collection scheduler not started: invalid DAILY_REPORT_TIME=%r (want HH:MM)", hhmm)
        return
    logger.info("daily-collection scheduler started (%s %s, polling every %ds)",
                hhmm, REPORT_TZ.key, SCHEDULER_POLL_SECONDS)
    while True:
        try:
            queued = await _queue_due_report(hhmm)
            if queued:
                logger.info("daily-collection: queued report for %s", queued)
        except asyncio.CancelledError:
            return
        except Exception:
            logger.exception("daily-collection scheduler error (will continue)")
        try:
            await asyncio.sleep(SCHEDULER_POLL_SECONDS)
        except asyncio.CancelledError:
            return


# ==================== REMINDERS ====================

@router.post("/reports/reminders")
async def send_fee_reminders(request: Request):
    user = await require_roles(UserRole.ADMIN, UserRole.ACCOUNTANT)(request)  # noqa: F841
    overdue_students = await db.students.find({"fee_status": {"$in": ["pending", "overdue"]}}, {"_id": 0}).to_list(2000)

    results = {"sent": 0, "failed": 0, "details": []}

    for student in overdue_students:
        email = student.get("parent_email") or student.get("email")
        if email:
            results["details"].append({
                "student": f"{student['first_name']} {student['last_name']}",
                "email": email,
                "status": "queued"
            })
            results["sent"] += 1

    return results


# ==================== AUDIT LOGS ====================

@router.get("/audit-logs")
async def get_audit_logs(request: Request, entity_type: Optional[str] = None, entity_id: Optional[str] = None, limit: int = 50):
    await require_roles(UserRole.ADMIN)(request)
    query = {}
    if entity_type:
        query["entity_type"] = entity_type
    if entity_id:
        query["entity_id"] = entity_id

    logs = await db.audit_logs.find(query, {"_id": 0}).sort("created_at", -1).to_list(limit)
    return logs


# ==================== HEALTH CHECK ====================

@router.get("/health")
async def health_check():
    return {"status": "healthy", "timestamp": datetime.now(timezone.utc).isoformat()}
