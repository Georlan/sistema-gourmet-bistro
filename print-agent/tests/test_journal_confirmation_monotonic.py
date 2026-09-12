import os
import sys

current_dir = os.path.dirname(os.path.abspath(__file__))
agent_dir = os.path.abspath(os.path.join(current_dir, ".."))
if agent_dir not in sys.path:
    sys.path.insert(0, agent_dir)

from journal import PrintJournal


def test_confirmed_backend_never_regresses_on_late_print_retry(tmp_path):
    journal = PrintJournal(str(tmp_path / "journal.db"))

    journal.record_print_success(
        "job-1",
        "idem-1",
        "Cozinha",
        confirmed=False,
    )
    journal.mark_backend_confirmed("job-1")
    assert journal.is_confirmed("job-1") is True

    # A late/replayed spooler-success event must not reopen a job that the
    # backend has already confirmed. Confirmation is a monotonic invariant.
    journal.record_print_success(
        "job-1",
        "idem-1",
        "Cozinha",
        confirmed=False,
    )

    assert journal.is_confirmed("job-1") is True
    assert journal.get_unconfirmed_printed_jobs() == []
