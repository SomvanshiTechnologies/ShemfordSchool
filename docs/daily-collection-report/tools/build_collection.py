"""Generate the Postman collection + environment for the Daily Collection Report API.

    python build_collection.py   ->  ../postman/DailyCollectionReport.postman_collection.json
                                     ../postman/Local.postman_environment.json
"""
import json
import os

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "postman")
os.makedirs(OUT, exist_ok=True)

ZERO = "pm.expect(Number(b.collections.%s)).to.eql(%s);"


def req(name, method, path, tests, token=None, params=None, body=None, auth=True):
    url = {"raw": "{{baseUrl}}" + path, "host": ["{{baseUrl}}"], "path": path.strip("/").split("/")}
    if params:
        url["query"] = [{"key": k, "value": v} for k, v in params.items()]
        url["raw"] += "?" + "&".join(f"{k}={v}" for k, v in params.items())
    headers = [{"key": "Accept", "value": "application/json"}]
    if body:
        headers.append({"key": "Content-Type", "value": "application/json"})
    if token:
        headers.append({"key": "Authorization", "value": "Bearer {{" + token + "}}"})
    item = {"name": name, "event": [{"listen": "test", "script": {"type": "text/javascript", "exec": tests}}],
            "request": {"method": method, "header": headers, "url": url}}
    if body:
        item["request"]["body"] = {"mode": "raw", "raw": json.dumps(body, indent=2)}
    return item


def login(name, email_var, token_var):
    return req(name, "POST", "/auth/login", [
        "pm.test('login succeeds (200)', () => pm.response.to.have.status(200));",
        "const j = pm.response.json();",
        "pm.test('access token returned', () => pm.expect(j.access_token || j.token).to.be.a('string'));",
        f"pm.collectionVariables.set('{token_var}', j.access_token || j.token);",
    ], body={"email": "{{" + email_var + "}}", "password": "{{testPassword}}", "platform": "web"})


def full_day_asserts(extra=()):
    return [
        "pm.test('status 200', () => pm.response.to.have.status(200));",
        "const b = pm.response.json();",
        "pm.test('report_date echoes the request', () => pm.expect(b.report_date).to.eql(pm.collectionVariables.get('fullDay')));",
        "pm.test('currency is INR', () => pm.expect(b.currency).to.eql('INR'));",
        "pm.test('cash = 1800 (1000 + 500 + 300 from the split)', () => pm.expect(b.collections.cash).to.eql(1800));",
        "pm.test('cheque = 2000', () => pm.expect(b.collections.cheque).to.eql(2000));",
        "pm.test('dd = 1500', () => pm.expect(b.collections.dd).to.eql(1500));",
        "pm.test('card = 3400 (3000 card + 400 pos_card alias)', () => pm.expect(b.collections.card).to.eql(3400));",
        "pm.test('upi = 3200 (2500 + 700 from the split)', () => pm.expect(b.collections.upi).to.eql(3200));",
        "pm.test('online = 1200 and bank_transfer = 800 reported as their own modes', () => { pm.expect(b.collections.online).to.eql(1200); pm.expect(b.collections.bank_transfer).to.eql(800); });",
        "pm.test('total_collection = 13900 = sum of modes', () => { pm.expect(b.total_collection).to.eql(13900); pm.expect(Object.values(b.collections).reduce((a, c) => a + c, 0)).to.eql(13900); });",
        "pm.test('refund of 600 counted; failed refund and next-day refund excluded', () => { pm.expect(b.refunds.total).to.eql(600); pm.expect(b.refunds.count).to.eql(1); });",
        "pm.test('net_collection = 13300', () => pm.expect(b.net_collection).to.eql(13300));",
        "pm.test('transaction_count = 10 (neighbouring days excluded)', () => pm.expect(b.transaction_count).to.eql(10));",
        *extra,
    ]


def err(name, params, code, token="adminToken", fragment=None):
    t = [f"pm.test('status {code}', () => pm.response.to.have.status({code}));"]
    if fragment:
        t += ["const b = pm.response.json();",
              f"pm.test('error message mentions: {fragment}', () => pm.expect(JSON.stringify(b.detail)).to.include('{fragment}'));"]
    return req(name, "GET", "/reports/daily-collection", t, token=token, params=params)


collection = {
    "info": {"name": "Daily Collection Report API (local test)",
             "description": "Run the folders top to bottom. Needs the local test stack (docs/daily-collection-report/tools/run_local.sh) "
                            "seeded with seed_test_data.py. Never point baseUrl at production with test credentials.",
             "schema": "https://schema.getpostman.com/json/collection/v2.1.0/collection.json"},
    "variable": [{"key": "adminToken", "value": ""}, {"key": "accountantToken", "value": ""},
                 {"key": "teacherToken", "value": ""}, {"key": "fullDay", "value": "2026-11-10"},
                 {"key": "emptyDay", "value": "2026-11-13"}],
    "item": [
        {"name": "0 - Authentication", "item": [
            login("Login as admin", "adminEmail", "adminToken"),
            login("Login as accountant", "accountantEmail", "accountantToken"),
            login("Login as teacher (must be refused later)", "teacherEmail", "teacherToken"),
        ]},
        {"name": "1 - GET daily collection (pull)", "item": [
            req("Full day, all payment modes + refund (admin)", "GET", "/reports/daily-collection",
                full_day_asserts(["pm.test('summary only: no transactions key by default', () => pm.expect(b).to.not.have.property('transactions'));",
                                  "pm.test('generated_at present', () => pm.expect(b.generated_at).to.be.a('string'));"]),
                token="adminToken", params={"date": "{{fullDay}}"}),
            req("Same day as accountant (allowed role)", "GET", "/reports/daily-collection",
                full_day_asserts(), token="accountantToken", params={"date": "{{fullDay}}"}),
            req("Payment-mode mapping day: POS modes, BharatQR, split (2026-11-12)", "GET", "/reports/daily-collection", [
                "pm.test('status 200', () => pm.response.to.have.status(200));",
                "const b = pm.response.json(); const c = b.collections;",
                "pm.test('POS card merges into card (1000); POS UPI into upi (2000)', () => { pm.expect(c.card).to.eql(1000); pm.expect(c.upi).to.eql(2000); });",
                "pm.test('BharatQR is its own mode (1500) and is NOT merged into upi', () => { pm.expect(c.bharat_qr).to.eql(1500); pm.expect(c.upi).to.not.eql(3500); });",
                "pm.test('POS cash + manual cash + split cash part = 600', () => pm.expect(c.cash).to.eql(600));",
                "pm.test('POS cheque + manual cheque = 450', () => pm.expect(c.cheque).to.eql(450));",
                "pm.test('online = 700 + split online part 300 = 1000', () => pm.expect(c.online).to.eql(1000));",
                "pm.test('POS terminal payments with no recorded instrument stay as pos_terminal (600), not guessed', () => pm.expect(c.pos_terminal).to.eql(600));",
                "pm.test('no raw pos_* keys leak through', () => Object.keys(c).forEach(k => pm.expect(k.startsWith('pos_') && k !== 'pos_terminal').to.eql(false)));",
                "pm.test('total 7150, 10 transactions, sum of modes equals total', () => { pm.expect(b.total_collection).to.eql(7150); pm.expect(b.transaction_count).to.eql(10); pm.expect(Object.values(c).reduce((a, v) => a + v, 0)).to.eql(7150); });",
            ], token="adminToken", params={"date": "2026-11-12"}),
            req("Neighbouring day 2026-11-11 (only its own 777 UPI)", "GET", "/reports/daily-collection", [
                "pm.test('status 200', () => pm.response.to.have.status(200));",
                "const b = pm.response.json();",
                "pm.test('only the 777 UPI payment', () => { pm.expect(b.collections.upi).to.eql(777); pm.expect(b.total_collection).to.eql(777); pm.expect(b.transaction_count).to.eql(1); });",
                "pm.test('the 250 refund initiated at 01:30 IST on the 11th is counted here, not on the 10th', () => { pm.expect(b.refunds.count).to.eql(1); pm.expect(b.refunds.total).to.eql(250); });",
            ], token="adminToken", params={"date": "2026-11-11"}),
            req("Empty collection day", "GET", "/reports/daily-collection", [
                "pm.test('status 200', () => pm.response.to.have.status(200));",
                "const b = pm.response.json();",
                "pm.test('all modes are 0, totals 0, count 0', () => { Object.values(b.collections).forEach(v => pm.expect(v).to.eql(0)); pm.expect(b.total_collection).to.eql(0); pm.expect(b.net_collection).to.eql(0); pm.expect(b.transaction_count).to.eql(0); });",
                "pm.test('stable keys always present', () => ['cash','cheque','dd','card','upi','online','bank_transfer','bharat_qr'].forEach(m => pm.expect(b.collections).to.have.property(m)));",
            ], token="adminToken", params={"date": "{{emptyDay}}"}),
            req("Default date (no 'date' parameter = today, Asia/Kolkata)", "GET", "/reports/daily-collection", [
                "pm.test('status 200', () => pm.response.to.have.status(200));",
                "const today = new Date().toLocaleDateString('en-CA', {timeZone: 'Asia/Kolkata'});",
                "pm.test('report_date is today in IST', () => pm.expect(pm.response.json().report_date).to.eql(today));",
            ], token="adminToken"),
        ]},
        {"name": "2 - Transaction-level detail (optional, separate section)", "item": [
            req("include_transactions=true", "GET", "/reports/daily-collection", [
                "pm.test('status 200', () => pm.response.to.have.status(200));",
                "const b = pm.response.json();",
                "pm.test('summary is unchanged', () => { pm.expect(b.total_collection).to.eql(13900); pm.expect(b.transaction_count).to.eql(10); });",
                "pm.test('10 transaction rows whose amounts add up to the total', () => { pm.expect(b.transactions.length).to.eql(10); pm.expect(b.transactions.reduce((a, t) => a + t.amount, 0)).to.eql(13900); });",
                "pm.test('each row has receipt, date, mode, amount and student reference', () => b.transactions.forEach(t => { ['payment_id','receipt_number','payment_date','payment_mode','amount','student_id','admission_number'].forEach(k => pm.expect(t).to.have.property(k)); pm.expect(t.payment_date).to.eql('2026-11-10'); }));",
                "pm.test('split payment row carries its breakdown', () => { const s = b.transactions.find(t => t.payment_mode === 'split'); pm.expect(s.split).to.eql({cash: 300, upi: 700}); });",
                "pm.test('cheque row keeps its cheque number as transaction_id', () => pm.expect(b.transactions.find(t => t.payment_mode === 'cheque').transaction_id).to.eql('CHQ-445566'));",
                "pm.test('student NAME is not included by default', () => b.transactions.forEach(t => pm.expect(t).to.not.have.property('student_name')));",
            ], token="adminToken", params={"date": "{{fullDay}}", "include_transactions": "true"}),
            req("include_transactions=true&include_student_name=true", "GET", "/reports/daily-collection", [
                "pm.test('status 200', () => pm.response.to.have.status(200));",
                "const b = pm.response.json();",
                "pm.test('student_name present on every row', () => b.transactions.forEach(t => pm.expect(t.student_name).to.be.a('string').and.not.empty));",
                "pm.test('name resolves from the students collection', () => pm.expect(b.transactions.find(t => t.admission_number === 'SFS2026/0001').student_name).to.eql('Aarav Sharma'));",
            ], token="adminToken", params={"date": "{{fullDay}}", "include_transactions": "true", "include_student_name": "true"}),
            req("include_student_name alone is ignored (no transactions section)", "GET", "/reports/daily-collection", [
                "pm.test('status 200', () => pm.response.to.have.status(200));",
                "pm.test('no transactions, so no names leak', () => pm.expect(pm.response.json()).to.not.have.property('transactions'));",
            ], token="adminToken", params={"date": "{{fullDay}}", "include_student_name": "true"}),
        ]},
        {"name": "3 - Error handling", "item": [
            err("Invalid date: text", {"date": "abc"}, 400, fragment="YYYY-MM-DD"),
            err("Invalid date: impossible calendar date", {"date": "2026-13-45"}, 400, fragment="YYYY-MM-DD"),
            err("Invalid date: not zero-padded", {"date": "2026-3-9"}, 400, fragment="YYYY-MM-DD"),
            err("Invalid date: future date", {"date": "2099-01-01"}, 400, fragment="future"),
            req("Unauthorized: no token", "GET", "/reports/daily-collection", [
                "pm.test('rejected without a token (401/403)', () => pm.expect([401, 403]).to.include(pm.response.code));"],
                params={"date": "{{fullDay}}"}),
            req("Unauthorized: invalid token", "GET", "/reports/daily-collection", [
                "pm.test('rejected with a bad token (401/403)', () => pm.expect([401, 403]).to.include(pm.response.code));"],
                params={"date": "{{fullDay}}"}, token="bogusToken"),
            req("Forbidden: teacher role", "GET", "/reports/daily-collection", [
                "pm.test('teacher refused (403)', () => pm.response.to.have.status(403));"],
                params={"date": "{{fullDay}}"}, token="teacherToken"),
        ]},
    ],
}

environment = {"name": "Local test", "values": [
    {"key": "baseUrl", "value": "http://127.0.0.1:8100/api", "enabled": True},
    {"key": "adminEmail", "value": "admin@test.local", "enabled": True},
    {"key": "accountantEmail", "value": "accountant@test.local", "enabled": True},
    {"key": "teacherEmail", "value": "teacher@test.local", "enabled": True},
    {"key": "testPassword", "value": "Test@12345", "enabled": True},
], "_postman_variable_scope": "environment"}

json.dump(collection, open(os.path.join(OUT, "DailyCollectionReport.postman_collection.json"), "w"), indent=2)
json.dump(environment, open(os.path.join(OUT, "Local.postman_environment.json"), "w"), indent=2)
print("written to", os.path.abspath(OUT))
