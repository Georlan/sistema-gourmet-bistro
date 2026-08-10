"""Despacho rápido de lotes preservando a ordem de cada impressora."""

from collections import OrderedDict
from concurrent.futures import ThreadPoolExecutor, as_completed
import time
from typing import Any, Dict, Iterable, List


def _target_printer(job: Dict[str, Any], printers: Dict[str, str]) -> str:
    destination = str(job.get("destination") or "COZINHA").upper()
    return (
        printers.get(destination)
        or printers.get("PADRAO")
        or "Padrão"
    )


def _dispatch_lane(adapter, journal, lane: List[Dict[str, Any]]):
    """Submete uma fila física em FIFO e para somente aquela fila ao falhar."""
    outcomes = []
    for index, item in enumerate(lane):
        job = item["job"]
        job_id = str(job["id"])
        idempotency_key = str(job.get("idempotency_key") or job_id)
        printer_name = item["printer_name"]

        if journal.is_printed(job_id, idempotency_key):
            outcomes.append({**item, "state": "accepted", "submit_ms": 0})
            continue

        started = time.perf_counter()
        success = adapter.print_ticket(
            str(job.get("payload_text") or ""),
            printer_name,
            str(job.get("document_type") or "producao").upper(),
            skip_ready_check=True,
        )
        submit_ms = round((time.perf_counter() - started) * 1000)
        if success:
            # Gravar antes de qualquer confirmação HTTP impede segunda via se
            # a rede cair depois que CUPS/Spooler aceitou o trabalho.
            journal.record_print_success(
                job_id,
                idempotency_key,
                printer_name,
                confirmed=False,
            )
            outcomes.append(
                {**item, "state": "accepted", "submit_ms": submit_ms}
            )
            continue

        outcomes.append({**item, "state": "failed", "submit_ms": submit_ms})
        outcomes.extend(
            {**remaining, "state": "release", "submit_ms": 0}
            for remaining in lane[index + 1:]
        )
        break
    return outcomes


def dispatch_claimed_jobs(
    adapter,
    journal,
    claimed_jobs: Iterable[Dict[str, Any]],
    printers: Dict[str, str],
    max_parallel_printers: int = 2,
) -> List[Dict[str, Any]]:
    """
    Envia destinos diferentes em paralelo, mantendo FIFO por impressora.

    A impressora física continua imprimindo em série, mas o agente não espera
    a cozinha para começar a submeter o bar. Em uma única térmica, todos os
    trabalhos permanecem na mesma lane e chegam rapidamente ao spooler.
    """
    lanes: "OrderedDict[str, list[dict[str, Any]]]" = OrderedDict()
    for position, job in enumerate(claimed_jobs):
        printer_name = _target_printer(job, printers)
        lanes.setdefault(printer_name, []).append(
            {
                "position": position,
                "job": job,
                "printer_name": printer_name,
            }
        )

    if not lanes:
        return []
    if len(lanes) == 1 or max_parallel_printers <= 1:
        results = []
        for lane in lanes.values():
            results.extend(_dispatch_lane(adapter, journal, lane))
        return sorted(results, key=lambda item: item["position"])

    results = []
    workers = min(max(1, max_parallel_printers), len(lanes), 4)
    with ThreadPoolExecutor(
        max_workers=workers,
        thread_name_prefix="koma-printer",
    ) as executor:
        futures = [
            executor.submit(_dispatch_lane, adapter, journal, lane)
            for lane in lanes.values()
        ]
        for future in as_completed(futures):
            results.extend(future.result())
    return sorted(results, key=lambda item: item["position"])
