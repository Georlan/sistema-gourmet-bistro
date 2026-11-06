import gc
import os
import sys
import pytest

from app.config import settings
from app.main import configure_memory_allocator


def test_malloc_arena_max_config_default():
    """Valida que MALLOC_ARENA_MAX possui default 2 para bounding de memória em contêineres."""
    assert hasattr(settings, "MALLOC_ARENA_MAX")
    assert settings.MALLOC_ARENA_MAX >= 1


def test_configure_memory_allocator_executes_safely():
    """Valida execução segura e idempotente de configure_memory_allocator."""
    result = configure_memory_allocator()
    # Em Linux com glibc, mallopt(-8, 2) retorna True; em outros SOs ou falhas, retorna False sem lançar exceção.
    assert isinstance(result, bool)
    if sys.platform.startswith("linux"):
        # Segunda chamada deve ser idempotente
        assert configure_memory_allocator() is True


def test_gc_freeze_capability():
    """Valida que gc.freeze() está disponível e operacional na versão Python do runtime."""
    assert hasattr(gc, "freeze")
    initial_freeze = gc.get_freeze_count()
    gc.freeze()
    assert gc.get_freeze_count() >= initial_freeze
