# Shemford School ERP

A full-stack school management system built for Shemford Futuristic School. Covers admissions, fee management, attendance, payroll, exams, and parent/student portals in a single platform.

---

## Features

- **Admissions & Onboarding** — Multi-step enrollment wizard with document uploads and fee preview
- **Student Management** — Profiles, class promotions, CSV bulk import, sibling discounts
- **Fee Management** — Component-based fee ledger, concessions, Razorpay online payments, receipts
- **Attendance** — Class-wise daily attendance with lock-after-submit; parent visibility
- **Marks & Exams** — Define exams, enter marks, publish results to students/parents
- **Employee & Payroll** — Staff profiles, monthly payroll generation, LWP deductions, bank details
- **Announcements & Messages** — Broadcast to classes/roles; voice note support
- **Reports** — Fee dues, collection, attendance summaries, exportable PDFs
- **Parent Portal** — Login with student ID or admission number; view fees, attendance, marks
- **Role-Based Access** — Admin, Teacher, Accountant, Student, Parent roles with scoped permissions

---

## Tech Stack

### Backend
| | |
|---|---|
| Framework | FastAPI (Python) |
| Database | MongoDB (Motor async driver) |
| Auth | JWT (python-jose) + bcrypt |
| Payments | Razorpay |
| File Storage | Local filesystem (`/uploads`) |
| PDF Generation | ReportLab |
| Email | Resend |
| Server | Uvicorn |

### Frontend
| | |
|---|---|
| Framework | React 19 |
| Routing | React Router v7 |
| UI Components | Radix UI + shadcn/ui |
| Styling | Tailwind CSS |
| Charts | Recharts |
| HTTP Client | Axios |
| Forms | React Hook Form + Zod |

---

## Project Structure

```
ShemfordSchool/
├── backend/
│   ├── routes/           # API route handlers (students, fees, attendance, etc.)
│   ├── middleware/        # RBAC enforcement, rate limiting
│   ├── migrations/        # DB migration scripts
│   ├── tests/             # Pytest test suite
│   ├── models.py          # Pydantic data models
│   ├── database.py        # MongoDB connection
│   ├── auth_utils.py      # JWT, password hashing, audit logs
│   ├── server.py          # FastAPI app entry point
│   └── requirements.txt
└── frontend/
    ├── src/
    │   ├── components/    # Page-level React components
    │   ├── contexts/      # Auth context
    │   ├── hooks/         # Custom hooks
    │   └── lib/           # Axios instance, utilities
    └── package.json
```

---

## Getting Started

### Prerequisites

- Python 3.11+
- Node.js 18+ / Yarn
- MongoDB (local or Atlas)

---

### Backend Setup

```bash
cd backend

# Create and activate virtual environment
python -m venv .venv
.venv\Scripts\activate        # Windows
# source .venv/bin/activate   # macOS/Linux

# Install dependencies
pip install -r requirements.txt

# Create environment file
cp .env.example .env
# Fill in the values (see Environment Variables below)

# Start the server
uvicorn server:app --reload --port 8000
```

---

### Frontend Setup

```bash
cd frontend

# Install dependencies
yarn install

# Create environment file
echo "REACT_APP_BACKEND_URL=http://localhost:8000" > .env

# Start the dev server
yarn start
```

The app will open at `http://localhost:3000`.

---

## Environment Variables

Two files, neither of which is committed (both are in `.gitignore`):

| File | Used by | When it is read |
|---|---|---|
| `backend/.env` | FastAPI | At process start — **restart the backend after editing** |
| `frontend/.env` | CRA build | At **build** time — values are baked into the bundle, so rebuild after editing |

> **Secrets are deliberately not listed in this repo.** The tables below give
> every variable, what it does and the safe/example values. Get the real keys
> from the Ezetap/Axis and Razorpay onboarding mails, or ask the admin to send
> them through a password manager — never over chat, and never by committing
> them here. Anything pushed to GitHub must be treated as public.

### Backend — `backend/.env`

Copy `backend/.env.example` to `backend/.env` and fill it in.

| Variable | Required | Purpose / example |
|---|---|---|
| `MONGO_URL` | yes | `mongodb://localhost:27017/` locally. In Docker this is **overridden** by `docker-compose.yml` to `mongodb://mongo:27017/?replicaSet=rs0`, so the value here is ignored in containers. |
| `DB_NAME` | yes | `shemford_school` |
| `BACKEND_URL` | yes | `http://localhost:8000` (dev) / the public API URL in production |
| `FRONTEND_URL` | yes | Used for links in outgoing email |
| `SECRET_KEY` | yes | App signing secret — long random string |
| `JWT_SECRET` | yes | Signs access/refresh tokens. Changing it logs everyone out. |
| `FIELD_ENCRYPTION_KEY` | yes | Encrypts sensitive stored fields. **Losing it makes that data unreadable** — back it up. |
| `CORS_ORIGINS` | yes | Comma-separated allowed origins, e.g. `http://localhost:3000` |
| `RAZORPAY_KEY_ID` / `RAZORPAY_KEY_SECRET` | for online payments | Razorpay dashboard |
| `RAZORPAY_WEBHOOK_SECRET` | for online payments | Verifies webhook signatures |
| `EZETAP_BASE_URL` | for POS | `https://demo.ezetap.com` (UAT) / `https://www.ezetap.com` (live) |
| `EZETAP_USERNAME` | for POS | P2P **API** user — **not** the web-portal login. Live: `2834928346` |
| `EZETAP_APP_KEY` | for POS | Secret UUID issued with the API user |
| `EZETAP_ORG_CODE` | no | `SHEMFORD_FUTURISTIC_SCHOO` — currently read but never sent |
| `POS_DEVICE_WHITELIST_ENABLED` | no | Defaults to **`true`**. Only devices in `pos_devices` may charge. |
| `STRIPE_API_KEY` / `STRIPE_WEBHOOK_SECRET` | no | Unused in the current flow |
| `RESEND_API_KEY` | for email | Resend API key |
| `SENDER_EMAIL` | for email | Verified from-address |
| `OAUTH_SESSION_URL` | for Google login | OAuth session endpoint |
| `MAX_REQUEST_SIZE_MB` | no | Upload cap, defaults applied if unset |

Non-secret production identifiers for the live POS terminal (also in
`.env.example`): DSN `1494931339` → registered in `pos_devices` as
`1494931339|ezetap_android`; TID `86970252`; MID `037135003200170`.

### Frontend — `frontend/.env`

```
REACT_APP_BACKEND_URL=http://127.0.0.1:8001
REACT_APP_GOOGLE_AUTH_URL=
REACT_APP_RAZORPAY_KEY_ID=
```

| Variable | Purpose |
|---|---|
| `REACT_APP_BACKEND_URL` | API base URL. **Baked into the bundle at build time.** |
| `REACT_APP_GOOGLE_AUTH_URL` | Google OAuth entry point |
| `REACT_APP_RAZORPAY_KEY_ID` | Publishable key only — the secret stays server-side |

**Docker note:** the frontend image takes `REACT_APP_BACKEND_URL` as a *build
arg*, read from a `.env` at the **repo root** (not `frontend/.env`). If that file
is missing the build silently falls back to `http://localhost:8000`, which makes
every browser call its own machine and breaks the app for all remote users.
Check it before any `docker compose ... --build`:

```bash
cat .env   # must contain REACT_APP_BACKEND_URL=<public API url>
```

---

## Default Admin Setup

On first run, create an admin account via:

```
POST /api/auth/register
{
  "email": "admin@shemford.com",
  "password": "yourpassword",
  "name": "Admin",
  "role": "admin"
}
```

---

## API Overview

| Module | Base Route |
|--------|-----------|
| Auth | `/api/auth` |
| Students | `/api/students` |
| Onboarding | `/api/onboarding` |
| Employees | `/api/employees` |
| Fees | `/api/fees` |
| Attendance | `/api/attendance` |
| Marks | `/api/marks` |
| Payroll | `/api/payroll` |
| Announcements | `/api/announcements` |
| Reports | `/api/reports` |
| File Upload | `/api/upload` |

Interactive API docs available at `http://localhost:8000/docs` when the backend is running.

---

## Recent Changes (September 2026)

Notes for the mobile app developer. Items marked **server-side** are already
handled by the API — the app gets them automatically. Items marked **client-side**
were implemented in the React web app and need mirroring in the mobile app.

### 1. Fee receipt layout — two copies per student  *(server-side)*

`backend/routes/fees.py` → `GET /api/fees/receipt/{payment_id}/pdf`

The receipt PDF was rebuilt to match the school's reference format. One A4 page
now carries **one student**, whose Office Copy and Student Copy sit **side by
side** in the **top half** of the sheet. The bottom half is left blank so a
second student's receipt can share the page.

- Cut guide: a vertical dashed line between the two copies.
- Field order: Payment ID / Date → school name, address, phones → `Fee Receipt`
  + copy label → Student Name / Sec, Father Name / Session, Class / Admission No
  → fee table → Payment Date / Grand Total, Collected By / Paid → In Words →
  Payment Mode / Status. The receipt ends there — there is no footer note and no
  branding line.
- Fee table columns: Fees Type, Fees Code, Amount, Fine, Discount, Total.
- Copy height grows 13.5pt per fee line, capped to stay inside its half; extra
  lines collapse into a `+ N more fee line(s)` summary row.
- Amounts use `₹` when a Unicode TTF is registered (DejaVu on Linux, Arial on
  Windows) and fall back to `Rs.` on core Helvetica.
- "In Words" uses the Indian system (crore / lakh / thousand), e.g.
  `1900 → "One Thousand Nine Hundred Only"`.

Field mapping, since the schema names differ from the receipt labels:

| Receipt label | Source field |
|---|---|
| Father Name | `students.parent_name` |
| Fees Code | month abbreviation, else `fee_component` |
| Fine | `student_ledger.late_fee_applied` |
| Discount | `student_ledger.concession_amount` |
| Session | `students.academic_year` |

### 2. "Collected By" shows a name, not an ID  *(server-side)*

`collected_by` is **not** one kind of identifier — it holds an `employee_id` for
staff-collected payments, a `user_id` for some admin-collected ones, and legacy
free text (`seed_script`) for seeded rows. The receipt now resolves it by
checking `employees` first (matching either `employee_id` or `user_id`), then
`users`, rendering `Name(EMPCODE)` — e.g. `Jyoti Joshi(EMP20251A6834)`. An
unresolvable id prints an em dash rather than leaking an internal identifier.

### 3. Receipt download filename  *(client-side — app must mirror)*

Receipts download as **`FeesReceipt_<StudentName>.pdf`** (non-alphanumerics
stripped, e.g. `FeesReceipt_TanayaHazra.pdf`).

The API sets this in `Content-Disposition`, and `backend/server.py` now lists
that header in the CORS `expose_headers` — **without it the browser hides the
header from JavaScript** and the filename falls back to a blob UUID.

The web app reads it in `frontend/src/lib/download.js`:

```js
const match = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(
  res.headers['content-disposition']
);
```

The app should do the same rather than constructing its own filename.

### 4. Receipt preview vs download  *(client-side — app must mirror)*

Tapping a receipt must **preview** it, never download. Only an explicit
**Download** action writes a file:

| Action | Behaviour |
|---|---|
| Receipt button on a fee row / History / POS | Opens the preview |
| **Open in new tab** in the preview | Opens the PDF, saves nothing |
| **Download** in the preview | Saves `FeesReceipt_<StudentName>.pdf` |

The preview is also scoped by `ledger_id` (`?ledger_id=...`) so a per-fee receipt
previews the same PDF it downloads.

Known gap: `frontend/src/mobile/screens/MobileFees.js` still downloads straight
away on tap — it has no preview dialog. It was left as it was, and only picked up
the corrected filename. Add a preview step there (and in the mobile app) to match
the desktop behaviour.

### 5. Generated passwords on admin reset  *(server-side)*

An admin reset with no explicit password now generates the person's **own
identifier** instead of a random string:

| Endpoint | Generated password |
|---|---|
| `POST /api/students/{student_id}/reset-password` | `admission_number` |
| `POST /api/employees/{employee_id}/reset-password` | `employee_id` |
| `POST /api/users/{user_id}/reset-password` | student's admission no., else employee id |

A password supplied in the request body still wins. Anyone who is neither a
student nor an employee (e.g. a parent) still gets a random password. Accounts
created through onboarding still receive random temporary passwords — only
**reset** changed.

### 6. Academic session survives a refresh  *(client-side — app must mirror)*

`frontend/src/contexts/SessionContext.js`

An admin viewing a past academic year (e.g. 2025-2026) was snapped back to the
active session on every page load, because `load()` unconditionally overwrote
the stored choice. The admin's selection now persists across refreshes:

- Admins keep their chosen session, provided it still exists in
  `available_sessions`.
- Non-admins remain pinned to the active session.
- A stored session that no longer exists falls back to the active one, so nobody
  is stranded in a deleted or archived year.

The choice lives in `localStorage` under `view_session` and drives the
`X-Academic-Year` header on every request.

### 7. Ezetap POS (PushToPay) — production status

Production config lives in `backend/.env` (see `.env.example` for the
identifiers; the App Key is a secret and is never committed):

```
EZETAP_BASE_URL=https://www.ezetap.com
EZETAP_USERNAME=2834928346
```

**Currently blocked at Ezetap/Axis, not in our code.** `POST /p2padapter/pay`
with `deviceId "1494931339|ezetap_android"` returns `P2P_DEVICE_NOT_FOUND`,
while every response reports `"apps": []` — the API user is mapped to no
terminals. A deliberately invalid device id returns a *different* error
(`DEVICE_NOT_FOUND`), which shows our DSN is recognised at the device layer and
fails specifically at the PushToPay layer. Axis must map DSN `1494931339` to API
user `2834928346` and enable PushToPay. No app or backend change will alter this
until they do.

---

## License

Private — All rights reserved. © Somvanshi Technologies
