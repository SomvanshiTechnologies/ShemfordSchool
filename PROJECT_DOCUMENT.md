# SHEMFORD FUTURISTIC SCHOOL — School Management System
### Project Documentation

---

## 1. Executive Summary

The **Shemford Futuristic School Management System** is a production-ready, full-stack web application built for complete school operations management. It implements realistic **Indian school ERP business logic** including CBSE-style grading, fee installment management with strict payment rules, attendance with locking mechanisms, and role-based access control across five user roles.

| Metric | Value |
|---|---|
| **Backend** | FastAPI (Python) — 16 modular routers, 94 API endpoints |
| **Frontend** | React — 17 page components, Shadcn/UI |
| **Database** | MongoDB — 20 collections |
| **Lines of Code** | ~4,400 backend + ~6,500 frontend |
| **Authentication** | JWT + Google OAuth |
| **Design System** | Minimalist monochrome — Orange (#E88A1A), White, Black (#1A1A1A) |

---

## 2. System Architecture

```
┌──────────────────────────────────────────────────────────────┐
│                        FRONTEND (React)                       │
│  React 18 + TailwindCSS + Shadcn/UI + Axios                  │
│  Port 3000 | REACT_APP_BACKEND_URL for API calls              │
├──────────────────────────────────────────────────────────────┤
│                     NGINX / K8s Ingress                       │
│  /api/* → Backend (8001)  |  /* → Frontend (3000)             │
├──────────────────────────────────────────────────────────────┤
│                    BACKEND (FastAPI/Python)                    │
│  16 modular APIRouter files | JWT auth middleware             │
│  Port 8001 | Motor (async MongoDB driver)                     │
├──────────────────────────────────────────────────────────────┤
│                      DATABASE (MongoDB)                       │
│  20 collections | Atomic counters | Audit logging             │
└──────────────────────────────────────────────────────────────┘
```

### Technology Stack

| Layer | Technology | Purpose |
|---|---|---|
| Frontend | React 18, TailwindCSS, Shadcn/UI | SPA with role-based UI |
| Backend | FastAPI, Pydantic, Motor | Async REST API |
| Database | MongoDB 6.x | Document store, flexible schema |
| Auth | JWT (HS256), Google OAuth | Session-less authentication |
| PDF Gen | ReportLab | Fee receipts, marksheets, reports |
| Excel Gen | openpyxl | Export reports to .xlsx |

---

## 3. User Roles & Permissions (RBAC)

| Feature | Admin | Teacher | Accountant | Parent | Student |
|---|---|---|---|---|---|
| Dashboard | Full stats | Class stats | Finance stats | Child summary | Own summary |
| Students | CRUD | View assigned | View | — | — |
| Classes | CRUD | View | — | — | — |
| Employees | CRUD | — | — | — | — |
| Users | CRUD | — | — | — | — |
| Attendance (Mark) | Override + Unlock | Submit + Lock | — | — | — |
| Attendance (View) | All classes | Assigned classes | — | Child's records | Own records |
| Employee Attendance | Mark all | — | — | — | — |
| Holidays | CRUD | View | View | View | View |
| Attendance Alerts | View all | View | — | — | — |
| Fees Config | Set annual fee | — | Set annual fee | — | — |
| Fees Collect | Collect payment | — | Collect payment | Pay own child | — |
| Fee Concessions | Apply/View | — | View | — | — |
| Fee Reminders | Send | — | Send | — | — |
| Marks (Exams) | Create/Lock/Publish | — | — | — | — |
| Marks (Entry) | Override | Enter marks | — | — | — |
| Marks (View) | All | Assigned | — | Published only | Published only |
| Reports | All types | Attendance only | Financial only | — | — |
| Announcements | Create/Edit | Create/Edit | — | View | View |
| Messages | Send/Receive | Send/Receive | — | Send/Receive | View |
| Syllabus | CRUD | View | — | View | View |
| Issues | Manage | Create/View | — | Create/View | Create/View |

---

## 4. Module Documentation

### 4.1 Fees Management

**Business Rules:**
- Admin sets **Annual Fee** per class; system auto-divides into **12 monthly installments**
- Mid-year admissions get **prorated installments** (remaining months only)
- **No partial payments** — each installment must be paid in full
- **No skipping** — must pay oldest pending installment first
- **Auto-overdue detection** — pending installments past due date are auto-marked "overdue"
- **Auto late fee** — if enabled per class, late fee is applied to overdue installments
- **Fee concession/scholarship** — admin can apply percentage concession to any student
- **Sibling discount** — configurable per class; auto-applied when 2nd+ child of same parent enrolls
- **Sequential receipt numbering** — format: `REC/2025-26/0001` (financial year based, atomic counter)

**Key Endpoints:**

| Method | Endpoint | Role | Purpose |
|---|---|---|---|
| GET | `/api/fees/class-config` | Admin | View all classes with fee configuration |
| PUT | `/api/fees/class-config/{id}` | Admin | Set annual fee, late fee, sibling discount |
| GET | `/api/fees/student/{id}` | All | Get student's installments + payment history |
| POST | `/api/fees/pay` | Admin/Parent | Record payment (strict no-skip rules) |
| GET | `/api/fees/due-chart` | Admin | View all students with pending dues |
| POST | `/api/fees/refresh-overdue` | Admin | Bulk scan & mark overdue installments |
| POST | `/api/fees/concession` | Admin | Apply % concession to student |
| GET | `/api/fees/concessions` | Admin | List all active concessions |
| GET | `/api/fees/receipt/{id}/pdf` | All | Download PDF receipt |

**Data Model — `fee_installments`:**
```json
{
  "installment_id": "inst_abc123",
  "student_id": "STU2026XXXX",
  "class_name": "Nursery",
  "month": "2026-04",
  "amount": 5000.0,
  "late_fee_applied": 500.0,
  "concession_amount": 250.0,
  "concession_reason": "Sibling discount (5%)",
  "total_due": 5250.0,
  "status": "pending | paid | overdue",
  "due_date": "2026-04-10",
  "academic_year": "2026-2027"
}
```

---

### 4.2 Attendance Management

**Business Rules:**
- Teacher selects Class + Section + Date, marks each student Present/Absent/Leave
- **Submit & Lock** — upon submission, session is locked. Teacher cannot edit without admin.
- **Admin override** — admin can unlock, edit, and re-lock any session
- **Holiday calendar** — attendance is **blocked on holiday dates** (server-side validation)
- **Auto-notify parents** — when attendance is submitted, parents of absent students receive email
- **Threshold alerts** — admin/teacher can query students below a configurable attendance % (default 75%)
- **Employee attendance** — admin can mark daily attendance for all staff/teachers

**Key Endpoints:**

| Method | Endpoint | Role | Purpose |
|---|---|---|---|
| POST | `/api/attendance` | Teacher/Admin | Submit & lock attendance |
| GET | `/api/attendance` | All | Query attendance records |
| GET | `/api/attendance/session-status` | All | Check if session is submitted/locked/holiday |
| POST | `/api/attendance/unlock` | Admin only | Unlock a locked session |
| GET | `/api/attendance/alerts` | Admin/Teacher | Students below threshold % |
| POST | `/api/attendance/employee` | Admin | Mark employee attendance |
| GET | `/api/attendance/employees` | Admin | Query employee attendance |
| GET/POST/DELETE | `/api/holidays` | Admin | Holiday CRUD |

---

### 4.3 Marks & Grading

**Business Rules:**
- Admin **defines exams** with name, type (Unit Test / Term / Annual), class, and subjects with max marks
- Teacher enters marks per student per subject for an exam
- Admin can **Lock** an exam (prevents further editing) and **Publish** (makes results visible to parents/students)
- **CBSE-style grading**: A1 (91-100%), A2 (81-90%), B1 (71-80%), B2 (61-70%), C1 (51-60%), C2 (41-50%), D (33-40%), E (<33%)
- Marksheets generated as PDF with school header, student info, subject-wise grades

**Key Endpoints:**

| Method | Endpoint | Role | Purpose |
|---|---|---|---|
| GET/POST | `/api/exams` | Admin | CRUD exam definitions |
| POST | `/api/exams/{id}/lock` | Admin | Lock exam |
| POST | `/api/exams/{id}/unlock` | Admin | Unlock exam |
| POST | `/api/exams/{id}/publish` | Admin | Publish results to parents/students |
| GET/POST | `/api/marks` | Teacher/Admin | Enter/view marks |
| GET | `/api/marks/marksheet/{id}` | All | Generate marksheet data |
| GET | `/api/marks/marksheet/{id}/pdf` | All | Download marksheet as PDF |

---

### 4.4 Reports & Analytics

| Report Type | Description | Export |
|---|---|---|
| Financial Report | Total collection, pending, overdue, by payment method, by month | Excel, PDF |
| Attendance Report | Present/absent/leave counts with percentage | Excel |
| Academic Report | Subject-wise averages, pass rates, class toppers | Excel |
| Student Report | Individual student's complete profile + fee + attendance | — |

---

### 4.5 Other Modules

| Module | Features |
|---|---|
| **Announcements** | Create, view, role-based visibility |
| **Messages** | Internal messaging between users |
| **Syllabus** | Upload and manage class-wise syllabus |
| **Issues** | Track and manage school issues/complaints |
| **Onboarding** | Bulk student/class creation with auto fee generation |

---

## 5. Frontend Pages

| # | Page | Route | Roles | Description |
|---|---|---|---|---|
| 1 | Login | `/login` | Public | Email/password + Google OAuth |
| 2 | Dashboard | `/dashboard` | All | Role-specific stats & quick actions |
| 3 | Students | `/students` | Admin, Teacher | CRUD student records |
| 4 | Classes | `/classes` | Admin, Teacher | Manage class structures & sections |
| 5 | Employees | `/employees` | Admin | Manage staff records |
| 6 | Users | `/users` | Admin | Manage user accounts & roles |
| 7 | Attendance | `/attendance` | Admin, Teacher | 5 tabs: Students, Employees, Report, Alerts, Holidays |
| 8 | Fees | `/fees` | Admin, Accountant | 4 tabs: Config, Due Chart, Concessions, Collect |
| 9 | Marks | `/marks` | Admin, Teacher | 3 tabs: Exams, Entry, View + Marksheet dialog |
| 10 | Reports | `/reports` | Admin, Accountant | Financial, Attendance, Academic reports |
| 11 | Announcements | `/announcements` | Admin, Teacher | Create & manage announcements |
| 12 | Syllabus | `/syllabus` | All | View/manage syllabus |
| 13 | Issues | `/issues` | All | Track issues/complaints |
| 14 | Messages | `/messages` | All | Internal messaging |
| 15 | My Attendance | `/my-attendance` | Student | View own attendance summary |
| 16 | My Marks | `/my-marks` | Student | View published marks |
| 17 | My Fees | `/my-fees` | Student, Parent | View installments + pay |

---

## 6. Database Schema

### Collections (20 total)

| Collection | Key Fields | Purpose |
|---|---|---|
| `users` | user_id, email, role, name | Authentication & authorization |
| `students` | student_id, admission_number, class_name, section, parent_email, fee_status | Student master data |
| `employees` | employee_id, designation, department, is_active | Staff master data |
| `class_structures` | class_id, name, sections, annual_fee, late_fee, sibling_discount_percent | Class configuration |
| `fee_installments` | installment_id, student_id, month, amount, concession_amount, late_fee_applied, total_due, status | Monthly fee records |
| `fee_payments` | payment_id, student_id, installment_ids, amount, receipt_number, payment_method | Payment transactions |
| `attendance` | entity_type, entity_id, date, status, class_name, section, is_locked | Daily attendance records |
| `attendance_sessions` | class_name, section, date, is_locked, present_count, absent_count | Session summaries |
| `holidays` | holiday_id, date, name, type | Holiday calendar |
| `exams` | exam_id, name, exam_type, class_name, subjects, is_locked, is_published | Exam definitions |
| `marks` | mark_id, exam_id, student_id, subject, marks_obtained, max_marks | Individual marks |
| `announcements` | title, content, created_by | School announcements |
| `messages` | sender_id, receiver_id, content | Internal messages |
| `syllabus` | class_name, subject, content | Curriculum data |
| `issues` | issue_id, title, status, raised_by | Issue tracking |
| `audit_logs` | entity_type, entity_id, action, details, user_id | Comprehensive audit trail |
| `onboarding` | type, status, data | Bulk onboarding records |
| `password_resets` | user_id, token, expires_at, used | Password reset tokens |
| `counters` | _id (counter name), seq | Atomic sequential counters (receipts) |
| `fee_structures` | class_name, fee_type, amount | Legacy fee structures |

---

## 7. API Reference (94 Endpoints)

### Authentication (13 endpoints)
`POST /api/auth/register` · `POST /api/auth/login` · `POST /api/auth/google` · `POST /api/auth/refresh` · `POST /api/auth/forgot-password` · `POST /api/auth/reset-password` · `GET /api/auth/me` · `GET /api/auth/users` · `PUT /api/auth/users/{id}` · `DELETE /api/auth/users/{id}` · `POST /api/auth/link-employee` · `GET /api/auth/verify-token` · `POST /api/auth/change-password`

### Students (6 endpoints)
`GET /api/students` · `GET /api/students/{id}` · `POST /api/students` · `PUT /api/students/{id}` · `DELETE /api/students/{id}` · `GET /api/students/search`

### Classes (5 endpoints)
`GET /api/classes` · `POST /api/classes` · `PUT /api/classes/{id}` · `DELETE /api/classes/{id}` · `GET /api/classes/{id}/students`

### Employees (5 endpoints)
`GET /api/employees` · `POST /api/employees` · `PUT /api/employees/{id}` · `DELETE /api/employees/{id}` · `GET /api/employees/{id}`

### Fees (11 endpoints)
`GET /api/fees/class-config` · `PUT /api/fees/class-config/{id}` · `GET /api/fees/student/{id}` · `POST /api/fees/pay` · `GET /api/fees/due-chart` · `POST /api/fees/refresh-overdue` · `POST /api/fees/concession` · `GET /api/fees/concessions` · `GET /api/fees/receipt/{id}/pdf` · `GET /api/fees/payments` · `GET /api/fees/structure`

### Attendance (12 endpoints)
`POST /api/attendance` · `GET /api/attendance` · `GET /api/attendance/session-status` · `POST /api/attendance/unlock` · `GET /api/attendance/alerts` · `POST /api/attendance/employee` · `GET /api/attendance/employees` · `GET /api/attendance/report` · `GET /api/attendance/summary/{id}` · `GET /api/holidays` · `POST /api/holidays` · `DELETE /api/holidays/{id}`

### Marks (10 endpoints)
`GET /api/exams` · `POST /api/exams` · `POST /api/exams/{id}/lock` · `POST /api/exams/{id}/unlock` · `POST /api/exams/{id}/publish` · `GET /api/marks` · `POST /api/marks` · `GET /api/marks/marksheet/{id}` · `GET /api/marks/marksheet/{id}/pdf` · `GET /api/marks/report`

### Reports (10 endpoints)
`GET /api/reports/financial` · `GET /api/reports/attendance` · `GET /api/reports/academic` · `GET /api/reports/student/{id}` · `GET /api/reports/financial/export/excel` · `GET /api/reports/financial/export/pdf` · `GET /api/reports/attendance/export/excel` · `GET /api/reports/academic/export/excel` · `GET /api/reports/student/{id}/export` · `POST /api/reports/send-fee-reminders`

### Other (22 endpoints)
Notifications (2) · Payments (3) · Onboarding (4) · Announcements (3) · Messages (3) · Syllabus (2) · Issues (3) · Utilities (2)

---

## 8. Design System

| Element | Value |
|---|---|
| **Primary** | `#E88A1A` (Orange) — CTAs, highlights, accents |
| **Dark** | `#1A1A1A` (Near Black) — text, sidebar, dark cards |
| **Light** | `#FFFFFF` (White) — backgrounds, cards |
| **Muted** | `#F5F5F5` — subtle backgrounds, badges |
| **Text Secondary** | `#888888` — labels, subtitles |
| **Border** | `#E5E5E5` — table borders, dividers |
| **Typography** | System font stack, uppercase tracking-wider labels |
| **Components** | Shadcn/UI (card, table, dialog, select, tabs, badge, button) |
| **Icons** | Lucide React (strokeWidth 1.5) |

**Design Principles:**
- No green/red status colors — status conveyed via Black/Orange/Gray badges
- Rounded-sm corners (not rounded-lg)
- 10px uppercase tracking-wider labels for table headers
- Minimal spacing, dense tables for data-heavy views

---

## 9. Security

| Feature | Implementation |
|---|---|
| Authentication | JWT (HS256) with 24h expiry + refresh token rotation |
| Password | Bcrypt hashing with salt |
| RBAC | Server-side role checks on every endpoint via `require_roles()` |
| Frontend RBAC | Route-level `allowedRoles` + sidebar filtering |
| Audit Trail | Every write operation logged with user, action, timestamp |
| Google OAuth | Emergent-managed OAuth flow |
| Input Validation | Pydantic models on all request bodies |

---

## 10. Testing

| Test Suite | Coverage |
|---|---|
| Backend unit tests (pytest) | 16/16 pass — fees, attendance, holidays, concessions |
| Backend integration tests | 26/26 pass — full CRUD, RBAC, business logic |
| Frontend E2E (Playwright) | All 17 pages verified, role-based access confirmed |

**Test Credentials:**

| Role | Email | Password |
|---|---|---|
| Admin | admin@test.com | Test1234! |
| Teacher | teacher@school.com | Teacher1234! |
| Parent | parent@test.com | Test1234! |

---

## 11. Deployment

| Environment | URL |
|---|---|
| Preview | `https://shemford-mobile.preview.emergentagent.com` |
| Backend | Port 8001 (Supervisor-managed, Uvicorn) |
| Frontend | Port 3000 (React dev server) |
| Database | MongoDB localhost:27017 / `test_database` |

**Environment Variables:**

| File | Key | Purpose |
|---|---|---|
| `frontend/.env` | `REACT_APP_BACKEND_URL` | API base URL |
| `backend/.env` | `MONGO_URL` | MongoDB connection string |
| `backend/.env` | `DB_NAME` | Database name |
| `backend/.env` | `JWT_SECRET` | Token signing key |
| `backend/.env` | `GOOGLE_CLIENT_ID` | OAuth client |

---

## 12. Known Limitations & Mocked Services

| Service | Status | Notes |
|---|---|---|
| Stripe Payments | **MOCKED** | Payment recorded locally, no real card processing |
| Email/SMS (Resend) | **MOCKED** | Absent notifications & fee reminders log but don't deliver |
| File Storage | Local | No cloud object storage configured |

---

## 13. Future Roadmap

| Priority | Feature | Description |
|---|---|---|
| P1 | Real Payment Gateway | Stripe/Razorpay integration for online fee payments |
| P1 | Real Notifications | SendGrid/Twilio for email and SMS delivery |
| P1 | Voice Notes | Record and send voice messages between users |
| P2 | Timetable Management | Class-wise weekly timetable with teacher assignment |
| P2 | Library Management | Book inventory, issue/return tracking |
| P2 | Transport Management | Bus routes, student allocation, tracking |
| P2 | Advanced Analytics | Trend charts, predictive attendance, fee forecasting |
| P2 | Mobile App | React Native companion app for parents |
| P3 | Security Hardening | Signed URLs, screenshot restriction, 2FA |

---

*Document generated: March 2026*
*Version: 2.0*
*Shemford Futuristic School Management System*
