"""Commit-safe invalidations to the affected courier only, through the existing bus."""
from ..websocket_manager import manager


def queue_courier_refresh(db, restaurant_id, *courier_ids):
    for courier_id in set(courier_ids):
        if isinstance(courier_id, int) and not isinstance(courier_id, bool) and courier_id > 0:
            manager.queue_committed_broadcast(db, {'event': 'courier_panel_updated', 'courier_id': courier_id}, restaurant_id, target_audience='courier')


def queue_courier_revocation(db, restaurant_id, courier_id):
    db.info.setdefault('revoked_websocket_sessions', set()).add((restaurant_id, f'courier:{courier_id}'))
