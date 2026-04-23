# Shemford School — Handover Guide

A school management system with 3 parts, all talking to one database.

```
  Website (PC/laptop)  ┐
                       ├──►  Backend API  ───►  MongoDB
  Mobile app (phone)   ┘
```

- **Backend** = Python (FastAPI) on port **8000**. Serves all the data.
- **Website** = React on port **3000**. Desktop view.
- **Mobile app** = React Native (Expo). Phone view.
- **Database** = MongoDB, running locally on port **27017**.

Website and mobile app show the **same data** because they ask the same backend.

---

## 1. What you need installed

| Tool | Version | Why |
|---|---|---|
| Node.js | 18 or newer | Runs website + mobile app |
| Python | 3.12 or 3.13 | Runs backend |
| MongoDB | 6 or 7 (Community) | Stores all data |
| Expo Go app | Latest | Open the mobile app on your phone. Get from Play Store / App Store. |
| Git | any | Clone and version control |

Check MongoDB is running: open a terminal and type `mongosh` — if it connects, you're good. On Windows the MongoDB service is usually already on after install.

---

## 2. First time setup (one time only)

Open a terminal in the project folder.

### 2a. Backend
```
cd backend
python -m venv venv
venv\Scripts\activate
pip install -r requirements.txt
```

### 2b. Website
```
cd frontend
npm install
```

### 2c. Mobile app
```
cd mobile
npm install
```

---

## 3. Fill in secrets (backend/.env)

File: `backend/.env` — already has everything for local testing. For real use, change these values:

- `MONGO_URL` — where MongoDB lives. Default `mongodb://localhost:27017/` is fine for local.
- `SECRET_KEY` and `JWT_SECRET` — any long random string.
- `FIELD_ENCRYPTION_KEY` — encrypts employee bank details. Don't change this after data is saved, or old bank data stops decrypting.
- `RAZORPAY_KEY_ID` / `RAZORPAY_KEY_SECRET` — test keys work for demos. Use live keys for real payments.
- `RESEND_API_KEY` — leave blank; password-reset emails just log to the console instead of sending.
- `CORS_ORIGINS` — list of frontends allowed to talk to the backend. For local: `http://localhost:3000`. Add more (comma-separated) if you add web mobile or a production domain.

Website file: `frontend/.env` has `REACT_APP_BACKEND_URL=http://localhost:8000`. Keep this.

---

## 4. Load the demo data (one time)

This fills the empty database with 1,462 students, 29 staff, a full year of attendance, fees, marks, etc.

```
cd backend
venv\Scripts\activate
python seed_data.py
python seed_test_student.py
```

`seed_data.py` wipes the demo collections and rebuilds them. Safe to re-run any time, but **any real data you added will be deleted** — don't run this on production.

`seed_test_student.py` links the test student/parent logins to one real student (Arjun Kumar, class 5th-Green). Re-runnable.

---

## 5. Start everything

**Open three terminals.**

### Terminal 1 — Backend
```
cd backend
venv\Scripts\activate
python -m uvicorn server:app --host 0.0.0.0 --port 8000
```

Check it works: open `http://localhost:8000/health` in a browser. You should see `{"status":"ok"}`.

### Terminal 2 — Website
```
cd frontend
npm start
```

Opens automatically at `http://localhost:3000`.

### Terminal 3 — Mobile app
```
cd mobile
npx expo start
```

A QR code appears in the terminal. Open **Expo Go** on your phone and scan it.

Phone and PC must be on the same Wi-Fi. If the phone loads the app but login hangs, open Windows Firewall and allow port **8000** (backend) and the Expo port (usually **8081**) inbound. One-time command in admin PowerShell:

```
New-NetFirewallRule -DisplayName "Backend 8000" -Direction Inbound -Protocol TCP -LocalPort 8000 -Action Allow -Profile Private
New-NetFirewallRule -DisplayName "Expo Metro"   -Direction Inbound -Protocol TCP -LocalPort 8081 -Action Allow -Profile Private
```

---

## 6. Test logins (always available after seed)

| Role       | Email                       | Password     | What they see |
|------------|-----------------------------|--------------|---|
| Admin      | admin@shemford.edu          | Admin1234    | Everything |
| Teacher    | teacher@shemford.edu        | Teacher1234  | Their classes, attendance, marks |
| Student    | student@shemford.edu        | Student1234  | Arjun Kumar's dashboard |
| Parent     | parent@shemford.edu         | Parent1234   | Their child (Arjun Kumar) |
| Accountant | accountant@shemford.edu     | Account1234  | Fees, reports |

Email login is **case and whitespace tolerant** — `STUDENT@shemford.edu  ` also works.

---

## 7. Folder map (what's where)

```
backend/
  server.py            ← starts the API, mounts all routes
  database.py          ← MongoDB connection
  models.py            ← data shapes (User, Student, Exam, etc.)
  db_init.py           ← creates MongoDB indexes on startup
  auth_utils.py        ← password hashing + JWT tokens
  security.py          ← bank field encryption
  seed_data.py         ← builds the demo database
  seed_test_student.py ← links test student/parent to one real student
  .env                 ← secrets (do not commit real ones)
  routes/              ← one file per feature
    auth.py            → login, register, password reset
    students.py        → student CRUD, CSV import
    employees.py       → staff
    attendance.py      → mark + view attendance
    marks.py           → exams + marks entry
    fees.py            → fee ledger, payments
    razorpay_payments.py → online payments
    reports.py         → dashboard stats, PDF/Excel exports
    announcements.py, messages.py, issues.py, syllabus.py, classes.py, onboarding.py, upgradation.py, notifications.py, settings.py, utilities.py, admin.py, payroll.py
  middleware/
    rate_limiter.py    → throttles login etc.
    rbac.py            → blocks unauth'd API calls
  tests/               ← a few pytest files

frontend/                                (the website)
  src/
    App.js                               → React app entry
    index.js                             → React DOM root
    contexts/AuthContext.js              → holds logged-in user
    lib/api.js                           → axios client (talks to backend)
    components/
      Layout.js                          → sidebar + header
      Dashboard.js                       → main dashboard (by role)
      LoginPage.js                       → login form
      StudentsPage.js, EmployeesPage.js, AttendancePage.js, FeesPage.js,
      MarksPage.js, ReportsPage.js, AnnouncementsPage.js, MessagesPage.js,
      IssuesPage.js, SyllabusPage.js, ClassStructurePage.js, PayrollPage.js,
      SettingsPage.js, UsersPage.js, UpgradationPage.js, ...
      ui/                                → shared widgets (button, card, etc.)
  public/                                → static assets (logo, index.html)
  .env                                   → sets REACT_APP_BACKEND_URL

mobile/                                  (the phone app)
  App.js                                 → Expo entry point
  src/
    config.js                            → auto-detects backend IP from Wi-Fi
    api/client.js                        → axios client
    contexts/AuthContext.js              → logged-in user
    navigation/
      AppNavigator.js                    → login vs main app, stack screens
      TabNavigator.js                    → role-specific bottom tabs
    theme/colors.js                      → colour + shape tokens
    components/
      UI.js, StatCard.js, ActionButton.js, LoadingSkeleton.js
    screens/
      LoginScreen.js
      admin/AdminDashboard.js
      teacher/TeacherDashboard.js
      student/StudentDashboard.js
      parent/ParentDashboard.js
      StudentsScreen.js, AttendanceScreen.js, MarksScreen.js, FeesScreen.js,
      MessagesScreen.js, NoticesScreen.js, ReportsScreen.js, MoreScreen.js
```

---

## 8. How the code is wired

- Website and phone both store the logged-in user's JWT token, then send it as `Authorization: Bearer <token>` on every API call.
- Backend checks the token on every `/api/*` request (see `middleware/rbac.py` + `auth_utils.py`).
- Every write (new student, attendance, payment) goes into MongoDB. Both clients read from the same DB, so they always see the same data.
- Mobile auto-detects the backend host: when the phone loads the app from `http://192.168.1.5:8081`, it calls the API at `http://192.168.1.5:8000`. No IP to type in manually.

---

## 9. What works today

Each item tells you: **what it does**, **where it lives on the website**, **where it lives on the phone app**, and **what happens under the hood**.

### Login / register / password reset
- Login with email + password. Works even if the user types capital letters or extra spaces (the backend cleans it up).
- Register screen on the website creates a **parent** account only. Admins create all other roles from Users page.
- Password reset: user clicks "Forgot password" → backend makes a one-time token → emails it (or logs it to console if `RESEND_API_KEY` is blank). User pastes the token into the reset form → sets new password.
- All sessions use a JWT token valid for 15 minutes. A refresh token auto-renews it.
- **Files:** website `frontend/src/components/LoginPage.js` · phone `mobile/src/screens/LoginScreen.js` · backend `backend/routes/auth.py`.

### Role-based dashboards
- **Admin** sees total students, total employees, today's attendance count, fee collection this month, fee overdue count, open issues, recent activity feed, low-attendance alerts.
- **Teacher** sees their assigned classes, today's attendance status, pending marks entry.
- **Student** sees their own class/section, attendance %, fee status, announcements.
- **Parent** sees each child with class + fee status + attendance.
- **Accountant** sees student count, month collection, overdue count, employees.
- Data auto-refreshes every 60 seconds while the tab is open.
- **Files:** website `frontend/src/components/Dashboard.js` · phone `mobile/src/screens/admin|teacher|student|parent/*.js` · backend `GET /api/reports/dashboard`.

### Students
- Admin can add a new student (the form creates a user account + parent user at the same time, all linked by `parent_id`).
- Bulk CSV import: go to Students page → "Import CSV" → upload. Two-phase: preview rows first, then commit only the valid ones.
- Filter by class, section, fee status, or search by name / admission number.
- Edit a student's info, reset their password, or reset the linked parent password.
- Active/Inactive toggle (soft-delete) — inactive students don't show up in most lists or in dashboard counts.
- Roll numbers are kept unique per `(class, section, stream)` by a counter in the `counters` collection.
- **Files:** website `frontend/src/components/StudentsPage.js` · phone `mobile/src/screens/StudentsScreen.js` · backend `backend/routes/students.py`.

### Employees (staff)
- Add teachers or admin staff. Email + phone + designation + department + salary + joining date.
- Optional: link a **user** to the employee so they can log in.
- Bank details (account number, IFSC) are **encrypted on disk** using `FIELD_ENCRYPTION_KEY`. The API decrypts on read so the UI shows plain text to admins.
- Payroll page generates payslips per month per employee, calculates net salary after deductions, and exports PDF.
- **Files:** website `frontend/src/components/EmployeesPage.js` + `PayrollPage.js` · backend `routes/employees.py` + `routes/payroll.py`.

### Attendance
- Teacher/admin picks class → section → date → sees all students in that section → marks each Present / Absent / Leave (or "All Present" button).
- "Submit & Lock" — once locked, only admin can unlock. Prevents teachers from editing yesterday's attendance.
- Holidays (in the `holidays` collection) auto-block marking on those dates.
- Parents are auto-notified (via message) when their child is marked absent.
- Low-attendance alert: dashboard shows students under 75% in the last 30 days.
- Student/parent sees their own record with a percentage + day-by-day list.
- **Files:** `AttendancePage.js` (web) · `AttendanceScreen.js` (phone) · `routes/attendance.py`.

### Marks / exams
- Admin defines an exam: name, type (Unit Test / Term), class, stream, date range, subjects with max marks.
- Teacher enters marks per student per subject. Auto-calculates grade (A+ / A / B / C / D / F) from percentage.
- "Publish" an exam makes marks visible to students and parents.
- "Lock" prevents further edits after publishing.
- Marksheet PDF: `GET /api/marks/marksheet/{student_id}/pdf?academic_year=2025-2026` — downloads a formatted report card.
- Student/parent only see published + locked exams, never unpublished ones.
- **Files:** `MarksPage.js` (web) · `MarksScreen.js` (phone) · `routes/marks.py`.

### Fees
- Each class has a `fee_component_configs` entry: tuition (monthly), activity, lab, admission, annual, etc.
- When a student is enrolled, a 19-entry ledger is auto-created (one-time + yearly components + 12 monthly tuition entries).
- Admin records a cash/UPI payment against specific ledger entries → a receipt is generated (`REC/2025-26/<seq>`).
- Parent/student can pay online via **Razorpay** (card / UPI / netbanking). Backend creates a Razorpay order, opens the checkout page, and on success updates the ledger + creates a `fee_payments` record. A webhook at `/api/webhook/razorpay` handles server-confirmed payments.
- Overdue detection: any pending entry past its `due_date` is flipped to `overdue` and a ₹200 late fee is added.
- Concessions: admin can reduce any entry's amount with a reason.
- **Files:** `FeesPage.js` (web) · `FeesScreen.js` (phone) · `routes/fees.py` + `routes/razorpay_payments.py`.

### Announcements, messages, holidays, classes
- Announcements: admin posts notices to "all", or filter to a specific class / role. Student / parent / teacher see them on their dashboard.
- Messages: one-off messages from admin/teacher to a specific parent/student. Currently view-only on phone — composing is pending (see section 10).
- Holidays: admin adds a holiday → attendance is auto-blocked that day.
- Class structure: admin defines classes, sections (Violet/Indigo/Blue/Green/Yellow/Orange/Red), and streams (Science/Humanities for 11/12) with capacity per section.
- **Files:** `AnnouncementsPage.js`, `MessagesPage.js`, `ClassStructurePage.js`, `routes/announcements.py`, `routes/messages.py`, `routes/classes.py`.

### Reports
- **Financial report**: total collection, total pending, breakdown by payment method (cash/UPI/cheque/bank transfer), breakdown by month. Exportable as PDF or Excel.
- **Attendance report**: present/absent/leave counts, percentage, filterable by class + date range.
- **Academic report**: class-wise average marks, per-subject stats.
- Export endpoints stream a file back — the browser auto-downloads it.
- **Files:** `ReportsPage.js` · `ReportsScreen.js` · `routes/reports.py`.

### User management
- Admin-only page. Create any role (student, teacher, parent, accountant, admin).
- Deactivate a user — they stay in the DB but can't log in.
- See last login time, creation date, linked student/employee.
- **File:** `UsersPage.js` · backend endpoint `POST /api/auth/create-user`.

---

## 10. What is NOT finished yet (real work to do)

### Priority 1 — finish these for real use

#### Password reset emails actually delivered
- **Symptom today:** user clicks "Forgot password" on the website, the backend logs `WARNING: RESEND_API_KEY not set` and the reset link never lands in the user's inbox.
- **Why:** `RESEND_API_KEY` is blank in `backend/.env`.
- **What to do:** Sign up at resend.com (free tier is fine for low volume), copy the API key, paste it as `RESEND_API_KEY=re_xxx...` in `backend/.env`, also set `SENDER_EMAIL=noreply@<yourdomain>` (must be a verified domain in Resend dashboard). Restart the backend.
- **Test:** call `POST /api/auth/forgot-password` with a real email; check the inbox.
- **File:** sending code is at `backend/routes/auth.py` function `_send_password_reset_email`.

#### Mobile: "compose message" screen
- **Symptom:** on the phone, a parent can read messages from the teacher but has no way to reply. There is no compose button.
- **Backend:** `POST /api/messages` already accepts `{recipient_id, subject, content, message_type}`. Working from the website.
- **What to do:** Create `mobile/src/screens/ComposeMessageScreen.js` with a recipient dropdown (load from `/api/users?role=teacher` for parents), subject + body fields, and a Send button that posts to `/api/messages`. Register it in `mobile/src/navigation/AppNavigator.js` as a stack screen called `ComposeMessage`. Add a floating `+` button on `MessagesScreen.js` that calls `navigation.navigate('ComposeMessage')`.

#### Mobile: Syllabus and Issues screens
- **Symptom:** tapping these in the More menu shows a "Coming Soon" alert.
- **Backend:** `GET /api/syllabus` and `GET /api/issues` already work. POST/PATCH for Issues exists.
- **What to do:**
  1. `mobile/src/screens/SyllabusScreen.js` — load `/api/syllabus?class_name=<user's class>`, render a list grouped by subject with a download link (`file_url`).
  2. `mobile/src/screens/IssuesScreen.js` — load `/api/issues`, show list with status chip; add a "Raise Issue" form that POSTs `{title, description, category, priority}`.
  3. Register both in `AppNavigator.js`. Update `MoreScreen.js` to remove the "Coming Soon" fallback once the screens exist.

#### Push notifications
- **Goal:** when a teacher marks attendance / posts an announcement / records a fee payment, the parent's phone gets a push.
- **What to do:**
  1. Phone: `npx expo install expo-notifications`. On login, call `Notifications.getExpoPushTokenAsync()` and send the token to the backend (`POST /api/notifications/register-device {token}`).
  2. Backend: store the token in a new `device_tokens` collection with `{user_id, token, platform}`.
  3. Whenever an announcement/message is created, look up the target users' tokens and call Expo's push service (`https://exp.host/--/api/v2/push/send` with a JSON batch).
  4. Handle token invalidation responses (delete tokens that come back as `DeviceNotRegistered`).
- **Scaffolding:** an empty `backend/routes/notifications.py` exists — build it out.

#### Production secrets
- **Why:** `SECRET_KEY`, `JWT_SECRET`, `FIELD_ENCRYPTION_KEY` in `backend/.env` are **committed demo values**. Anyone with the repo can forge JWTs.
- **What to do:**
  1. Generate new random values: `python -c "import secrets; print(secrets.token_hex(32))"` three times.
  2. Paste them into the production `backend/.env` (don't commit — add `.env` to `.gitignore`).
  3. **`FIELD_ENCRYPTION_KEY` exception:** once you have real employee bank data in the DB, **do not change this key** — old encrypted values will become unreadable. If you must rotate it, write a migration that re-encrypts on the fly.
  4. Razorpay: replace `rzp_test_...` with live keys from dashboard.razorpay.com. Also set `RAZORPAY_WEBHOOK_SECRET` to the secret shown there, and register the webhook URL `https://<yourdomain>/api/webhook/razorpay` in Razorpay dashboard.

### Priority 2 — nice to have

#### MongoDB backups (scheduled)
- **Why it matters:** no backup exists today. If MongoDB dies or someone runs `seed_data.py` on production, all real data is gone.
- **What to do (Windows example):**
  ```
  # Save as C:\scripts\mongo-backup.ps1
  $ts = Get-Date -Format 'yyyyMMdd-HHmm'
  mongodump --uri='mongodb://localhost:27017/' --db=shemford_school `
            --archive="D:\backups\shemford-$ts.archive" --gzip
  # Delete backups older than 30 days
  Get-ChildItem 'D:\backups\shemford-*.archive' | Where-Object {
    $_.LastWriteTime -lt (Get-Date).AddDays(-30)
  } | Remove-Item
  ```
  Schedule it with Task Scheduler → daily at 2 AM.
- **On-demand backup:** the admin panel has a button wired to `POST /api/admin/backup` — same effect, but only when an admin clicks. Run it before risky operations.

#### Google Sign-in
- `OAUTH_SESSION_URL` in `backend/.env` points at a demo endpoint. It needs to be your own OAuth proxy that returns `{email, name, picture}` given a session ID.
- Easier path: use **Firebase Auth** or **Supabase Auth** for the OAuth dance, then exchange their token for a JWT at `/api/auth/session`.
- **Today's fallback:** the Google button on the login page is hidden if `OAUTH_SESSION_URL` is blank. Leaving it blank is fine.

#### Offline support on phone
- **Use case:** a teacher in a classroom with flaky Wi-Fi marks attendance; it should save locally and sync when back online.
- **What to do:** add `expo-sqlite` to mobile, wrap `client.post('/attendance', ...)` with a queue — if request fails, store in SQLite with status `pending`, retry on app foreground + when network reachable (use `@react-native-community/netinfo`).

#### Tests
- Backend: only `backend/tests/test_razorpay.py` exists. Add pytest tests for `auth`, `students`, `attendance`, `marks`, `fees` routes. There's already a `backend/tests/conftest.py` with fixtures you can extend.
- Frontend: no tests at all. Start with **React Testing Library** for LoginPage and Dashboard.
- Mobile: no tests at all. Use **Jest + React Native Testing Library**.

### Priority 3 — known small bugs

1. **Teacher's "my classes" count is broken.** Backend writes `marked_by = <employee_id>` on attendance but `routes/reports.py` line 55 queries `{"marked_by": user["user_id"]}`. Fix either side:
   - Cleaner: in `backend/seed_data.py` line 656 and wherever attendance is created, store `user_id` not `employee_id`. This is the "person who marked it" — user_id is the right identity.
   - Quick: in `routes/reports.py`, resolve the employee by user_id first, then filter attendance by that `employee_id`.

2. **Rate limiter resets on restart.** `backend/middleware/rate_limiter.py` keeps request counts in a Python dict. Restarting the backend clears them all. Fine for one-instance, breaks for multi-process. **Fix:** swap the dict for Redis (`redis.asyncio`). Keep the same sliding-window logic; just move storage.

3. **Some error toasts on the website are generic.** `frontend/src/lib/api.js` shows `"Login failed"` for any non-401 error. **Fix:** forward `error.response?.data?.detail` into the toast so users see the backend's exact reason.

4. **Mobile dashboard overdue count includes future months.** `mobile/src/screens/admin/AdminDashboard.js` uses `x.months_overdue > 0` from `/fees/due-chart`. This works, but the stat card label says "Overdue students" while the number is actually "students with any pending dues". **Fix:** either rename the label to "With Dues" or only count students where `overdue_amount > 0`.

5. **Receipt number format.** The main seed uses `REC/2025-26/<seq>` and `seed_test_student.py` uses `REC/2025-26/TS-<uuid>`. They don't collide but look inconsistent on the receipt PDF. **Fix:** pick one format and stick with it — the seeded pattern is the standard one.

---

## 11. Going to production — checklist

Do these in order. Each one has the **why**, then the **how**.

- [ ] **Rotate all secrets in `backend/.env`.**
  **Why:** the demo file is in the repo. Anyone who sees it can forge JWTs and decrypt employee bank data.
  **How:** in an admin terminal, run `python -c "import secrets; print(secrets.token_hex(32))"` three times — paste the outputs as `SECRET_KEY`, `JWT_SECRET`, `FIELD_ENCRYPTION_KEY` on the production server only. Never commit them. Add `backend/.env` to `.gitignore` if not already. Use the cloud provider's secret manager (AWS Secrets Manager, GCP Secret Manager, Azure Key Vault) in production rather than an on-disk file.

- [ ] **Set `CORS_ORIGINS` to the real domain only.**
  **Why:** leaving `http://localhost:3000` in production lets a malicious site load your API if a user has a stale tab open.
  **How:** edit `backend/.env`: `CORS_ORIGINS=https://portal.shemford.edu`. Multiple domains? Comma-separate: `https://portal.shemford.edu,https://admin.shemford.edu`. Restart the backend.

- [ ] **Use a MongoDB replica set, not standalone.**
  **Why:** standalone has no oplog → no point-in-time recovery → one bad delete erases everything. Replica set also gives you automatic failover.
  **How:** cheapest path is **MongoDB Atlas M10** (free tier M0 works for small loads but no backup). Create a cluster → get the connection string → paste into `MONGO_URL` in production `.env`. Restart backend. The schema + indexes are idempotent, `db_init.py` will create them on first startup.

- [ ] **Put the backend behind nginx (or Caddy) with HTTPS.**
  **Why:** uvicorn doesn't terminate TLS well, and bare HTTP means login passwords travel in plain text.
  **How (nginx example):**
  ```
  server {
    listen 443 ssl;
    server_name api.shemford.edu;
    ssl_certificate /etc/letsencrypt/live/api.shemford.edu/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/api.shemford.edu/privkey.pem;
    location / {
      proxy_pass http://127.0.0.1:8000;
      proxy_set_header Host $host;
      proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
      proxy_set_header X-Forwarded-Proto $scheme;
    }
  }
  ```
  Run backend as a systemd service (not `uvicorn` in a terminal) so it auto-restarts. Use `certbot` for free Let's Encrypt certs.

- [ ] **Build the website once and host the static output.**
  **Why:** `npm start` runs a dev server — slow, not cached, restarts leak memory. Production should serve pre-compiled files.
  **How:**
  ```
  cd frontend
  REACT_APP_BACKEND_URL=https://api.shemford.edu npm run build
  ```
  This makes `frontend/build/` — copy it to your nginx `root` folder (e.g. `/var/www/shemford`). `frontend/nginx.conf` already has a working config you can adapt. `frontend/Dockerfile` does the whole thing in a container if you prefer Docker.

- [ ] **Build + submit the mobile app.**
  **Why:** Expo Go is only for development. Real users install from the store.
  **How:**
  1. Create an Expo account at expo.dev.
  2. `cd mobile && npx eas login`
  3. `npx eas build:configure` (one time per project)
  4. Edit `mobile/src/config.js` to hardcode the production host: replace the `detectDevHost()` fallback with `https://api.shemford.edu` and set `API_PORT = 443`.
  5. `npx eas build -p android --profile production` → downloads an `.aab` file.
  6. Upload to Google Play Console. Same steps with `-p ios` for App Store.

- [ ] **Switch Razorpay to live mode.**
  **Why:** test keys don't move real money.
  **How:** Razorpay dashboard → KYC + bank verification (takes 2–5 days) → Settings → API Keys → generate **live** keys. Replace `RAZORPAY_KEY_ID` / `RAZORPAY_KEY_SECRET` in production `.env`. Also regenerate the **webhook secret** and update `RAZORPAY_WEBHOOK_SECRET`. Register the webhook URL `https://api.shemford.edu/api/webhook/razorpay` in the Razorpay dashboard and tick these events: `payment.captured`, `payment.failed`, `refund.processed`.

- [ ] **Set up nightly MongoDB backups, keep 30 days.**
  **Why:** a single bug or bad query can trash data; without a recent backup there's no way back.
  **How:** see the `mongo-backup.ps1` script in section 10 Priority 2. Schedule daily at 2 AM local time. Store backups on a **different drive or bucket** than the DB itself (S3 / Azure Blob / Google Cloud Storage).

- [ ] **Add uptime + error monitoring.**
  **Why:** you want to hear about outages before users do.
  **How:**
  - Uptime: UptimeRobot (free) → add a monitor pointing at `https://api.shemford.edu/health` every 5 minutes. Slack/email alert on down.
  - Errors: Sentry (free tier) → install `sentry-sdk[fastapi]` in backend and `@sentry/react` in frontend. Wrap the FastAPI app with Sentry's middleware. Lets you see unhandled exceptions with stack trace.

- [ ] **Lock down MongoDB.**
  **Why:** default install has no auth. Anyone who reaches the port can read/drop your data.
  **How:** in `mongod.conf`, set `security.authorization: enabled`. Create an admin user + an app user. Update `MONGO_URL` to include credentials: `mongodb://appuser:pw@host:27017/shemford_school?authSource=admin`. If using Atlas, this is on by default.

- [ ] **Remove the demo seed scripts from the production server.**
  **Why:** `seed_data.py` **drops 22 collections**. If anyone runs it against production, you lose everything.
  **How:** don't deploy `seed_data.py` and `seed_test_student.py`. Add them to `.dockerignore` / your deploy script's exclude list.

---

## 12. If something breaks — quick fixes

**"Login says invalid credentials"** → Wrong email or password. Case/spaces don't matter.
If it says this even with correct login, the backend can't reach the DB, or the DB was wiped. Restart backend; if still fails, re-run `seed_data.py`.

**"Dashboard shows 0 students"** → Backend isn't connected to the seeded DB. Check `DB_NAME=shemford_school` in `backend/.env`. Run `seed_data.py` if empty.

**"Phone app says Cannot reach server"** → Windows Firewall. Allow port 8000 inbound (see section 5).

**"CORS error in browser console"** → Add the website's URL to `CORS_ORIGINS` in `backend/.env`, restart backend.

**Port already in use** → A stale Python or Node process. On Windows:
```
Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -match 'uvicorn' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
```

**MongoDB won't start** → On Windows, run `net start MongoDB` as admin. On other OSes: `sudo systemctl start mongod`.

---

## 13. First 10 minutes after you get this project

Follow these steps in order. If any step's "expected result" doesn't match, stop and fix that step before moving on.

### Step 1 — install the basics (~5 min, one time)
- Node 18+ from https://nodejs.org (LTS installer).
- Python 3.12+ from https://python.org (tick "Add to PATH").
- MongoDB Community Server from https://mongodb.com/try/download/community. Pick "Complete" setup — it installs MongoDB as a Windows service that auto-starts.
- Expo Go app on your phone (Play Store / App Store).

**Check:** open a terminal and run these. Each should print a version number.
```
node --version
python --version
```

### Step 2 — install project dependencies
```
cd backend
python -m venv venv
venv\Scripts\activate
pip install -r requirements.txt
```
This takes ~2 min. You'll see pip downloading FastAPI, motor, pymongo, etc.

Then in two more terminals:
```
cd frontend && npm install
cd mobile   && npm install
```

**Expected:** no `ERR!` in the output. Warnings about deprecated packages are fine.

### Step 3 — start the backend
```
cd backend
venv\Scripts\activate
python -m uvicorn server:app --host 0.0.0.0 --port 8000
```
Leave this terminal open.

**Expected:** last few lines of output:
```
INFO:     Uvicorn running on http://0.0.0.0:8000
Database indexes: N created/verified, 0 warnings
Startup complete — DB indexes verified, job worker running
```

**Test:** open `http://localhost:8000/health` in a browser → should show `{"status":"ok"}`.

If MongoDB isn't running you'll see `ServerSelectionTimeoutError`. Start MongoDB: in an admin terminal run `net start MongoDB`.

### Step 4 — seed the demo data
**Open a second terminal** (leave the backend running in the first).
```
cd backend
venv\Scripts\activate
python seed_data.py
python seed_test_student.py
```

**Expected output:**
```
[1/9] Users
  Users: 5 test accounts
[2/9] Classes
  Classes: 15 ...
...
  Students: ~1460
  Attendance records: ~460000 ...
Done! All data seeded successfully.
```
Takes about 30–45 seconds.

Then `seed_test_student.py` prints:
```
Student             : Arjun Kumar (STU2025XXXXXX)  class 5th-Green, roll 14
```

### Step 5 — start the website
Third terminal:
```
cd frontend
npm start
```
Browser opens automatically at `http://localhost:3000`.

**Test:** login with `admin@shemford.edu / Admin1234`. You should see:
- Dashboard shows **~1,462 total students**, **29 total employees**.
- Fee Collection card shows a rupee value (≥ ₹1 crore).
- Sidebar has Students, Classes, Attendance, Marks, Fees, Employees, Reports, etc.

Go to **Students** page → should list paginated students. Search for "Arjun" → one result (Arjun Kumar, 5th-Green, roll 14).

### Step 6 — start the mobile app
Fourth terminal:
```
cd mobile
npx expo start
```
A QR code appears in the terminal.

**Test on phone:** open Expo Go, scan the QR. App loads (first time takes ~20 sec as Metro bundles).

Login as `student@shemford.edu / Student1234`.
**Expected on phone:** "Hi, Arjun" header, class 5th-Green, attendance ring around 90%, stat cards, quick actions, and recent announcements.

**If phone shows "Cannot reach server":** Windows Firewall is blocking. Run the two firewall commands in section 5. Close and reopen Expo Go, rescan the QR.

### Step 7 — smoke-test consistency
Prove data is shared across clients:
1. Phone → login as `student@shemford.edu` → note the "Attendance %" on the dashboard.
2. Website → login as `parent@shemford.edu / Parent1234` → go to Children's Attendance → should show Arjun with the same percentage.
3. Website → login as `admin@shemford.edu` → Students page → filter class 5th section Green → Arjun is in the list with the same student ID.

All three views agree → system is healthy. You're ready to start development.

**Total elapsed time:** 8–12 minutes depending on download speeds.

---

## 14. Contact points in the code

The 5 most common tasks you'll do, with exact file paths and line anchors.

### Add a new API endpoint
**Example:** add `GET /api/library/books` that returns library books.

1. Create `backend/routes/library.py`:
   ```python
   from fastapi import APIRouter, Request
   from database import db
   from models import UserRole
   from auth_utils import require_roles, get_current_user

   router = APIRouter()

   @router.get("/library/books")
   async def list_books(request: Request):
       await get_current_user(request)   # any logged-in user
       books = await db.books.find({}, {"_id": 0}).to_list(500)
       return books
   ```

2. Open `backend/server.py`. Near line 50 you'll see a block of imports like `from routes.auth import router as auth_router`. Add yours:
   ```python
   from routes.library import router as library_router
   ```

3. Around line 55 there's a `for router in [...]: app.include_router(router, prefix="/api")` loop. Add `library_router` to that list.

4. Save and restart the backend. Hit `http://localhost:8000/docs` → Swagger UI shows your new route.

### Add a new website page
**Example:** add a `Library` page at `/library`.

1. Create `frontend/src/components/LibraryPage.js`:
   ```jsx
   import React, { useEffect, useState } from 'react';
   import api from '../lib/api';
   export default function LibraryPage() {
     const [books, setBooks] = useState([]);
     useEffect(() => { api.get('/library/books').then(r => setBooks(r.data)); }, []);
     return <div className="p-6"><h1 className="text-2xl font-bold">Library</h1>{/* render books */}</div>;
   }
   ```

2. Open `frontend/src/App.js`. In the `<Routes>` block, add:
   ```jsx
   <Route path="/library" element={<LibraryPage />} />
   ```
   and import it at the top.

3. Open `frontend/src/components/Layout.js`. In `ALL_MENU_ITEMS` (around line 16), add:
   ```js
   { name: 'Library', icon: BookOpen, path: '/library', roles: ['admin', 'teacher', 'student'] },
   ```

### Add a new phone screen
**Example:** add `Library` screen on the phone.

1. Create `mobile/src/screens/LibraryScreen.js` (copy the pattern from `NoticesScreen.js`).

2. Decide: is it a **tab** or a **pushed screen**?
   - Tab → open `mobile/src/navigation/TabNavigator.js`, add a `<Tab.Screen name="Library" component={LibraryScreen} ... />` inside the relevant role tabs.
   - Pushed screen → open `mobile/src/navigation/AppNavigator.js`, add `<Stack.Screen name="Library" component={LibraryScreen} options={detailHeader('Library')} />`. Then any dashboard can call `navigation.navigate('Library')`.

3. Optional: add a button to `MoreScreen.js` that navigates to it.

### Change the look (design system)
- **Mobile colours + spacing + shadows:** `mobile/src/theme/colors.js`. Edit `COLORS`, `TINTS`, `RADIUS`, `SHADOW`. Every screen pulls from these, so changes propagate automatically.
- **Mobile reusable widgets:** `mobile/src/components/UI.js` (cards, badges, section titles), `StatCard.js` (metric tile), `ActionButton.js` (menu row).
- **Website colours:** Tailwind — see `frontend/tailwind.config.js` `theme.extend.colors` for the brand orange (`#E88A1A`). Global styles in `frontend/src/index.css`.
- **Website reusable widgets:** `frontend/src/components/ui/` has button, card, input, tabs, etc. (shadcn/ui style — copy + paste, not npm).
- **Logo + favicon:** `frontend/public/logo.webp`, `frontend/public/favicon.svg`.

### Change the seeded data
- **File:** `backend/seed_data.py`. Each section (`seed_users_table`, `seed_classes`, `seed_employees`, `seed_students_and_fees`, `seed_attendance`, etc.) is one function. To add a new collection, write a new function and call it from `main()`.
- **Test student override:** `backend/seed_test_student.py` sets up Arjun Kumar. Edit the top constants (`FIRST`, `LAST`, `CLASS`, `SECTION`) if you want a different test persona.
- **Re-run discipline:** `seed_data.py` **drops 22 collections** on every run. This is intentional for demos. Do NOT run it on production. `seed_test_student.py` only touches the one test student's records.
- **Typical edit flow:**
  1. Stop the backend (otherwise collections are live-changing under you).
  2. Edit `seed_data.py`.
  3. `python seed_data.py`.
  4. `python seed_test_student.py` (to relink the test student to the new data).
  5. Restart the backend.

### Debugging recipes
- **"Who called this endpoint?"** Every request is logged in the backend terminal with method, path, status, duration, and a `rid=<uuid>`. Grep the log for that `rid` to see the full trail of one request.
- **"Why does this user see X?"** Their role is in the JWT payload. Decode a token at https://jwt.io to confirm the role. Role-based filtering lives inside each route's `if user["role"] == ...` block.
- **"Why is the mobile app not hitting my backend?"** On the app, shake the device → open the debug menu → "Debug JS Remotely" or check the Metro terminal. Add `console.log(API_URL)` near the top of `mobile/src/config.js` to confirm what host it's calling.
- **"Why does the page show old data?"** React Query / SWR isn't in use; data fetches on mount + every 60s (dashboard) or on user action. Force refresh = reload the tab / close and reopen the phone app.
- **"Test API from command line":** `http://localhost:8000/docs` gives you a Swagger UI where you can authorize with a token (click the lock icon, paste `Bearer <token>`) and call any endpoint.

### Useful MongoDB commands
If you have `mongosh` installed:
```
mongosh
> use shemford_school
> db.students.countDocuments()                           // see total
> db.students.findOne({class_name: "5th", section: "Green"})
> db.users.find({email: /shemford\.edu$/}).count()       // all school users
> db.fee_payments.aggregate([{$group: {_id: null, total: {$sum: "$amount"}}}])
```
Without `mongosh`, the backend's Python is the easiest way — see any of the `seed_*.py` scripts for the pattern.
