"""
Factory de Adaptadores de Impressão.
"""

import sys
from .base import BasePrinterAdapter
from .file import FilePrinterAdapter
from .linux import LinuxPrinterAdapter
from .windows import WindowsPrinterAdapter


def get_adapter(adapter_name: str = "auto", output_dir: str = "print_output") -> BasePrinterAdapter:
    adapter_clean = (adapter_name or "auto").lower().strip()

    if adapter_clean == "file":
        return FilePrinterAdapter(output_dir=output_dir)

    if adapter_clean == "linux":
        return LinuxPrinterAdapter(output_dir=output_dir)

    if adapter_clean == "windows":
        return WindowsPrinterAdapter(output_dir=output_dir)

    # Mode 'auto': detect system platform
    if sys.platform == "win32":
        return WindowsPrinterAdapter(output_dir=output_dir)
    else:
        return LinuxPrinterAdapter(output_dir=output_dir)
