"""Fiscal Core do KÔMA.

O pacote concentra contratos fiscais versionados. Regras tributárias e integração
SEFAZ não devem ser espalhadas por rotas, Caixa ou SmartPOS.
"""

from .compliance import OFFICIAL_FISCAL_BASELINE, FiscalComplianceSource

__all__ = ["OFFICIAL_FISCAL_BASELINE", "FiscalComplianceSource"]
