"""Tenant-scoped inventory/enrollment/collection; dry-run is ALWAYS the default."""
import argparse
import json
from app.database import engine, TenantSession, tenant_session_scope
from app.services.product_image_lifecycle import run_tenant
from app.services.outbox.worker import discover_active_restaurant_ids


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('mode', choices=['collect', 'reconcile'])
    scope = parser.add_mutually_exclusive_group(required=True)
    scope.add_argument('--tenant', type=int)
    scope.add_argument('--all-tenants', action='store_true')
    parser.add_argument('--execute', action='store_true', help='Explicitly enroll (reconcile) or DELETE due objects (collect)')
    parser.add_argument('--min-age-days', type=int, default=7)
    args = parser.parse_args()
    if args.tenant is not None and args.tenant <= 0:
        parser.error('tenant deve ser positivo')
    if args.min_age_days < 7:
        parser.error('min-age-days deve ser pelo menos 7')
    if args.all_tenants:
        with TenantSession(bind=engine) as db:
            tenants = discover_active_restaurant_ids(db)
    else:
        tenants = [args.tenant]
    for tenant in tenants:
        print(json.dumps({'dry_run': not args.execute, 'tenant': tenant,
                         'result': run_tenant(tenant, mode=args.mode, execute=args.execute,
                                              min_age_days=args.min_age_days)}, ensure_ascii=False))


if __name__ == '__main__':
    main()
