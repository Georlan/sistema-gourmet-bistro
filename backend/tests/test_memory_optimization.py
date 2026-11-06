import subprocess
import sys

from app.config import parse_malloc_arena_max, settings
from app.main import configure_memory_allocator


def test_parse_malloc_arena_max():
    """Valida o parser configurável de MALLOC_ARENA_MAX com suporte a desativação explícita."""
    assert parse_malloc_arena_max("2") == 2
    assert parse_malloc_arena_max("4") == 4
    assert parse_malloc_arena_max("1") == 1

    # Formatos que desativam o limitador de arenas (preservam default do SO)
    assert parse_malloc_arena_max("0") is None
    assert parse_malloc_arena_max("") is None
    assert parse_malloc_arena_max("none") is None
    assert parse_malloc_arena_max("disabled") is None
    assert parse_malloc_arena_max("false") is None
    assert parse_malloc_arena_max("off") is None
    assert parse_malloc_arena_max("null") is None
    assert parse_malloc_arena_max("invalido") is None


def test_settings_memory_defaults():
    """Valida que os defaults de memória e GC seguem os contratos de segurança operacional."""
    assert hasattr(settings, "MALLOC_ARENA_MAX")
    if settings.MALLOC_ARENA_MAX is not None:
        assert settings.MALLOC_ARENA_MAX >= 1

    # gc.freeze() DEVE ser False por padrão para proteger latência e evitar retenção de referências cíclicas
    assert hasattr(settings, "ENABLE_GC_FREEZE")
    assert settings.ENABLE_GC_FREEZE is False


def test_configure_memory_allocator_disabled_and_enabled():
    """Valida que configure_memory_allocator respeita desativação e executa de forma segura."""
    # Desativado explicitamente
    assert configure_memory_allocator(None) is False
    assert configure_memory_allocator(0) is False
    assert configure_memory_allocator(-1) is False

    # Execução segura com valor válido (retorna bool sem levantar exceção)
    result = configure_memory_allocator(2)
    assert isinstance(result, bool)
    if sys.platform.startswith("linux"):
        # Em Linux glibc, mallopt(-8, 2) retorna True e é idempotente
        assert result is True
        assert configure_memory_allocator(2) is True


def test_gc_freeze_isolated_subprocess():
    """Valida disponibilidade de gc.freeze() em subprocesso isolado.

    Garante isolamento estrito: o pytest runner NÃO tem seu coletor cíclico
    alterado ou congelado por este teste.
    """
    script = """
import gc
import sys

if not hasattr(gc, "freeze"):
    sys.exit(1)

initial_freeze = gc.get_freeze_count()
gc.freeze()
assert gc.get_freeze_count() >= initial_freeze
sys.exit(0)
"""
    result = subprocess.run([sys.executable, "-c", script], check=False, capture_output=True, text=True)
    assert result.returncode == 0, f"Falha no teste isolado de GC: {result.stderr}"
