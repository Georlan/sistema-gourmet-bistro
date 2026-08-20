from __future__ import annotations

import json
import os
from pathlib import Path


REPORT_PATH = Path(
    os.getenv("KOMA_SECURITY_AUDIT_REPORT", "security-audit-report.json")
)
BLOCKED_FINDING = "STAFF_LOGIN_NO_RATE_LIMIT"


def main() -> None:
    if not REPORT_PATH.exists():
        raise AssertionError(f"security audit report not found: {REPORT_PATH}")

    report = json.loads(REPORT_PATH.read_text())
    findings = report.get("findings", [])
    codes = {str(item.get("code")) for item in findings if item.get("code")}
    assert BLOCKED_FINDING not in codes, (
        "staff login brute-force probe is still unthrottled"
    )

    print("Security C OK: repeated staff password failures are throttled.")


if __name__ == "__main__":
    main()
