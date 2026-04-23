# Database Migration Plan — Production Upgrade
## Shemford Futuristic School ERP

This document covers every schema change introduced in the production-grade upgrade and explains how to apply them safely to an existing school database without losing data.

---

## 1. New Collections

These collections do not exist yet. They are created automatically the first time a document is inserted, but their indexes must be pre-created to guarantee uniqueness and TTL cleanup.

### `jti_blocklist`
Stores revoked JWT access tokens until their natural expiry.

| Field | Type | Notes |
|-------|------|-------|
| `jti` | string | unique — the JWT's `jti` claim |
| `expires_at` | Date (BSON) | TTL index auto-deletes the document after this date |

**Action:** Run `db_init.py` (called automatically on server startup). No existing data to migrate.

### `refresh_tokens`
Stores opaque refresh tokens issued on login.

| Field | Type | Notes |
|-------|------|-------|
| `token` | string | unique, 64-char URL-safe random string |
| `user_id` | string | |
| `role` | string | |
| `is_revoked` | bool | `false` by default |
| `created_at` | Date | |
| `expires_at` | Date (BSON) | TTL index auto-deletes after this date |

**Action:** Run `db_init.py`. No existing data. Existing sessions (OAuth cookie) are unaffected — those use `user_sessions` collection, which is unchanged.

---

## 2. Field-Level Encryption — `employees` and `payroll`

### What changes
Four fields in `employees` are now stored encrypted:
- `bank_account_number`
- `bank_ifsc`
- `bank_name`
- `bank_account_holder`

Two fields in `payroll.bank_snapshot` are now stored encrypted:
- `bank_snapshot.account_number`
- `bank_snapshot.ifsc`
- `bank_snapshot.bank_name`

### Migration strategy: **opt-in prefix sentinel**
- Encrypted values are stored as `enc:<base64-fernet-ciphertext>`.
- The application read path (`decrypt_field`) checks for the `enc:` prefix:
  - If present → decrypts with Fernet.
  - If absent → returns the value unchanged (backward-compat for un-migrated rows).
- A flag `_bank_fields_encrypted: true` is written to each document once all its bank fields have been encrypted, so the migration script can skip already-processed rows on subsequent runs.

### Zero-downtime migration steps

#### Step 1 — Generate and deploy the encryption key
```bash
python3 -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
# → Add output to backend/.env as FIELD_ENCRYPTION_KEY=<value>
```
Restart the backend. New writes to `employees` and `payroll` will now be encrypted automatically.
**Existing rows are still readable** — the `enc:` prefix sentinel means the app reads them as plaintext until the migration runs.

#### Step 2 — Dry run (non-destructive preview)
```bash
cd backend
python migrations/migrate_encrypt_bank.py --dry-run
```
This prints every field it *would* encrypt without writing anything. Review the output to confirm:
- Number of employees to update
- Number of payroll records to update

#### Step 3 — Live migration
```bash
python migrations/migrate_encrypt_bank.py
```
Output:
```
employees: processed=47 updated=42 skipped=5 errors=0
payroll: processed=120 updated=110 skipped=10 errors=0
Migration completed successfully
```
- `skipped` = documents already flagged as encrypted or with no bank data.
- `errors` = documents that failed (review logs; re-run is safe — idempotent).

#### Step 4 — Verify
```bash
# Spot-check one employee in mongo shell:
mongosh shemford_school --eval "db.employees.findOne({bank_account_number: {$exists: true}})" | grep bank
# Should show "enc:gAAAAAB..." values
```

#### Step 5 — (Optional) Enforce encryption at DB level
After migration is 100% complete, you can add a validation rule in MongoDB:
```js
db.runCommand({
  collMod: "employees",
  validator: {
    $jsonSchema: {
      properties: {
        bank_account_number: {
          bsonType: "string",
          pattern: "^enc:|^$"
        }
      }
    }
  },
  validationLevel: "moderate"
})
```

---

## 3. `employees` Collection — New Fields

The following fields were added to `EmployeeBase` (already backfilled with defaults in the model):

| Field | Default | Notes |
|-------|---------|-------|
| `monthly_salary` | `0.0` | Used for payroll calculation |
| `bank_account_number` | `null` | Encrypted after migration |
| `bank_ifsc` | `null` | Encrypted after migration |
| `bank_name` | `null` | Encrypted after migration |
| `bank_account_holder` | `null` | Encrypted after migration |
| `_bank_fields_encrypted` | `false` | Migration state flag — not for display |

**Action:** No migration needed. MongoDB's schemaless nature means existing documents simply won't have these fields, and `emp.get("monthly_salary", 0)` defaults handle that. Update employees via the UI or a bulk update script if needed.

---

## 4. `student_ledger` Collection — New Fields

| Field | Default | Notes |
|-------|---------|-------|
| `status` | `"pending"` | Now supports `"partially_paid"` in addition to existing values |
| `amount_paid` | `0` | Total amount received so far |
| `remaining_balance` | `0` | Amount still owed |

**Action:** No migration needed. Existing rows have `status="pending"/"paid"/"overdue"/"waived"` — all remain valid. The new `amount_paid`/`remaining_balance` fields default to `0` and are only set when a partial payment is processed.

---

## 5. `payroll` Collection (new collection)

Entirely new. Created on first payroll generation. Indexes created by `db_init.py` on startup. No migration required.

---

## 6. `razorpay_orders` Collection (new collection)

Entirely new. Created on first Razorpay order. Indexes created by `db_init.py` on startup. No migration required.

---

## 7. Index Changes

`db_init.py` is run automatically on every server startup. It uses `create_index` with `background=True`, which means:
- Indexes are built without blocking reads/writes on the collection.
- If the index already exists, the call is a no-op.
- Safe to run on a live database.

New indexes added in this upgrade:
- `jti_blocklist.jti` (unique)
- `jti_blocklist.expires_at` (TTL)
- `refresh_tokens.token` (unique)
- `refresh_tokens.(user_id, is_revoked)` (compound)
- `refresh_tokens.expires_at` (TTL)

---

## 8. Rollback Plan

| Change | Rollback |
|--------|---------- |
| JTI blocklist / refresh tokens | Drop `jti_blocklist` and `refresh_tokens` collections. Revert `auth_utils.py` and `routes/auth.py` to previous version. |
| Field encryption | Remove `FIELD_ENCRYPTION_KEY` from `.env`. The app falls back to plaintext reads for unencrypted values. Already-encrypted values will be returned as `enc:...` strings until the key is restored. **Do not rotate or delete the key while encrypted data still exists.** |
| Rate limiter | Remove `RateLimitMiddleware` from `server.py`. |
| Request ID header | Remove `attach_request_id` middleware from `server.py`. |

---

## 9. Key Management Notes

- **Never commit `FIELD_ENCRYPTION_KEY` to git.** It grants read access to all encrypted PII.
- Store the key in a secrets manager (AWS Secrets Manager, HashiCorp Vault, etc.) for production.
- **Key rotation**: to rotate, use Fernet's `MultiFernet` with two keys (old + new), re-encrypt all documents, then remove the old key from the key list. This is not implemented yet — add when needed.
- **Backup the key** alongside database backups — a database backup without the key is unrecoverable for encrypted fields.
