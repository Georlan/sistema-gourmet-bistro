# OPERAÇÃO KÔMA — B11: Scale & Efficiency Engine (1 → 10 → 100 restaurantes)

**Data de consolidação:** 24/11/2026  
**Baseline auditado:** `origin/main` `96d3729f` (22/11/2026) → atualizado sobre `dbfd8183`..`41ca6ba3` (24/11/2026)  
**Escopo:** Engenharia de escalabilidade, eficiência operacional sem regressão, PostgreSQL 17, runtime FastAPI/Railway, frontend/Cloudflare Pages, CI/CD e modelagem FinOps para 1, 10 e 100 restaurantes.

---

## Seção A — Mapa Real da Arquitetura e Dependências

| Camada / Serviço | Tecnologia / Fornecedor | Estado observado (produção read-only) | Papel no sistema |
|---|---|---|---|
| **API Backend** | FastAPI / Uvicorn / SQLAlchemy (`Railway`, proj. `passionate-truth`) | 1 réplica em `sfo` (`/backend`), `DB_POOL_SIZE=4`, `DB_MAX_OVERFLOW=0`, ~0,0077 vCPU médio, 226 MB RAM méd. (pico 463 MB / 1h-max 901 MB) | Fonte autoritativa de pedidos, estoque, pagamentos, impressão, auth, SSE/WS |
| **Banco Autoritativo** | PostgreSQL 17 gerenciado (`Supabase`) | Supavisor Session Mode (limite histórico observado de 15 sessões); RLS multitenant em todas as tabelas de negócio | Persistência ACID, RLS, `LISTEN/NOTIFY` via conexão dedicada |
| **Frontend & Edge** | React + Vite + TypeScript (`Cloudflare Pages`: `sistema-gourmet-bistro`, zona `komafood.com.br` Free) | Assets `/assets/*` com `max-age=31536000, immutable`; Workers `koma-edge-router` e `nexo-relay` | Cardápio Universal V2, Caixa/Kanban, Garçom, Super Admin |
| **Serviços Auxiliares Railway** | `evolution-api` (~232 MB RAM), `Postgres` (~81 MB RAM), `Redis 8.2.9` (~20 MB RAM), `Postgres S3 Backup` (cron `0 3 * * *` → `t3.storageapi.dev`, `2,57 MB` em 22/11), `pre-purge-backup-20260916` (ocioso) | Projeto paralelo `radiant-encouragement` possui `memory` (~18 MB RAM) | WhatsApp (Evolution + Postgres/Redis próprios), backup diário S3 |
| **Observabilidade** | PostHog (`648305`), logs estruturados Railway, `/health` (`db_pool` + `websocket`) | `catalog_load_ms` 14d: `p50=1204ms`, `p95=2070,5ms` (675 amostras) | Telemetria de produto, Web Vitals e diagnóstico de pool |
| **CI/CD & Segurança** | GitHub Actions (repositório público), ruleset `Protect main branch` (`23316793`) | Único check obrigatório: `Merge verdict`; `strict_required_status_checks_policy: false`, `allow_auto_merge: true` | Gates orientados a impacto (`quality-gate`, `postgres-critical-boundaries`, `browser-targeted-gate`, `print-agent`, `backend-dependency-health`) |

---

## Seção B — Gargalos e Desperdícios Diagnosticados (Evidência Raiz)

1. **Self-deadlock de 4 vias no `QueuePool` (`DB_POOL_SIZE=4, DB_MAX_OVERFLOW=0`)**:
   - `PUT /comandas/kds/itens/prontos` (`orders_core.py`), `POST /cardapio/modificadores/venda-direta` (`pos_adapter.py`) e `POST /cardapio/pedidos` (`web_adapter.py`) executavam `db.refresh(...)` pós-commit (reabrindo transação na conexão da requisição) e em seguida rodavam `BackgroundTasks(manager.broadcast)` → `OperationalRealtimeBus.publish()` → `engine.begin()` (pedindo uma **2ª conexão simultânea** antes de `get_db()` fechar a 1ª). Com 4 chamadas concorrentes, o pool travava por 15–30s (`TimeoutError`, HTTP 500).
   - No benchmark `BEFORE` (`96d3729f`), o burst de 16 chamadas KDS resultou em **12/16 falhas HTTP 500 (75% erro)** e o estágio de 100 restaurantes sofreu **62,8%–63,3% de falhas HTTP 500**.
2. **Starvation de `db.close()` sob alta concorrência (>40 requests)**:
   - Executar `db.close()` dentro do threadpool compartilhado do AnyIO (`run_in_threadpool`) cria deadlock quando 40 requests síncronos aguardam conexão do pool enquanto o `close()` aguarda uma thread livre; resolvido com executor dedicado `_DB_CLOSE_EXECUTOR` (`ThreadPoolExecutor(max_workers=4)`).
3. **Overhead ocioso e conexões retidas**:
   - `_add_tenant_id_filtering_criteria` varria ~124 mappers por SELECT ORM; `DB_PRE_PING_FRESH_SECONDS=5s` forçava `SELECT 1` em quase todo polling; `PostgresListenMultiplexer` sem TCP keepalives sofria quedas NAT/Supavisor em 347–900s; `signup_notifications` limitava backoff em 30s; `reconciliation_worker` sem backoff ocioso; `MercadoPagoProvider`/`PagBankProvider` não fechavam `httpx.Client`; `reconcile_provider_payment` e `fiscal/reference_watch_runner` retinham conexão DB durante HTTP externo; `_websocket_connections_count()` contava buckets (`2` por tenant) em vez de sockets reais.
4. **Hot-paths SQL, Print Agents, CRM e Relatórios**:
   - `print_agents.py`: `claim-batch` ocioso executava `_coalesce_pending_reprints` e `_can_agent_claim_generic_jobs` sem checar se havia job pendente; `complete-batch` no-op executava `db.commit()` + broadcast a cada ~61s; tokens 401 em cache ainda abriam sessão DB.
   - `orders_core.py`: `joinedload(Comanda.itens)` cartesiano em `/detalhes/todos` e `/delivery/ativos`; `_advance_kds_check_if_all_ready` omitia `locked_comanda=comanda`.
   - `online_order_control.py`: `GET /control` dava `db.commit()` incondicional; `smartpos_cash_projection.py`: N+1 em `comanda.itens`; `customer_crm.py`: `sa_inspect().get_table_names()` por request e filtro `criado_em` em Python; `financial_product_routes.py`: carregava todos os `Item` em Python em vez de `SQL GROUP BY`; `cardapio_digital.py`: sem `ETag`/`304`.
5. **PostgreSQL 17 (RLS & Índices)**:
   - 6 policies RLS ainda reavaliavam `current_setting()` por linha (sem InitPlan); `produto_familias` e `produto_familia_grupo_modificadores` sem `FORCE RLS`; 3 índices duplicados (`ix_contract_invites_token_hash`, `ix_contract_invites_restaurante_id`, `ix_cardapios_tenant`); ausência de índice em `print_agent_tokens(token_hash)` (Seq Scan em cada auth de agente) e 4 índices parciais/compostos de hot-path.
6. **Frontend & Cloudflare Pages**:
   - Thundering herd no Caixa (`motoboysLoadState !== 'loaded'`, `inFlight.clear()`, `koma_team_updated`/`koma_reports_updated` no primeiro `onopen`), `/acompanhar/.../summary` duplicado no evento SSE `"connected"` inicial, 162 chunks JS (96 micro-chunks `< 2KB`), upload de promoções sem `prepareImageUpload`, e ausência de `Cache-Control` explícito em `/brand/*`, `/cardapio/*`, `/acompanhar/*`.
   - Nota: melhorias complementares de renderização/memoização/fontes/WS do Cardápio V2 também foram integradas em paralelo nos PRs `#1468`, `#1469`, `#1470`, `#1471`, `#1472`, `#1474` e `#1482`, reconciliadas sem conflito com a série B11.
7. **CI/CD**:
   - Playwright gravava `video` e `trace` em todos os testes passando (`retain-on-failure`); 2 testes de CEP pulados por mirar `desktop-1024`; `src/domain/modifierConsumption.test.ts` fora de `npm run test:unit`; `schedule-gate` pulava auditorias semanais `npm audit`/`pip-audit` em semanas sem commits; `change-governance.md` desatualizado quanto ao ruleset.

---

## Seção C — Melhorias Implementadas e Integradas na `main`

| PR | Branch / Título | Merge SHA | Escopo entregue |
|---|---|---|---|
| **PR 1 (`#1475`)** | `perf/b11-db-pool-idle-and-realtime` | `06fa29b5` | Cache de mappers tenant-scoped, `DB_PRE_PING_FRESH_SECONDS=30s`, cache CORS dinâmico, TCP keepalives no `PostgresListenMultiplexer`, backoff `300s` em `signup_notifications`, `SESSION_REVALIDATION_SECONDS=180s`, contagem real de sockets WS, `close()` em MP/PagBank, liberação de transação PG antes de HTTP em `reconcile_provider_payment` e `reference_watch_runner`, backoff ocioso `20s→120s` em `reconciliation_worker`. |
| **PR 2 (`#1478`)** | `perf/b11-hotpaths-print-and-queries` | `5954b137` | Executor dedicado `_DB_CLOSE_EXECUTOR` em `database.py`; cura do self-deadlock (`queue_committed_broadcast` antes do commit e remoção de `db.refresh` pós-commit em `orders_core.py`, `pos_adapter.py`, `web_adapter.py`); `selectinload` em `/detalhes/todos`, `/delivery/ativos` e `smartpos_cash_projection.py`; fast-paths de `print_agents.py` (pré-filtro async de 401, check `pending` antes de coalesce, 0-commit em `complete-batch` no-op); 0-commit em `GET /online-orders/control`; skip `SELECT` de UUIDv4 novo no outbox; cache `crm_schema_available` + filtro SQL `criado_em`; `SQL GROUP BY` em `/relatorios/produtos`; `ETag` fraco + `304` + `Cache-Control` em `GET /api/cardapio-digital/public`. |
| **PR 3 (`#1479`)** | `perf/b11-postgres-rls-initplan-and-indexes` | `04f0b0ce` | Migração Alembic `20261124b11a` (`SET LOCAL lock_timeout = '5s'`, `downgrade()` completo): 6 policies RLS normalizadas para InitPlan (`0` restantes no schema `public`), `FORCE RLS` + `REVOKE` em `produto_familias` e `produto_familia_grupo_modificadores`, remoção de 3 índices duplicados, criação de 5 índices de hot-path (`ix_print_agent_tokens_token_hash`, `ix_comandas_tenant_open_delivery_status`, `ix_online_payment_intents_reconcile_due`, `ix_crm_contatos_tenant_criado`, `ix_image_retirement_pending_due`), import lazy de `app.crypt` em `u1e2f3a4b5c6` e cache CRM restrito ao dialeto PostgreSQL. |
| **PR 4 (`#1480`)** | `perf/b11-frontend-thundering-herd-and-v2` | `41ca6ba3` | Correção `motoboysLoadState === 'idle'`, preservação de deduplicação `inFlight` em `onlineOrdersControlClient`, `koma_team_updated`/`koma_reports_updated` apenas em reconexão, guard contra SSE `"connected"` inicial duplicado em `CardapioOrdersDrawer`/`CardapioOrderChatPanel`, `manualChunks` (`vendor-icons` 81 KB + `vendor-react` 190 KB), redução de cards `priority` em `MenuV2Experience`, `prepareImageUpload` em `PromotionsSettings`, headers `/brand/*`, `/cardapio/*` e `/acompanhar/*`. |
| **PR 5 (`#1481`)** | `ci/b11-ci-speed-and-coverage-hardening` | `2ffcfd58` | `trace`/`video: 'on-first-retry'` no Playwright, alinhamento CEP `desktop-1024 → desktop-1366`, inclusão de `src/domain/*.test.ts` em `test:unit`, remoção de `schedule-gate` em `backend-dependency-health.yml`, atualização de `docs/engineering/change-governance.md`. |
| **PR 6** | `docs/b11-scale-benchmarks-and-finops-engine` | *(este PR)* | Versionamento de `backend/scripts/benchmark_b11_scale_1_10_100.py`, teste PG17 `backend/tests/test_b11_scale_1_10_100_pg17.py`, este relatório técnico e referência em `docs/engineering/infra-frugal-capacity.md`. |

---

## Seção D — Evidência Reproduzível: BEFORE vs AFTER (PostgreSQL 17 Real)

Ambiente idêntico: Docker `postgres:17-alpine`, role não-superuser `worker_test` membro de `koma_app` com RLS ativo, `DB_POOL_SIZE=4`, `DB_MAX_OVERFLOW=0`, `DB_POOL_TIMEOUT=15s`, 100 tenants populados (`2001..2100`), Uvicorn 1 worker.

### 1. Cenário `RTT = 0ms` (Banco mesma região / CPU + Pool + SQL)

| Cenário | BEFORE (`96d3729f`) | AFTER (PRs 1–3) | Delta |
|---|---|---|---|
| **Burst KDS 16× concorrente** | `4/16` OK, **12× HTTP 500**, `p50=15201ms`, `p95=15289ms`, `timeouts=12` | **`16/16` OK, 0× HTTP 500**, `p50=1155ms`, `p95=1620ms`, `timeouts=0` | **-100% erros, -92,4% p50** |
| **Estágio A — 1 rest. (`conc=8`)** | `24/24` OK, `17,30 rps`, `p95=750ms`, `timeouts=1` | `24/24` OK, **`24,55 rps`**, `p95=530ms`, `timeouts=0` | **+41,9% RPS, -29,4% p95** |
| **Estágio B — 10 rests. (`conc=24`)** | `48/60` OK, **12× HTTP 500**, `3,46 rps`, `p95=16035ms`, `timeouts=15` | **`60/60` OK, 0× HTTP 500**, **`24,82 rps`**, `p95=1253ms`, `timeouts=0` | **7,2× RPS, -92,2% p95** |
| **Estágio C — 100 rests. (`conc=50`)** | `67/180` OK, **113× HTTP 500**, `2,37 rps`, `p95=30322ms`, `timeouts=131` | **`180/180` OK, 0× HTTP 500**, **`22,27 rps`**, `p95=3230ms`, `timeouts=0` | **9,4× RPS, -89,3% p95** |
| **Saúde global do Pool (`/health`)** | `wait_timeouts=162`, `slow_holds=18`, `hold_max=43971ms` | **`wait_timeouts=0`, `slow_holds=0`, `hold_max=466,6ms`** | **-100% timeouts, -98,9% hold max** |

### 2. Cenário `RTT = 25ms` (Simulação cross-region Railway SFO ↔ Supabase)

| Cenário | BEFORE (`96d3729f`) | AFTER (PRs 1–3) | Delta |
|---|---|---|---|
| **Burst KDS 16× concorrente** | `4/16` OK, **12× HTTP 500**, `p50=15182ms`, `timeouts=12` | **`16/16` OK, 0× HTTP 500**, `p50=3442ms`, `p95=5443ms`, `timeouts=0` | **-100% erros, -77,3% p50** |
| **Estágio A — 1 rest. (`conc=8`)** | `24/24` OK, `4,09 rps`, `p50=1537ms`, `timeouts=2` | `24/24` OK, **`5,35 rps`**, `p50=622ms`, `timeouts=0` | **+30,8% RPS, -59,5% p50** |
| **Estágio B — 10 rests. (`conc=24`)** | `29/60` OK, **31× HTTP 500 (51,7% erro)**, `1,87 rps`, `p50=15006ms`, `p95=17084ms`, `timeouts=36` | **`60/60` OK, 0× HTTP 500**, **`7,49 rps`**, `p50=2039ms`, `p95=4490ms`, `timeouts=0` | **4,0× RPS, -86,4% p50, -100% erros** |
| **Estágio C — 100 rests. (`conc=50`)** | `66/180` OK, **114× HTTP 500 (63,3% erro)**, `2,32 rps`, `p95=32625ms`, `timeouts=128` | `131/180` OK, `49× HTTP 500`, `3,06 rps`, `p95=25218ms`, `timeouts=52` | **-57% erros; evidencia teto matemático de RTT=25ms com pool=4** |

### 3. Endpoints isolados & Bundle Frontend

- **Backend (isolados, PG17)**:
  - `PUT /comandas/kds/itens/prontos`: `49 → 44` SQL, `4 → 1` commits, `185ms → 119ms` (`RTT=0ms`).
  - `POST /api/print-agents/jobs/complete-batch` (no-op): `2 → 0` commits, `0` broadcasts.
  - `POST /api/print-agents/jobs/claim-batch` (idle): `4 → 3` SQL, `0` commits, sem scan de reimpressão.
  - `GET /relatorios/produtos`: `1 → 0` commits, agregação por `SQL GROUP BY`.
  - `POST /api/print-agents/heartbeat` (steady, `RTT=25ms`): `308,6ms → 177,5ms` (-42,5%).
  - `GET /api/cardapio-digital/public`: `ETag` fraco + `304 Not Modified` + `Cache-Control: public, max-age=15, stale-while-revalidate=60`.
- **Frontend (`npm run build`)**:
  - Chunks JS totais: **162 → 88 (-45,7%)**.
  - Micro-chunks JS `< 2KB`: **96 → 22 (-77,1%)**.
  - `vendor-icons` consolidado em 1 chunk cacheável (`81 KB` raw) e `vendor-react` (`190 KB` raw).

---

## Seção E — Modelagem de Carga e Capacidade (1 / 10 / 100 Restaurantes)

| Dimensão operacional | Estágio A (1 rest.) | Estágio B (10 rests.) | Estágio C (100 rests.) |
|---|---|---|---|
| Restaurantes cadastrados / ativos no pico | 1 / 1 | 10 / 7–10 | 100 / 60–80 simultâneos |
| Operadores simultâneos (Caixa + Garçom + KDS) | 2–4 | 20–35 | 180–300 |
| Consumidores navegando no Cardápio V2 | 5–20 | 50–180 | 500–1.500 |
| Pedidos/min no pico (sexta/sábado 20h) | 0,5–2 | 5–15 | 40–100 |
| Conexões WebSocket + SSE ativas | 2–5 | 25–45 | 220–400 |
| Print Agents ativos | 1 | 8–10 | 70–100 |
| Conexões PG necessárias (ORM + 1 LISTEN mux) | 4 + 1 = 5 | 4 + 1 = 5 | 8–12 (Transaction Mode) + 1 LISTEN Session |
| **Viabilidade na infra atual (`pool=4, RTT=25ms`)** | **Aprovado com folga (0% erro)** | **Aprovado (0% erro, 7,5 rps)** | **Exige gatilho de colocalização de região (RTT≤5ms) ou Supavisor Transaction Mode + `pool=8–12`** |

---

## Seção F — Modelagem FinOps 2026 e Custo Marginal por Restaurante

| Fornecedor / Item | Estágio A (1 rest.) | Estágio B (10 rests.) | Estágio C (100 rests.) | Observação de custo |
|---|---|---|---|---|
| **Railway (`Kôma` API + auxiliares)** | **US\$ 5/mês** (Hobby) | **US\$ 5–12/mês** (Hobby / uso medido) | **US\$ 20–45/mês** (Pro + 1–2 réplicas) | Manter Railway Agent com orçamento zero; eliminar serviços ociosos reduz baseline de RAM |
| **Supabase (PostgreSQL + Storage)** | **US\$ 0/mês** (Free, 500 MB DB / 1 GB Storage) | **US\$ 0–25/mês** (Pro US\$ 25 ao superar 500 MB DB ou exigir PITR/backups) | **US\$ 25–75/mês** (Pro + Compute Small/Medium + Transaction Pooler) | Upgrade para Pro é o primeiro salto estrutural recomendado a partir de ~10–15 lojas pagantes |
| **Cloudflare Pages + DNS** | **US\$ 0/mês** (Free) | **US\$ 0/mês** (Free) | **US\$ 0–20/mês** (Free/Pro) | Bandwidth estático ilimitado no Pages; micro-chunks reduzidos em 77% poupam invocações de Functions |
| **Backup S3 (`t3.storageapi.dev`)** | **< US\$ 1/mês** (`~2,6 MB` × 10 cópias) | **< US\$ 1/mês** | **US\$ 1–5/mês** | Retenção `MAX_BACKUPS=10` |
| **PostHog / GitHub Actions** | **US\$ 0/mês** (Free tier + repo público) | **US\$ 0/mês** | **US\$ 0/mês** | Repo público tem minutos ilimitados de runners padrão |
| **Total mensal estimado** | **~US\$ 5/mês** | **~US\$ 5–37/mês** | **~US\$ 46–145/mês** | |
| **Custo marginal / restaurante ativo** | **~US\$ 5,00/rest.** | **~US\$ 0,50–3,70/rest.** | **~US\$ 0,46–1,45/rest.** | Escala sublinear (custo cresce <3× enquanto receita cresce 10×) |

---

## Seção G — Matriz de Gatilhos Objetivos de Upgrade (Sem Superdimensionar)

| Métrica / Sintoma Medido | Limiar de Alerta | Ação Exata (em ordem de menor custo) |
|---|---|---|
| `/health` `db_pool.wait_ms.p95` ou `slow_waits_total` em horário de pico | `wait_ms.p95 > 500ms` por 3 janelas seguidas OU `wait_timeouts_total > 0` | 1) **Colocalizar região Railway ↔ Supabase** (corta RTT de ~25ms → ~2ms sem aumentar plano). 2) Reduzir SQLs de `OrderApplicationService.create_order` (56 → <20 queries). 3) Migrar `DATABASE_URL` para **Supavisor Transaction Mode** (mantendo `PostgresListenMultiplexer` em DSN Session dedicado) e elevar `DB_POOL_SIZE` para `8–12`. |
| Tamanho do banco Supabase / necessidade de PITR | DB > 350 MB (70% do Free 500 MB) OU ≥ 10 restaurantes pagantes ativos | Migrar Supabase Free → **Supabase Pro (US\$ 25/mês)** com PITR e 8 GB DB / 100 GB Storage. |
| RAM do serviço `Kôma` no Railway | Média sustentada > 650 MB ou pico > 85% do limite do container | Avaliar vazamento de cache/objetos antes de escalar; só então adicionar 2ª réplica (recalculando orçamento de conexões: `2 × DB_POOL_SIZE + 2 LISTEN`). |
| CPU do serviço `Kôma` no Railway | `vCPU > 0,65` sustentado em pico | Otimizar serialização/queries pesadas primeiro; depois 2ª réplica com Transaction Pooler. |
| Tráfego de fotos / egress Supabase Storage | > 70% da cota de egress | Ativar CDN/cache longo na frente de URLs públicas de fotos de catálogo/promoções. |

---

## Seção H — Status dos Blocos B0–B11 e Decisões Pendentes de Aprovação

- **B0–B2**: consolidados e preservados (pool telemetry, isolamento multitenant, Print Agents `#1082/#1083/#1084`).
- **B11 (concluído em código e banco)**: PRs `#1475`, `#1478`, `#1479`, `#1480`, `#1481` integrados na `main` + PR 6 (benchmarks, teste PG17 e documentação).

### Itens deliberadamente NÃO alterados sem aprovação explícita do proprietário:
1. **Colocalização de região Railway (`sfo`) ↔ Supabase** ou troca para **Supavisor Transaction Mode**: envolve reconfiguração de infraestrutura de produção e breve janela de troca de DSN.
2. **Serviços Railway auxiliares (`evolution-api`, `Postgres`, `Redis`, `pre-purge-backup-20260916`, `memory` em `radiant-encouragement`)**: `pre-purge-backup-20260916` está ocioso e `evolution-api` + seus bancos respondem por ~333 MB de RAM (~60% da memória do projeto); qualquer remoção/desligamento exige autorização explícita.
3. **Armazenamento de PDFs em `catalog_assistance_requests`** (até 10 MB como BLOB no PostgreSQL) e **GC automático de fotos de promoções substituídas**: requerem migração de fluxo/storage dedicada.
4. **Dependency Graph (`-c requirements.lock`)**: não renomeado para não arriscar quebra no build Railpack do Railway sem teste isolado de deploy.
5. **Redução profunda de SQLs internos em `OrderApplicationService.create_order` (56 → <20 SQLs)**: próxima onda recomendada antes de ultrapassar ~30 restaurantes simultâneos em `RTT=25ms`.
