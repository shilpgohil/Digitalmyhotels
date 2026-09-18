# -*- coding: utf-8 -*-
import sys
sys.stdout.reconfigure(encoding="utf-8", errors="replace")

NEON = ("host=ep-royal-cell-azlddqmb-pooler.c-3.ap-southeast-1.aws.neon.tech "
        "dbname=neondb user=neondb_owner password=npg_XS48EVkFOGQr "
        "sslmode=require connect_timeout=30")

import psycopg2, psycopg2.extras
conn = psycopg2.connect(NEON); conn.autocommit = True
cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
def db(sql): cur.execute(sql); return [dict(r) for r in cur.fetchall()]

print("=== Guests with same id_last4 (same Aadhaar last 4) in same hotel ===")
rows = db("""
    SELECT h.name AS hotel, g.id_last4, g.full_name,
           g.normalized_phone, g.created_at::date AS joined,
           (SELECT COUNT(*) FROM bookings b WHERE b.primary_guest_id = g.id) AS booking_count
    FROM guests g JOIN hotels h ON h.id = g.hotel_id
    WHERE g.id_last4 IS NOT NULL
    ORDER BY h.name, g.id_last4, g.full_name, g.created_at
""")
# Group by hotel + id_last4
from collections import defaultdict
groups = defaultdict(list)
for r in rows:
    groups[(r['hotel'], r['id_last4'])].append(r)

for (hotel, last4), guests in groups.items():
    if len(guests) > 1:
        print(f"\n  Hotel: {hotel} | Aadhaar last4: ****{last4}")
        for g in guests:
            print(f"    {g['full_name']:25} | phone: {g['normalized_phone']:15} | bookings: {g['booking_count']} | joined: {g['joined']}")

print("\n=== Guest DB constraint ===")
print("unique constraint: (hotel_id, normalized_phone) - phone must be unique per hotel")
print("id_last4 is NOT unique - same ID can have multiple records")

print("\n=== What create_guest does when phone already exists ===")
dup_check = db("""
    SELECT h.name, g.full_name, g.normalized_phone, COUNT(*) AS cnt
    FROM guests g JOIN hotels h ON h.id = g.hotel_id
    GROUP BY h.name, g.full_name, g.normalized_phone
    HAVING COUNT(*) > 1
""")
print(f"  True duplicates (same name+phone): {len(dup_check)}")

conn.close()
