"""Two real processes sharing PostgreSQL; no second in-process manager stands in."""

from __future__ import annotations

import asyncio
import multiprocessing as mp
import os
import queue
import time

import pytest


def _process(label, commands, output, database_url):
    os.environ["DATABASE_URL"] = database_url
    os.environ["MIGRATION_DATABASE_URL"] = database_url
    from app.websocket_manager import ConnectionManager

    class Socket:
        def __init__(self, name):
            self.name = name

        async def accept(self, **_kwargs):
            return None

        async def send_json(self, message):
            output.put(("event", label, self.name, message))

        async def close(self, **_kwargs):
            output.put(("closed", label, self.name, None))

    async def serve():
        manager = ConnectionManager(shared_transport=True)
        manager.start()
        assert await asyncio.to_thread(manager.bus.ready.wait, 8)
        output.put(("ready", label, manager.bus.instance_id, None))
        sockets = {}
        transaction = None
        while True:
            nonce, action, args = await asyncio.to_thread(commands.get)
            if action == "quit":
                output.put(("ack", label, nonce, None))
                break
            if action == "connect":
                name, tenant, audience, user = args
                socket = Socket(name)
                sockets[name] = socket
                await manager.connect(socket, tenant, client_type=audience, user_id=user)
            elif action == "broadcast":
                message, tenant, audience = args
                await manager.broadcast(message, tenant, target_audience=audience)
            elif action == "revoke":
                tenant, user = args
                manager.revoke(tenant, user)
            elif action == "generation":
                output.put(("generation", label, manager.bus.generation, manager.bus.ready.is_set()))
            elif action == "tx_begin":
                from sqlalchemy.orm import Session
                from app.database import engine
                transaction = Session(engine)
                transaction.begin()
            elif action == "tx_queue":
                message, tenant = args
                manager.queue_committed_broadcast(transaction, message, tenant)
            elif action == "tx_commit":
                transaction.commit()
                transaction.close()
                transaction = None
            elif action == "tx_rollback":
                transaction.rollback()
                transaction.close()
                transaction = None
            output.put(("ack", label, nonce, None))
        await asyncio.to_thread(manager.stop)

    asyncio.run(serve())


def test_two_process_operational_realtime():
    url = os.getenv("KOMA_REALTIME_TEST_DATABASE_URL")
    if not url:
        pytest.skip("Set KOMA_REALTIME_TEST_DATABASE_URL to a disposable PostgreSQL database")

    context = mp.get_context("spawn")
    output = context.Queue()
    processes = {}
    commands = {}
    pending = []
    nonce = 0

    def take(predicate, timeout=5):
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            for index, item in enumerate(pending):
                if predicate(item):
                    return pending.pop(index)
            try:
                pending.append(output.get(timeout=0.1))
            except queue.Empty:
                continue
        raise AssertionError(f"Timed out waiting for process event; pending={pending}")

    def command(label, action, *args):
        nonlocal nonce
        nonce += 1
        commands[label].put((nonce, action, args))
        take(lambda item: item[0] == "ack" and item[1] == label and item[2] == nonce)

    def start(label):
        commands[label] = context.Queue()
        process = context.Process(target=_process, args=(label, commands[label], output, url))
        process.start()
        processes[label] = process
        return take(lambda item: item[0] == "ready" and item[1] == label)[2]

    def events_for(marker, expected):
        for _ in range(len(expected)):
            take(lambda item: item[0] == "event" and item[3].get("marker") == marker)
        time.sleep(0.25)
        extra = []
        while True:
            try:
                pending.append(output.get_nowait())
            except queue.Empty:
                break
        for item in pending:
            if item[0] == "event" and item[3].get("marker") == marker:
                extra.append((item[1], item[2]))
        assert not extra, extra
        # The expected events were consumed above; call sites also check scope
        # through the per-socket delivery acknowledgements below.

    try:
        instance_a = start("A")
        start("B")
        for label in ("A", "B"):
            for tenant in (10, 20):
                command(label, "connect", f"{label}-{tenant}-internal", tenant, "internal", f"user-{label}-{tenant}")
                command(label, "connect", f"{label}-{tenant}-client", tenant, "client", None)

        command("A", "broadcast", {"event": "tables_updated", "marker": "a-to-b"}, 10, "internal")
        first = [take(lambda item: item[0] == "event" and item[3].get("marker") == "a-to-b") for _ in range(2)]
        assert {(item[1], item[2]) for item in first} == {("A", "A-10-internal"), ("B", "B-10-internal")}
        events_for("a-to-b", [])

        command("B", "broadcast", {"event": "tables_updated", "marker": "b-to-a"}, 10, "internal")
        second = [take(lambda item: item[0] == "event" and item[3].get("marker") == "b-to-a") for _ in range(2)]
        assert {(item[1], item[2]) for item in second} == {("A", "A-10-internal"), ("B", "B-10-internal")}
        events_for("b-to-a", [])

        command("A", "broadcast", {"event": "config_updated", "marker": "public"}, 10, None)
        public = [take(lambda item: item[0] == "event" and item[3].get("marker") == "public") for _ in range(4)]
        assert {(item[1], item[2]) for item in public} == {
            (label, f"{label}-10-{audience}") for label in ("A", "B") for audience in ("internal", "client")
        }
        events_for("public", [])

        command("A", "revoke", 10, "user-B-10")
        closed = take(lambda item: item[0] == "closed" and item[1] == "B")
        assert closed[2] == "B-10-internal"

        command("A", "tx_begin")
        command("A", "tx_queue", {"event": "tables_updated", "marker": "rollback"}, 10)
        command("A", "tx_rollback")
        events_for("rollback", [])
        command("A", "tx_begin")
        command("A", "tx_queue", {"event": "tables_updated", "marker": "commit"}, 10)
        command("A", "tx_commit")
        committed = [take(lambda item: item[0] == "event" and item[3].get("marker") == "commit") for _ in range(1)]
        assert {(item[1], item[2]) for item in committed} == {("A", "A-10-internal")}
        events_for("commit", [])

        command("B", "revoke", 20, None)
        tenant_closed = [take(lambda item: item[0] == "closed" and item[2].endswith("20-internal")) for _ in range(2)]
        assert {(item[1], item[2]) for item in tenant_closed} == {
            ("A", "A-20-internal"), ("B", "B-20-internal")
        }

        # Interrupt A's LISTEN connection. It must reconnect without restarting B.
        import psycopg2
        with psycopg2.connect(url.replace("postgresql+psycopg2://", "postgresql://", 1)) as connection, connection.cursor() as cursor:
            cursor.execute("SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE application_name = %s", (f"koma-operational-{instance_a[:8]}",))
        deadline = time.monotonic() + 8
        while time.monotonic() < deadline:
            command("A", "generation")
            generation = take(lambda item: item[0] == "generation" and item[1] == "A")
            if generation[2] >= 2 and generation[3]:
                break
            time.sleep(0.2)
        else:
            raise AssertionError("Listener A did not reconnect")
        command("B", "broadcast", {"event": "tables_updated", "marker": "reconnected"}, 10, "internal")
        got = take(lambda item: item[0] == "event" and item[3].get("marker") == "reconnected")
        assert (got[1], got[2]) == ("A", "A-10-internal")

        command("B", "quit")
        processes["B"].join(timeout=5)
        assert not processes["B"].is_alive()
        command("A", "broadcast", {"event": "tables_updated", "marker": "alone"}, 10, "internal")
        assert take(lambda item: item[0] == "event" and item[3].get("marker") == "alone")[1] == "A"
        start("B")
        command("B", "connect", "B-restarted-10", 10, "internal", "user-B-new")
        command("A", "broadcast", {"event": "tables_updated", "marker": "restart"}, 10, "internal")
        restarted = [take(lambda item: item[0] == "event" and item[3].get("marker") == "restart") for _ in range(2)]
        assert {(item[1], item[2]) for item in restarted} == {("A", "A-10-internal"), ("B", "B-restarted-10")}

        command("B", "broadcast", {"event": "tables_updated", "marker": "other-user-survives"}, 10, "internal")
        survivor = [take(lambda item: item[0] == "event" and item[3].get("marker") == "other-user-survives") for _ in range(2)]
        assert {(item[1], item[2]) for item in survivor} == {("A", "A-10-internal"), ("B", "B-restarted-10")}
    finally:
        for label, process in processes.items():
            if process.is_alive():
                try:
                    command(label, "quit")
                except Exception:
                    pass
                process.join(timeout=3)
                if process.is_alive():
                    process.terminate()
                    process.join(timeout=3)
