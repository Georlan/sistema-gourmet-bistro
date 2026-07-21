import sys
from .base import BasePrinterAdapter
from .dummy import DummyPrinterAdapter
from .linux import LinuxPrinterAdapter
from .windows import WindowsPrinterAdapter

def get_adapter(adapter_name: str) -> BasePrinterAdapter:
    name = (adapter_name or "").lower().strip()
    if name == "dummy":
        return DummyPrinterAdapter()
    elif name == "linux":
        return LinuxPrinterAdapter()
    elif name == "windows":
        return WindowsPrinterAdapter()

    # Seleção automática baseada no SO
    if sys.platform == "win32":
        return WindowsPrinterAdapter()
    elif sys.platform.startswith("linux"):
        return LinuxPrinterAdapter()

    return DummyPrinterAdapter()

__all__ = [
    "BasePrinterAdapter",
    "DummyPrinterAdapter",
    "LinuxPrinterAdapter",
    "WindowsPrinterAdapter",
    "get_adapter",
]
