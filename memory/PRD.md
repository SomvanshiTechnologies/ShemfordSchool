# Shemford Futuristic School - School Management System

## Problem Statement
Build a complete, production-ready School Management System for "Shemford Futuristic School" implementing realistic Indian school ERP business logic with strict RBAC enforcement. Additionally, build a React Native (Expo) mobile app for daily use by Admin, Teachers, Parents, and Students.

## Core Business Rules
- **Fees**: Admin defines Annual Fee per class -> 12 monthly installments. No skipped/partial payments. Auto-overdue, late fees, concessions, sibling discounts. Sequential receipt numbering.
- **Attendance**: Teacher marks daily -> locks on submit. Admin override to unlock. Holiday calendar. Auto-notify parents. Threshold alerts (<75%). Employee attendance.
- **Marks**: Exam-based workflow with lock/unlock/publish. CBSE-style grading (A1-E).
- **RBAC**: Admin (full), Teacher (marks/attendance), Parent (view + pay fees), Student (view-only).

## Tech Stack
- **Desktop Frontend**: React, TailwindCSS, Shadcn/UI (Monochrome: Orange #E88A1A, White, Black #1A1A1A)
- **Mobile App**: React Native (Expo SDK 55), React Navigation, Ionicons
- **Backend**: FastAPI (Python), Pydantic, 16 modular routers
- **Database**: MongoDB (motor)
- **Auth**: JWT + Google OAuth (Emergent-managed)

## Test Credentials
| Role | Email | Password |
|---|---|---|
| Admin | admin@test.com | Test1234! |
| Teacher | teacher@school.com | Teacher1234! |
| Parent | parent@test.com | Test1234! |

## What's Been Implemented

### Desktop Web App (Complete)
- Full modular backend with 16 routers
- Dashboard per role, student/parent self-service views
- Fees: Auto-overdue, late fees, concessions, sibling discounts, receipt numbering, reminders
- Attendance: Lock/unlock, holiday calendar, threshold alerts, employee tracking
- Marks: Exam workflow, CBSE grading, PDF marksheets
- PWA support with manifest.json and service worker

### React Native Mobile App (Complete - March 2026)
Location: `/app/mobile/`
- **Expo SDK 55** with React Navigation bottom tabs
- **Role-based tab navigators**: Admin (Home/Students/Fees/Attendance/More), Teacher (Home/Attendance/Marks/Messages/More), Parent (Home/Fees/Messages/Notices/More), Student (Home/Marks/Attendance/Notices/More)
- **Screens**: LoginScreen, AdminDashboard, TeacherDashboard, ParentDashboard, StudentDashboard, AttendanceScreen, FeesScreen, MarksScreen, MessagesScreen, NoticesScreen, ReportsScreen, StudentsScreen, MoreScreen
- **Shared components**: StatCard, ActionButton, UI (Card, Badge, Avatar, SectionTitle, EmptyState), LoadingSkeleton
- **Features**: JWT auth with SecureStore, Axios API client, native modals (fee payment bottom sheet), chip selectors, pull-to-refresh compatible, dark/orange/white theme
- **Build verified**: Expo web export successful (zero errors)
- Connects to same FastAPI backend as desktop app

## Architecture
```
/app/
├── backend/ (FastAPI, 16 routers, MongoDB)
├── frontend/ (React desktop web app with PWA)
│   └── src/
│       ├── App.js (Desktop + /m/* mobile web routes)
│       ├── components/ (Desktop components)
│       └── mobile/ (PWA mobile web - also works)
└── mobile/ (React Native Expo app - NEW)
    ├── App.js (Entry point)
    ├── app.json (Expo config)
    └── src/
        ├── api/client.js (Axios + SecureStore auth)
        ├── components/ (StatCard, ActionButton, UI, Skeleton)
        ├── contexts/AuthContext.js (JWT auth)
        ├── navigation/ (AppNavigator, TabNavigator)
        ├── screens/ (13 screens, 4 role dashboards)
        └── theme/colors.js
```

## P1 - Upcoming Tasks
- Real Stripe payment gateway integration (currently MOCKED)
- Real notification system (SendGrid/Twilio) (currently MOCKED)
- Voice note feature
- Push notifications for mobile app

## P2 - Future/Backlog
- Advanced security hardening
- Issue tracking enhancement
- Timetable & Library management
- EAS Build for APK/IPA distribution
