# GUIA VIVO DE EVOLUÇÃO KÔMA — PLANO MESTRE B0–B13 (v2.0)

**Documento canônico de acompanhamento estratégico, arquitetural e de homologação do KÔMA.**  
**Repositório:** `Georlan/sistema-gourmet-bistro` (`main`)  
**Versão da metodologia:** `v2.0` (3 dimensões: Escopo Original `v1.0` + Escopo Ampliado `v2.0` + Homologação Operacional)  
**Data desta consolidação:** 24/11/2026 (15:50 BRT / 18:50 UTC)  
**SHA canônico auditado (`origin/main`):** `9fd40904c92af3a4c8b11f1623bf600f4b2b000a`  
**Base histórica preservada:** Auditoria independente ChatGPT de 22/11/2026 sobre SHA `96d3729f949ca3ff0f395777bdc37177000904dc`

---

## Direção Permanente de Produto e Arquitetura

- **Visão:** Sistema universal de gestão gastronômica com experiências especializadas conforme o modelo de operação de cada restaurante — *"Completo internamente, simples para quem opera."*
- **Segmentos-alvo progressivos:** hamburguerias, pizzarias, marmitarias, à la carte, restaurantes populares, prato feito/executivo, self-service, buffets por peso, buffets de preço fixo, churrascarias, rodízios, japoneses, bares, cafeterias, açaíterias, sorveterias, padarias, redes e franquias.
- **Arquitetura Universal dos 5 Modelos de Venda** (compartilhando o **mesmo** catálogo, identidade de produto, núcleo de pedidos, comandas, Caixa, precificação autoritativa, pagamentos, estoque, auditoria, fiscal e relatórios — proibido construir arquiteturas paralelas por segmento):
  1. **Venda por unidade** (ex.: hambúrguer, bebida).
  2. **Venda por peso** (ex.: self-service, buffet por kg, açaí por peso).
  3. **Venda por pessoa** (ex.: rodízio, buffet livre preço fixo).
  4. **Venda por composição a preço fixo** (ex.: marmitaria, prato feito, prato executivo).
  5. **Venda mista** (ex.: rodízio com bebidas cobradas separadamente; buffet por peso + sobremesa unitária).
- **Meta do Plano Mestre:** evoluir progressivamente os **14 blocos oficiais (B0–B13)** até `>= 90%` do escopo aprovado, sem ignorar requisitos essenciais de segurança, integridade financeira ou homologação operacional.

---

## Metodologia de Evolução (v2.0)

Cada bloco é avaliado separadamente em **três dimensões**, preservando o histórico sem reduzir silenciosamente pontuações anteriores quando o denominador é ampliado:

1. **A. Escopo Original (`v1.0`):** critérios anteriores à ampliação de 24/11/2026, permitindo comparação histórica direta contra a auditoria de 22/11/2026 (`96d3729f`).
2. **B. Escopo Ampliado (`v2.0`):** incorpora os novos requisitos oficiais (5 modelos de venda, rodízio, balanças, prato por peso, prato feito dedicado, produção por lote/rendimento, DRE/CP/CR, TEF/Pinpad, recuperação integral de dependências, contingência offline e migração de concorrentes).
3. **C. Homologação Operacional:** mede comprovação real em produção, hardware físico, serviços externos (SEFAZ, adquirentes, iFood) e cenários reais de falha.

**Níveis de atendimento:** `0%` (inexistente/não identificado) · `25%` (preparação arquitetural comprovada) · `50%` (implementação parcial) · `75%` (funcional com testes relevantes, validação incompleta) · `100%` (atendido e homologado conforme sua natureza).  
**Fórmula:** `Progresso = Σ (peso_i × nível_i) / 100`, com `Σ peso_i = 100` por dimensão.  
**Trava anti-inflação:** proibido atribuir `>= 90%` a qualquer bloco com dependência essencial não comprovada; proibido contar trabalho não integrado em `main` (PRs abertos/branches locais) como entrega da `main`.

---

# RELATÓRIO DE AUDITORIA PARA AVALIAÇÃO INDEPENDENTE (CHATGPT)

## Seção A — Referência Atual

- **Data / hora da auditoria:** 24/11/2026 (~15:50 BRT / 18:50 UTC).
- **Branch canônica:** `origin/main`.
- **SHA completo da `origin/main`:** `9fd40904c92af3a4c8b11f1623bf600f4b2b000a`.
- **Último commit na `origin/main`:** `2026-11-24 18:48:13 +0000` — `fix(caixa): inicializar motoboysLoadState em idle para destravar seleção de entregador (#1487)`.
- **Commits / PRs integrados desde a auditoria histórica (`96d3729f..9fd40904`):** **19 commits/PRs** (`#1467`, `#1468`, `#1469`, `#1470`, `#1471`, `#1472`, `#1473`, `#1474`, `#1475`, `#1478`, `#1479`, `#1480`, `#1481`, `#1482`, `#1484`, `#1485`, `#1486`, `#1488`, `#1487`).
  - **Entregas recentes integradas sobre `78588d60`:**
    - **PR `#1485`** (`c01e5f9b`): deep links contextuais de cliente/suporte (`?go=`) e guia de respostas rápidas WhatsApp (`docs/operations/whatsapp-quick-replies.md`, `cashierDeepLink.ts`, `deepLinkStorage.ts`, testes unitário e E2E).
    - **PR `#1486`** (`f03a9cec`): autodiagnóstico de tenant (`backend/app/services/support_diagnostics.py`), feedback contextual com error ring buffer (`supportCode.ts`), alerta Telegram e testes (`test_support_diagnostics_and_context.py`, `supportCodeBuffer.test.ts`).
    - **PR `#1488`** (`808e2815`): correção das 3 falhas do `Backend Full Suite` (run `45450622399`) sem enfraquecer asserções.
    - **PR `#1487`** (`9fd40904`): correção da regressão real P0 de `motoboysLoadState` (causa raiz das 8 falhas do `Browser Targeted Gate`, run `45458203059`), com `Browser targeted regressions` **verde** no merge.
- **Estado dos deployments (verificação somente leitura em 24/11/2026):**
  - **Railway (`passionate-truth` / `production`, região `sfo`):** serviço `Kôma` operacional em `SUCCESS` (verificado em `e93633b1` no `78588d6` e acompanhando os merges recentes da `main`). Serviços presentes no projeto: `Kôma`, `Postgres S3 Backup`, `pre-purge-backup-20260916` (ocioso), `evolution-api`, `Redis`, `Postgres`.
  - **Supabase (PostgreSQL 17):** **Security Advisors = 0 erros/warnings** (apenas 1 `INFO` intencional: `rls_enabled_no_policy` em `koma_internal.transaction_reset_backups`). **Performance Advisors:** `auth_rls_initplan = 0` (zerado pelo PR `#1479`!), **`duplicate_index = 4` (`WARN`)** ainda presentes em produção, `unindexed_foreign_keys = 34` (`INFO`), `unused_index = 75` (`INFO`).
  - **Cloudflare:** autenticado (`whoami` validado); `Cloudflare Pages` verde nos PRs `#1485`, `#1486`, `#1487` e `#1488`.
  - **GitHub Actions (`main`):** `Merge verdict`, `Browser targeted regressions`, `Gitleaks secret scan` e `Cloudflare Pages` **100% verdes** nos merges `#1487` e `#1488`. As 3 falhas do `Backend Full Suite` (`45450622399`) e as 8 falhas do `Browser Targeted Gate` (`45458203059`) foram investigadas, classificadas e corrigidas em PRs separados (`#1488` e `#1487`, detalhados na Seção F).
- **Fontes consultadas (exclusivamente leitura):** `origin/main` via `git show`/`git grep`/`git ls-tree` (isolado do working tree local que estava em `feat/cardapio-v2-header-polish`), `product-contract.json`, `AGENTS.md`, `docs/` completo, `backend/`, `src/`, `print-agent/`, `print-android/`, `smartpos-android/`, GitHub CLI (`gh pr list`, `gh run list`, `gh run view`), Railway MCP (`list-projects`, `list-services`, `list-deployments`), Supabase MCP (`list_migrations`, `get_advisors`), Cloudflare MCP (`whoami`).
- **Limitações explicitadas da investigação:**
  1. O arquivo histórico `GUIA_VIVO_EVOLUCAO_KOMA_B0_B13_2026-11-22_AUDITADO.md` **não foi localizado** em `origin/main` nem no filesystem local (`/home/testuser`), portanto os critérios da auditoria anterior foram reconstruídos a partir da base numérica oficial fornecida no prompt (média `65,71%` verificada aritmeticamente: `920,00 / 14 = 65,7143%`) e das evidências documentais presentes no repositório (`b1-final-homologation.md`, `b2-final-homologation.md`, `b11-scale-efficiency-engine.md`, etc.).
  2. Não foram executados testes destrutivos, escritas em produção, leituras de segredos/PII ou testes físicos em hardware (balanças, SmartPOS, impressoras térmicas).
  3. Não foi consultado o painel de faturamento/custos do Railway nem métricas RUM em tempo real do PostHog além dos números já consolidados em `docs/engineering/b11-scale-efficiency-engine.md` (24/11/2026).

---

## Seção B — Memória Atualizada e Persistência Real

Com transparência sobre o que **realmente persiste** entre sessões e ferramentas:

1. **Memória persistente global do Antigravity (carregada automaticamente em todas as sessões):**
   - Atualizado: `/home/testuser/.gemini/config/rules/perfil-operacional.md` (Seção 6 — KÔMA).
   - **Garantia de persistência:** **SIM (alta)** — injetado automaticamente em `<user_rules>` em toda nova conversa do Antigravity.
   - **O que foi preservado:** todas as preferências operacionais, regras de segurança, histórico de projetos e diretrizes anteriores permaneceram intactos; adicionou-se a referência canônica ao Plano Mestre B0–B13 (`v2.0`), aos 5 Modelos de Venda, à Metodologia de 3 Dimensões e ao documento canônico do repositório.
2. **Documento canônico do repositório (este arquivo):**
   - Criado: `docs/architecture/GUIA_VIVO_EVOLUCAO_KOMA_B0_B13.md`.
   - Referenciado na tabela de roteamento de `AGENTS.md`.
   - **Garantia de persistência:** **SIM (alta)** após integração do PR documental na branch canônica `main`, passando a ser fonte única compartilhada entre todas as máquinas, sessões e ferramentas de IA (Antigravity, ChatGPT, Codex).
3. **Knowledge Items (`/home/testuser/.gemini/antigravity/knowledge/`):**
   - Verificado: diretório existe apenas com `knowledge.lock` vazio e o runtime atual não expõe ferramenta nativa de gravação de Knowledge Items. Portanto **não** se afirma persistência via Knowledge Items.
4. **Recuperação por futuras sessões e outras IAs:**
   - **Antigravity:** lê automaticamente `/home/testuser/.gemini/config/rules/perfil-operacional.md` + `AGENTS.md` → abre `docs/architecture/GUIA_VIVO_EVOLUCAO_KOMA_B0_B13.md`.
   - **ChatGPT / Codex / outras ferramentas:** após o PR documental em `main`, basta apontar para `docs/architecture/GUIA_VIVO_EVOLUCAO_KOMA_B0_B13.md` na `main` (ou encaminhar este relatório).

---

## Seção C — Painel dos 14 Blocos (B0–B13)

*Verificação aritmética da base histórica (`22/11/2026`, SHA `96d3729f`): soma `920,00 / 14 = 65,7143%` (`65,71%`).*

| Bloco | Avaliação histórica (22/11) | Escopo original atual (`v1.0`) | Delta vs. histórico | Escopo ampliado atual (`v2.0`) | Homologação operacional | Confiança | Status |
|---|---:|---:|---:|---:|---:|---|---|
| **B0** — Infra, disponibilidade e FinOps | 76,25% | **77,50%** | +1,25 pp | **71,25%** | **67,50%** | Alta | Estável com pendências FinOps/DR integral |
| **B1** — Integridade e segurança | 88,75% | **88,75%** | 0,00 pp | **76,25%** | **70,00%** | Alta | Forte no núcleo; aberto p/ equipamentos/webhooks |
| **B2** — Performance e eficiência | 80,00% | **86,25%** | +6,25 pp | **76,25%** | **76,25%** | Alta | Forte ganho B11/V2; resta `create_order` e 4 dup idx |
| **B3** — Cardápio Digital e modelos comerciais | 78,75% | **81,25%** | +2,50 pp | **60,00%** | **73,75%** | Alta | V2 maduro + contratos tema verdes (`#1488`); sem peso/rodízio/PF dedicado |
| **B4** — Operação, Caixa, PDV, Garçom e KDS | 82,50% | **83,75%** | +1,25 pp | **53,75%** | **58,75%** | Alta | Núcleo forte + regressão motoboys corrigida (`#1487`); 4 modos ausentes |
| **B5** — Pagamentos e conciliação | 66,25% | **66,25%** | 0,00 pp | **53,75%** | **52,50%** | Alta | MP Pix OK; PagBank/SmartPOS/TEF/recebíveis pendentes |
| **B6** — SaaS, planos e onboarding técnico | 82,50% | **82,50%** | 0,00 pp | **77,50%** | **70,00%** | Alta | Base madura; falta templates ativos e SaaS billing homol. |
| **B7** — Marketplaces (iFood prioritário) | 5,00% | **5,00%** | 0,00 pp | **5,00%** | **0,00%** | Alta | Bloqueador comercial crítico (apenas adapter abstrato) |
| **B8** — Financeiro, estoque, custos e produção | 63,75% | **52,50%** | -11,25 pp | **41,25%** | **45,00%** | Alta | Estoque OK; **DRE/CP/CR e produção por lote inexistentes** |
| **B9** — CRM, fidelização e crescimento | 77,50% | **77,50%** | 0,00 pp | **68,75%** | **57,50%** | Alta | LGPD e manual sólidos; automação WA desligada por flag |
| **B10** — Fiscal | 48,75% | **48,75%** | 0,00 pp | **40,00%** | **22,50%** | Alta | Fundação/cofre prontos; **0% emissão real SEFAZ** |
| **B11** — Escalabilidade contínua (1→100) | 48,75% | **77,50%** | +28,75 pp | **66,25%** | **62,50%** | Alta | Maior salto (PR1–PR6); falta 100 lojas em `RTT=25ms` |
| **B12** — Continuidade operacional e contingência | 56,25% | **62,50%** | +6,25 pp | **52,50%** | **52,50%** | Alta | Filas server-side e journals OK; **0% offline real** |
| **B13** — Implantação, suporte e sucesso do cliente | 65,00% | **72,50%** | +7,50 pp | **60,00%** | **60,00%** | Alta | Deep links (`#1485`) + autodiagnóstico (`#1486`); migração catálogo manual |
| **MÉDIA GERAL (14 blocos)** | **65,71%** | **68,75%** | **+3,04 pp** | **57,32%** | **54,91%** | — | **Nenhum bloco >= 90% (trava anti-inflação mantida)** |

### Revisão Justificada das Pontuações — B8, B11 e B13 (Critérios, Pesos e Evidências)

#### 1. B8 (`63,75%` histórico → `52,50%` original atual, `-11,25 pp` | `41,25%` ampliado | `45,00%` homologação)
- **Por que caiu no escopo original sem perda de código:** não houve regressão de código em B8; houve **correção metodológica baseada em inspeção direta do código em `origin/main`**:
  - *Critério 1 — Estoque, Insumos, Fichas Técnicas e Inventário (peso 30%, nível 75% → `22,50`):* `Insumo`, `ProdutoInsumo`, `inventory.py`, `inventory_count.py` e testes (`test_b8_estoque_integrity.py`) funcionam, mas `ProdutoInsumo` só vincula `Produto` — **opções de modificadores não possuem ficha técnica** (`backend/app/services/menu_intelligence.py:64`).
  - *Critério 2 — Compras e Importação XML NF-e de Entrada (peso 20%, nível 75% → `15,00`):* `POST /estoque/importar-xml` (`routes/estoque.py:55`) funciona e tem testes (`test_estoque_xml.py`), porém o matching é por slug exato sem de-para de unidade/embalagem nem geração de contas a pagar.
  - *Critério 3 — CMV, Custo Médio e Engenharia de Cardápio (peso 20%, nível 75% → `15,00`):* custo médio ponderado e `menu_intelligence.py` funcionam (otimizado no `#1478`), mas usam custo médio atual (não histórico da data da venda) e ignoram modificadores.
  - *Critério 4 — Contas a Pagar/Receber, Fluxo de Caixa e DRE Gerencial Real (peso 30%, nível 0% → `0,00`):* **causa central da redução de `-11,25 pp`**. `product-contract.json` (`#1512`) já corrigiu a promessa comercial removendo `"DRE de Vendas"`, e os aliases de busca de Recebimentos foram limpos (`cashierFunctionSearch.ts`), mantendo apenas compatibilidade de URL em `cashierNavigation.ts` para `RelatorioFinanceiroTab.tsx` (que consulta `GET /comandas/estatisticas/geral`, recebimentos aprovados menos estornos). Não existem modelos, rotas ou telas de Contas a Pagar (o único modelo existente, `OwnerFinanceMonth`, é restrito às despesas internas da empresa KÔMA em `koma_internal`), Contas a Receber ou DRE real.
- **No escopo ampliado (`41,25%`):** acrescenta Perdas/Lotes/Validade (`15%×25% = 3,75`, apenas registro manual `tipo="perda"`) e Produção por Lote/Rendimento/Buffet (`15%×0% = 0,00`), reduzindo o denominador para refletir fielmente o que falta para buffets/self-service.

#### 2. B11 (`48,75%` histórico → `77,50%` original atual, `+28,75 pp` | `66,25%` ampliado | `62,50%` homologação)
- **Por que saltou `+28,75 pp` no escopo original (e por que NÃO passou de 90%):**
  - *Critério 1 — Eficiência de Pool, Workers, DB e Frontend para 1–10 lojas (peso 30%, nível 100% → `30,00`):* PRs `#1475`, `#1478`, `#1479`, `#1480` e `#1487` eliminaram o self-deadlock de 4 vias, `_DB_CLOSE_EXECUTOR`, zeraram `auth_rls_initplan` (`20261124b11a`), adicionaram 5 índices hot-path, `ETag/304`, fim do thundering herd SSE/Caixa e `-77,1%` micro-chunks.
  - *Critério 2 — Benchmarks PG17 1/10/100 e Testes de Regressão (peso 25%, nível 100% → `25,00`):* PR `#1484` versionou `backend/scripts/benchmark_b11_scale_1_10_100.py` e `backend/tests/test_b11_scale_1_10_100_pg17.py` provando `0%` erro para 1 loja (`24/24`) e 10 lojas (`60/60`) em `RTT=0ms` e `RTT=25ms`, e 100 lojas (`180/180`) em `RTT=0ms`.
  - *Critério 3 — Modelagem FinOps e Gatilhos Objetivos de Upgrade (peso 15%, nível 100% → `15,00`):* `docs/engineering/b11-scale-efficiency-engine.md` (Seções F e G) consolida custos marginais 1/10/100 e limiares objetivos de `/health`.
  - *Critério 4 — Capacidade Comprovada p/ 100 Lojas em RTT Real + Otimização de `create_order` (peso 30%, nível 25% → `7,50`):* **trava que mantém B11 em `77,50%`**. No benchmark `RTT=25ms` (Railway `sfo` ↔ Supabase), o Estágio C (100 lojas) ainda falhou (`131/180 OK`, `49× HTTP 500`, `52` timeouts com `pool=4`), `OrderApplicationService.create_order` ainda faz ~56 SQLs, restam `4 duplicate_index` WARN no Supabase e a colocalização/Transaction Pooler aguarda aprovação de infra.

#### 3. B13 (`65,00%` histórico → `72,50%` original atual, `+7,50 pp` | `60,00%` ampliado | `60,00%` homologação)
- **Por que subiu `+7,50 pp` frente a `96d3729f`:** entregas concretas integradas na `main` nos PRs `#1485` (`c01e5f9b`: deep links contextuais `?go=` + guia de respostas rápidas WhatsApp + testes unit/E2E) e `#1486` (`f03a9cec`: autodiagnóstico de tenant `support_diagnostics.py`, error ring buffer em `supportCode.ts`, alerta Telegram e `test_support_diagnostics_and_context.py`). O critério *Autonomia, Tutoriais e Sucesso* subiu de `25% → 50%` (`30%×50% = 15,00`), mantido abaixo de `75%` porque a migração de cardápios de PDF/foto/concorrentes continua manual.

### Explicação das demais alterações
- **B2 (`+6,25 pp`: `80,00% → 86,25%`) e B12 (`+6,25 pp`: `56,25% → 62,50%`):** reflexo direto da eliminação do self-deadlock de 4 vias (`#1478`), `_DB_CLOSE_EXECUTOR`, fim do thundering herd SSE/Caixa (`#1480` + `#1487`), `-77,1%` micro-chunks, TCP keepalives `LISTEN` (`#1475`), correção de WS duplicados mobile (`#1471`) e fix `401` Print Android (`#1470`).
- **Queda estrutural entre Escopo Original (`68,75%`) e Escopo Ampliado (`57,32%`, `-11,43 pp`):** explica-se integralmente pela mudança formal de denominador (`v2.0`), especialmente em **B4** (`83,75% → 53,75%`), **B3** (`81,25% → 60,00%`), **B8** (`52,50% → 41,25%`), **B5** (`66,25% → 53,75%`) e **B12** (`62,50% → 52,50%`).

---

## Seção D — Auditoria Individual (B0 a B13)

### B0 — Infraestrutura, disponibilidade e FinOps
- **Objetivo:** manter infraestrutura barata (meta Hobby Railway ~US\$ 5/mês na validação), confiável, monitorada e integralmente recuperável.
- **Critérios, pesos e cálculo:**
  - *Original (`77,50%`):* Topologia/Deploy/CI `25%×100` (`25,00`) + Backup/Restore PG `25%×75` (`18,75`) + Monitoramento/Smoke `20%×75` (`15,00`) + Segurança Operacional `15%×75` (`11,25`) + FinOps/Ociosos `15%×50` (`7,50`) = **`77,50%`**.
  - *Ampliado (`71,25%`):* Topologia/CI `20%×100` (`20,00`) + Backup/Restore PG `20%×75` (`15,00`) + Monitor/Smoke `20%×75` (`15,00`) + Seg. Op. `15%×75` (`11,25`) + FinOps/Ociosos `15%×50` (`7,50`) + Recuperação integral deps Storage/Redis/Evolution `10%×25` (`2,50`) = **`71,25%`**.
  - *Homologação (`67,50%`):* Prod estável `30%×100` (`30,00`) + Restore drill PG17 `30%×75` (`22,50`) + Smoke/alertas contínuos `20%×75` (`15,00`) + Drill integral deps `20%×0` (`0,00`) = **`67,50%`**.
- **Confirmado:** Cloudflare Pages + Railway `passionate-truth` (`Kôma` em `sfo`, `SUCCESS` no `78588d6`) + Supabase PG17; `Postgres S3 Backup` diário (`0 3 * * *` → `t3.storageapi.dev`, `MAX_BACKUPS=10`); pacote off-site `age` (`scripts/offsite_backup_package.py`); restore drill PG17 real em 15/11/2026 (`docs/operations/backup-restore-drill.md`, 126 tabelas, 166 policies, exit 0); `production-smoke.yml`, `backup-freshness-monitor.yml`, `external-availability-monitor.yml`, `ops:doctor`.
- **Parcial / Ausente:** backup S3 não cobre Postgres da Evolution API, Redis nem Supabase Storage; serviços Railway auxiliares consomem ~333 MB RAM (`evolution-api` ~232 MB, `Postgres` ~81 MB, `Redis` ~20 MB) + serviço ocioso `pre-purge-backup-20260916`; restore drill não testou boot do app nem Storage.
- **Evidências:** `docs/engineering/infra-contract.md`, `docs/engineering/offsite-backup-package.md`, `docs/operations/backup-restore-drill.md`, `scripts/production-smoke.mjs`, `scripts/ops-doctor.mjs`, Railway deployment `e93633b1`, PRs `#1481`, `#1484`.
- **Contradições / Riscos:** `docs/engineering/infra-contract.md` ainda cita projeto Railway `Koma Homologacao` enquanto a regra de ouro proíbe homologação permanente paga — confirmar se está desligado/removido.
- **Para 90%:** remover/arquivar serviço ocioso `pre-purge-backup-20260916` (com aprovação), formalizar backup/restore de Storage + Evolution DB, manter `Backend Full Suite` verde. **Para 100%:** drill de recuperação integral (PG + Storage + boot API) comprovado e plano de colocalização Railway↔Supabase validado.
- **Próxima missão recomendada:** Faxina FinOps Railway (com aprovação) + script de backup/restore de Storage + correção dos 3 testes falhos na `Backend Full Suite`.

---

### B1 — Integridade e segurança
- **Objetivo:** impedir vazamento multi-tenant, inconsistências financeiras, fraudes e perdas.
- **Critérios, pesos e cálculo:**
  - *Original (`88,75%`):* RLS/FORCE RLS `30%×100` (`30,00`) + Auth/RBAC/Revogação `25%×75` (`18,75`) + Idempotência/Transacional `25%×100` (`25,00`) + Auditoria/Credenciais `20%×75` (`15,00`) = **`88,75%`**.
  - *Ampliado (`76,25%`):* RLS `25%×100` (`25,00`) + Auth/RBAC `20%×75` (`15,00`) + Idempotência `20%×100` (`20,00`) + Auditoria `15%×75` (`11,25`) + Seg. equipamentos/balanças/pesos `10%×25` (`2,50`) + Seg. webhooks externos `10%×25` (`2,50`) = **`76,25%`**.
  - *Homologação (`70,00%`):* Homologação B1 + Security Advisors `40%×100` (`40,00`) + Concorrência PG17 `30%×75` (`22,50`) + Hardening equipamentos `15%×50` (`7,50`) + Webhooks marketplaces `15%×0` (`0,00`) = **`70,00%`**.
- **Confirmado:** 119+ tabelas com RLS, 166+ policies, **0 policies sem InitPlan** (`20261124b11a`, PR `#1479`), `FORCE RLS` + `REVOKE` em `produto_familias*`, Supabase Security Advisors = 0 erros/warnings; `revoke_user_sessions` na troca de cargo já na `main` (`backend/app/routes/auth.py:539-544`); bloqueio de cancelamento de pedido pago (`#1399`); idempotência com fingerprint em pedidos/pagamentos/estornos/impressão; fix 401 no Print Android (`#1470`).
- **Parcial / Ausente:** WebSockets já abertos só desconectam no próximo ciclo de reconexão/verificação; `POST /smartpos/payment-intents/{id}/resultado-terminal` confia no `outcome` do operador autenticado sem assinatura criptográfica do hardware PlugPag; sem verificação HMAC/assinatura de webhooks de marketplaces (não existem rotas); sem protocolo de integridade de peso/balança.
- **Contradições:** `docs/engineering/b1-final-homologation.md` ainda lista `fix/b1-role-revocation-and-homologation` como `*(pendente merge)*`, embora já esteja integrado em `auth.py:539-544`.
- **Para 90%:** encerramento imediato de WS em revogação de sessão + validação de integridade de `resultado-terminal` SmartPOS + contratos de segurança para balanças/pesos e webhooks iFood. **Para 100%:** auditoria adversarial cobrindo balanças, SmartPOS físico e webhooks iFood homologados.
- **Próxima missão recomendada:** Atualizar `b1-final-homologation.md` e acoplar requisitos de segurança (HMAC/idempotência/integridade de peso) diretamente nas entregas de B7 (iFood) e B4 (balanças).

---

### B2 — Performance e eficiência
- **Objetivo:** garantir baixa latência, eficiência de banco/frontend e rapidez operacional em equipamentos modestos.
- **Critérios, pesos e cálculo:**
  - *Original (`86,25%`):* SQL/Índices/Pool `30%×75` (`22,50`) + Hot-paths/Deadlocks `25%×100` (`25,00`) + Frontend/Chunks/ETag/CWV `25%×75` (`18,75`) + Filas/Polling/Realtime `20%×100` (`20,00`) = **`86,25%`**.
  - *Ampliado (`76,25%`):* SQL/Pool `25%×75` (`18,75`) + Hot-paths `20%×100` (`20,00`) + Frontend/CWV `20%×75` (`15,00`) + Filas/Realtime `15%×100` (`15,00`) + Equipamentos modestos `10%×50` (`5,00`) + Rapidez pesagem/fechamento `10%×25` (`2,50`) = **`76,25%`**.
  - *Homologação (`76,25%`):* Benchmarks PG17 `35%×100` (`35,00`) + Homologação B2 + RUM `35%×75` (`26,25`) + Validação pós-V2 disp. modestos `15%×50` (`7,50`) + Limpeza dup idx prod `15%×50` (`7,50`) = **`76,25%`**.
- **Confirmado:** PRs `#1468`, `#1469`, `#1475`, `#1478`, `#1479`, `#1480`, `#1482` — cura do self-deadlock de 4 vias, `_DB_CLOSE_EXECUTOR`, fast-paths 0-commit (`print_agents`, `online-orders/control`, `outbox`), `ETag`/`304` no cardápio público, `selectinload`, `SQL GROUP BY` em relatórios, fim do thundering herd SSE/Caixa, `-77,1%` micro-chunks (`96 → 22`), isolamento de CSS operacional e fix `metric_name` em `web_vitals_metric`.
- **Parcial / Ausente:** `OrderApplicationService.create_order` ainda executa **~56 SQLs** por pedido; Supabase Performance Advisors ainda reporta **4 `duplicate_index` (`WARN`)** em produção; `catalog_load_ms` 14d em `p95=2070,5ms` (antes do PR `#1482`, exige re-medição); PR `#1483` (lazy loading `SuperAdminPanel` e sub-módulos `CaixaPanel`) está aberto e **não** contado na `main`; fluxo de pesagem inexistente.
- **Para 90%:** reduzir `create_order` de 56 → `<20` SQLs, eliminar os 4 `duplicate_index` restantes no Supabase, integrar lazy loading (`#1483`) e comprovar `catalog_load_ms p95 < 1500ms` em mobile modesto. **Para 100%:** validação de latência em pesagem/fechamento rápido e 0 regressões de CWV.
- **Próxima missão recomendada:** Onda 2 de SQL em `create_order` (`56 → <20` queries) + limpeza dos 4 `duplicate_index` + avaliação/merge do PR `#1483`.

---

### B3 — Cardápio Digital e modelos comerciais
- **Objetivo:** comercializar produtos de diferentes segmentos sobre o mesmo Cardápio Universal V2 sem vitrines paralelas.
- **Critérios, pesos e cálculo:**
  - *Original (`81,25%`):* V2/Temas/UX Mobile `25%×75` (`18,75`) + Catálogo/Famílias/Modif./Promoções `25%×100` (`25,00`) + Sacola/Checkout/Agend./Rastreamento `25%×75` (`18,75`) + Perfis Iniciais `25%×75` (`18,75`) = **`81,25%`**.
  - *Ampliado (`60,00%`):* V2/Temas `20%×75` (`15,00`) + Catálogo/Famílias/Promo `20%×100` (`20,00`) + Sacola/Checkout `15%×75` (`11,25`) + Marmitaria/Composição `15%×75` (`11,25`) + PF/Executivo dedicado `10%×25` (`2,50`) + Peso/Buffet `10%×0` (`0,00`) + Rodízio `10%×0` (`0,00`) = **`60,00%`**.
  - *Homologação (`73,75%`):* V2 em operação real `40%×100` (`40,00`) + Marmitaria prod `30%×75` (`22,50`) + Suíte/contratos tema verdes `15%×75` (`11,25`, corrigido no `#1488`) + Demais perfis `15%×0` (`0,00`) = **`73,75%`**.
- **Confirmado:** Cardápio Universal V2 único (vitrines legadas removidas), multi-cardápio, `ProdutoFamilia`, modificadores compartilhados com `tipos`/`unidades` e `meio_a_meio`, Marmitaria P/M/G completa, promoções (`combo`, `compre_ganhe`, `desconto_item`), agendamento (`ScheduledOrder`), cupons, fidelidade, pausa/capacidade operacional, temas OKLCH claro/escuro.
- **Parcial / Ausente:** `restaurant_profile_templates.py` oferece apenas *preview em memória* para `pizzaria`, `acai`, `churrasco` (não persiste); `commercial_role` no pairing não conectado ao DB; **ausentes:** configuração comercial por peso (`preco_kg`/unidades fracionárias), rodízio, buffet, prato feito/executivo dedicado, catálogo por canal, TV digital.
- **Bugs de contrato resolvidos:** os 2 testes legados de `backend/tests/test_cardapio_koma_theme_contract.py` foram alinhados ao contrato vigente V2 no PR `#1488` (`808e2815`).
- **Para 90% (ampliado):** corrigir testes de contrato de tema + introduzir `sale_model` (unidade, peso, pessoa, composição preço fixo) no catálogo + persistência idempotente de templates de perfis operacionais (PF/executivo, pizzaria, açaí, churrasco). **Para 100%:** homologar todos os 5 modelos comerciais no mesmo catálogo + vitrine/autoatendimento QR Code.
- **Próxima missão recomendada:** Desenhar o contrato de domínio unificado dos **5 Modelos de Venda** (compartilhado entre B3, B4, B8 e B10) antes de qualquer UI específica.

---

### B4 — Operação gastronômica, Caixa, PDV, Garçom e KDS
- **Objetivo:** operar diferentes segmentos no mesmo núcleo de pedidos, comandas, Caixa, KDS e impressão.
- **Critérios, pesos e cálculo:**
  - *Original (`83,75%`):* Pedidos/Mesas/Comandas/Salão `30%×100` (`30,00`) + PDV/Caixa/Turnos/Sangria `25%×100` (`25,00`) + Garçom/KDS/Entregador `25%×75` (`18,75`) + Impressão/SmartPOS Op. `20%×50` (`10,00`) = **`83,75%`**.
  - *Ampliado (`53,75%`):* Pedidos/Salão `20%×100` (`20,00`) + PDV/Caixa `15%×100` (`15,00`) + Garçom/KDS/Entregador `15%×75` (`11,25`) + Impressão/SmartPOS `10%×50` (`5,00`) + Modo Rodízio `10%×0` (`0,00`) + Balanças `10%×0` (`0,00`) + Prato por Peso `10%×0` (`0,00`) + Prato Feito Dedicado `10%×25` (`2,50`) = **`53,75%`**.
  - *Homologação (`58,75%`):* Caixa/Salão/Kanban/Delivery prod `35%×100` (`35,00`) + Print Windows piloto `25%×75` (`18,75`) + Print Android/SmartPOS campo `20%×25` (`5,00`) + Balanças/Peso/Rodízio físico `20%×0` (`0,00`) = **`58,75%`**.
- **Confirmado:** núcleo `AtendimentoMesa ≠ Comanda ≠ Lancamento ≠ Item`, salão completo (transferir, mesclar, dividir, reabrir), PDV, turno/sangria/suprimento/fechamento cego, KDS em tempo real sem self-deadlock (`#1478`), PWA entregador, chat de pedido, Core Universal de Impressão (vias setoriais, delta, Windows/Linux USB/Rede/BT + Android BT 58mm).
- **Parcial:** `smartpos-android/` pronto em código mas sem homologação física; `print-agent` pendente de repo público de release; KDS sem estações por produto/SLA.
- **Ausente (4 novos requisitos prioritários):** **Modo Rodízio** (0%), **Integração com Balanças** (0%), **Modo Prato por Peso** (0% — `Item` não suporta peso/quantidade fracionária), **Modo Prato Feito dedicado** (25% — atendível só via Marmitaria/modificadores genéricos). *Backlog competitivo (P2):* comanda/ficha física numerada, painel de senhas, reservas, fila de espera, totem.
- **Para 90% (ampliado):** implementar os 4 modos prioritários (PF, Rodízio, Prato por Peso e ponte local de Balanças sobre a arquitetura do Print Agent) + homologar SmartPOS/Print Android em campo. **Para 100%:** homologação física com balança comercial (Toledo/Filizola/Urano), comprovante com peso/tara/preço-kg e operação mista validada em restaurante real.
- **Próxima missão recomendada:** Especificação e implementação do **Núcleo de Venda por Peso/Pessoa/Composição** (`Item` com quantidade decimal, tara/peso bruto/líquido, cobrança por participante no rodízio) + extensão do `print-agent` como agente local de hardware (impressora + balança).

---

### B5 — Pagamentos e conciliação
- **Objetivo:** receber, dividir, estornar e conciliar pagamentos presenciais e online com segurança financeira real.
- **Critérios, pesos e cálculo:**
  - *Original (`66,25%`):* Presenciais/Split/Estornos `25%×100` (`25,00`) + MP Pix Online `20%×100` (`20,00`) + PagBank Connect + Direct Pix + Concil. `30%×50` (`15,00`) + SmartPOS Fin. + Cartão Online `25%×25` (`6,25`) = **`66,25%`**.
  - *Ampliado (`53,75%`):* Presenciais/Split/Estornos `20%×100` (`20,00`) + MP Pix `20%×100` (`20,00`) + PagBank/Direct Pix `20%×50` (`10,00`) + SmartPOS Fin. `15%×25` (`3,75`) + TEF/Pinpad `10%×0` (`0,00`) + Taxas/Repasses/Recebíveis `15%×0` (`0,00`) = **`53,75%`**.
  - *Homologação (`52,50%`):* MP Pix prod `35%×100` (`35,00`) + PagBank Connect `25%×50` (`12,50`) + SmartPOS/TEF físico `20%×0` (`0,00`) + Conciliação/SaaS Billing isolado `20%×25` (`5,00`) = **`52,50%`**.
- **Confirmado:** pagamentos presenciais, split por valor/itens (`PagamentoAlocacao`), estornos auditados com bloqueio de cancelamento pago, MP Pix online completo (OAuth, webhook, worker de conciliação, estorno `OnlinePaymentRefund`), `FinancialPendingCenter`.
- **Parcial:** PagBank Connect (sem estorno na UI em `refunds.py`; incidentes de 28/10 no piloto 8 sobre `x-authenticity-token`/ECDSA ainda pendentes de confirmação formal do suporte PagBank); Direct Pix manual; SmartPOS apenas com `PagBankSimulatorProvider` (bloqueado em produção) e sem homologação física.
- **Ausente:** cartão crédito/débito online no cardápio digital; TEF/Pinpad (SiTef/PayGo/Stone/Cielo/Rede); conciliação de taxas de adquirentes, repasses e recebíveis efetivamente depositados.
- **Para 90%:** fechar homologação PagBank Connect (webhook + estorno), homologar SmartPOS fisicamente (ou habilitar provider real), implementar conciliação de taxas/recebíveis e validar cartão online. **Para 100%:** TEF/Pinpad homologado e conciliação bancária/adquirente automatizada.
- **Próxima missão recomendada:** Fechar pendências do PagBank Connect (webhook + estorno) e iniciar homologação física do SmartPOS Android + conciliação de taxas/recebíveis.

---

### B6 — SaaS, planos e onboarding técnico
- **Objetivo:** provisionar, gerenciar, cobrar e controlar entitlements/multiloja de restaurantes com autonomia e auditoria.
- **Critérios, pesos e cálculo:**
  - *Original (`82,50%`):* Planos/Entitlements/Overrides `25%×100` (`25,00`) + Contratos/Trial/Cobrança SaaS `30%×75` (`22,50`) + Provisionamento/Super Admin `25%×100` (`25,00`) + Multiloja/Perfis `20%×50` (`10,00`) = **`82,50%`**.
  - *Ampliado (`77,50%`):* Planos/Entitlements `25%×100` (`25,00`) + Contratos/Trial/Billing `20%×75` (`15,00`) + Provisionamento/Super Admin `20%×100` (`20,00`) + Perfis Especializados `20%×50` (`10,00`) + Multiloja/Redes `15%×50` (`7,50`) = **`77,50%`**.
  - *Homologação (`70,00%`):* Provisionamento/Trial real `40%×100` (`40,00`) + Cobrança SaaS recorrente `30%×50` (`15,00`) + Multiloja/Perfis `30%×50` (`15,00`) = **`70,00%`**.
- **Confirmado:** `product-contract.json` (`2026-11-business-v2a`: `pocket` R\$ 99,90 / `pro` R\$ 179,90 com `courier_app` incluído / `premium` R\$ 329,90 / `KÔMA Founders` R\$ 79,90 para 5 vagas com `free_addon_licenses: true` / onboarding padrão R\$ 0,00 e VIP R\$ 299,00; 0% comissão em todos os planos), 8 capabilities com override auditado (`RestauranteCapability`), trial diferido D+7 (`onboarding_trial.py`), checkout SaaS `credit_card` MP + `pix` universal, multiloja isolada (`RestaurantNetwork*`, `/auth/lojas`), provisionamento sem SQL manual.
- **Parcial / Ausente:** templates de perfis operacionais (`pizzaria`, `acai`, `churrasco`) só fazem preview em memória; homologação financeira isolada da cobrança recorrente MP pendente (`payments-observability-audit-2026-10-20.md`); administração consolidada de redes/franquias (relatórios/catálogo de rede) inexistente por design atual.
- **Para 90%:** homologação financeira isolada de cobrança SaaS + aplicação idempotente de templates de perfis operacionais. **Para 100%:** gestão centralizada opcional para redes/franquias e inadimplência/suspensão/reativação 100% automatizada.
- **Próxima missão recomendada:** Homologar ciclo financeiro completo da cobrança SaaS (cartão + Pix + suspensão/reativação) e ativar aplicação de templates de perfis.

---

### B7 — Integrações oficiais com marketplaces (foco principal: iFood)
- **Objetivo:** integrar oficialmente o iFood (e posteriormente 99Food/Keeta/aiqfome em trilha separada) sobre o núcleo canônico de pedidos.
- **Critérios, pesos e cálculo:**
  - *Original (`5,00%`) e Ampliado (`5,00%`):* Contrato Abstrato/Idempotência `20%×25` (`5,00`) + Auth/Credenciamento/Eventos iFood `30%×0` (`0,00`) + Fluxo de Pedidos `25%×0` (`0,00`) + Sync Catálogo e Conciliação `25%×0` (`0,00`) = **`5,00%`**.
  - *Homologação (`0,00%`):* Credenciamento `30%×0` + Homologação técnica `40%×0` + Piloto autorizado `30%×0` = **`0,00%`**.
- **Confirmado (apenas borda):** `MarketplaceProviderAdapter`, `ExternalOrderReference`, `IntegrationOutbox`, `OrderChannel` (`IFOOD`, `NINE_NINE_FOOD`, `KEETA`), logos/badges de UI.
- **Ausente (100% do produto):** zero conector iFood, zero OAuth/credenciais de parceiro, zero polling/webhook de eventos, zero aceite/cancelamento/status/logística, zero sincronização de catálogo, zero conciliação financeira. `Plans.tsx:228` declara expressamente que marketplaces não fazem parte da oferta atual. *Backlog separado:* 99Food, Keeta, aiqfome (0 ocorrências).
- **Risco:** confundir ícones de UI e `MockIfoodAdapter` (teste) com integração funcional.
- **Para 90%:** credenciamento oficial iFood + adapter concreto + polling/webhook + ciclo completo de pedidos + sync básico de catálogo/disponibilidade + homologação técnica iFood. **Para 100%:** piloto autorizado em restaurante real + conciliação financeira de taxas/repasses iFood.
- **Próxima missão recomendada (P0 comercial):** Iniciar processo oficial de credenciamento de parceiro iFood + implementar `IfoodMarketplaceAdapter` sobre `MarketplaceProviderAdapter` + `OrderApplicationService`.

---

### B8 — Financeiro, estoque, custos e produção
- **Objetivo:** controlar estoque, compras, CMV, finanças gerenciais reais (DRE, contas a pagar/receber, fluxo de caixa) e produção gastronômica (lotes/rendimento/buffet).
- **Critérios, pesos e cálculo:**
  - *Original (`52,50%`):* Estoque/Insumos/Fichas/Inventário `30%×75` (`22,50`) + Compras/XML NF-e `20%×75` (`15,00`) + CMV/Custo Médio/Cardápio `20%×75` (`15,00`) + Contas a Pagar/Receber/Fluxo/DRE Real `30%×0` (`0,00`) = **`52,50%`**.
  - *Ampliado (`41,25%`):* Estoque/Fichas `20%×75` (`15,00`) + Compras/XML `15%×75` (`11,25`) + CMV/Margem `15%×75` (`11,25`) + CP/CR/Fluxo/DRE `20%×0` (`0,00`) + Perdas/Lotes/Validade `15%×25` (`3,75`) + Produção Lote/Rendimento/Buffet `15%×0` (`0,00`) = **`41,25%`**.
  - *Homologação (`45,00%`):* Estoque/XML/Inventário `40%×75` (`30,00`) + CMV/Relatórios `30%×50` (`15,00`) + Financeiro Gerencial/Produção `30%×0` (`0,00`) = **`45,00%`**.
- **Confirmado:** `Insumo`, `ProdutoInsumo`, baixa/estorno automático (`inventory.py`), custo médio ponderado, inventário físico (`inventory_count.py`), importação XML NF-e (`POST /estoque/importar-xml`), registro manual de perda (`tipo="perda"`), CMV estimado e engenharia de cardápio (`menu_intelligence.py`).
- **Parcial / Ausente / Contradição crítica:**
  - **Observação de produto:** `product-contract.json` (`#1512`, `2026-11-business-v2a`) já removeu a promessa `"DRE de Vendas"`, e `cashierFunctionSearch.ts` foi alinhado para `"Recebimentos, meios de pagamento e estornos"` (mantendo aliases legados apenas para compatibilidade de navegação em `cashierNavigation.ts` para `RelatorioFinanceiroTab.tsx`, que exibe recebimentos aprovados menos estornos).
  - **Inexistentes:** Contas a Pagar (restaurante), Contas a Receber, DRE gerencial real, Fluxo de Caixa projetado, Lotes/Validade (PEPS/FEFO), Produção por lote/sub-receitas/rendimento/sobras de buffet, ficha técnica em opções de modificadores (`menu_intelligence.py:64`), de-para de unidade/embalagem no XML, acerto financeiro estruturado de entregadores/equipe.
- **Para 90%:** implementar Contas a Pagar/Receber + Despesas + Fluxo de Caixa + DRE gerencial real (separando medido vs. estimado) + ficha técnica em modificadores + de-para XML + controle de produção por lote/rendimento e perdas consolidadas. **Para 100%:** lotes/validade + margem por kg vendido em buffet + homologação contábil/operacional.
- **Próxima missão recomendada:** Corrigir rotulagem enganosa de `"DRE"` no curto prazo e implementar o módulo **Financeiro Gerencial (Contas a Pagar, Despesas, Fluxo de Caixa e DRE Real)** + ficha técnica em modificadores.

---

### B9 — CRM, fidelização e crescimento
- **Objetivo:** reter clientes e aumentar recorrência com conformidade LGPD e mensuração real.
- **Critérios, pesos e cálculo:**
  - *Original (`77,50%`):* Pontos/Cashback/Cupons `30%×100` (`30,00`) + CRM/Segmentação/Mensuração `30%×75` (`22,50`) + LGPD/Opt-out `20%×100` (`20,00`) + Automação Campanhas WA `20%×25` (`5,00`) = **`77,50%`**.
  - *Ampliado (`68,75%`):* Pontos/Cashback/Cupons `25%×100` (`25,00`) + CRM/Segmentação `25%×75` (`18,75`) + LGPD/Opt-out `20%×100` (`20,00`) + Automação WA Ativa `20%×25` (`5,00`) + Indicações/Aniv./Expiração `10%×0` (`0,00`) = **`68,75%`**.
  - *Homologação (`57,50%`):* Fidelidade/Cupons/Opt-out `45%×100` (`45,00`) + CRM Manual `25%×50` (`12,50`) + Automação WA prod `30%×0` (`0,00`) = **`57,50%`**.
- **Confirmado:** pontos, cashback, cupons com validação atômica, calculadora de economia (`growth_economics.py`), CRM com 5 segmentações explicáveis e atribuição sem dupla contagem, opt-out LGPD granular (`marketing_only`), inbound de consentimento (`whatsapp_marketing_consent.py`) e fila de campanhas (`central_whatsapp_campaigns.py`).
- **Parcial / Ausente:** automação WhatsApp está **desligada por default** via env flags (`KOMA_CENTRAL_WA_CAMPAIGNS_ENABLED`, `KOMA_CENTRAL_WA_CONSENT_ENABLED`); sem expiração automática de pontos/cashback, bônus de aniversário/indicação ou prêmio em produto grátis. *Nota documental:* `docs/engineering/whatsapp-central-campaigns.md` precisa ser atualizado pois o endpoint inbound já existe em `origin/main`.
- **Para 90%:** piloto controlado e homologado de campanhas WhatsApp com consentimento confirmado + expiração/bônus de aniversário. **Para 100%:** programa de indicações e mensuração de ROI comercial comprovada em múltiplos clientes.
- **Próxima missão recomendada:** Habilitar piloto controlado de campanhas WhatsApp com opt-in validado em tenant autorizado (não ID 6 sem aprovação) e atualizar `whatsapp-central-campaigns.md`.

---

### B10 — Fiscal
- **Objetivo:** emitir, cancelar, inutilizar, contingenciar e exportar documentos fiscais (NFC-e/NF-e) com segurança jurídica e suporte a todos os modelos de venda.
- **Critérios, pesos e cálculo:**
  - *Original (`48,75%`):* Modelagem/Sequência/Cofre A1/CSC `30%×100` (`30,00`) + Onboarding CE/Preflight/Watcher `20%×75` (`15,00`) + Tributação Editável por Produto `15%×25` (`3,75`) + Emissão/SEFAZ `35%×0` (`0,00`) = **`48,75%`**.
  - *Ampliado (`40,00%`):* Modelagem/Cofre `25%×100` (`25,00`) + Onboarding/Watcher `15%×75` (`11,25`) + Tributação Editável `15%×25` (`3,75`) + Emissão NFC-e/Contingência/Exportação `30%×0` (`0,00`) + NF-e 55/Multi-UF/Peso/Rodízio `15%×0` (`0,00`) = **`40,00%`**.
  - *Homologação (`22,50%`):* Cofre/Preflight `30%×75` (`22,50`) + Homologação SEFAZ `35%×0` (`0,00`) + Produção/Contingência SEFAZ `35%×0` (`0,00`) = **`22,50%`**.
- **Confirmado:** excelente fundação F0/F1 (`fiscal_models.py`, `FiscalSequence` atômico, `FiscalDocumentItem.quantity Numeric(14,4)` já pronto para fracionários, cofre A1/CSC cifrado, onboarding `BR-CE`, preflight, watcher de referências oficiais e calculadora RTC, 15 arquivos de teste).
- **Ausente (bloqueador comercial P0):** **0 providers registrados em `fiscal_providers`**; `issue_fiscal_document` não tem chamadores em produção; sem assinatura XMLDSig/SOAP/transmissão SEFAZ ou conector Focus/PlugNotas; `CashierFiscalProducts.tsx` é somente leitura (sem edição de NCM/CFOP/CSOSN); restrito por `CheckConstraint` ao modelo `65` (sem NF-e 55) e `BR-CE`; sem DANFE, exportação contábil ou contingência offline executável.
- **Para 90%:** editor de tributação por produto + materializador de venda + conector fiscal real (direto SEFAZ ou provedor homologado) + emissão/cancelamento/inutilização/DANFE/exportação XML em homologação e produção SEFAZ para NFC-e. **Para 100%:** contingência offline comprovada, multi-UF, NF-e 55 e cobertura fiscal validada para venda por kg e rodízio.
- **Próxima missão recomendada (P0 comercial):** Decisão arquitetural (provedor fiscal vs. emissão direta SEFAZ) + editor de NCM/CFOP/CSOSN + primeira emissão homologada em ambiente de homologação SEFAZ-CE.

---

### B11 — Escalabilidade contínua (1 → 10 → 25 → 50 → 100 restaurantes)
- **Objetivo:** manter custo mínimo com 1 loja, compartilhar eficientemente com 10 e escalar sustentavelmente até 100 sem regressão.
- **Critérios, pesos e cálculo:**
  - *Original (`77,50%`):* Eficiência Pool/Workers/DB/Front (1–10) `30%×100` (`30,00`) + Benchmarks PG17 1/10/100 `25%×100` (`25,00`) + FinOps e Gatilhos `15%×100` (`15,00`) + Capacidade 100 Lojas em `RTT=25ms` + `create_order` `30%×25` (`7,50`) = **`77,50%`**.
  - *Ampliado (`66,25%`):* Eficiência 1–10 `25%×100` (`25,00`) + Benchmarks PG17 `20%×100` (`20,00`) + FinOps `15%×100` (`15,00`) + 100 Lojas RTT real + Infra `25%×25` (`6,25`) + Novos equipamentos/marketplaces `15%×0` (`0,00`) = **`66,25%`**.
  - *Homologação (`62,50%`):* Benchmark PG17 `RTT=0/25ms` `40%×100` (`40,00`) + Deploy prod + telemetria `/health` `30%×75` (`22,50`) + Campo >=10 lojas e gatilhos 100 lojas `30%×0` (`0,00`) = **`62,50%`**.
- **Confirmado:** PR1–PR6 integrados na `main` (`#1475`, `#1478`, `#1479`, `#1480`, `#1481`, `#1484`), benchmark PG17 versionado (`backend/scripts/benchmark_b11_scale_1_10_100.py`, `test_b11_scale_1_10_100_pg17.py`), relatório FinOps (`docs/engineering/b11-scale-efficiency-engine.md` — US\$ 5/mês p/ 1 loja → US\$ 5–37/mês p/ 10 → US\$ 46–145/mês p/ 100).
- **Pendente (detalhado na Seção G):** 100 lojas em `RTT=25ms` falham (`49/180` HTTP 500) com `pool=4`; colocalização Railway↔Supabase ou Supavisor Transaction Mode + `pool=8–12`; redução `create_order` (`56 → <20` SQLs); limpeza de serviços auxiliares Railway; migração de PDFs BLOB (10 MB) em `catalog_assistance_requests` para Storage.
- **Para 90%:** aprovar e aplicar colocalização ou Transaction Pooler + reduzir `create_order` para `<20` SQLs + provar `180/180 OK (0% erro)` no Estágio C (100 lojas) em `RTT` realista. **Para 100%:** validação em produção com >=10 lojas ativas simultâneas + cobertura de carga para webhooks de marketplaces e equipamentos.
- **Próxima missão recomendada:** Retomar B11 Onda 2 exatamente no item 1 da Seção G (`create_order` 56 → `<20` SQLs + plano de colocalização/Transaction Mode quando houver autorização).

---

### B12 — Continuidade operacional e contingência
- **Objetivo:** evitar perda de pedidos, duplicidades ou paralisação do restaurante diante de falhas temporárias de rede, backend ou equipamentos.
- **Critérios, pesos e cálculo:**
  - *Original (`62,50%`):* Filas duráveis server-side `25%×75` (`18,75`) + Resiliência WS/SSE/LISTEN/Idempotência `30%×75` (`22,50`) + Journal local equipamentos `20%×75` (`15,00`) + Recuperação formal de quedas `25%×25` (`6,25`) = **`62,50%`**.
  - *Ampliado (`52,50%`):* Filas server-side `25%×75` (`18,75`) + Resiliência Realtime `20%×75` (`15,00`) + Journal equipamentos `20%×75` (`15,00`) + Operação Offline Real `20%×0` (`0,00`) + Balanças/Totens/Pag. interrompidos `15%×25` (`3,75`) = **`52,50%`**.
  - *Homologação (`52,50%`):* Journal Print/WS/Pagamentos `45%×75` (`33,75`) + Contenção operacional `25%×75` (`18,75`) + Simulação real de queda total `30%×0` (`0,00`) = **`52,50%`**.
- **Separação rigorosa (o que existe vs. o que NÃO existe):**
  - *Cache de leitura / Shell PWA:* `courier-sw.js` (só shell `/entregador` + assets) e `courierSnapshotCache.ts` (snapshot cifrado AES-GCM, somente leitura); `koma-sw.js` é exclusivamente Web Push (sem fetch cache).
  - *Rascunho local / retry manual:* `cartDraftStorage.ts` (`sessionStorage`), `operationalRequest.ts` (chave idempotente em `localStorage` para retry manual), `smartpos-android` (`PendingOrderStore`, `FileOperationStore` para reconciliar PlugPag).
  - *Filas duráveis:* `PrintJob` + `IntegrationOutbox` (server-side PG), `journal.db` SQLite WAL no Print Agent e `PrintJournalStore` no Android (anti-duplicidade e reconfirmação), `reconciliation_worker.py` (pagamentos online).
  - *Operação efetivamente offline:* **INEXISTENTE (0%)** — não há fila local de mutações (abrir mesa, lançar item, pesar, fechar dinheiro/comanda) nem motor local de sincronização/resolução de conflitos.
- **Para 90%:** definir e implementar arquitetura de contingência local (ex.: fila local idempotente para PDV/balcão/comanda com sync seguro e bloqueio estrito de aprovação offline de pagamentos externos) + simulação formal de queda de internet/backend. **Para 100%:** teste de campo em restaurante real com queda controlada de link e recuperação 100% íntegra.
- **Próxima missão recomendada:** RFC + POC de contingência offline segura para PDV/Salão (fila idempotente local para lançamentos e pagamentos presenciais não-online, com reconciliação server-side).

---

### B13 — Implantação, suporte e sucesso do cliente
- **Objetivo:** permitir que restaurantes entrem em produção e operem com autonomia sem depender constantemente do fundador.
- **Critérios, pesos e cálculo:**
  - *Original (`72,50%`):* Onboarding Fast-Track/Provisionamento `25%×100` (`25,00`) + Central Incidentes/Suporte/Super Admin `20%×100` (`20,00`) + Importação Catálogo `25%×50` (`12,50`) + Autonomia/Diagnóstico/Sucesso `30%×50` (`15,00`, elevado pelos PRs `#1485` e `#1486`) = **`72,50%`**.
  - *Ampliado (`60,00%`):* Fast-Track `20%×100` (`20,00`) + Incidentes/Suporte `20%×100` (`20,00`) + Migração Concorrentes/CSV/PDF/Modif. `20%×25` (`5,00`) + Onboarding Segmento/Equipamentos `20%×25` (`5,00`) + Treinamento/Autodiagnóstico/Sucesso `20%×50` (`10,00`) = **`60,00%`**.
  - *Homologação (`60,00%`):* Fast-Track em clientes reais `40%×75` (`30,00`) + Suporte/Incidentes Super Admin `30%×75` (`22,50`) + Autonomia/Autodiagnóstico sem Fundador `30%×25` (`7,50`) = **`60,00%`**.
- **Confirmado:** `FirstAccessOnboarding.tsx` (4 passos bloqueantes mobile-first), `preparando → pronto_para_teste → trialing → active`, `SuperAdminIncidents` (5 fontes reais com ações corretivas), Modo Suporte auditado com TTL, `CustomerSupportWidget`, `SuperAdminRestaurant360`, **deep links contextuais (`?go=`) + WhatsApp quick replies (`#1485`)**, e **autodiagnóstico de tenant + error ring buffer + alerta Telegram (`#1486`)**.
- **Esforço manual ainda necessário (gargalo do fundador):**
  1. Migração de cardápios de PDF/imagem/concorrentes exige download manual de `catalog_assistance_requests` e transcrição manual para JSON; além disso, `POST /produtos/importar` **não importa grupos de modificadores/complementos**!
  2. Sem importador CSV/Excel nem conector de migração de concorrentes (iFood/Anota AI/Goomer/Cardápio Web).
  3. Liberação de trial/Pix manual e configuração de impressora/OAuth/fiscal ainda demandam acompanhamento humano.
- **Para 90%:** importação autônoma CSV/JSON com grupos de modificadores + assistente de extração de cardápio (PDF/foto → revisão pelo dono) + checklists guiados de impressora/pagamento/balança + painel de saúde de ativação/retenção. **Para 100%:** 5+ restaurantes implantados ponta a ponta sem intervenção manual do fundador.
- **Próxima missão recomendada:** Evoluir `POST /produtos/importar` para suportar **CSV + grupos de modificadores/famílias** e criar fluxo semi-automático de revisão de cardápio importado pelo próprio dono.

---

## Seção E — Matriz dos Novos Recursos Investigados (`origin/main`)

| Funcionalidade | Bloco responsável | Blocos dependentes | Estado atual (`origin/main`) | Evidência objetiva | Prioridade | Esforço estimado |
|---|---|---|---|---|---|---|
| **Integração oficial iFood** | B7 | B1, B3, B4, B5, B11 | **Preparação arquitetural** | Apenas `MarketplaceProviderAdapter`, `ExternalOrderReference`, `IntegrationOutbox`, enum e logo; 0 conector/OAuth/webhook | **P0** | Alto (4–6 sem.) |
| **Emissão Fiscal real (NFC-e SEFAZ)** | B10 | B1, B4, B8, B12 | **Implementado parcialmente** | Cofre A1/CSC, preflight, watcher e `FiscalSequence` OK; **0 providers** em `fiscal_providers`, 0 emissão SEFAZ, UI produtos só leitura | **P0** | Alto (4–6 sem.) |
| **Contas a pagar** | B8 | B1, B5 | **Não identificado** | Só existe `OwnerFinanceMonth` interno do KÔMA (`koma_internal`); 0 modelo/rota para restaurantes | **P0** | Médio (2–3 sem.) |
| **Contas a receber** | B8 | B5, B1 | **Não identificado** | Apenas recebimentos imediatos (`Pagamento`) e faturas SaaS Direct Pix; 0 módulo de títulos/recebíveis futuros | **P0** | Médio (2–3 sem.) |
| **DRE gerencial real** | B8 | B5, B10 | **Não identificado** | `RelatorioFinanceiroTab` exibe só recebimentos - estornos; `product-contract.json` (`#1512`) e busca do Caixa já corrigidos | **P0** | Médio (2–3 sem.) |
| **Contingência offline real** | B12 | B1, B4, B5, B10 | **Não identificado** *(só cache/rascunho)* | `courier-sw.js` faz cache só de shell `/entregador`; `PrintJob`/journal não permitem criar pedidos offline | **P0** | Alto (4–6 sem.) |
| **Prato por peso (kg/g/tara)** | B4 | B3, B1, B8, B10 | **Não identificado (venda)** | `Produto` só tem `preco` unitário; `Item` sem peso/decimal; `unidade_medida` restrita a `Insumo`; `restaurant_profiles.md` marca como aberto | **P1** | Médio (2–3 sem.) |
| **Integração com balanças** | B4 | B1, B2, B12, B13 | **Não identificado** | 0 ocorrências de balança/tara/Serial/WebSerial/Toledo/Filizola/Urano no repo (incluindo `print-agent/`) | **P1** | Médio-Alto (3–4 sem.) |
| **Modo Rodízio (por pessoa)** | B4 | B3, B1, B8, B10 | **Não identificado** | 0 campos/rotas de cobrança por pessoa, adulto/criança ou controle de itens incluídos no rodízio | **P1** | Médio (2–3 sem.) |
| **Prato feito / Prato executivo** | B3 / B4 | B6, B13 | **Implementado parcialmente** | Marmitaria P/M/G completa; PF/executivo não tem perfil/template dedicado nem atalho rápido dedicado no PDV | **P1** | Baixo-Médio (1–2 sem.) |
| **Produção por lote e rendimento** | B8 | B4 | **Não identificado** | 0 modelos/rotas para ordens de produção, sub-receitas, fator de rendimento (`yield`), sobras ou descarte de buffet | **P1** | Médio-Alto (3–4 sem.) |
| **Migração de concorrentes / CSV / PDF** | B13 | B3, B6 | **Implementado parcialmente** | Só JSON estrito (sem modificadores) + upload PDF/foto para transcrição manual no Super Admin; 0 CSV/concorrentes | **P1** | Médio (2–3 sem.) |
| **TEF / Pinpad (PDV)** | B5 | B1, B4, B12 | **Não identificado** | 0 SiTef/PayGo/Stone/Cielo/Rede/Pinpad; SmartPOS Android PlugPag existe em código mas sem homologação física | **P1** | Alto (4–6 sem.) |
| **Buffet livre (preço fixo)** | B4 | B3, B8, B10 | **Não identificado** | Apenas menção `"selfservice"` em comentário de `ConfiguracaoRestaurante.nicho`; sem regra de cobrança por pessoa | **P1** | Baixo (reaproveita Rodízio) |
| **Controle de perdas / desperdícios** | B8 | B4 | **Implementado parcialmente** | `POST /estoque/movimentacoes` aceita `tipo="perda"` com motivo; sem relatório consolidado nem quebra técnica | **P1** | Baixo (1 sem.) |
| **Compras e XML NF-e** | B8 | B10, B1 | **Implementado e testado** *(parcial)* | `POST /estoque/importar-xml` + entrada manual + `Distribuidor` funcionam; falta de-para de embalagem e vínculo com Contas a Pagar | **P1** | Baixo-Médio (1–2 sem.) |
| **Validade e lotes (PEPS/FEFO)** | B8 | B4 | **Não identificado** | 0 colunas de lote/validade em `Insumo`, `ItemEntradaEstoque` ou `MovimentacaoEstoque` | **P2** | Médio (2 sem.) |
| **Comanda individual (cartão/ficha)** | B4 | B1, B5 | **Implementado parcialmente** | Suporta múltiplas comandas por mesa e divisão; falta cartão/ficha física numerada reutilizável independente de mesa | **P2** | Médio (2 sem.) |
| **Painel de senhas (retirada/TV)** | B4 | B3, B2 | **Não identificado** | Apenas `numero_pedido` e rastreamento web individual; sem tela TV/chamada sonora | **P2** | Baixo (1–2 sem.) |
| **Reservas de mesas** | B4 | B3, B9 | **Não identificado** | `Mesa` tem apenas `id/restaurante_id/capacidade/nome`; sem agenda ou status `reservada` | **P2** | Médio (2 sem.) |
| **Fila de espera** | B4 | B9 | **Não identificado** | Nenhuma estrutura de fila de espera de salão | **P2** | Baixo-Médio (1–2 sem.) |
| **Totem de autoatendimento** | B4 | B3, B5, B11 | **Preparação arquitetural** | Apenas enum `OrderChannel.KIOSK = "kiosk"` mapeado para `"cardapio"`; 0 UI/fluxo kiosk | **P2** | Alto (4–6 sem.) |
| **Outros marketplaces (99Food, Keeta, aiqfome)** | B7 | B1, B4, B5 | **Preparação arquitetural** *(99/Keeta)* / **Não identificado** *(aiqfome)* | Enums e ícones para 99Food/Keeta; 0 ocorrências de `aiqfome`; 0 conectores | **P2** | Médio/cada (pós-iFood) |

---

## Seção F — PRs, Branches, Trabalhos Paralelos e Investigação de CI

- **Integrado na `origin/main` desde `96d3729f` (19 PRs):** `#1467`, `#1468`, `#1469`, `#1470`, `#1471`, `#1472`, `#1473`, `#1474`, `#1475` (B11 PR1), `#1478` (B11 PR2), `#1479` (B11 PR3), `#1480` (B11 PR4), `#1481` (B11 PR5), `#1482`, `#1484` (B11 PR6), `#1485` (deep links `?go=` + WhatsApp quick replies), `#1486` (autodiagnóstico de tenant + error ring buffer), `#1488` (correção `Backend Full Suite`), `#1487` (correção regressão real motoboys / `Browser Targeted Gate`).
- **Investigação e resolução das falhas de CI (diferenciando regressões reais de testes desatualizados):**
  1. **`Browser Targeted Gate` — run `45458203059` (8 falhas): REGRESSÃO REAL P0 DE PRODUÇÃO (corrigida no PR `#1487`, `9fd40904`).**
     - *Sintoma:* todas as 8 falhas deram timeout de 30s esperando `combobox` (`Entregador do pedido 87 / 5002 / 5100`) ficar `enabled`.
     - *Causa raiz:* o B11 PR4 (`#1480`, `41ca6ba3`) alterou `src/components/caixa/realtime/useCashierRealtime.ts` para disparar `fetchMotoboys()` somente quando `motoboysLoadState === 'idle'`, mas `src/components/caixa/orders/useCashierOrders.ts:337` inicializava o estado em `'loading'` (sem `'idle'` no tipo). Com isso, `fetchMotoboys()` nunca disparava e o despacho de delivery ficava permanentemente bloqueado.
     - *Correção (`#1487`):* inicializado `motoboysLoadState` em `'idle'`, alinhados os tipos em `CaixaOrdersWorkspace.tsx`, `KanbanOrderDetails.tsx` e `CashierCouriers.tsx`, preservada a guarda anti-thundering-herd e adicionada regressão em `tests/b11-frontend-efficiency.test.ts`. Validado com `lint`, `test:unit`, `build` e `Browser targeted regressions` **100% verde**.
  2. **`Backend Full Suite` — run `45450622399` (3 falhas): 2 TESTES DESATUALIZADOS + 1 ERRO DE TEARDOWN SQLITE (corrigidos no PR `#1488`, `808e2815`).**
     - *2 testes desatualizados:* `backend/tests/test_cardapio_koma_theme_contract.py` (`test_appearance_only_exposes_logo_and_banner_editing` e `test_settings_keep_the_menu_on_the_koma_palette`) ainda exigiam ausência de `type="color"` e `KOMA_MENU_BACKGROUND = '#090a0f'`, contrato substituído intencionalmente pelo Cardápio Universal V2 (`#1456`). Atualizados para validar o contrato vigente (`normalizeConfigBrandColor`, `BRAND_COLOR_PRESETS`, `buildMenuThemeTokens`, ausência de `cor_fundo`, integridade de logo/capa e migration histórica `6c7d8e9f0a1b`).
     - *1 erro de teardown:* `test_multi_tenant_scoping_in_delivery_dispatch` passava todas as asserções (HTTP 404), mas falhava no `finally:` ao deletar `Restaurante(id=888)` por existir `ConfiguracaoRestaurante(restaurante_id=888)` com `NOT NULL`. Corrigido para limpar `ConfiguracaoRestaurante` do tenant temporário antes de excluir `Restaurante`.
- **PRs abertos (NÃO contados como entrega da `main`):**
  1. **PR `#1483`** (`perf/lazy-load-superadmin-and-cashier-secondary-tabs`): `perf(frontend): lazy loading no SuperAdminPanel e sub-módulos secundários do CaixaPanel` — checks verdes. *Beneficia B2/B11.*
  2. **PR `#1477`** (`chore/deps-security-test-coverage-and-hygiene`): `chore(deps,tests): resgatar teste ignorado, corrigir CVE do Vite e organizar devDependencies` — checks verdes. *Beneficia B0/B1.*
  3. **PR `#1476`** (`chore/cleanup-dead-code-and-preview-assets`): `chore(cleanup): remover código morto comprovado e tirar mock-preview do build público` — **`UNSTABLE`** (`Browser targeted regressions` falhou; verificar se era efeito colateral da regressão `#1487` após rebase em `main`).
- **Higiene de branches:** ~1.140 branches remotas acumuladas; limpeza controlada recomendada como tarefa separada posterior.

---

## Seção G — Continuação Exata do B11 (Missão Interrompida)

**Descoberta chave:** A primeira onda completa da missão B11 (PR1 até PR6) **JÁ FOI CONCLUÍDA E INTEGRADA NA `origin/main`** (o PR6 `#1484` é o próprio `HEAD` `78588d60`, em produção no Railway `e93633b1`). **NÃO reiniciar a investigação do B11.**

### Etapas comprovadamente concluídas (preservar sem refazer)
1. **PR1 (`#1475`, `06fa29b5`):** otimização de pool/workers ociosos, cache de mappers e CORS, TCP keepalives `LISTEN`, `SESSION_REVALIDATION_SECONDS=180s`, contagem real WS, fechamento `httpx.Client` MP/PagBank, liberação DB pré-HTTP em reconciliação/fiscal.
2. **PR2 (`#1478`, `5954b137`):** cura do self-deadlock de 4 vias (`queue_committed_broadcast` + remoção de `db.refresh`), `_DB_CLOSE_EXECUTOR`, `selectinload`, fast-paths 0-commit (`print_agents`, `online-orders/control`, `outbox`), `SQL GROUP BY` relatórios, `ETag`/`304` no cardápio público.
3. **PR3 (`#1479`, `04f0b0ce`):** migração `20261124b11a` — **0 policies RLS sem InitPlan**, `FORCE RLS` + `REVOKE` em `produto_familias*`, `-3` índices duplicados, `+5` índices hot-path.
4. **PR4 (`#1480`, `41ca6ba3`):** fim do thundering herd no Caixa/SSE, `manualChunks` (`162 → 88` chunks, `-77,1%` micro-chunks `<2KB`), `public/_headers`.
5. **PR5 (`#1481`, `2ffcfd58`):** otimização CI Playwright (`on-first-retry`), inclusão `src/domain/*.test.ts` em `test:unit`, auditoria semanal garantida.
6. **PR6 (`#1484`, `78588d60`):** benchmark PG17 1/10/100 (`backend/scripts/benchmark_b11_scale_1_10_100.py`), teste de regressão PG17 (`backend/tests/test_b11_scale_1_10_100_pg17.py`) e relatório FinOps (`docs/engineering/b11-scale-efficiency-engine.md`).

### Resultados comprovados no benchmark PG17 (`pool=4, overflow=0`)
- **`RTT=0ms`:** Estágio A (1 loja) `24/24 OK` (`24,55 rps`, `p95=530ms`), Estágio B (10 lojas) `60/60 OK` (`24,82 rps`, `p95=1253ms`), Estágio C (100 lojas) `180/180 OK` (`22,27 rps`, `p95=3230ms`, `0` timeouts vs `131` antes).
- **`RTT=25ms` (Railway `sfo` ↔ Supabase):** Estágio A `24/24 OK` (`5,35 rps`), Estágio B `60/60 OK` (`7,49 rps`, `0` erros vs `51,7%` antes), **Estágio C (100 lojas): `131/180 OK`, `49× HTTP 500`, `52` timeouts** *(comprova gargalo físico do pool=4 com RTT=25ms)*.

### Ponto exato de retomada (Onda 2 do B11 — tarefas pendentes)
1. **Redução profunda de SQLs em `OrderApplicationService.create_order` (`56 → <20` SQLs)** — pré-requisito de código para suportar >30 lojas em `RTT=25ms`.
2. **Limpeza dos 4 `duplicate_index` (`WARN`) restantes no Supabase** (detectados ao vivo nos Performance Advisors de 24/11).
3. **Decisão + execução (com aprovação do fundador):** colocalização de região Railway↔Supabase (corta RTT `25ms → ~2ms` sem elevar plano) e/ou migração de `DATABASE_URL` para **Supavisor Transaction Mode** (mantendo `PostgresListenMultiplexer` em DSN Session dedicado) + `DB_POOL_SIZE=8–12`.
4. **Enxugamento FinOps Railway (com aprovação):** avaliar desligamento/remoção de `pre-purge-backup-20260916` (ocioso) e revisão de `evolution-api` + Postgres + Redis (~333 MB RAM).
5. **Migração de PDFs BLOB (até 10 MB) em `catalog_assistance_requests`** para Object Storage + GC automático de fotos de promoções substituídas + alinhamento de `requirements.lock` para Dependency Graph.

---

## Seção H — Ranking das Próximas Missões Recomendadas

| Ordem | Missão | Blocos | Prioridade | Risco / Valor | Esforço | Paralelizável? |
|---:|---|---|---|---|---|---|
| **1** | **Higiene de CI & Merge Seguro de PRs Prontos:** corrigir os 3 testes falhos na `Backend Full Suite` (`test_cardapio_koma_theme_contract.py` + `test_multi_tenant_scoping_in_delivery_dispatch`), avaliar merge de `#1477` (CVE Vite) e `#1483` (lazy loading) e remover os 4 `duplicate_index` do Supabase | B0, B1, B2, B3 | **P0** | Elimina regressão silenciosa na suíte completa e fecha CVE Vite | Baixo (2–3 dias) | Sim (independente) |
| **2** | **Emissão Fiscal Real NFC-e (SEFAZ-CE):** definir estratégia (provedor fiscal vs. emissão direta), criar editor de NCM/CFOP/CSOSN por produto, conectar `issue_fiscal_document` ao Caixa/PDV e homologar primeira emissão + cancelamento + DANFE em homologação SEFAZ | B10 (B4, B8) | **P0** | Barreira comercial/legal crítica para escalar base pagante | Alto (4–6 sem.) | Sim (trilha fiscal dedicada) |
| **3** | **Integração Oficial iFood (MVP Homologável):** iniciar credenciamento oficial de parceiro, implementar `IfoodMarketplaceAdapter` sobre `MarketplaceProviderAdapter` + `OrderApplicationService` (polling/webhook, aceite, cancelamento, status, sync básico de catálogo) | B7 (B1, B4, B5) | **P0** | Maior barreira comercial para delivery (B7 = 5%) | Alto (4–6 sem.) | Sim (paralelo a Fiscal) |
| **4** | **Financeiro Gerencial Real (CP/CR/Fluxo/DRE):** corrigir rótulo enganoso de `"DRE"`, implementar Contas a Pagar, Contas a Receber, Despesas, Fluxo de Caixa e DRE Gerencial real + ficha técnica em modificadores | B8 (B5) | **P0** | Elimina promessa falsa de DRE e entrega gestão financeira real | Médio (3–4 sem.) | Sim |
| **5** | **Arquitetura Universal dos 5 Modelos de Venda (Peso + Rodízio + PF):** estender `Produto`/`Item` para `sale_model` (`unit`, `weight`, `per_person`, `fixed_composition`), quantidades decimais, tara/peso bruto/líquido, cobrança por pessoa (adulto/criança) e atalho rápido PF/Executivo | B3, B4 (B1, B8, B10) | **P1** | Desbloqueia self-service, buffet, rodízio, churrascaria, açaí por peso e PF sem duplicar arquitetura | Médio-Alto (4–5 sem.) | Após fechar contrato de domínio |
| **6** | **Agente Local de Balanças (extensão do Print Agent):** protocolo serial/USB (Toledo/Filizola/Urano), leitura estável, tara, diagnóstico, prevenção de duplicidade e fallback manual auditado + homologação física | B4 (B1, B12, B13) | **P1** | Essencial para comercializar o modo prato por peso em campo | Médio-Alto (3–4 sem.) | Depende da Missão 5 |
| **7** | **B11 Onda 2 (100 Lojas em RTT Real) + Enxugamento FinOps:** reduzir `create_order` (`56 → <20` SQLs), colocalizar Railway↔Supabase ou Transaction Pooler (com aprovação) e revisar serviços auxiliares Railway | B11, B0, B2 | **P1** | Garante sustentabilidade de 10 → 100 lojas no piso mínimo de custo | Médio (2–3 sem.) | Sim |
| **8** | **PagBank Connect + SmartPOS Físico + Conciliação de Taxas/Recebíveis:** fechar assinatura webhook e estorno PagBank, realizar homologação física do SmartPOS Android PlugPag e estruturar conciliação de taxas/repasses | B5 (B4, B8) | **P1** | Fecha lacunas financeiras de pagamento presencial e online | Médio (3–4 sem.) | Sim |
| **9** | **Implantação Autônoma de Catálogo (B13):** evoluir `POST /produtos/importar` para CSV + grupos de modificadores/famílias e assistente de revisão pelo dono (reduzindo dependência manual do fundador) | B13 (B3, B6) | **P1** | Remove gargalo humano do fundador na aquisição de clientes | Médio (2–3 sem.) | Sim |
| **10** | **Contingência Offline Segura (B12) + Produção por Lote/Rendimento (B8):** RFC e implementação de fila local idempotente para PDV/Salão (sem aprovar pagamento externo offline) + controle de produção por lote/rendimento/sobras para buffets | B12, B8 | **P1** | Blindagem operacional e gestão real para buffets/self-service | Alto (4–6 sem.) | Após Missão 5 |

---

## Seção I — Histórico de Versões do Guia Vivo

| Versão | Data | SHA `origin/main` | Metodologia | Média Orig. | Média Ampl. | Média Homol. | Observação |
|---|---|---|---|---:|---:|---:|---|
| `v1.0` | 22/11/2026 | `96d3729f949ca3ff0f395777bdc37177000904dc` | Auditoria independente ChatGPT (1 dimensão) | 65,71% | — | — | Baseline histórico preservado integralmente |
| `v2.0` | 24/11/2026 | `9fd40904c92af3a4c8b11f1623bf600f4b2b000a` | 3 dimensões (Orig. `v1.0` / Ampl. `v2.0` / Homol.) | **68,75%** | **57,32%** | **54,91%** | Incorpora Plano Mestre B0–B13 ampliado, 5 modelos de venda, conclusão B11 PR1–PR6, entregas `#1485`/`#1486`, correções de CI `#1487`/`#1488` e revisão fundamentada de B8 e B11 |
| `v2.0-sync` | 27/11/2026 | `a4cd054fcfb32665005ce092f9d40f339900cccc` *(+ estabilização)* | 3 dimensões preservadas (pesos fixos, sem inflação por fix de CI) | **68,75%** | **57,32%** | **54,91%** | Sincroniza `product-contract.json` (`2026-11-business-v2a`: Pocket R\$ 99,90, Pro R\$ 179,90 + `courier_app`, Founders R\$ 79,90), registra correção de aliases DRE/fluxo na busca e vincula os 195 itens `A01–L08` aos blocos `B0–B13` |

---

## Seção J — Consolidação do Backlog: Vínculo dos 195 Itens (`A01–L08`) aos Blocos `B0–B13`

*Fonte canônica dos 195 itens: auditoria sobre `0c067614` (`RELATORIO_1_INVENTARIO_COMPLETO_A01_L08.md`, 26/11/2026), preservando classificação, evidências, histórico, dependências entre blocos e pendências reais sem duplicação.*

| Bloco | Critérios vinculados (Seção D) | IDs Resolvidos / Não Aplicáveis | IDs Parciais / Não Verificados | IDs Pendentes | Dependências entre Blocos |
|---|---|---|---|---|---|
| **B0 — Infra, Disponibilidade e FinOps** | Topologia/Deploy/CI · Backup/Restore PG · Monitor/Smoke · Seg. Op. · FinOps/Ociosos · Recup. Integral | `F06`, `F07`, `F11`, `F14`, `K07`, `K10`, `K12` | `F01` *(não verif.)*, `F02`, `F04`, `F05` *(não verif.)*, `F09`, `F10`, `F12`, `L05` | `F03`, `F08` | `B11` (FinOps/pool), aprovação do fundador (`F03`) |
| **B1 — Integridade e Segurança** | RLS/FORCE RLS · Auth/RBAC/Revogação · Idempotência/Transacional · Auditoria/Credenciais · Seg. Equipamentos/Webhooks | `A01`, `A06`, `A07`, `A08`, `A09`, `A10`, `A11` | `A02`, `E08` | `A12` | `B4` (balanças/salão), `B5` (PagBank/SmartPOS), `B7` (webhooks iFood) |
| **B2 — Performance e Eficiência** | SQL/Índices/Pool · Hot-paths/Deadlocks · Frontend/Chunks/ETag/CWV · Filas/Polling/Realtime · Equip. Modestos | `D06`, `D16`, `E02`, `E07`, `E09`, `E10`, `E11`, `E12`, `E14`, `E15`, `E16`, `E18`, `E19`, `E20`, `E21`, `E24`, `E25`, `E26`, `E27`, `L03`, `L04` | `B09`, `C03`, `C04`, `C09`, `E04`, `E05`, `E06`, `E17`, `E22`, `E23` | — | `B11` (Onda 2 `create_order` + 4 `duplicate_index`), `B3`/`B4` |
| **B3 — Cardápio Digital e Modelos Comerciais** | V2/Temas/UX Mobile · Catálogo/Famílias/Modif./Promoções · Sacola/Checkout/Agend. · Perfis Iniciais · 5 Modelos | `B01`, `B02`, `B03`, `B04`, `B05`, `B06`, `B08`, `B10`, `B11`, `B12`, `B13`, `B14`, `B15`, `B16`, `B17`, `B18`, `B20`, `B21`, `B22`, `B23`, `B24`, `B25`, `K14` | `B07`, `J15`, `K13` | `K09` *(viewport 390×844)* | `B4` (contrato único 5 modelos), `B6` (templates) |
| **B4 — Operação, Caixa, PDV, Garçom e KDS** | Pedidos/Mesas/Salão · PDV/Caixa/Turnos · Garçom/KDS/Entregador · Impressão/SmartPOS · 4 Novos Modos | `A03`, `A04`, `A05`, `C02`, `C08` *(não reprod.)*, `C14`, `C15` *(não reprod.)*, `C16`, `C17`, `D01`, `D02`, `D03`, `D05`, `D07`, `D08`, `D09`, `D10`, `D11`, `D12`, `D13`, `D15`, `D17`, `D18`, `D20`, `D21`, `D22`, `E13`, `J09` | `C01`, `C07`, `C11`, `C12`, `C13`, `C18`, `D04`, `D14`, `D19`, `L01` *(não verif.)*, `L02` *(não verif.)* | `C05`, `C06` | `B3` (5 modelos), `B1` (segurança peso), `B5` (SmartPOS) |
| **B5 — Pagamentos e Conciliação** | Presenciais/Split/Estornos · MP Pix Online · PagBank/Direct Pix · SmartPOS Fin. · TEF/Recebíveis | `G01`, `G02`, `G03`, `G04`, `G05`, `G06`, `G07`, `G08`, `G11`, `G12` | `G09`, `G10` | — | `B1` (assinatura/estorno), `B4` (SmartPOS/PDV) |
| **B6 — SaaS, Planos e Onboarding Técnico** | Planos/Entitlements · Contratos/Trial/Billing · Provisionamento/Super Admin · Perfis Especializados · Multiloja | `G13`, `H01`, `H02`, `H04`, `H05`, `H06`, `H07`, `H08` | `K06`, `L07` | — | `B5` (homologação cobrança recorrente MP), `B13` (templates) |
| **B7 — Marketplaces (iFood Prioritário)** | Contrato Abstrato/Idempotência · Auth/Credenciamento/Eventos · Fluxo de Pedidos · Sync Catálogo/Conciliação | — | `I06`, `I08` *(apenas borda/outbox)* | `I01`, `I02`, `I03`, `I04`, `I05`, `I07`, `I09`, `I10`, `I11`, `I12` | `B1` (webhooks), `B3` (catálogo), `B4` (pedidos), `B5` (repasses), `B8` (estoque) |
| **B8 — Financeiro, Estoque, Custos e Produção** | Estoque/Insumos/Fichas · Compras/XML · CMV/Custo Médio · CP/CR/Fluxo/DRE · Perdas/Lotes · Produção/Buffet | `J07` | `J01`, `J02`, `J03`, `J05` | `J04`, `J06`, `J08`, `J14` | `B5` (conciliação/recebíveis), `B4` (peso/buffet), `B10` (XML/fiscal) |
| **B9 — CRM, Fidelização e Crescimento** | Pontos/Cashback/Cupons · CRM/Segmentação · LGPD/Opt-out · Automação WA · Indicações/Aniv./Expiração | `J10`, `J11` | `J12`, `J13` | — | Aprovação de piloto WA (`J13`) |
| **B10 — Fiscal** | Modelagem/Cofre A1/CSC · Onboarding/Watcher · Tributação Editável · Emissão NFC-e/SEFAZ · NF-e 55/Multi-UF | — | `J17`, `J18` | `J16` | `B4` (venda por peso/rodízio), `B8` (tributação/XML) |
| **B11 — Escalabilidade Contínua (1→100)** | Eficiência 1–10 · Benchmarks PG17 1/10/100 · FinOps/Gatilhos · 100 Lojas `RTT=25ms` + `create_order` | `K11` | `E01`, `E03`, `F13`, `L06` | — | `B0` (FinOps/colocalização), `B2` (`create_order` + 4 `duplicate_index`) |
| **B12 — Continuidade Operacional e Contingência** | Filas Server-Side · Resiliência Realtime/Idempotência · Journal Equipamentos · Operação Offline Real | `C10`, `H10` | — | *(0% offline real — Seção E)* | `B1` (idempotência), `B4` (PDV/Salão), `B5` (bloqueio pag. offline) |
| **B13 — Implantação, Suporte e Sucesso** | Fast-Track/Provisionamento · Incidentes/Suporte · Importação Catálogo · Autonomia/Diagnóstico/Sucesso | `B19` *(N/A código)*, `H03`, `H09` | — | *(CSV + modificadores, Seção D/E)* | `B3` (catálogo/modificadores), `B6` (onboarding/planos) |
| **Governança / Processo / Transversais** | Higiene de repositório, documentação, escopo e diretrizes | `K04`, `K05`, `K08`, `K15`, `L08` | `J19` *(P3 sob demanda)* | `K01`, `K02`, `K03` | — |

**Conferência quantitativa:** `12 (A) + 25 (B) + 18 (C) + 22 (D) + 27 (E) + 14 (F) + 13 (G) + 10 (H) + 12 (I) + 19 (J) + 15 (K) + 8 (L) = 195 itens` integralmente vinculados sem duplicação.

---

## Seção K — Estratégia de adoção, diferenciação e evolução de longo prazo (27/11/2026)

**Natureza:** camada estratégica transversal proposta pelo fundador e analisada criticamente em 27/11/2026. Complementa A–J; não altera o denominador V2.0, os pesos, as notas, os 195 IDs históricos nem o contrato comercial. Não é autorização para executar todos os itens agora. Base de referência do repositório: `691a12837b607253d8eb2ca2869a7c094105ed3c`; PRs B8 #1532/#1533 ainda em integração. Preservar a arquitetura vigente e os cinco modelos de venda sobre núcleo único. Registrar hipóteses novas como propostas desta seção, não como defeitos ou entregas já realizadas. Somente incorporar critérios a uma futura versão formal da metodologia mediante decisão explícita, mantendo comparabilidade histórica.

### K.1 — Tese e limites das evidências

O KÔMA deve ser **mais fácil de adotar, operar, confiar e abandonar**, além de útil: não recriar lock-in. Reduzir o risco de migração e provar valor mensurável antes de exigir a troca do PDV. Vantagem pretendida: simplicidade, estabilidade observável, portabilidade dos dados, liberdade de escolha dentro das integrações homologadas e suporte eficaz e economicamente sustentável.

- **Custos de troca:** estudo B2B de Blut et al./setor ICT ([DOI 10.1108/JOSM-04-2014-0101](https://doi.org/10.1108/JOSM-04-2014-0101)) e pesquisa [National Restaurant Association, 2026](https://restaurant.org/research-and-media/media/press-releases/new-research-from-the-national-restaurant-association-identifies-connected-technology-as-restaurants) sustentam a importância de custo, valor, treinamento e integração. Na pesquisa com 212 operadores, custo (48,8%), adequação/valor (43,8%), lacunas de equipe/conhecimento (41,3%) e integração (38,8%) foram obstáculos à adoção/expansão tecnológica. Contexto dos EUA, não estimativa de churn de PDVs brasileiros. Não afirmar que a maioria dos clientes fica apenas por medo, nem que gigantes são incapazes de inovar.
- **Concorrência já reage:** [Toast documenta sincronização local e limitações offline](https://doc.toasttab.com/doc/platformguide/adminOfflineModeOverview.html) e [Saipos oferece orientação/migração](https://saipos.com/sistema/restaurante/trocar-de-sistema-para-restaurante). Material comercial não comprova eficácia, mas refuta exclusividade. Relatos Reddit/RA servem para levantar casos a investigar, não medir prevalência nem imputar defeitos atuais sem reprodução.
- **Canal direto:** [iFood informa planos de 12% e 23% de comissão, além de taxa de pagamento aplicável](https://blog-parceiros.ifood.com.br/ifood-cadastro/). Contratos e condições variam; usar extratos do restaurante. Canal próprio também tem custos de pagamento, aquisição, entrega, suporte e promoções. Marketplace traz descoberta e logística; complementar antes de substituir. Não garantir economia de 20 pontos de margem, receita em 48h ou custo de aquisição quase zero.
- **Local-first:** [Ink & Switch (2019)](https://www.inkandswitch.com/essay/local-first/) e [Bailis et al., invariant confluence](https://arxiv.org/abs/1402.2237) justificam estudar operação local, mas convergência CRDT não garante estoque não negativo, unicidade de pagamento, numeração fiscal ou autoridade única. Sem reescrever o núcleo online; testar partições, conflitos e recuperação antes de promover uma arquitetura. Imutabilidade de eventos não significa código ou schema imutável; evoluir contratos versionados e preservar auditoria.
- **IA de margem e demanda:** [estudo de desperdício em restaurante japonês no Brasil](https://doi.org/10.1016/j.wmb.2025.100261) e [estudo de previsão em catering](https://www.sciencedirect.com/science/article/pii/S0959652623044232) dão base para experimentar previsão, não provam ganhos universais. Números 28%, 9%, 96,6%, 70%, 47% e redução pela metade não foram rastreados às pesquisas específicas no material recebido; não usar em vendas, metas ou projeções sem fonte e contexto. Começar por baselines simples, dados completos, backtests temporais e pilotos controlados.
- **Comércio agêntico:** [Adobe Digital Insights](https://business.adobe.com/blog/ai-traffic-surge-retail-sites-not-machine-readable) mediu +393% de tráfego referenciado por IA no varejo online dos EUA no 1º trimestre de 2026 contra o anterior anual e conversão relativa +42% em março de 2026; não é demanda de restaurantes brasileiros nem conversão de pedidos autônomos. [McKinsey, 17/10/2025](https://www.mckinsey.com/capabilities/quantumblack/our-insights/the-agentic-commerce-opportunity-how-ai-agents-are-ushering-in-a-new-era-for-consumers-and-merchants) projeta US$ 3–5 tri em comércio de bens orquestrado por agentes até 2030, não receita KÔMA. [ACP](https://github.com/agentic-commerce-protocol/agentic-commerce-protocol), [UCP](https://ucp.dev/specification/overview/) e [Beckn](https://github.com/beckn/protocol-specifications) existem; adoção, adequação ao food service, autenticação e desempenho dependem do ecossistema. Não prometer callbacks <150 ms, substituição de smartphones ou demanda futura garantida.

### K.2 — Experimento comercial: conquistar confiança antes da virada (B6/B13, dependências B0–B12)

1. **Escolha de bolsão:** testar um segmento e território em que o fundador consiga dar suporte. Sugestão, não decisão comercial: hamburguerias ou pizzarias com delivery próprio, 3–5 pilotos de referência. Entrevistar dono, caixa, garçom, gerente e contador; identificar mudança de contrato, inauguração, expansão e dores de integração como sinais de intenção. Não explorar emergência com promessa impossível. Reclamações públicas agregadas para pesquisa; abordagem individual somente por canal apropriado e conforme LGPD/termos, sem spam.
2. **Demonstração personalizada:** catálogo público ou arquivo autorizado → importação em rascunho, categorias, preços, variações/adicionais, imagens autorizadas, validação e confirmação pelo restaurante. Não inventar fotos reais, ingredientes, alérgenos ou informações tributárias; não publicar loja, contatar clientes ou aceitar pedidos sem autorização. Medir tempo até prévia e até catálogo revisado (15 minutos é hipótese para catálogo simples, não SLA).
3. **Entrada gradual / shadow mode:** auditor de custo/CMV somente leitura sobre dados autorizados, demonstração QA isolada ou canal próprio para subconjunto explícito de pedidos, coexistindo com PDV anterior. Definir qual sistema é autoridade de cada pedido, estoque, cobrança, impressão, fiscal e fechamento; nunca emitir/baixar duas vezes ou captar pedido que a cozinha não possa atender. Dados reais de clientes só com base legal e necessidade. Medir valor líquido incremental antes da expansão; WhatsApp opcional, compra web sem exigência de aplicativo.
4. **Migração assistida (“luva branca”):** inventário de dados e dispositivos, importação dry-run com de-para, validação de contagens/valores, exportação de segurança, ensaio em QA, aceite do dono e contador, treinamento por função e virada em janela de menor risco definida pelo estabelecimento. Plano de rollback com fronteira de transações, congelamento da origem e reconciliação de pedidos/pagamentos/fiscal; preservar histórico e portabilidade. Treinar em 30 min é hipótese, não garantia. Sem importar senhas, tokens ou dados de cartões. Fornecer checklist de exportação/saída do próprio KÔMA.
5. **Primeiro pico e sucesso:** acompanhar primeiro turno real, com canal de atendimento, escala sustentável, severidades, escalonamento, comunicação de incidente e contingência documentados. Monitorar tempo de resposta/resolução e capacidade do fundador; “48h” é alvo experimental de melhoria pequena, não garantia nem permissão para ignorar testes. Medir tickets, ativação, retenção D30/D90 e resultado por coorte. Depoimentos somente autorizados, com metodologia e números comprovados; benefício comercial não condicionado a elogio.
6. **Validação econômica:** medir CAC incluindo horas do fundador, implantação, viagens, suporte e subsídios; custo direto mensal por tenant e margem de contribuição SaaS; retenção e expansão líquida, não apenas cadastros. Para o cliente: comparar contribuição por pedido/canal após CMV, taxas, entrega, descontos, marketing, estornos e custo incremental de suporte/embalagem. Economia líquida mensal = custos evitados + contribuição incremental − novos custos. Payback = custo de migração ÷ benefício líquido mensal positivo, com premissas/intervalos; se benefício incerto ou não positivo, não prometer payback. Não oferecer "risco zero", hardware universal, fidelidade inexistente ou SLA sem conferir o contrato vigente.

### K.3 — Vínculos ao Plano Mestre (backlog estratégico sem pontuação adicional)

Horizontes: **A** = após terminar integração B8, usar/reaproveitar e experimentar com poucos clientes; **B** = evoluir com fundamentos e evidências; **C** = opcional futuro condicionado a tração, viabilidade e aprovação. Não reabrir bloco já aceito apenas por adicionar uma hipótese.

| Bloco | Evolução pretendida e hipótese testável | Gate / dependência | Horizonte |
|---|---|---|---|
| B0 | Deploy controlado fora do pico, rollback testado, backup/restore integral inclusive dependências, observabilidade de falhas, custo por tenant. | Medir RTO/RPO e drill real isolado; não alterar infra/backup sem autorização. | A/B |
| B1 | Auditoria de ações críticas ligada a identidade/turno quando aplicável, autorização por operação, revogação e proteção antifraude; tokens de agente com escopos mínimos e trilha de ações. | Testes adversariais, replays, acesso cruzado, minimização de dados; log append-only/tamper-evident onde necessário, assinatura não substitui RBAC. | A/B/C |
| B2 | Velocidade de tarefas no balcão, mobile e notebook modesto; menos cliques sem eliminar confirmações críticas. | Comparar mesmas tarefas e operadores: p50/p95, erros, cliques, conclusão; meta "3 toques" só se medida e segura. | A |
| B3 | Cardápio estruturado e importável, canal próprio sem WhatsApp obrigatório, modificadores/preços/indisponibilidade corretos; metadados nutricionais/alérgenos apenas verificados. | Importação revisada, checkout correto, conversão e margem; preservar cinco modelos existentes. API de catálogo versionada apenas quando necessária. | A/B |
| B4 | PDV e salão ágeis; ponte de borda compatível com hardware testado; KDS por praças com tempos medidos e sincronização de conclusão, override do cozinheiro; depois balanças e IoT. | Piloto de turno, medir tempo/erros e qualidade de expedição; comparar FIFO e agendamento simples antes de otimizador. | A/B/C |
| B5 | Escolha entre provedores realmente homologados, conciliação e taxas transparentes; cartão online, SmartPOS/TEF/Tap-to-Pay conforme demanda. | Idempotência, estorno, comprovante/repasse, teste físico e taxas efetivas; roteamento não pode trocar autorização/contrato ou assumir pagamento offline. Embedded finance é hipótese C. | A/B/C |
| B6 | Planos/entitlements transparentes, onboarding gradual e contratual, CAC/LTV/custo de atendimento por coorte, Founders conforme regras atuais. | Não mudar preço nem take rate; comparar custo e retenção dos pilotos, revisar concessões e sustentabilidade. | A |
| B7 | Integração oficial iFood prioritária; outros canais por adapters, conciliação e deduplicação; rede aberta e logística multi-frota futuramente. | Credenciamento, homologação, pedidos/status/cardápio e reconciliação; não substituir iFood por promessa de rede própria. | A/B/C |
| B8 | CMV e financeiro confiáveis como porta de entrada; importação XML/de-para, custo histórico e rendimento, alertas de alteração de insumo com explicação; previsão de compras e sugestões de preço. | Completar e integrar #1532/#1533; dados completos/revisados, sem lucro inventado. Captura automática de XML só por integração autorizada, com regras fiscais e cobertura explícitas. | A/B |
| B9 | CRM com consentimento/base legal, retenção e campanhas mensuráveis, agente conversacional de pedidos opcional via Web/WhatsApp oficial. | Opt-in/opt-out, custo por pedido, controle de frequência, aprovação humana e taxa de correção/transferência; grupo controle para medir efeito incremental, sem contato invasivo. | B |
| B10 | Fiscal brasileiro real, exportação e fluxo do contador; interfaces por jurisdição quando existir segundo mercado. | NFC-e/SEFAZ homologada, contingência conforme regras vigentes e testes do contador; não programar pacotes tributários estrangeiros sem demanda/consultoria local. | A/B/C |
| B11 | Capacidade e custo marginal sustentáveis; contratos versionados/outbox, métricas e hot paths eficientes, sem microserviços prematuros. | Onda 2 e testes 25/50/100 com RTT, falhas e custos medidos; registrar compatibilidade/replay, não prometer estabilidade infinita. | A/B |
| B12 | Continuidade offline progressiva, journal local durável e replay idempotente; avaliar hub local e sincronização entre dispositivos antes de edge mesh/CRDT. | Modelo de ameaças e autoridade offline limitada; testes de internet/energia/LAN, crash do hub, relógio, conflitos, recuperação e reconciliação; nenhuma aprovação fictícia de Pix/cartão/fiscal. | A/B/C |
| B13 | Migração assistida, importação catálogo/CSV/PDF e modificadores com revisão, training por função, primeiro pico acompanhado, suporte e exportação de saída. | Pilotos voluntários, tempo até primeira venda correta, integridade da migração, custo de implantação, adesão da equipe, suporte e retenção. | A/B |

### K.4 — Roadmap condicionado, sem reiniciar o plano atual

- **A — Consolidar e validar:** concluir B8 e seus gates; manter B7 oficial e B10 fiscal como frentes comerciais com dependências externas; puxar recorte mínimo de B13 (importação revisada, checklist de virada/rollback, treinamento e primeiro pico) e B12 (contingência demonstrável) para habilitar pilotos. B11 Onda 2 e B0 seguem conforme limites/risco medidos. Não bloquear primeiros pilotos seguros aguardando 100% de todos os blocos.
- **B — Diferenciação comprovada:** motor de margem com alertas acionáveis, previsão de compras baseada em histórico sazonal, KDS por praças, CRM autorizado, agente de pedidos opcional. Começar por média sazonal/mesmo dia da semana, regras explicáveis e revisão humana; comparar erro (MAE/WAPE quando definido), desperdício medido, ruptura, custo e margem. LSTM/RL só se superarem alternativas simples em validação fora da amostra e piloto econômico. Preços sugeridos, nunca alterar automaticamente sem decisão específica, limites e trilha. Para agente: interpretar áudio/texto como intenção não confiável, validar produto/modificadores, preço, disponibilidade, endereço, taxa e capacidade no núcleo canônico; confirmação humana do resumo e valor, pagamento por fluxo autorizado, idempotência, transferência ao atendimento. Usar documentação vigente [WhatsApp Business Messaging Policy](https://whatsappbusiness.com/policy/) e [ANPD legítimo interesse](https://www.gov.br/anpd/pt-br/assuntos/noticias/anpd-lanca-guia-orientativo-sobre-legitimo-interesse); não contornar restrições por automação não oficial.
- **C — Opções de longo prazo:** contratos de integração legíveis por máquina, descoberta e reserva temporária com expiração, APIs/módulos MCP/ACP/UCP/Beckn somente para canal com demanda comprovada; escopos, autenticação, consentimento do comprador, autorização de pagamento, revalidação de preços/capacidade, quotas, isolamento, proteção contra prompt injection e rollback. Não expor MCP nativo por tenant ou transferir autoridade de pedidos ao agente por antecipação. Internacionalização progressiva após validação local; currency/timezone/locale e fiscal como limites de módulo, sem refatoração global preventiva. IoT e visão computacional somente mediante custo, instalação, precisão, manutenção, segurança e privacidade aceitáveis. Bolsa de capacidade, leilão multi-frota e compras coletivas B2B somente com densidade local comprovada, parceiros, governança de qualidade/entrega e modelo econômico; não prometer rede que ainda não existe.
- **Receitas futuras são opções, não política:** preservar zero comissão KÔMA, preços e Founders do `product-contract.json` vigente. Take rate de 0,65%, taxa de 3,5%, rebate 2–5%, 12%/88% da receita e crédito em 1 clique são hipóteses não validadas, em parte conflitantes com posicionamento atual. Não alterar contrato, lançar crédito, reter dinheiro de terceiros ou cobrar taxa sem autorização. Estudar separadamente unit economics, risco/chargeback/inadimplência, conflitos de interesse, responsabilidade, parceiros e regulação. [BCB/CMN Resolução Conjunta 16/2025 — BaaS](https://www.bcb.gov.br/estabilidadefinanceira/exibenormativo?numero=16&tipo=Resolu%C3%A7%C3%A3o+Conjunta): eventual embedded finance com instituição autorizada, avaliação jurídica e contrato; não inferir que dados de caixa eliminam risco de crédito. Compras coletivas precisam de consentimento comercial e transparência de rebates; manter recomendações de fornecedores imparciais.

### K.5 — Regra permanente de validação

Para cada hipótese, registrar: problema observado, segmento, baseline medido, proposta, custo (incluindo suporte), experimento, amostra/limitações, risco, resultado e decisão continuar/ajustar/descartar. Separar níveis: proposta, protótipo, implementado, integrado, publicado, testado, homologado. Resultados de simulação não são resultados de campo. Métricas sem denominador, origem ou janela não são evidência. Antes/depois não prova causalidade sem controlar sazonalidade, promoções, mix e demanda; utilizar comparação por coorte ou teste controlado quando viável. Tratar dados pessoais conforme finalidade/base legal, retenção, exportação segura e minimização. Respeitar direitos de imagens, dados e contratos. Não usar benchmarking competitivo para prometer resultados não observados.

**Princípio de continuidade:** terminar o escopo aprovado de cada bloco com critérios de aceite e manutenção sustentável; preservar ideias de longo prazo no backlog sem aumentar indefinidamente os requisitos para fechar uma missão. Novos recursos só entram no denominador mediante versão formal aprovada, evidência e prioridade. O produto deve ser útil hoje e evoluível amanhã, não uma plataforma supostamente perfeita daqui a dez anos.
