"""Small hourly maintenance loop. Deletion requires an explicit deployment opt-in."""
import asyncio
import logging
import os

logger = logging.getLogger('koma.product_image_worker')


def sweep():
    # Disabled collection must be idle, rather than running the same expensive
    # reference checks every hour. Explicit CLI dry-runs remain available.
    execute = os.getenv('PRODUCT_IMAGE_GC_EXECUTE', 'false').lower() == 'true'
    if not execute:
        return
    from ..database import SessionLocal
    from .outbox.worker import discover_active_restaurant_ids
    from .product_image_lifecycle import run_tenant
    with SessionLocal() as db:
        tenants = discover_active_restaurant_ids(db)
    for tenant in tenants:
        try:
            result = run_tenant(tenant, execute=execute)
            if result:
                logger.info('Image GC tenant=%s execute=%s results=%s', tenant, execute, result)
        except Exception:
            logger.exception('Image GC failed tenant=%s', tenant)


async def run_worker():
    while True:
        try:
            await asyncio.to_thread(sweep)
        except Exception:
            logger.exception('Image GC discovery failed')
        await asyncio.sleep(3600)
