from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from urllib.parse import urlparse


@dataclass(frozen=True)
class FiscalComplianceSource:
    """Referência oficial que sustenta uma regra do Fiscal Core.

    `adoption_status` evita transformar a simples publicação de uma Nota Técnica
    em regra ativa antes da data/ambiente de vigência aplicável.
    """

    key: str
    title: str
    version: str
    jurisdiction: str
    source_url: str
    verified_on: date
    adoption_status: str
    notes: str = ""

    @property
    def official_host(self) -> str:
        return (urlparse(self.source_url).hostname or "").lower()


VERIFIED_ON = date(2026, 9, 15)

OFFICIAL_FISCAL_BASELINE: tuple[FiscalComplianceSource, ...] = (
    FiscalComplianceSource(
        key="moc-nfe-nfce",
        title="Manual de Orientação do Contribuinte - NF-e e NFC-e",
        version="7.0",
        jurisdiction="BR",
        source_url=(
            "https://www.nfe.fazenda.gov.br/portal/consulta.aspx/"
            "listaConteudo.aspx?tipoConteudo=ndIjl+iEFdE="
        ),
        verified_on=VERIFIED_ON,
        adoption_status="baseline",
        notes="Base nacional de leiaute, serviços e regras de validação.",
    ),
    FiscalComplianceSource(
        key="danfe-nfce-qrcode",
        title="Manual de Padrões Técnicos do DANFE-NFC-e e QR Code",
        version="6.0 (março/2025)",
        jurisdiction="BR",
        source_url=(
            "https://www.nfe.fazenda.gov.br/portal/consulta.aspx/"
            "listaConteudo.aspx?tipoConteudo=ndIjl+iEFdE="
        ),
        verified_on=VERIFIED_ON,
        adoption_status="baseline",
        notes="Fonte oficial para DANFE NFC-e e QR Code.",
    ),
    FiscalComplianceSource(
        key="contingencia-offline-nfce",
        title="Manual de Especificações da Contingência Offline para NFC-e",
        version="2.0",
        jurisdiction="BR",
        source_url=(
            "https://www.nfe.fazenda.gov.br/portal/consulta.aspx/"
            "listaConteudo.aspx?tipoConteudo=ndIjl+iEFdE="
        ),
        verified_on=VERIFIED_ON,
        adoption_status="baseline",
        notes="Contingência é um estado fiscal explícito; nunca equivale a rejeição.",
    ),
    FiscalComplianceSource(
        key="nt-2025-002",
        title="NT 2025.002 - Reforma Tributária do Consumo para NF-e/NFC-e",
        version="1.51 (04/08/2026)",
        jurisdiction="BR",
        source_url=(
            "https://www.nfe.fazenda.gov.br/pOrtaL/listaConteudo.aspx?"
            "tipoConteudo=04BIflQt1aY="
        ),
        verified_on=VERIFIED_ON,
        adoption_status="baseline",
        notes=(
            "Regras IBS/CBS são versionadas por vigência. Não inferir rejeição ou "
            "obrigatoriedade apenas pela existência de campos no schema."
        ),
    ),
    FiscalComplianceSource(
        key="nt-2026-002",
        title="NT 2026.002 - vendas presenciais/não presenciais e DANFE Simplificado Tipo 2",
        version="1.10 (04/08/2026)",
        jurisdiction="BR",
        source_url=(
            "https://www.nfe.fazenda.gov.br/pOrtaL/listaConteudo.aspx?"
            "tipoConteudo=04BIflQt1aY="
        ),
        verified_on=VERIFIED_ON,
        adoption_status="monitor",
        notes=(
            "Publicada no Portal Nacional. Aplicabilidade concreta deve ser confirmada "
            "por ambiente/data antes de ativar validações no motor fiscal."
        ),
    ),
    FiscalComplianceSource(
        key="nt-2026-004",
        title="NT 2026.004 - adequação da NF-e/NFC-e ao CNPJ alfanumérico",
        version="1.01 (08/06/2026)",
        jurisdiction="BR",
        source_url=(
            "https://www.nfe.fazenda.gov.br/pOrtaL/listaConteudo.aspx?"
            "tipoConteudo=04BIflQt1aY="
        ),
        verified_on=VERIFIED_ON,
        adoption_status="baseline",
        notes=(
            "Schemas oficiais em uso contemplam CNPJ alfanumérico. O gerador XML "
            "deve usar o pacote vigente do Portal Nacional, não regex histórica numérica."
        ),
    ),
    FiscalComplianceSource(
        key="rfb-cnpj-alfanumerico",
        title="CNPJ Alfanumérico - Receita Federal",
        version="produção desde 31/07/2026",
        jurisdiction="BR",
        source_url=(
            "https://www.gov.br/receitafederal/pt-br/acesso-a-informacao/acoes-e-programas/"
            "programas-e-atividades/cnpj-alfanumerico/cnpj-alfa"
        ),
        verified_on=VERIFIED_ON,
        adoption_status="baseline",
        notes=(
            "Novas inscrições podem conter letras nos 12 primeiros caracteres; "
            "os dois dígitos verificadores permanecem numéricos e seguem o algoritmo oficial."
        ),
    ),
    FiscalComplianceSource(
        key="rfb-ncm-json",
        title="Tabela NCM vigente - Sistema Classif / Receita Federal",
        version="feed JSON vigente",
        jurisdiction="BR",
        source_url=(
            "https://portalunico.siscomex.gov.br/classif/api/publico/"
            "nomenclatura/download/json"
        ),
        verified_on=VERIFIED_ON,
        adoption_status="baseline",
        notes=(
            "Feed oficial sem CAPTCHA para sincronização automática. O download contém a "
            "tabela vigente; histórico precisa ser preservado pelo KÔMA em snapshots próprios."
        ),
    ),
    FiscalComplianceSource(
        key="rfb-rtc-calculator-offline",
        title="Calculadora oficial da Reforma Tributária do Consumo",
        version="portal PRO V0042 / 1.3.0-af611293 em 15/09/2026",
        jurisdiction="BR",
        source_url=(
            "https://consumo.tributos.gov.br/servico/calcular-tributos-consumo/calculadora"
        ),
        verified_on=VERIFIED_ON,
        adoption_status="baseline",
        notes=(
            "Motor oficial de CBS/IBS/IS. Deve rodar localmente e ser consumido via API; "
            "o próprio componente possui mecanismo de atualização de regras/tabelas."
        ),
    ),
    FiscalComplianceSource(
        key="rfb-cbs-apuracao-api",
        title="APIs de Apuração da CBS - Receita Federal",
        version="documentação v1.0 de 03/09/2026",
        jurisdiction="BR",
        source_url="https://docs.receitafederal.gov.br/apuracao-cbs/",
        verified_on=VERIFIED_ON,
        adoption_status="monitor",
        notes=(
            "Consultas incrementais de débitos/créditos previstas para outubro/2026 e "
            "pagamentos/recolhimentos para novembro/2026. Não ativar antes da disponibilidade oficial."
        ),
    ),
    FiscalComplianceSource(
        key="ibge-localidades",
        title="API de Localidades - Registro de Referência de Municípios",
        version="API v1",
        jurisdiction="BR",
        source_url="https://servicodados.ibge.gov.br/api/docs/localidades",
        verified_on=VERIFIED_ON,
        adoption_status="baseline",
        notes=(
            "Fonte oficial para município, código IBGE e UF usados na resolução da "
            "jurisdição fiscal do estabelecimento."
        ),
    ),
    FiscalComplianceSource(
        key="ce-in-87-2025",
        title="IN SEFAZ/CE nº 87/2025 - integração de pagamentos com NF-e/NFC-e",
        version="87/2025",
        jurisdiction="CE",
        source_url=(
            "https://sefazlegis.sefaz.ce.gov.br/api/openFile?"
            "id=fb3405db-006a-48dd-ba9d-a051c99b8d52"
        ),
        verified_on=VERIFIED_ON,
        adoption_status="baseline",
        notes=(
            "Base estadual para vínculo tecnológico de pagamento, Grupo YA e ECONF."
        ),
    ),
    FiscalComplianceSource(
        key="ce-credenciamento-nfce",
        title="Credenciamento NFC-e - SEFAZ Ceará",
        version="portal vigente em 15/09/2026",
        jurisdiction="CE",
        source_url="https://nfce.sefaz.ce.gov.br/pages/credenciamento.jsf",
        verified_on=VERIFIED_ON,
        adoption_status="baseline",
        notes="Credenciamento e certificado digital do contribuinte.",
    ),
)


OFFICIAL_HOST_SUFFIXES = (
    "nfe.fazenda.gov.br",
    "sefaz.ce.gov.br",
    "sefazlegis.sefaz.ce.gov.br",
    "ibge.gov.br",
    "gov.br",
)


def baseline_by_key(key: str) -> FiscalComplianceSource:
    for source in OFFICIAL_FISCAL_BASELINE:
        if source.key == key:
            return source
    raise KeyError(f"Fonte fiscal oficial não registrada: {key}")


def assert_official_baseline() -> None:
    """Falha cedo se uma baseline fiscal apontar para host não oficial ou chave duplicada."""

    seen: set[str] = set()
    for source in OFFICIAL_FISCAL_BASELINE:
        if source.key in seen:
            raise RuntimeError(f"Fonte fiscal duplicada: {source.key}")
        seen.add(source.key)
        if not source.source_url.startswith("https://"):
            raise RuntimeError(f"Fonte fiscal sem HTTPS: {source.key}")
        if not any(
            source.official_host == suffix
            or source.official_host.endswith(f".{suffix}")
            for suffix in OFFICIAL_HOST_SUFFIXES
        ):
            raise RuntimeError(
                f"Fonte fiscal fora de domínio oficial permitido: {source.key} -> "
                f"{source.official_host}"
            )


assert_official_baseline()
