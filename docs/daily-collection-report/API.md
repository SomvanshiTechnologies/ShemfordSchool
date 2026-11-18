# Daily Collection Report API

Shemford School ERP: daily fee-collection report, grouped by payment mode.

There are two independent ways to get the report:

| | **Pull** | **Push** |
|---|---|---|
| What | `GET /api/reports/daily-collection` | The application `POST`s the report to a URL you configure |
| When | Any time, for any past date | Automatically every day at **23:59 Asia/Kolkata** |
| Who calls whom | The caller asks our API | Our API calls the receiving system |
| Auth | Bearer JWT (admin or accountant) | Optional Bearer token and/or HMAC signature that **you** configure |

Both produce the same JSON (see [Response](#response-body)). All examples below are real output from a local test database; the files are in [`samples/`](samples/).

---

## 1. Pull: `GET /api/reports/daily-collection`

```
GET {baseUrl}/api/reports/daily-collection?date=2026-11-10
Authorization: Bearer <jwt>
Accept: application/json
```

### Authentication
1. `POST {baseUrl}/api/auth/login` with `{"email": "...", "password": "...", "platform": "web"}`.
2. Use the returned token as `Authorization: Bearer <token>`.
3. Only the **admin** and **accountant** roles may call this endpoint. Other roles get `403`.

### Query parameters
| Name | Required | Default | Meaning |
|---|---|---|---|
| `date` | no | today (Asia/Kolkata) | `YYYY-MM-DD`, zero-padded, not in the future |
| `include_transactions` | no | `false` | `true` adds a separate `transactions` list (per-payment rows) |
| `include_student_name` | no | `false` | Only with `include_transactions=true`. Adds `student_name` to each row (personal data, off by default) |

### Response body
Summary (always present):

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
    "bank_transfer": 800.0
  },
  "total_collection": 13900.0,
  "refunds": { "total": 600.0, "count": 1 },
  "net_collection": 13300.0,
  "transaction_count": 10,
  "generated_at": "2026-11-18T11:42:00.000000+00:00"
}
```

| Field | Type | Meaning |
|---|---|---|
| `report_date` | string | The day reported, `YYYY-MM-DD` |
| `currency` | string | Always `INR` |
| `collections` | object | Amount per payment mode (see [modes](#payment-modes)). `cash`, `cheque`, `dd`, `card`, `upi` are **always present** (0 when none); other modes appear only when used that day |
| `total_collection` | number | Sum of `collections` |
| `refunds.total` / `refunds.count` | number | Refunds initiated on that day (see [refunds](#refunds-failed-and-cancelled-payments)) |
| `net_collection` | number | `total_collection - refunds.total` |
| `transaction_count` | integer | Number of successful payment records for the day |
| `generated_at` | string | UTC time the response was built (**pull only**) |

Amounts are rupees with up to 2 decimals.

### Optional transaction-level detail (separate section)
With `include_transactions=true` the same response also contains `transactions`. The summary above is unchanged.

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

| Field | Notes |
|---|---|
| `payment_id`, `receipt_number` | Always present |
| `transaction_id` | Gateway/bank reference, cheque or DD number. `null` for cash |
| `payment_mode` | Normalised mode. `split` when one payment was paid with several modes |
| `split` | Only on `split` rows: breakdown by mode, e.g. `{"cash": 300, "upi": 700}`. The summary counts each part under its own mode |
| `student_id`, `admission_number` | Reference to the student. `admission_number` is `null` if the student record is gone |
| `student_name` | Only with `include_student_name=true` |

Every row's `amount` adds up to `total_collection`.

### Errors
| HTTP | When | Body |
|---|---|---|
| 400 | `date` is not `YYYY-MM-DD` (including `2026-3-9`, `2026-13-45`, text) | `{"detail": "date must be in YYYY-MM-DD format"}` |
| 400 | `date` is in the future | `{"detail": "date cannot be in the future"}` |
| 401 | No token, or an invalid or expired token | `{"detail": "Authentication required.", ...}` |
| 403 | Authenticated but not admin/accountant | `{"detail": "Access denied. Required role(s): admin, accountant. Your role: teacher"}` |
| 500 | Report could not be built (details are logged server-side only) | `{"detail": "Could not generate the collection report"}` |

An empty day is **not** an error: it returns `200` with every mode `0`, `transaction_count: 0` ([sample](samples/pull_empty_day_response.json)).

---

## 2. Push: scheduled `POST` to the receiving system

At **23:59 Asia/Kolkata** each day the application builds that day's report and sends:

```
POST {DAILY_REPORT_WEBHOOK_URL}
Content-Type: application/json
Idempotency-Key: daily-collection-2026-11-10
Authorization: Bearer <DAILY_REPORT_WEBHOOK_TOKEN>        (only if a token is configured)
X-Signature-SHA256: <hex hmac-sha256 of the raw body>      (only if a secret is configured)
```

The body is the JSON from [Response body](#response-body) **without** `generated_at`. The `transactions` list is included only when `DAILY_REPORT_INCLUDE_TRANSACTIONS=true` ([summary-only payload](samples/push_payload_summary_only.json), [with transactions](samples/push_payload_with_transactions.json)).

### What the receiver must do
- Return any **2xx** status to acknowledge. Anything else, or a timeout (20 s), counts as a failure and is retried.
- Treat `Idempotency-Key` as the unique id of the report (one per date). If the same key arrives twice, ignore or overwrite; do not add it twice.
- (Recommended) verify authenticity. Bearer token: compare the `Authorization` header with the shared token. Signature: HMAC-SHA256 over the **raw request bytes**, hex-encoded, with the shared secret:

```python
import hmac, hashlib
expected = hmac.new(SECRET.encode(), raw_body_bytes, hashlib.sha256).hexdigest()
ok = hmac.compare_digest(expected, request.headers["X-Signature-SHA256"])
```
```js
const expected = crypto.createHmac("sha256", SECRET).update(rawBodyBuffer).digest("hex");
const ok = crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(req.get("X-Signature-SHA256")));
```

### Reliability
| Situation | Behaviour |
|---|---|
| Receiver returns non-2xx / is down | The job queue retries (3 attempts). If still failing, the day is marked `failed` and the scheduler tries again about every **30 minutes**, up to **12 attempts** |
| Application was down at 23:59 | On the first scheduler poll after it starts (polls every 60 s) the missed day is queued and sent |
| Same day triggered twice (restart, retry, manual) | Sent **once**. A per-day delivery record is claimed atomically; a repeat is skipped |
| Email and webhook both configured, only one failed | Only the failed channel is retried |
| No receiver URL and no email configured | The day is recorded as `skipped`; nothing is sent |

Delivery state lives in the `daily_collection_reports` collection (`_id` = date; `status`: `sending`, `sent`, `skipped`, `failed`; plus `channels`, `attempts`, `error`).

### Configuration (environment variables, `backend/.env`)
| Variable | Default | Purpose |
|---|---|---|
| `DAILY_REPORT_ENABLED` | `true` | Turns the scheduler on/off |
| `DAILY_REPORT_TIME` | `23:59` | Daily run time, `HH:MM` |
| `REPORT_TIMEZONE` | `Asia/Kolkata` | Timezone for "the day" and the run time |
| `DAILY_REPORT_WEBHOOK_URL` | empty | **Receiver endpoint. Empty = no push** |
| `DAILY_REPORT_WEBHOOK_TOKEN` | empty | Optional Bearer token sent to the receiver |
| `DAILY_REPORT_WEBHOOK_SECRET` | empty | Optional HMAC secret for `X-Signature-SHA256` |
| `DAILY_REPORT_INCLUDE_TRANSACTIONS` | `false` | Add per-payment rows to the pushed payload |
| `DAILY_REPORT_INCLUDE_STUDENT_NAME` | `false` | Add `student_name` to those rows |
| `DAILY_REPORT_EMAILS` | empty | Comma-separated recipients; the email carries an Excel (`.xlsx`) copy |

Connecting to a real receiver is a configuration change only: set the URL (and token/secret if they use them) and restart the backend. No code changes.

---

## Payment modes

`collections` keys are normalised, lower-case:

| Key | Meaning | Includes (aliases) |
|---|---|---|
| `cash` | Cash at the counter | `pos_cash` |
| `cheque` | Cheque | |
| `dd` | Demand draft | `demand_draft` |
| `card` | Debit/credit card, mostly via the POS machine | `pos_card`, `debit_card`, `credit_card` |
| `upi` | UPI | `pos_upi` |
| `online` | Online gateway payment (Razorpay/Stripe, parent self-pay). Cards/UPI paid through the gateway are reported here, not under `card`/`upi` | |
| `bank_transfer` | NEFT/RTGS/IMPS recorded by the school | |
| *other* | Any other method string used by the application appears under its own key | |

Split payments (one payment settled with several modes) are expanded: each part is added to its own mode, so the mode totals always add up to `total_collection`.

## Refunds, failed and cancelled payments
- Only **successful** payments are counted. Failed and cancelled gateway attempts never create a payment record, so they never appear.
- Refunds are shown separately and **not** removed from `collections`: `net_collection = total_collection - refunds.total`.
- A refund belongs to the day it was **initiated** (`Asia/Kolkata` day). Refunds with status `failed` are ignored.
- Refunds currently exist for online (gateway) payments only.

## Day boundary (known limitation)
A payment belongs to the day of its stored `payment_date`. Counter payments (cash, cheque, DD, POS) store the school's local date. Gateway payments store the **UTC** date, so an online payment made between 00:00 and 05:30 IST can be reported on the previous day.

---

## 3. Testing independently with Postman

Files in [`postman/`](postman/): `DailyCollectionReport.postman_collection.json` and `Local.postman_environment.json`. Import both, choose the **Local test** environment, run the collection.

Local test stack (throwaway database, no real email or webhook):
1. `python tools/seed_test_data.py` (needs `MONGO_URL=mongodb://localhost:27017`, `DB_NAME=postman_test_dc`; refuses any other database)
2. `bash tools/run_local.sh` starts the backend (port 8100) and a mock receiver (port 9100)
3. Run the Postman collection (or `npx newman run postman/DailyCollectionReport.postman_collection.json -e postman/Local.postman_environment.json`)
4. `python tools/trigger_report.py 2026-11-10 --twice` queues the push job and confirms the mock got exactly one POST
5. `python tools/compare_db_vs_api.py` recomputes the totals straight from MongoDB and compares them with the API

Test scenarios covered: all payment modes, split payment, alias modes, refund counted / refund on another day / failed refund, neighbouring days excluded, empty day, default date, optional transactions, invalid and future dates, no/invalid token, wrong role.

## 4. Integration checklist (what we need from the receiving team)

Nothing below is assumed. Each item changes configuration only, unless noted.

1. **Endpoint URL** that accepts `POST` with a JSON body.
2. **Authentication**: Bearer token, HMAC signature, both, or none. If they need a different scheme (API key header, Basic auth, OAuth) that is a small code change.
3. **Payload shape**: is the summary enough, or do they need per-transaction rows? Which fields? If their field names or structure differ from ours, they can map on their side or we add a mapping layer.
4. **Success response**: we treat any 2xx as delivered.
5. **IP allow-listing**: if their endpoint is firewalled, they need our server's fixed IP.
6. **Day cut-off and duplicates**: confirm that using `Idempotency-Key` for de-duplication works for them.
7. **Whether they also want to pull**: that needs a dedicated service account on our side.
