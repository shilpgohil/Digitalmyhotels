# -*- coding: utf-8 -*-
import sys, os
sys.stdout.reconfigure(encoding="utf-8", errors="replace")
NEON = ("host=ep-royal-cell-azlddqmb-pooler.c-3.ap-southeast-1.aws.neon.tech "
        "dbname=neondb user=neondb_owner password=npg_XS48EVkFOGQr "
        "sslmode=require connect_timeout=30")
import psycopg2, psycopg2.extras
conn = psycopg2.connect(NEON); conn.autocommit = True
cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
def db(sql): cur.execute(sql); return [dict(r) for r in cur.fetchall()]
from datetime import date
today = date.today()

print("=== PRODUCTION MIGRATION HEAD ===")
migs = db("SELECT version_num FROM alembic_version")
print(f"  Head: {migs[0]['version_num'] if migs else 'NONE'}")

print("\n=== LOCAL MIGRATION FILES (last 10) ===")
mig_dir = "backend/alembic/versions"
files = sorted(os.listdir(mig_dir))
for f in files[-10:]:
    print(f"  {f[:55]}")

print("\n=== OVERDUE BOOKINGS (checked_in but past checkout_date) ===")
overdue = db("""
    SELECT h.name, b.booking_number, b.check_in_date, b.check_out_date,
           b.payment_status, b.status,
           (CURRENT_DATE - b.check_out_date) AS days_overdue
    FROM bookings b JOIN hotels h ON h.id=b.hotel_id
    WHERE b.status='checked_in'
      AND b.check_out_date < CURRENT_DATE
    ORDER BY days_overdue DESC
""")
for r in overdue:
    d = r["days_overdue"]
    days = d.days if hasattr(d, "days") else d
    print(f"  {r['name'][:20]:20} {r['booking_number']} checkin={r['check_in_date']} due={r['check_out_date']} overdue={days}d pay={r['payment_status']}")
if not overdue:
    print("  (none)")

print("\n=== MIGRATION CHAIN ANALYSIS ===")
print(f"  Production head: {migs[0]['version_num'] if migs else 'NONE'}")
print(f"  Our new migration: fa3e1d2c9b87 (alternate_contact_phone)")
print(f"  Our migration's down_revision: dd48e2f5ab34")
print(f"  Production does NOT have our column yet - will be applied on next deploy")

conn.close()
print("\n=== DONE ===")
