# KÔMA Fiscal Core — Ceará NFC-e

Status: fundação F0/F1 concluída; onboarding fiscal Ceará em implementação.
Baseline verificada em: **2026-09-15**.
Escopo inicial: **NFC-e modelo 65 para restaurantes no Ceará**.

## Objetivo

O Fiscal Core é a fonte de verdade para emissão fiscal de vendas do restaurante.
Ele é independente do Caixa, do SmartPOS, do provedor de pagamento e do provedor
fiscal. Pagamento aprovado não equivale a documento fiscal autorizado.

Fluxo alvo:

```text
Pedido / Caixa / SmartPOS
        |
        v
Fiscal Preflight
        |
        v
snapshot imutável da venda
        |
        +--> pagamento(s) e metadados financeiros
        |
        v
Tax Engine versionado
        |
        v
FiscalDocument
        |
        v
FiscalProvider
        |
        v
SEFAZ
```

## Invariantes

1. O KÔMA não adivinha tributação pelo nome do produto.
2. IA não é fonte de verdade para alíquota, enquadramento, imposto, NCM, CFOP,
   CST/CSOSN ou regra fiscal. Regras de produção precisam ter fonte oficial e
   vigência registradas.
3. Configuração fiscal do estabelecimento e dos produtos precisa ser validada
   antes de liberar cobrança integrada.
4. O estado financeiro é separado do estado fiscal.
5. Timeout de SEFAZ nunca é tratado automaticamente como rejeição.
6. Documento em estado `unknown` deve ser consultado/reconciliado antes de uma
   nova tentativa que possa duplicar efeito externo.
7. Numeração fiscal nunca será calculada por `MAX(numero) + 1`.
8. Certificado A1, chave privada e CSC não podem ser gravados em claro no banco,
   logs, frontend, commits ou testes. O banco guarda apenas referências seguras.
9. Toda regra tributária precisa ser ligada a versão/vigência e fonte oficial.
10. DANFE é representação do documento; o XML autorizado e o protocolo são a
    evidência fiscal principal.
11. Contingência é um estado operacional explícito, com transmissão e
    reconciliação posteriores.
12. O endereço fiscal resolve a jurisdição por dados oficiais; UF e município
    derivados não podem depender de texto livre nem de inferência probabilística.

## Estados do documento fiscal

```text
draft -> ready -> submitting -> authorized
                         |-> rejected
                         |-> unknown -> reconciling
                         |-> contingency -> pending_transmission

authorized -> cancel_pending -> cancelled
```

O caminho de reconciliação pode retornar a `authorized`, `rejected`, `unknown`
ou `contingency`, conforme consulta e regras oficiais vigentes.

## Entidades da fundação

- `RestaurantFiscalProfile`: configuração fiscal do tenant e referências de
  segredos/certificado.
- `ProductFiscalProfile`: classificação tributária versionada por produto.
- `FiscalDocument`: documento fiscal e snapshot imutável da venda/cálculo.
- `FiscalDocumentItem`: itens congelados do documento.
- `FiscalPayment`: meios de pagamento e metadados necessários ao vínculo fiscal.
- `FiscalEvent`: trilha imutável de eventos e transições.
- `FiscalSequence`: sequência por tenant + ambiente + modelo + série.

Todas as tabelas são tenant-scoped e usam RLS no PostgreSQL.

## Baseline oficial verificada

| Chave | Documento | Versão / referência | Uso |
| --- | --- | --- | --- |
| `moc-nfe-nfce` | Manual de Orientação do Contribuinte NF-e/NFC-e | MOC 7.0 | leiaute, serviços e validações nacionais |
| `danfe-nfce-qrcode` | DANFE NFC-e e QR Code | v6.0, março/2025 | impressão/representação |
| `contingencia-offline-nfce` | Contingência Offline NFC-e | v2.0 | continuidade operacional |
| `nt-2025-002` | Reforma Tributária do Consumo | v1.51, 04/08/2026 | campos/regras IBS/CBS conforme vigência |
| `nt-2026-002` | Vendas presenciais/não presenciais | v1.10, 04/08/2026 | monitorar vigência/aplicabilidade antes de ativar regra |
| `rfb-cnpj-alfanumerico` | CNPJ Alfanumérico — Receita Federal | produção desde 31/07/2026 | validação de CNPJ numérico e alfanumérico |
| `ibge-localidades` | API de Localidades / Registro de Referência de Municípios | API v1 | município, código IBGE e UF |
| `ce-in-87-2025` | IN SEFAZ/CE 87/2025 | 09/07/2025 | vínculo tecnológico de pagamento, Grupo YA e ECONF |
| `ce-credenciamento-nfce` | Portal de credenciamento NFC-e CE | portal vigente | credenciamento/certificado |

As URLs oficiais ficam versionadas em `backend/app/fiscal/compliance.py`.
A presença de uma Nota Técnica no registry não autoriza assumir que todas as
regras dela já estão em produção: a aplicabilidade deve considerar ambiente e
vigência publicados pelo fisco.

## Fonte de verdade tributária

Responsabilidades:

```text
Fisco
  -> publica regras, tabelas, schemas e vigências

Contador / responsável fiscal do restaurante
  -> informa enquadramento e classificação aplicável

KÔMA
  -> valida, aplica deterministicamente, registra versão e transmite
```

Automação serve para remover digitação e inconsistências, não para inventar
tributação. Sugestões futuras nunca podem ser promovidas silenciosamente para
configuração fiscal ativa.

## Resolução de jurisdição

O Ceará é a primeira jurisdição operacional (`BR-CE`), mas o domínio é nacional.
A resolução usa o **código oficial do município do IBGE**. O prefixo da UF é
validado contra a tabela oficial, e o município é confirmado na API oficial de
Localidades durante o onboarding.

```text
endereço fiscal
   -> município escolhido de fonte oficial
   -> código IBGE
   -> UF derivada/validada
   -> BR-CE
   -> política fiscal Ceará
```

Depois de validado, o snapshot cadastral fica persistido. Uma venda normal não
depende de consultar a API do IBGE. Se CNPJ, município, UF, certificado ou outro
dado crítico tornar o perfil inconsistente, o KÔMA derruba `enabled` e exige novo
preflight antes de emissão.

Outras UFs entram no registry `FISCAL_JURISDICTIONS` no futuro; uma jurisdição
não implementada é resolvida, mas permanece `supported=false`, sem fallback para
regras do Ceará.

## CNPJ 2026

O runtime aceita o CNPJ histórico numérico e o formato alfanumérico em produção
desde julho de 2026. Os 12 primeiros caracteres podem conter letras/números e os
dois dígitos verificadores permanecem numéricos, calculados pelo algoritmo
oficial da Receita Federal. O mesmo validador é compartilhado pelo fluxo de
contratação e pelo Fiscal Core para evitar regras divergentes.

## Segurança de certificado e CSC

`RestaurantFiscalProfile` contém somente:

- `certificate_secret_ref`
- fingerprint do certificado
- validade
- `csc_id`
- `csc_secret_ref`

O material criptográfico real deverá permanecer em secret manager/armazenamento
criptografado apropriado, com acesso exclusivo ao worker fiscal.

## Persistência transacional F1

A reserva de numeração usa o escopo `tenant + ambiente + modelo + série`. Em
PostgreSQL, a alocação é feita por UPSERT atômico sobre `FiscalSequence`; não há
leitura de `MAX(numero)`. A criação do `FiscalDocument` e do evento inicial ocorre
na mesma transação da reserva. Se a transação falhar, o avanço da sequência é
revertido junto.

`idempotency_key` é único por tenant. Repetir a mesma criação retorna o documento
já persistido, sem reservar outro número. Transições usam `event_key` único por
documento; estado e `FiscalEvent` são confirmados no mesmo commit, e retries do
mesmo evento são replay seguro.

## Próximos gates

### F0 — Compliance Registry

- [x] registry em código com fontes oficiais
- [x] data de verificação e versão
- [x] distinção entre baseline e documento apenas monitorado
- [x] fonte oficial do CNPJ alfanumérico registrada
- [x] fonte oficial de municípios/UF registrada
- [ ] rotina automatizada de detecção de atualização nas fontes oficiais

### F1 — Domínio fiscal

- [x] `RestaurantFiscalProfile`
- [x] `ProductFiscalProfile`
- [x] `FiscalDocument`
- [x] `FiscalDocumentItem`
- [x] `FiscalPayment`
- [x] `FiscalEvent`
- [x] `FiscalSequence`
- [x] state machine inicial
- [x] RLS na migration
- [x] serviço transacional de reserva de número com concorrência PostgreSQL
- [x] persistência idempotente de transições/eventos

### F2 — Onboarding Ceará

- [x] CNPJ numérico e alfanumérico com DV oficial
- [x] CNAE com validação estrutural inicial
- [x] CRT com códigos aceitos no leiaute
- [x] município confirmado na API oficial do IBGE
- [x] UF/jurisdição derivada e validada pelo código IBGE
- [x] apenas `BR-CE` habilitada; outras UFs falham fechadas
- [x] readiness bloqueia certificado vencido/ausente
- [x] alteração inconsistente desabilita emissão fiscal
- [ ] validar situação cadastral e IE/CGF em fonte oficial da SEFAZ/CE
- [ ] fluxo seguro de provisionamento do certificado A1/CSC
- [ ] endpoint explícito de ativação após homologação

### F3 — Produto e tributação

- [x] estrutura versionada de `ProductFiscalProfile`
- [ ] fonte oficial/versionada para NCM/CEST/CFOP/CST/CSOSN/PIS/COFINS
- [ ] aprovação do responsável fiscal/contador
- [ ] vigência do perfil e bloqueio de produto sem classificação ativa

### F4+

Ainda não implementado: Tax Engine, Fiscal Preflight completo, XML NFC-e,
assinatura, comunicação SEFAZ, contingência executável, ECONF,
cancelamento/inutilização, DANFE e observabilidade. Nenhum tenant deve receber
`fiscal_nfce=true` antes dos gates correspondentes.
