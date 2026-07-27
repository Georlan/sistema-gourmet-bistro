#!/usr/bin/env python3
"""
Agente de Impressão Local Kôma Bistrô (Atalho para main.py).
"""

import sys
import os

# Garantir que os módulos locais em print-agent sejam importáveis
current_dir = os.path.dirname(os.path.abspath(__file__))
if current_dir not in sys.path:
    sys.path.insert(0, current_dir)

from main import main

if __name__ == "__main__":
    main()
