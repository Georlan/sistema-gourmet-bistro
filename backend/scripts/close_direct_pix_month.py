"""Daily job, with an explicit tenant allowlist. Does not discover or mutate other tenants.

Usage: PYTHONPATH=backend python backend/scripts/close_direct_pix_month.py --tenant 123
Run after deploying migrations, with the runtime koma_app role. Repeat safely.
"""
import argparse
import datetime as dt
from zoneinfo import ZoneInfo
from app.database import SessionLocal, current_restaurante_id
from app.models import RestaurantDirectPixConfig
from app.services.direct_pix_billing import close_month


def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--tenant',type=int,action='append',required=True)
    args=parser.parse_args()
    today=dt.datetime.now(ZoneInfo('America/Sao_Paulo'))
    period=(today.replace(day=1)-dt.timedelta(days=1)).strftime('%Y-%m')
    for tenant in args.tenant:
        token=current_restaurante_id.set(tenant)
        try:
            with SessionLocal(restaurante_id=tenant) as db:
                config=db.query(RestaurantDirectPixConfig).filter(RestaurantDirectPixConfig.restaurante_id==tenant).one_or_none()
                if config is None:
                    continue
                invoice=close_month(db,restaurant_id=tenant,period=period)
                db.commit()
                print(f'tenant={tenant} period={period} invoice={invoice.id} status={invoice.status}')
        finally:
            current_restaurante_id.reset(token)


if __name__=='__main__':
    main()
