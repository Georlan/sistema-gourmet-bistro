from __future__ import annotations

import argparse
import json

from app.database import SessionLocal, current_restaurante_id
from app.services.atendimento_reconciliation import (
    find_open_atendimentos_without_open_commands,
    repair_open_atendimentos_without_open_commands,
)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Audita e, sob confirmação estrita, repara atendimentos abertos sem comanda aberta."
    )
    parser.add_argument("--restaurant-id", type=int, required=True)
    parser.add_argument("--apply", action="store_true", help="Aplica a reparação; o padrão é dry-run.")
    parser.add_argument(
        "--expected-count",
        type=int,
        help="Contagem observada no dry-run; obrigatória com --apply.",
    )
    parser.add_argument("--actor-id", help="Usuário responsável, quando existir no mesmo restaurante.")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    if args.apply and args.expected_count is None:
        raise SystemExit("--expected-count é obrigatório com --apply")

    tenant_token = current_restaurante_id.set(args.restaurant_id)
    db = SessionLocal()
    try:
        findings = find_open_atendimentos_without_open_commands(
            db,
            restaurante_id=args.restaurant_id,
        )
        result = {
            "mode": "apply" if args.apply else "dry-run",
            "restaurant_id": args.restaurant_id,
            "count": len(findings),
            "findings": [finding.to_dict() for finding in findings],
        }
        if not args.apply:
            db.rollback()
            print(json.dumps(result, ensure_ascii=False, indent=2, default=str))
            return 0

        repaired = repair_open_atendimentos_without_open_commands(
            db,
            restaurante_id=args.restaurant_id,
            expected_count=args.expected_count,
            actor_id=args.actor_id,
        )
        db.commit()
        result["count"] = len(repaired)
        result["findings"] = [finding.to_dict() for finding in repaired]
        result["audit"] = "movimentos_atendimento:fechamento"
        print(json.dumps(result, ensure_ascii=False, indent=2, default=str))
        return 0
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()
        current_restaurante_id.reset(tenant_token)


if __name__ == "__main__":
    raise SystemExit(main())
