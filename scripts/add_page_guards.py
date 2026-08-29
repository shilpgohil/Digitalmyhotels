"""Add RequirePermission guards to partner portal pages that lack them.

Run from workspace root:  python scripts/add_page_guards.py
"""

from __future__ import annotations

import re
from pathlib import Path

SRC = Path("frontend/src/app/(partner)")

# Map route -> (FunctionName, permission constant)
# Permission constants must match PERMISSIONS in lib/permissions.ts
GUARDS = {
    "invoices": ("InvoicesPage", "PERMISSIONS.invoicesManage"),
    "expenses": ("ExpensesPage", "PERMISSIONS.expensesView"),
    "team": ("TeamPage", "PERMISSIONS.hotelManageTeam"),
    "daily-closing": ("DailyClosingPage", "PERMISSIONS.dailyClosing"),
    "shift-handover": ("ShiftHandoverPage", "PERMISSIONS.shiftHandover"),
    "reports": ("ReportsPage", "PERMISSIONS.reportsView"),
    "audit": ("AuditPage", "PERMISSIONS.auditView"),
    "housekeeping": ("HousekeepingPage", "PERMISSIONS.housekeepingManage"),
    "checkin": ("CheckinPage", "PERMISSIONS.checkin"),
    "checkout": ("CheckoutPage", "PERMISSIONS.checkout"),
    "bookings": ("BookingsPage", "PERMISSIONS.bookingsView"),
    "current-guests": ("CurrentGuestsPage", "PERMISSIONS.guestsView"),
    "rooms": ("RoomsPage", "PERMISSIONS.roomsView"),
    "plan": ("PlanPage", "PERMISSIONS.hotelView"),
    "settings": ("SettingsPage", "PERMISSIONS.hotelView"),
}

IMPORT_LINE = 'import { RequirePermission } from "@/components/auth/require-permission";'
PERMISSIONS_IMPORT = 'import { PERMISSIONS } from "@/lib/permissions";'


def already_guarded(text: str) -> bool:
    return "RequirePermission" in text


def add_guard(page: Path, fn_name: str, permission: str) -> None:
    text = page.read_text(encoding="utf-8")
    if already_guarded(text):
        print(f"  already guarded: {page}")
        return

    # Insert import after the last "import" line block at top of file.
    lines = text.splitlines(keepends=True)
    last_import_idx = 0
    for i, line in enumerate(lines):
        stripped = line.lstrip()
        if stripped.startswith("import "):
            last_import_idx = i

    # Add RequirePermission import.
    has_perm_import = PERMISSIONS_IMPORT in text
    insert_lines = [IMPORT_LINE + "\n"]
    if not has_perm_import:
        insert_lines.append(PERMISSIONS_IMPORT + "\n")
    lines.insert(last_import_idx + 1, "".join(insert_lines))
    text = "".join(lines)

    # Rename `export default function FnName` -> `function ContentName`.
    content_name = fn_name.replace("Page", "Content")
    text = re.sub(
        rf"\bexport default function {re.escape(fn_name)}\b",
        f"function {content_name}",
        text,
        count=1,
    )

    # Append export wrapper.
    wrapper = f"""
export default function {fn_name}() {{
  return (
    <RequirePermission permission={{{permission}}}>
      <{content_name} />
    </RequirePermission>
  );
}}
"""
    text = text.rstrip("\n") + "\n" + wrapper

    page.write_text(text, encoding="utf-8")
    print(f"  guarded: {page} ({permission})")


def main() -> None:
    for route, (fn_name, permission) in GUARDS.items():
        page = SRC / route / "page.tsx"
        if not page.exists():
            print(f"  skip (not found): {page}")
            continue
        add_guard(page, fn_name, permission)


if __name__ == "__main__":
    main()
    print("Done.")
