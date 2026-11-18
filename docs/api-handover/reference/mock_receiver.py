"""Temporary local stand-in for the school software that will receive the pushed report.

    python mock_receiver.py [port]           # default 9100
    set MOCK_SECRET=...                      # same value as DAILY_REPORT_WEBHOOK_SECRET (to verify the signature)
    set MOCK_TOKEN=...                       # same value as DAILY_REPORT_WEBHOOK_TOKEN (to verify the bearer token)
    set MOCK_FAIL_FIRST=2                    # answer 503 to the first 2 requests, to exercise retries

Every request is appended to received.jsonl and a verdict is printed. POST /receive -> 200 {"ok": true}.
Nothing leaves this machine.
"""
import hashlib
import hmac
import json
import os
import sys
from http.server import BaseHTTPRequestHandler, HTTPServer

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 9100
SECRET = os.environ.get("MOCK_SECRET", "")
TOKEN = os.environ.get("MOCK_TOKEN", "")
FAIL_FIRST = int(os.environ.get("MOCK_FAIL_FIRST", "0"))
LOG = os.path.join(os.path.dirname(os.path.abspath(__file__)), "received.jsonl")
seen = {"n": 0}


class Handler(BaseHTTPRequestHandler):
    def do_POST(self):
        raw = self.rfile.read(int(self.headers.get("Content-Length", 0)))
        seen["n"] += 1
        checks = {}
        if SECRET:
            expected = hmac.new(SECRET.encode(), raw, hashlib.sha256).hexdigest()
            checks["signature_valid"] = hmac.compare_digest(expected, self.headers.get("X-Signature-SHA256", ""))
        if TOKEN:
            checks["bearer_valid"] = self.headers.get("Authorization") == f"Bearer {TOKEN}"
        try:
            body = json.loads(raw)
        except ValueError:
            body = None
        checks["json_valid"] = body is not None
        entry = {"n": seen["n"], "path": self.path, "idempotency_key": self.headers.get("Idempotency-Key"),
                 "content_type": self.headers.get("Content-Type"), "checks": checks, "body": body}
        with open(LOG, "a", encoding="utf-8") as f:
            f.write(json.dumps(entry) + "\n")
        print(f"#{seen['n']} POST {self.path} key={entry['idempotency_key']} checks={checks}", flush=True)
        fail = seen["n"] <= FAIL_FIRST
        self.send_response(503 if fail else 200)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(json.dumps({"ok": not fail}).encode())

    def log_message(self, *_):
        pass


print(f"mock receiver listening on http://127.0.0.1:{PORT}/receive  (log: {LOG})", flush=True)
HTTPServer(("127.0.0.1", PORT), Handler).serve_forever()
