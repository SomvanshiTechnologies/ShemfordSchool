#!/usr/bin/env bash
# Start the mock receiver (port 9100) and a local backend (port 8100) against the throwaway test DB.
# Usage: ./run_local.sh            (Ctrl+C stops both)
# Nothing here touches a real database or sends real email/webhooks:
#   RESEND_API_KEY and DAILY_REPORT_EMAILS are forced empty, the webhook points at the local mock.
set -e
HERE="$(cd "$(dirname "$0")" && pwd)"
export MONGO_URL=mongodb://localhost:27017
export DB_NAME=postman_test_dc
export JWT_SECRET=local-test-jwt-secret SECRET_KEY=local-test-secret
export FIELD_ENCRYPTION_KEY="$(python -c 'from cryptography.fernet import Fernet;print(Fernet.generate_key().decode())')"
export CORS_ORIGINS=http://localhost:3000
export RESEND_API_KEY= DAILY_REPORT_EMAILS=
export DAILY_REPORT_ENABLED=true DAILY_REPORT_TIME=23:59 REPORT_TIMEZONE=Asia/Kolkata
export DAILY_REPORT_WEBHOOK_URL=http://127.0.0.1:9100/receive
export DAILY_REPORT_WEBHOOK_TOKEN=test-token-123
export DAILY_REPORT_WEBHOOK_SECRET=test-secret-456
export DAILY_REPORT_INCLUDE_TRANSACTIONS=${DAILY_REPORT_INCLUDE_TRANSACTIONS:-true}
export MOCK_TOKEN=$DAILY_REPORT_WEBHOOK_TOKEN MOCK_SECRET=$DAILY_REPORT_WEBHOOK_SECRET

python "$HERE/mock_receiver.py" 9100 &
MOCK=$!
trap 'kill $MOCK 2>/dev/null' EXIT
cd "$HERE/../../../backend"
python -m uvicorn server:app --host 127.0.0.1 --port 8100
