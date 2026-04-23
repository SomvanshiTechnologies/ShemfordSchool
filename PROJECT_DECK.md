# SHEMFORD FUTURISTIC SCHOOL
## School Management ERP — Project Deck

---

---

# SLIDE 1 — OVERVIEW

## What We Built

> A **production-ready, full-stack School ERP** designed for Indian schools — covering every aspect of school operations from fees to academics to communication.

| | |
|---|---|
| **Product** | Shemford School Management System |
| **Type** | Full-Stack Web Application + Mobile Screen |
| **Target** | K-12 Indian Schools (CBSE focus) |
| **Status** | Production Ready |

---

---

# SLIDE 2 — THE PROBLEM

## Indian Schools Are Running on Paper & WhatsApp

- Fee collection tracked in Excel or ledger books
- Attendance registers filled manually, no parent alerts
- Exam results shared via printed marksheets
- No central system for staff, students, and parents
- No role-based access — everyone sees everything (or nothing)

**Result:** Data loss, payment delays, poor parent engagement, admin overload.

---

---

# SLIDE 3 — OUR SOLUTION

## One Platform. Five Roles. Complete School Operations.

```
Admin  →  Full control over school, fees, staff, academics
Teacher  →  Attendance, marks entry, announcements
Accountant  →  Fee collection, financial reports
Parent  →  Child's fees, marks, attendance at a glance
Student  →  Own marks, attendance, fee status
```

**Every user sees only what they need. Nothing more.**

---

---

# SLIDE 4 — TECH STACK

## Built for Scale & Speed

```
┌─────────────────────────────────────────┐
│         FRONTEND  (React 18)            │
│  TailwindCSS · Shadcn/UI · Axios        │
│  17 pages · Role-based routing          │
├─────────────────────────────────────────┤
│         BACKEND  (FastAPI / Python)     │
│  16 modular routers · JWT Auth          │
│  94 REST API endpoints · Pydantic       │
├─────────────────────────────────────────┤
│         DATABASE  (MongoDB)             │
│  20 collections · Async Motor driver    │
│  Atomic counters · Full audit logs      │
└─────────────────────────────────────────┘
```

| Layer | Tech |
|---|---|
| Frontend | React 18, TailwindCSS, Shadcn/UI |
| Backend | FastAPI, Python, Motor |
| Database | MongoDB 6.x |
| Auth | JWT (HS256) + Google OAuth |
| Reports | ReportLab (PDF), openpyxl (Excel) |

---

---

# SLIDE 5 — KEY MODULES

## 6 Core Modules That Run the School

### 1. Fees Management
- Annual fee set per class → auto-split into 12 monthly installments
- No skipping, no partial payment — strict Indian school logic
- Late fees, sibling discounts, concessions/scholarships
- PDF receipts with sequential numbering (`REC/2025-26/0001`)

### 2. Attendance
- Submit & Lock mechanism — teacher locks attendance after submission
- Admin override to unlock and edit
- Blocked on holidays (server-side validation)
- Auto parent notification on child absence
- Threshold alerts for students below 75%

### 3. Marks & Grading
- Admin creates exams (Unit Test / Term / Annual)
- Teacher enters marks; Admin locks & publishes
- CBSE-style grading: A1 to E
- PDF Marksheets with school header & subject grades

### 4. Reports & Analytics
- Financial: collection, pending dues, overdue by month
- Attendance: class-wise & student-wise summary
- Academic: subject averages, pass rates, toppers
- Export to Excel and PDF

### 5. Communication
- Announcements (role-based visibility)
- Internal Messaging between users
- Fee Reminders to parents
- Issue/Complaint tracking

### 6. Administration
- Student, Employee, Class CRUD
- User account management with role assignment
- Syllabus upload per class
- Bulk onboarding for new academic year

---

---

# SLIDE 6 — RBAC MATRIX

## Who Can Do What

| Feature | Admin | Teacher | Accountant | Parent | Student |
|---|:---:|:---:|:---:|:---:|:---:|
| Dashboard | Full | Class | Finance | Child | Own |
| Students CRUD | Yes | View | View | — | — |
| Mark Attendance | Yes | Yes | — | — | — |
| Collect Fees | Yes | — | Yes | Pay own | — |
| Enter Marks | Override | Yes | — | — | — |
| View Results | All | Assigned | — | Published | Published |
| Reports | All types | Attendance | Financial | — | — |
| Messages | Yes | Yes | — | Yes | View |

---

---

# SLIDE 7 — DATABASE DESIGN

## 20 Collections, Zero Redundancy

| Collection | Purpose |
|---|---|
| `users` | Auth, roles, profiles |
| `students` | Student master records |
| `employees` | Staff master records |
| `class_structures` | Class config + fee settings |
| `fee_installments` | Monthly fee records per student |
| `fee_payments` | Payment transactions + receipts |
| `attendance` | Daily per-student attendance |
| `attendance_sessions` | Locked session summaries |
| `holidays` | Holiday calendar |
| `exams` | Exam definitions |
| `marks` | Subject-wise marks |
| `announcements` | School notices |
| `messages` | Internal user messages |
| `issues` | Complaints & issue tracking |
| `audit_logs` | Every action logged with user + time |

---

---

# SLIDE 8 — DESIGN SYSTEM

## Minimalist. Monochrome. Professional.

| Token | Value | Usage |
|---|---|---|
| Primary | `#E88A1A` Orange | CTAs, highlights, active states |
| Dark | `#1A1A1A` Near Black | Text, sidebar, headers |
| Light | `#FFFFFF` White | Backgrounds, cards |
| Muted | `#F5F5F5` | Subtle backgrounds |
| Border | `#E5E5E5` | Tables, dividers |

**Design Principles:**
- No green/red — status shown via Orange/Black/Gray badges
- Dense tables for data-heavy views (school admins prefer this)
- Uppercase tracking-wider labels for table headers
- Rounded-sm corners throughout
- Lucide icons at strokeWidth 1.5

---

---

# SLIDE 9 — SECURITY

## Built Secure by Default

| Layer | What We Do |
|---|---|
| Passwords | Bcrypt hashed with salt |
| Sessions | JWT (HS256), 24h expiry + refresh rotation |
| Authorization | `require_roles()` on every backend endpoint |
| Frontend | Route-level role guards + sidebar filtering |
| Audit | Every write logged: user, action, timestamp |
| OAuth | Google Sign-In via secure OAuth flow |
| Validation | Pydantic models on all API request bodies |

---

---

# SLIDE 10 — NUMBERS

## What We Shipped

| Metric | Count |
|---|---|
| Backend API Endpoints | **94** |
| Backend Routers (modules) | **16** |
| Frontend Pages | **17** |
| Database Collections | **20** |
| User Roles | **5** |
| Backend Lines of Code | ~4,400 |
| Frontend Lines of Code | ~6,500 |
| Test Cases Passing | **42/42** |

---

---

# SLIDE 11 — TESTING

## 100% Tests Passing

| Suite | Result |
|---|---|
| Backend Unit Tests (pytest) | 16/16 PASS |
| Backend Integration Tests | 26/26 PASS |
| Frontend E2E (Playwright) | 17/17 pages verified |

**Test Credentials:**

| Role | Email | Password |
|---|---|---|
| Admin | admin@test.com | Test1234! |
| Teacher | teacher@school.com | Teacher1234! |
| Parent | parent@test.com | Test1234! |

---

---

# SLIDE 12 — CURRENT STATUS (April 2026)

## What's Live vs What's Mocked

| Feature | Status |
|---|---|
| Fees, Attendance, Marks, Reports | LIVE |
| JWT Auth + Google OAuth | LIVE |
| PDF Receipts & Marksheets | LIVE |
| Excel Report Exports | LIVE |
| Razorpay Payment Integration | IN PROGRESS |
| Email / SMS Notifications | MOCKED (logs only) |
| File/Document Storage | Local only |

---

---

# SLIDE 13 — ROADMAP

## What's Next

| Priority | Feature |
|---|---|
| P1 | Razorpay online fee payment (in progress) |
| P1 | Real email/SMS via SendGrid or Twilio |
| P2 | Timetable Management |
| P2 | Library Management |
| P2 | Transport & Bus Tracking |
| P2 | Advanced Analytics & Charts |
| P2 | React Native Mobile App |
| P3 | 2FA, Signed URLs, Screenshot Restriction |

---

---

# SLIDE 14 — DEPLOYMENT

## How to Run

```bash
# Backend
cd backend
pip install -r requirements.txt
uvicorn server:app --host 0.0.0.0 --port 8001

# Frontend
cd frontend
npm install
npm start

# Or full stack with Docker
docker-compose up
```

**Environment Variables needed:**

| File | Key |
|---|---|
| `backend/.env` | `MONGO_URL`, `DB_NAME`, `JWT_SECRET`, `GOOGLE_CLIENT_ID` |
| `frontend/.env` | `REACT_APP_BACKEND_URL` |

---

---

# SLIDE 15 — SUMMARY

## Why Shemford ERP?

- Complete school operations in one system
- Built specifically for **Indian school workflows** (CBSE, installment fees, strict attendance)
- Role-based — every stakeholder gets a tailored experience
- Secure, tested, production-ready
- Extensible — new modules plug into the existing architecture

---

> **Shemford Futuristic School Management System**
> Version 2.0 · April 2026
> Built with FastAPI · React · MongoDB

---
