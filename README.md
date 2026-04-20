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

### Backend `.env`

```env
MONGO_URL=mongodb://localhost:27017
DB_NAME=shemford_school
JWT_SECRET=your_jwt_secret_key
BACKEND_URL=http://localhost:8000
CORS_ORIGINS=http://localhost:3000

# Razorpay (optional — for online payments)
RAZORPAY_KEY_ID=your_key_id
RAZORPAY_KEY_SECRET=your_key_secret

# Email (optional — Resend)
RESEND_API_KEY=your_resend_key
FROM_EMAIL=no-reply@yourdomain.com
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

## License

Private — All rights reserved. © Somvanshi Technologies
