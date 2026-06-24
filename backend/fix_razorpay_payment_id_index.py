"""
fix_razorpay_payment_id_index.py — repair the razorpay_orders.rzp_payment_id index.

Problem:
  The index was created as {unique: True, sparse: True}. A SPARSE index still
  indexes documents where the field is present but explicitly null — it only
  skips documents where the field is ABSENT. create-order inserts new orders
  with rzp_payment_id = null (the payment id is only known after verification),
  so the second such order collides:

      E11000 duplicate key ... index: rzp_payment_id_1 dup key: {rzp_payment_id: null}

Fix:
  Drop the sparse-unique index and recreate it as a PARTIAL unique index that
  only enforces uniqueness when rzp_payment_id is an actual string. Multiple
  null/absent values are then allowed; real Razorpay payment ids stay unique.

Idempotent. Usage (from backend/):
  MONGO_URL="mongodb://localhost:27017/?directConnection=true" DB_NAME="shemford_school" \
      .venv/Scripts/python.exe fix_razorpay_payment_id_index.py

On the server (inside the backend container):
  sudo docker compose exec backend python fix_razorpay_payment_id_index.py
"""
import os
import asyncio

from dotenv import load_dotenv
from motor.motor_asyncio import AsyncIOMotorClient

load_dotenv()
db = AsyncIOMotorClient(os.environ["MONGO_URL"])[os.environ["DB_NAME"]]

INDEX_NAME = "rzp_payment_id_1"
PARTIAL_FILTER = {"rzp_payment_id": {"$type": "string"}}


async def main():
    coll = db.razorpay_orders
    info = await coll.index_information()
    existing = info.get(INDEX_NAME)
    print(f"Current {INDEX_NAME}: {existing}")

    # If it already has the right partial filter, nothing to do.
    if existing and existing.get("partialFilterExpression") == PARTIAL_FILTER and existing.get("unique"):
        print("Index already partial-unique. Nothing to do.")
        return

    if existing:
        await coll.drop_index(INDEX_NAME)
        print(f"Dropped old {INDEX_NAME}.")

    await coll.create_index(
        [("rzp_payment_id", 1)],
        name=INDEX_NAME,
        unique=True,
        partialFilterExpression=PARTIAL_FILTER,
        background=True,
    )
    print(f"Recreated {INDEX_NAME} as PARTIAL unique (only when rzp_payment_id is a string).")

    nulls = await coll.count_documents({"rzp_payment_id": None})
    print(f"Existing orders with null rzp_payment_id (now allowed): {nulls}")
    print("Done.")


if __name__ == "__main__":
    asyncio.run(main())
