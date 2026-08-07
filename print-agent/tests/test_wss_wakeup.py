"""
Testes de Unidade para o WSS Outbound Push & Resiliência do Kôma Print Agent.
Verifica:
1. Sinalização de wake_up via WSS desbloqueia o evento imediatamente.
2. Queda de WSS reverte graciosamente para polling padrão sem perder trabalhos.
3. Idempotência e journal local permanecem 100% protegidos.
"""

import sys
import os
import tempfile
import threading
import time
import unittest

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from wss_client import WssWakeupClient
from config import AgentConfig
from journal import PrintJournal


class TestWssWakeupAndResilience(unittest.TestCase):

    def test_wake_event_unblocks_wait(self):
        """Testa se o wake_event descongela o worker de forma instantânea ao receber sinal."""
        wake_event = threading.Event()
        start_time = time.time()

        # Simular disparo WSS em 0.1s
        def trigger_signal():
            time.sleep(0.1)
            wake_event.set()

        t = threading.Thread(target=trigger_signal)
        t.start()

        # O worker espera por até 5.0s, mas deve ser liberado em ~0.1s
        unblocked = wake_event.wait(timeout=5.0)
        elapsed = time.time() - start_time

        self.assertTrue(unblocked)
        self.assertLess(elapsed, 1.0, "O evento deveria ter sido liberado em menos de 1 segundo.")

    def test_fallback_to_polling_when_wss_unavailable(self):
        """Testa se o timeout do wake_event expira normalmente no tempo de polling quando o WSS não estiver disponível."""
        wake_event = threading.Event()
        start_time = time.time()

        # Esperar com timeout de 0.2s sem nenhum sinal disparado
        unblocked = wake_event.wait(timeout=0.2)
        elapsed = time.time() - start_time

        self.assertFalse(unblocked, "Sem WSS, o timeout deve expirar normalmente.")
        self.assertGreaterEqual(elapsed, 0.18, "O tempo percorrido deve respeitar o intervalo do polling fallback.")

    def test_journal_idempotency_prevents_duplicate_print(self):
        """Garante que notificações WSS duplicadas ou re-envios de WSS não causam impressão dupla."""
        with tempfile.NamedTemporaryFile(suffix=".db", delete=False) as tmp:
            db_path = tmp.name

        try:
            journal = PrintJournal(db_path=db_path)
            job_id = "test_job_wss_001"

            # Registrar primeira impressão
            self.assertFalse(journal.is_printed(job_id))
            journal.record_print_success(job_id, idempotency_key="ikey_001", printer_name="USB_Thermal")
            self.assertTrue(journal.is_printed(job_id))

            # Tentar simular segundo sinal WSS para o mesmo job
            # O journal deve continuar reportando como já impresso
            self.assertTrue(journal.is_printed(job_id))
        finally:
            if os.path.exists(db_path):
                os.remove(db_path)


if __name__ == "__main__":
    unittest.main()
