# Daily Collection Report API: Handover Document

**System:** Shemford Futuristic School ERP
**Document version:** 1.0, 18 November 2026
**Audience:** School management and the technical team of the school's existing reporting software
**Classification:** Contains no credentials. Every secret in this document is a placeholder such as `<PASSWORD>`.

---

## 1. Summary

The ERP records every fee collection. This API gives that data to another system in two independent ways:

| | **A. GET: retrieve a report** | **B. POST: push a report** |
|---|---|---|
| Who starts it | **Your system** asks our server | **Our server** sends it to your server |
| When | Any time, for any past date | Automatically every day at **23:59 Asia/Kolkata** |
| Direction | Your system -> our API | Our API -> **your endpoint** |
| What you must provide | Nothing. We issue you a login. | **A receiving URL and its authentication rules** (see section 14) |
| Status | **Ready** | **Ready on our side. Waiting for your endpoint details** |

Both return the same report: collections for one day grouped by payment mode, refunds, net collection and a transaction count, with optional per-payment rows.

> **Important:** the push cannot be completed until the receiving system's endpoint URL and authentication details are provided. Until then the scheduler records each day as "skipped" and sends nothing. The GET API works independently of this.

### 1.1 Deployment status (18 November 2026)

| Item | State |
|---|---|
| GET endpoint on the deployed server | **Live** (returns `401` without a token, verified) at the interim address in section 3 |
| HTTPS domain `erp.shemfordkatwa.in` | **Pending** (DNS record and certificate). Use HTTPS for any real credentials |
| Payment-mode mapping (section 7) and transaction rows (section 9) | Implemented and tested in the code repository. They go live on the server at the next deployment |
| Push webhook | Implemented and tested against a local mock receiver. **Not connected to any real endpoint** |
| Email copy with Excel attachment | Implemented. Needs an email-service key to be configured (optional channel, section 10.4) |

---

## 2. Package contents

| File | Purpose |
|---|---|
| `Daily_Collection_Report_API_Handover.md` | This document |
| `postman/Daily_Collection_Report_API.postman_collection.json` | Importable Postman collection (login, GET requests, error cases, webhook reference) |
| `postman/Daily_Collection_Report_API.postman_environment.json` | Postman environment with placeholders. Fill in your own values |
| `samples/*.json` | Real example responses, push payloads and error bodies |
| `reference/mock_receiver.py` | A small local receiver that prints and verifies what our server pushes. Use it as a starting point for your own endpoint |

All example data (student names, receipt numbers, amounts) comes from a throwaway test database, not from real school records.

---

## 3. The GET API (retrieve a report)

### 3.1 Endpoint

```
GET {BASE_URL}/reports/daily-collection
```

| Environment | `BASE_URL` |
|---|---|
| Interim deployed address | `http://15.135.209.95:8000/api` |
| Target production address (once HTTPS is live) | `https://erp.shemfordkatwa.in/api` |

The interim address uses plain HTTP and is for connectivity testing only. **Do not send real credentials over HTTP.** The interim address will be closed when the domain goes live, so build against `BASE_URL` as a setting.

- **HTTP method:** `GET`
- **Response format:** `application/json`
- **Allowed roles:** `admin`, `accountant`. Any other role receives `403`.

### 3.2 Authentication

The API uses a **Bearer token (JWT)**. There is no separate API-key mechanism. An integration uses a normal user account that has the **Accountant** (or Admin) role.

**How credentials are obtained**
1. The school administrator creates an account with the **Accountant** role for the integration. In the application this is done through Employees (designation "Accountant").
2. The login ID and password are handed over through a secure channel by the school. They are never put in documents or e-mailed in clear text.
3. We recommend a dedicated account used only by the integration, so it can be disabled without affecting staff.

**Step 1: log in** (`POST {BASE_URL}/auth/login`)

```http
POST {BASE_URL}/auth/login
Content-Type: application/json

{ "email": "<ISSUED-LOGIN>", "password": "<PASSWORD>", "platform": "web" }
```

(The field is named `email` but accepts the login ID issued to the account.)

Response `200`:
```json
{
  "token": "<ACCESS-TOKEN>",
  "refresh_token": "<REFRESH-TOKEN>",
  "user": { "user_id": "<id>", "email": "<login>", "role": "accountant" }
}
```

**Step 2: call the report with the token**
```http
GET {BASE_URL}/reports/daily-collection?date=2026-11-10
Authorization: Bearer <ACCESS-TOKEN>
Accept: application/json
```

**Step 3: renew without the password** (`POST {BASE_URL}/auth/refresh`)
```http
POST {BASE_URL}/auth/refresh
Content-Type: application/json

{ "refresh_token": "<REFRESH-TOKEN>" }
```
Response: `{ "token": "<NEW-ACCESS-TOKEN>", "refresh_token": "<NEW-REFRESH-TOKEN>" }`

| Rule | Value |
|---|---|
| Access token lifetime | **15 minutes** |
| Refresh token lifetime | **30 days**. It **rotates**: each refresh invalidates the previous refresh token, so always store the newest one |
| Login lockout | **5 failed attempts lock that login for 15 minutes** |
| Rate limits | Login: 20 per 15 minutes per IP. Other endpoints: 120 requests per minute per IP. Exceeding returns `429` with `Retry-After` |

An integration that polls should log in once, keep the refresh token in a secrets store, and refresh when it receives `401`.

### 3.3 Request headers

| Header | Required | Value |
|---|---|---|
| `Authorization` | Yes | `Bearer <ACCESS-TOKEN>` |
| `Accept` | Recommended | `application/json` |

### 3.4 Query parameters

| Parameter | Required | Default | Description |
|---|---|---|---|
| `date` | No | Today (Asia/Kolkata) | The day to report, `YYYY-MM-DD`, zero-padded, not in the future. `2026-3-9` is rejected |
| `include_transactions` | No | `false` | `true` adds a separate `transactions` list with one row per payment |
| `include_student_name` | No | `false` | Only with `include_transactions=true`. Adds `student_name` to each row. This is personal data, so request it only if needed. Without `include_transactions` it is ignored |

### 3.5 Example request (curl)

```bash
curl -s "{BASE_URL}/reports/daily-collection?date=2026-11-10" \
     -H "Authorization: Bearer <ACCESS-TOKEN>" -H "Accept: application/json"
```

---

## 4. Response structure

The summary fields are always returned. Real example (test data) for `date=2026-11-10`:

```json
{
  "report_date": "2026-11-10",
  "currency": "INR",
  "collections": {
    "cash": 1800.0,
    "cheque": 2000.0,
    "dd": 1500.0,
    "card": 3400.0,
    "upi": 3200.0,
    "online": 1200.0,
    "bank_transfer": 800.0,
    "bharat_qr": 0.0
  },
  "total_collection": 13900.0,
  "refunds": { "total": 600.0, "count": 1 },
  "net_collection": 13300.0,
  "transaction_count": 10,
  "generated_at": "2026-11-18T11:42:00.000000+00:00"
}
```

| Field | Type | Always present | Description |
|---|---|---|---|
| `report_date` | string `YYYY-MM-DD` | Yes | The day the figures are for |
| `currency` | string | Yes | Always `INR` |
| `collections` | object | Yes | Amount collected per payment mode. See section 7 for the keys. The keys `cash`, `cheque`, `dd`, `card`, `upi`, `online`, `bank_transfer`, `bharat_qr` are always present (0 when nothing was collected that way). Other keys appear only when used that day |
| `total_collection` | number | Yes | Sum of all values in `collections` (successful payments only) |
| `refunds.total` | number | Yes | Sum of refunds initiated that day |
| `refunds.count` | integer | Yes | Number of refunds initiated that day |
| `net_collection` | number | Yes | `total_collection - refunds.total` |
| `transaction_count` | integer | Yes | Number of successful payment records that day (a split payment counts once) |
| `generated_at` | string, UTC ISO-8601 | **GET only** | When the response was built. Not included in the pushed payload |
| `transactions` | array | Only with `include_transactions=true` | Per-payment rows, section 9 |

Amounts are rupees with up to two decimals. A day with no collections returns `200` with every mode `0`, `transaction_count: 0` and no error (`samples/pull_empty_day_response.json`).

---

## 5. Which payments are counted

- **Counted:** successful payments only, as recorded in the application's payment records. Counter payments, POS-terminal payments and online-gateway payments are all included.
- **Never counted:** failed and cancelled online payments. They never become payment records, so they cannot appear in any total.
- **Refunds** are reported separately (section 8) and are **not** deducted inside `collections`.

---

## 6. Day boundary (known limitation)

A payment belongs to the day of its **recorded payment date**, and the report groups by that date.

The application stamps the payment date from the **server's clock**, and the production server runs in **UTC**. A payment taken between **00:00 and 05:30 IST** is therefore stamped with the **previous** calendar date, and appears in the previous day's report. A payment taken at any other time of day is stamped with the same date as in India. This applies to every payment type (counter, POS and online). School collection hours (roughly 09:00 to 18:00 IST) are not affected.

The report's own day (the scheduler's run time and the refund day) uses Asia/Kolkata. Only the stored payment date follows the server clock.

Aligning the server clock to Asia/Kolkata would remove this, but it also changes other date logic in the application, so it is a separate decision for the school. It has not been changed.

---

## 7. Payment modes

### 7.1 Keys in `collections`

| Key | Always present | Meaning |
|---|---|---|
| `cash` | Yes | Cash, including cash taken at the POS terminal |
| `cheque` | Yes | Cheques, including cheques recorded through the POS terminal |
| `dd` | Yes | Demand draft. The application has **no built-in DD method**. It is reported as `dd` if a DD method is added by the school (value `dd` or `demand_draft`). Otherwise it stays 0 |
| `card` | Yes | Debit/credit card taken at the POS terminal |
| `upi` | Yes | UPI taken at the POS terminal ("UPI only" mode) |
| `online` | Yes | Online-gateway payments by parents **and** payments entered by staff as "Online / UPI" (with a UPI/UTR/NEFT reference) |
| `bank_transfer` | Yes | NEFT/RTGS/IMPS recorded by staff |
| `bharat_qr` | Yes | BharatQR payments taken at the POS terminal |
| `pos_terminal` | Only when used | POS payments where staff chose "All modes" on the terminal (see 7.3) |
| *other* | Only when used | Any additional method the school adds under Settings -> Payment Methods appears under its own lower-case value |

### 7.2 How each collection method is stored and reported

| How the fee was collected | Stored in the database as | Reported under |
|---|---|---|
| Cash at the counter | `cash` | `cash` |
| Cheque recorded by staff | `cheque` | `cheque` |
| NEFT/RTGS/IMPS recorded by staff | `bank_transfer` | `bank_transfer` |
| Staff choose "Online / UPI" | `online` | `online` |
| Parent pays through the online gateway | `online` | `online` |
| POS terminal: Card | `pos_card` | `card` |
| POS terminal: UPI | `pos_upi` | `upi` |
| POS terminal: Cash | `pos_cash` | `cash` |
| POS terminal: Cheque | `pos_cheque` | `cheque` |
| POS terminal: BharatQR | `pos_bharatqr` | `bharat_qr` |
| POS terminal: "All modes" | `pos_all` | `pos_terminal` |
| Split payment (cash + online) | `split` with a breakdown | **each part under its own key** (cash part -> `cash`, online part -> `online`) |

### 7.3 Points that are deliberately not merged or guessed

- **QR is not UPI.** The POS terminal stores BharatQR as its own mode, so it has its own key `bharat_qr` and is never added to `upi`. The application has no other QR payment type.
- **`online` is one bucket.** The gateway records and the staff "Online / UPI" entries do not say whether the payer used UPI, a card or net banking, so `online` is not split further and is not added to `upi`.
- **`pos_terminal`:** when staff choose "All modes", the terminal's reply does not record which instrument the payer actually used. These payments are shown as `pos_terminal` instead of being assigned to card, UPI or QR by guesswork.
- **Split payments** are always expanded: the mode totals still add up to `total_collection`.

### 7.4 Worked example with sample amounts

Test day `2026-11-12`: ten payments stored as follows.

| Stored as | Amount | Counted under |
|---|---|---|
| `pos_card` | 1,000 | `card` |
| `pos_upi` | 2,000 | `upi` |
| `pos_cash` | 300 | `cash` |
| `pos_cheque` | 400 | `cheque` |
| `pos_bharatqr` | 1,500 | `bharat_qr` |
| `pos_all` | 600 | `pos_terminal` |
| `cash` | 100 | `cash` |
| `cheque` | 50 | `cheque` |
| `online` | 700 | `online` |
| `split` (cash 200 + online 300) | 500 | `cash` 200 and `online` 300 |

Resulting response (`samples/pull_pos_modes_day_response.json`):

```json
{
  "report_date": "2026-11-12",
  "currency": "INR",
  "collections": {
    "cash": 600.0, "cheque": 450.0, "dd": 0.0, "card": 1000.0, "upi": 2000.0,
    "online": 1000.0, "bank_transfer": 0.0, "bharat_qr": 1500.0, "pos_terminal": 600.0
  },
  "total_collection": 7150.0,
  "refunds": { "total": 0, "count": 0 },
  "net_collection": 7150.0,
  "transaction_count": 10,
  "generated_at": "2026-11-18T12:30:00.000000+00:00"
}
```

Check: 600 + 450 + 1000 + 2000 + 1000 + 1500 + 600 = **7,150** = the sum of the ten payments.

---

## 8. Refunds and net collection

- `refunds.total` and `refunds.count` come from online-gateway refunds. **The application records refunds only for online-gateway payments**; there is no other refund type in its database.
- A refund belongs to the day it was **initiated** (an Asia/Kolkata day), not the day of the original payment.
- Refunds with status `failed` are ignored.
- `collections` and `total_collection` are **not reduced** by refunds.
- `net_collection = total_collection - refunds.total`.

Example: collections 13,900 with one refund of 600 -> `net_collection` 13,300.

---

## 9. Transaction-level detail (optional)

Off by default so the summary stays small and contains no personal data. Enabled with `include_transactions=true` on the GET, or on the push with `DAILY_REPORT_INCLUDE_TRANSACTIONS=true` (section 10.3). The summary fields do not change. Row amounts add up to `total_collection`.

```json
{
  "payment_id": "pay_test_003",
  "receipt_number": "RCP2026TEST003",
  "transaction_id": "CHQ-445566",
  "payment_date": "2026-11-10",
  "payment_mode": "cheque",
  "amount": 2000.0,
  "student_id": "stu_001",
  "admission_number": "SFS2026/0001",
  "academic_year": "2026-2027",
  "student_name": "Aarav Sharma"
}
```

| Field | Type | Notes |
|---|---|---|
| `payment_id` | string | Unique payment record id |
| `receipt_number` | string | Receipt number printed for the parent |
| `transaction_id` | string or null | Gateway/bank reference, cheque or DD number, POS transaction id. `null` for cash |
| `payment_date` | string `YYYY-MM-DD` | Recorded payment date |
| `payment_mode` | string | Mapped mode (section 7). `split` when one payment used several modes |
| `amount` | number | Total of this payment |
| `student_id` | string | Internal student id |
| `admission_number` | string or null | School admission number. `null` if the student record no longer exists |
| `academic_year` | string or null | e.g. `2026-2027` |
| `split` | object | **Only on `split` rows.** Amount per mode, e.g. `{"cash": 300.0, "upi": 700.0}` |
| `student_name` | string or null | **Only with `include_student_name=true`** (GET) or `DAILY_REPORT_INCLUDE_STUDENT_NAME=true` (push) |

Fields we do **not** store on a payment, and therefore cannot supply: payer name for gateway payments, payment-card details, bank names. We do not know what your system needs. If it needs more than the fields above, tell us.

---

## 10. The push webhook (POST to your system)

### 10.1 What we send

At **23:59 Asia/Kolkata** every day our server builds that day's report and sends it to **your** endpoint:

```http
POST {YOUR-ENDPOINT-URL}
Content-Type: application/json
Idempotency-Key: daily-collection-2026-11-10
Authorization: Bearer <WEBHOOK-TOKEN>              (only if a token is configured)
X-Signature-SHA256: <hex HMAC-SHA256 of the body>   (only if a secret is configured)
```

Body: the report of section 4 **without** `generated_at`, for example (`samples/push_payload_summary_only.json`):

```json
{
  "report_date": "2026-11-10",
  "currency": "INR",
  "collections": { "cash": 1800.0, "cheque": 2000.0, "dd": 1500.0, "card": 3400.0, "upi": 3200.0,
                   "online": 1200.0, "bank_transfer": 800.0, "bharat_qr": 0.0 },
  "total_collection": 13900.0,
  "refunds": { "total": 600.0, "count": 1 },
  "net_collection": 13300.0,
  "transaction_count": 10
}
```
With `DAILY_REPORT_INCLUDE_TRANSACTIONS=true` the body also contains `transactions` (`samples/push_payload_with_transactions.json`).

### 10.2 What your endpoint must do

| Requirement | Detail |
|---|---|
| Accept `POST` with a JSON body | `Content-Type: application/json` |
| Reply with a **2xx** status | Anything else counts as failure. **Redirects (3xx) also count as failure**, so give us the final URL |
| Reply within **20 seconds** | Longer is treated as a timeout and retried |
| Use `Idempotency-Key` to de-duplicate | One key per date (`daily-collection-<date>`). If the same key arrives twice, ignore or overwrite. Never add it twice |
| Verify authenticity (recommended) | Check the Bearer token and/or the signature below |
| Be reachable from our server over **HTTPS** | And allow our server's address if you use an IP allow-list (section 14) |

**Verifying the signature**: HMAC-SHA256 over the **raw request bytes**, hex-encoded, using the shared secret:

```python
import hmac, hashlib
expected = hmac.new(SECRET.encode(), raw_body_bytes, hashlib.sha256).hexdigest()
ok = hmac.compare_digest(expected, request.headers["X-Signature-SHA256"])
```
```js
const expected = crypto.createHmac("sha256", SECRET).update(rawBodyBuffer).digest("hex");
const ok = crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(req.get("X-Signature-SHA256")));
```

### 10.3 Configuration on our server (`backend/.env`)

| Variable | Default | Purpose |
|---|---|---|
| `DAILY_REPORT_ENABLED` | `true` | Scheduler on/off |
| `DAILY_REPORT_TIME` | `23:59` | Daily run time, `HH:MM` |
| `REPORT_TIMEZONE` | `Asia/Kolkata` | Timezone of "the day" and of the run time |
| `DAILY_REPORT_WEBHOOK_URL` | *(empty)* | **Your endpoint. Empty means nothing is pushed** |
| `DAILY_REPORT_WEBHOOK_TOKEN` | *(empty)* | Optional Bearer token sent to your endpoint. Placeholder: `<WEBHOOK-TOKEN>` |
| `DAILY_REPORT_WEBHOOK_SECRET` | *(empty)* | Optional HMAC secret for `X-Signature-SHA256`. Placeholder: `<WEBHOOK-SECRET>` |
| `DAILY_REPORT_INCLUDE_TRANSACTIONS` | `false` | Add per-payment rows to the push |
| `DAILY_REPORT_INCLUDE_STUDENT_NAME` | `false` | Add `student_name` to those rows |
| `DAILY_REPORT_EMAILS` | *(empty)* | Optional e-mail recipients (comma separated) |

Connecting a real receiver is a **configuration change and a restart only**. No code change, unless your system needs a different authentication scheme (for example an API-key header, Basic auth or OAuth), which would be a small addition.

### 10.4 Optional e-mail copy

If `DAILY_REPORT_EMAILS` is set and an e-mail-service key is configured, the same report is e-mailed with an Excel (`.xlsx`) attachment named `daily-collection-<date>.xlsx`. This is independent of the webhook and is currently not active (no e-mail service key is configured yet).

---

## 11. The scheduler: timing, recovery and duplicates

| Aspect | Behaviour |
|---|---|
| Run time | **23:59 Asia/Kolkata** daily (`DAILY_REPORT_TIME`, `REPORT_TIMEZONE`). The report is for the date that has just ended at that moment |
| Mechanism | A scheduler checks once a minute for the latest due report and queues it. The job queue then runs and retries it |
| Server was down at 23:59 | Nothing is lost. On the first check after the server starts, the missed day is queued and sent |
| Receiver unavailable | The queue retries up to 3 times. If it still fails the day is marked `failed` and is retried about every **30 minutes**, up to **12 attempts**. Only the failed channel is retried (for example e-mail is not resent if only the webhook failed) |
| Same day triggered twice (restart, retry, manual) | **Sent once.** Each day has an atomic delivery record. A second trigger is skipped. A claim abandoned by a crashed worker is recovered after 15 minutes |
| No receiver and no e-mail configured | The day is recorded as `skipped`. Nothing is sent |
| Where state is kept | Collection `daily_collection_reports`, one record per date: `status` (`sending`, `sent`, `skipped`, `failed`), `channels`, `attempts`, `error` |

**Timing note:** the push is built at 23:59. A payment recorded between 23:59 and midnight is not in that day's push. It does appear when the GET API is called for that date later, so a periodic GET can be used to reconcile.

---

## 12. Error responses (GET)

| HTTP | When | Example body |
|---|---|---|
| `400` | `date` is not `YYYY-MM-DD` (including `2026-3-9`, `2026-13-45`, text) | `{"detail": "date must be in YYYY-MM-DD format"}` |
| `400` | `date` is in the future | `{"detail": "date cannot be in the future"}` |
| `401` | No `Authorization` header | `{"detail": "Authentication required.", "request_id": "-"}` |
| `401` | Invalid or expired access token (15 min) | `{"detail": "Session expired. Please log in again."}` |
| `403` | Authenticated, but the role is not admin/accountant | `{"detail": "Access denied. Required role(s): admin, accountant. Your role: teacher"}` |
| `429` | Rate limit exceeded or login locked | `{"detail": "Too many failed login attempts. Please try again after N minutes.", "retry_after": <seconds>}` with `Retry-After` header |
| `500` | The report could not be built (details only in server logs) | `{"detail": "Could not generate the collection report"}` |

Login errors: `401 {"detail": "Invalid credentials"}`; `403 {"detail": "Account is deactivated"}`.

An empty day is **not** an error.

---

## 13. Postman

Files: `postman/Daily_Collection_Report_API.postman_collection.json` and `postman/Daily_Collection_Report_API.postman_environment.json`.

1. In Postman choose **Import** and select both files, then select the imported environment.
2. Set `baseUrl` (the address in section 3.1 ending in `/api`), `loginId` and `password` (issued by the school). The password field is a secret and is empty in the file.
3. Run **0 - Authentication -> Login** first. The access token is stored automatically. Run **Refresh token** after 15 minutes.
4. Run **1 - Pull report (GET)**. `reportDate` defaults to yesterday (Asia/Kolkata) when left empty.
5. **2 - Error responses** shows each error. The wrong-role request needs an optional `forbiddenRoleToken` (a non-admin/non-accountant user) and skips itself when empty.
6. **3 - Push webhook (what we send you)** is a reference of our nightly request. It is never sent when the collection runs.

Each request carries saved example responses and automatic checks: status code, the documented fields, that `total_collection` equals the sum of the modes, and that `net_collection = total_collection - refunds.total`.

---

## 14. What is still needed to finish the integration

### 14.1 From the receiving system's technical team

| # | Needed | Why |
|---|---|---|
| 1 | **Endpoint URL** that accepts the nightly `POST` (HTTPS) | Without it nothing is pushed |
| 2 | **Authentication scheme**: Bearer token, HMAC signature, both, or something else, and how the credentials are issued | We configure `DAILY_REPORT_WEBHOOK_TOKEN` / `DAILY_REPORT_WEBHOOK_SECRET`. Another scheme needs a small code change |
| 3 | **Payload needs**: is the summary enough, or are per-payment rows needed? Are student names needed? | Switches `DAILY_REPORT_INCLUDE_TRANSACTIONS` / `DAILY_REPORT_INCLUDE_STUDENT_NAME` |
| 4 | **Field names or structure** if they differ from section 4 | We can add a mapping, or they can map on their side |
| 5 | **Success response** they will return | We treat any 2xx as delivered |
| 6 | **IP allow-listing**: whether their endpoint is firewalled | They would allow our server's fixed public address (the server has a fixed address, which we will supply for allow-listing) |
| 7 | Whether they also want to **pull** (GET) | A dedicated read-only login is issued by the school |
| 8 | A **technical contact** and a test window | To run a first test delivery together |

We have made no assumptions about the receiving software.

### 14.2 On our side before go-live

| # | Item | Status |
|---|---|---|
| 1 | HTTPS domain live (`erp.shemfordkatwa.in`: DNS record + certificate) | Pending |
| 2 | Deploy the latest version (payment-mode mapping, transaction rows) to the server | Pending |
| 3 | Issue a dedicated read-only (Accountant) login for GET access | When requested |
| 4 | Set `DAILY_REPORT_WEBHOOK_URL`, token/secret and the transaction options, then restart | After 14.1 is received |
| 5 | Run one test delivery to the receiver's test endpoint | After 14.4 |
| 6 | Optional: e-mail copy (needs an e-mail service key and a verified sender address) | Optional |

---

## 15. Security notes

- Send credentials only over **HTTPS**. The interim HTTP address is for connectivity checks only.
- This document and the Postman files contain **placeholders only**. Never paste real passwords, tokens or secrets into shared documents, tickets or e-mail. Use Postman's secret-type variables.
- Use a dedicated account for the integration and disable it if it is no longer needed.
- The webhook token and secret are shared only between the two technical teams. Rotate them if they are ever exposed.
- Student names are personal data and are off by default.

---

## 16. How this was verified

| Check | Result |
|---|---|
| Payment totals per mode recomputed straight from the database, compared with the API | All figures matched (two test days) |
| Postman collection (development test suite) | 19 requests, 74 assertions, 0 failures |
| This handover collection | 10 requests executed, 38 assertions, 0 failures (the wrong-role request also verified with a real non-privileged token) |
| Webhook delivery to a local mock receiver | Correct JSON, Bearer token and signature verified, `Idempotency-Key` present |
| Duplicate trigger of the same day | Sent once only |
| Scheduler recovery after a simulated missed run | Re-sent automatically on the next check |
| Automated unit tests | 28 passing |

All testing used a throwaway local database and a local mock receiver. No production data was used and no real e-mail or external request was sent.

---

## Appendix A. All fields at a glance

```
report_date            string  YYYY-MM-DD
currency               string  "INR"
collections            object  { cash, cheque, dd, card, upi, online, bank_transfer, bharat_qr   (always)
                                 pos_terminal, <other admin-defined modes>                        (when used) }
total_collection       number
refunds                object  { total: number, count: integer }
net_collection         number
transaction_count      integer
generated_at           string  UTC ISO-8601            (GET only)
transactions[]         array                           (only when requested)
  payment_id           string
  receipt_number       string
  transaction_id       string | null
  payment_date         string  YYYY-MM-DD
  payment_mode         string
  amount               number
  student_id           string
  admission_number     string | null
  academic_year        string | null
  split                object  { <mode>: number }      (split payments only)
  student_name         string | null                   (only when requested)
```
