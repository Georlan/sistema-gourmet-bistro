# KÔMA — Homologação Final do Bloco B2 (Eficiência, Performance, Capacidade e Escalabilidade)

**Data:** 2026-11-18  
**Base integrada (`main`):** `e075f3705e321ee9261b14133b8b7744daed7c47` (+ PR `#1383`)  
**Veredito:** **B2 — HOMOLOGADO COM RESSALVAS** (requisitos essenciais integrados, CI verde e produção validada; limites conhecidos de capacidade local e economia financeira direta não medida permanecem documentados)

---

## 1. Objetivos do B2
- Reduzir consumo ocioso de requisições HTTP e consultas ao banco pelos Print Agents (Desktop e Android).
- Consolidar conexões permanentes `PostgreSQL LISTEN` para proteger o limite observado do Supavisor Session Mode (`pool_size=15`).
- Reduzir trabalho SQL por pedido e consulta de status sem comprometer integridade financeira, estoque, multi-tenancy/RLS ou idempotência.
- Proteger filas em memória e shutdown contra sobrecarga no transporte realtime do chat.
- Validar capacidade com 10 restaurantes sob o orçamento real de pool ORM (`DB_POOL_SIZE=4`, `DB_MAX_OVERFLOW=0`).

---

## 2. Entregas Integradas (`main`)

| PR | Escopo | Status | Merge SHA |
|---|---|---|---|
| `#1371` | Polling adaptativo dos Print Agents (Desktop e Android) | Mergeado | `72064065d8a972aed713140aa7638aa212e01061` |
| `#1373` | Multiplexação dos 3 canais `LISTEN` em 1 conexão/processo (`PostgresListenMultiplexer`) | Mergeado | `57d29c1e3990b3ca1a265ed5e003c358f4081f9a` |
| `#1378` | Redução de consultas no checkout/status + isolamento de reidratação lenta do chat | Mergeado | `c98896a5af85d3e8f332b04f562f4a664407eadf` |
| `#1381` | Fila FIFO limitada (`maxsize=256`), coalescência por `(restaurante_id, conversation_id)` e shutdown limitado (`2.0s`) no `OrderChatHub` | Mergeado | `12d21d4fd3aa73a293924a321fa30063ff2eb71d` |
| `#1382` | Eliminação de leituras N+1 em `consumir_estoque_dos_itens` e `_to_order_dto` + benchmark PG17 | Mergeado | `ec3f5e6ca8c1456faa6aa8d8ce8c371d57a15f68` |
| `#1401` | Alinhamento do teste `test_orders_kanban_keeps_every_real_stage_side_by_side_on_desktop` às 3 filas por modalidade (recuperação do `Full backend pytest`) | Mergeado | `e075f3705e321ee9261b14133b8b7744daed7c47` |
| `#1383` | Benchmark realista 10 restaurantes (`pool_size=4, max_overflow=0`), reuso de lookups na `Session` e este documento | Integração final | (SHA registrado no merge do `#1383`) |

---

## 3. Métricas Comprovadas (Antes / Depois)

### Consultas SQL por operação (5 itens distintos)
- **`GET /cardapio/pedidos/{comanda_id}/status`:**
  - Antes (`#1378`): `10` SELECTs (`p50=11.07–13.41 ms`, `p95=11.95–15.65 ms`).
  - Depois: **`5` SELECTs** (`-50%`, O(1) independente do número de itens; `p50=8.78–10.16 ms`, `p95=9.92–12.7 ms`).
- **`POST /cardapio/pedidos` (SQLite, 5 itens):**
  - Antes (`#1378`): `44` SELECTs / `58` queries totais.
  - Depois (`#1382`): **`31` SELECTs / `45` queries totais** (`-13` SELECTs).
- **`POST /cardapio/pedidos` (PostgreSQL 17 real, 5 itens simples):**
  - Antes (`#1382`): `50` SELECTs / `64` operações totais.
  - Depois (`#1382`): **`39` SELECTs / `53` operações totais** (`-11` SELECTs / `-22%`).
- **`POST /cardapio/pedidos` (PostgreSQL 17 real, 2 itens + modificador, `#1383`):**
  - `31` SELECTs / `45` operações totais (`single_order_tx_ms=96.72 ms`); `GET /api/cardapio-digital/public` em `15` queries.

### Multiplexação `LISTEN` e Backpressure do Chat
- **Conexões `LISTEN` por processo:** de `3` sessões para **`1` sessão** (`PostgresListenMultiplexer`, `p50=1.56 ms`, `p95=2.43 ms`, recovery `120.9 ms`).
- **Não-bloqueio (`test_listen_nonblocking_postgres.py`):** entrega de `koma_print_jobs` e `koma_operational_realtime` em **`0.19 ms`** durante stall simulado de `350 ms` no chat.
- **Sobrecarga no chat (`test_order_chat_queue_backpressure.py`):** burst de `121` notificações com `max_notify_queue_size=8` → fila máxima `8`, `40` eventos coalescidos, `72` `refresh` diretos emitidos via SSE, `stop(timeout=0.3)` concluído em **`0.24 ms`**.

---

## 4. Capacidade Realista Demonstrada em Laboratório (10 Restaurantes, Pool `4/0`, PG17 Local)

Ambiente: container descartável `postgres:17` em `127.0.0.1:55434`, `DB_POOL_SIZE=4`, `DB_MAX_OVERFLOW=0`, `PostgresListenMultiplexer` ativo (1 conexão `LISTEN`), 10 tenants isolados (`1001..1010`), carga mista descorrelacionada (`30%` cardápio, `40%` criação de pedido com modificador, `20%` status, `10%` `accept_order` concorrente).

| Clientes concorrentes | Erros | Throughput | `p50` | `p95` |
|---:|---:|---:|---:|---:|
| `1` | `0` | `24.85 req/s` | `39.99 ms` | `39.99 ms` |
| `10` | `0` | `15.62 req/s` | `521.90 ms` | `616.12 ms` |
| `25` | `0` | `14.91 req/s` | `939.88 ms` | `1614.50 ms` |
| `50` | `0` | `15.42 req/s` | `1730.15 ms` | `3022.41 ms` |

- **Pico de conexões ORM ocupadas:** `4` (`pg_stat_activity_conns = 5`, sendo 4 ORM + 1 `LISTEN`).
- **Espera pelo pool ORM:** `p50 = 0.01 ms`, `p95 = 1647.23 ms`, `max = 2700.35 ms`.
- **Recursos do processo de teste:** `cpu_s = 6.872 s`, `max_rss_mb = 212.54 MB`.
- **Eventos entregues via `LISTEN`:** `print_events_received = 8`, `chat_queue_len = 0`.
- **Invariantes validados:** isolamento cross-tenant (`404`), idempotência sob concorrência (`5` replays → `1` `comanda_id`), integridade exata de estoque nos 10 tenants após aceites concorrentes, recuperação `200 OK` após `pg_engine.dispose()`.

### O que está comprovado vs. ainda não comprovado
- **Comprovado em laboratório (PG17 local):** 1 processo com pool `4/0` + `1` `LISTEN` atende 10 tenants e até 50 clientes simultâneos com `0` erros e `~15.4 req/s` sob carga mista real, usando apenas `5` conexões PG (`10` durante overlap de deploy de 2 instâncias, abaixo do teto histórico de `15` do Supavisor Session Mode).
- **Ainda não comprovado:** impacto de RTT real até a região remota do Supabase/Supavisor, comportamento de Transaction Mode vs. Session Mode sob múltiplos workers Gunicorn/Uvicorn simultâneos, e comportamento acima de 50 clientes simultâneos (onde a fila do pool `4/0` já eleva `p95` para `~3.02 s`).

---

## 5. Eficiência Comprovada vs. Economia Financeira
- **Linha de base observável:** Railway serviço `Kôma` (`numReplicas: 1`, região `sfo`, meta Hobby US$ 5/mês) + Supabase plano Free + frontend estático em Cloudflare Pages.
- **Eficiência comprovada:** redução de conexões permanentes `LISTEN` (`3 → 1`), redução de queries SQL no checkout (`-22%` em PG17) e status (`-50%`), polling adaptativo de Print Agents e fila de chat limitada em memória.
- **Economia financeira direta:** **não medida** neste ciclo (sem série histórica comparável suficiente para atribuir redução direta em dólares por restaurante).
- **Critérios objetivos para considerar upgrade (Railway / Supabase):**
  1. Saturação persistente do pool `4/0` (`pool_wait_p95 > 1.5 s` sustentado em produção) ou erros `QueuePool limit` / `5xx`.
  2. Aproximação recorrente do teto de sessões do Supavisor (`>= 12/15` sessões ativas).
  3. Esgotamento de quotas de banco/egress no Supabase ou CPU/RAM no Railway com impacto em latência.

---

## 6. Gates, Segurança e Riscos Residuais
- **Gates resolvidos:** `frontend-dependency-security` (`picomatch` `GHSA-fc5q-39xc-vjpf`) verde na `main` e no `#1383`; `Full backend pytest` recuperado via PR `#1401` (`e075f370`).
- **Risco residual (Médio) — Fila do pool `4/0` em picos > 25–50 clientes simultâneos:** `pool_wait_p95` atinge `~1.65 s` e `p95` total `~3.02 s` com `50` clientes concorrentes em PG17 local devido à duração transacional do `POST /cardapio/pedidos` (`~96.7 ms` isolado).
- **Fora do escopo B2 (rastreados no B0):** pendências de faturamento Railway e autenticação do monitor de backup permanecem no B0.
