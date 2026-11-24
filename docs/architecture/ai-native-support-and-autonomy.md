# Arquitetura de Suporte e Operações AI-Native (Solopreneur SaaS)

Este documento define a arquitetura de evolução do KÔMA para reduzir drasticamente o tempo de detecção, triagem, orientação e correção de incidentes mantendo custo próximo do piso operacional e isolamento rígido multi-tenant.

## 1. Roadmap de Autonomia (Níveis 1 a 6)

| Nível | Capacidade | Estado no KÔMA | Controle humano |
| --- | --- | --- | --- |
| **1 — Diagnóstico rastreável** | `support_code` em erros, ring-buffer escopado por sessão/tenant e correlação via `npm run ops:trace` | Implementado em `main` | Humano executa triagem e envia resposta |
| **2 — Auto-atendimento contextual** | Deep links seguros (`/?go=<id>`) com whitelist canônica, diagnóstico self-service (`GET /api/support/diagnostics`), contexto técnico no `CustomerSupportWidget` e respostas rápidas WhatsApp | Implementado (PRs #1485 e #1486) | Humano escolhe o link ou aprova ação |
| **3 — Triagem automatizada + memória** | `npm run ops:triage --json` com schema `"1.0"`, exposição de `db_pool` no `ops:doctor` e `docs/operations/incident-memory/index.json` | Implementado (PR atual) | Somente leitura; zero mutação em produção |
| **4 — Homologação isolada antes do contrato** | `operational-qa` isolado por `qa_token` (SHA-256 + `Cache-Control: private, no-store`), blindagem total em `Comanda.onboarding_test=True` e transição atômica no aceite contratual | Implementado (PR #1490) | Ativação explícita via Super Admin / `ops:onboarding` |
| **5 — Vigilância ativa 24h orientada a eventos** | Monitor edge Cloudflare Workers Free (`*/5 * * * *`) com reteste de 15 s e cooldown Telegram + backup GitHub Actions | Código pronto (`ops/availability-worker`); deploy manual em 2 passos | Dispara alerta apenas em `DOWN`/`DEGRADED`/`RECOVERED` real |
| **6 — Remediação assistida por agente 24h** | Agente dispara somente em incidente confirmado, executa `ops:triage --json`, reproduz em worktree isolado, roda `npm run focus:check` e abre PR pequeno | Próxima fase (requer gatilho e política de aprovação) | Merge, migração perigosa, billing e ID 6 exigem aprovação humana explícita |

## 2. Matriz de Segurança e Anti-Prompt-Injection

| Superfície / Risco | Vetor de ataque | Mitigação obrigatória no KÔMA |
| --- | --- | --- |
| **Texto livre do cliente e parâmetros de busca** | Prompt injection no campo de feedback do suporte ou no `--symptom` repassado a um LLM | Payload delimitado como dado não confiável no alerta Telegram e encapsulado em `{ "untrusted": true, "value": ... }` pelo `ops:triage` |
| **Logs estruturados e respostas HTTP externas** | Cabeçalhos/URLs maliciosas capturadas em traceback ou `/meta.json` | `parseTraceLines` filtra eventos e `buildTriageReport` encapsula `path`, `exception_type`, `commit`, `error` e `instance` com `wrapUntrusted` |
| **Deep linking (`/?go=<id>`)** | Injeção de XSS, open redirect, parâmetros arbitrários ou disparo de ação mutante (`vendas_novo_pedido`) via URL | Whitelist estrita derivada de `CASHIER_SIDEBAR_GROUPS` (`cashierDeepLink.ts`) com exclusão explícita de `action: true`; autorização permanece no backend/tenant |
| **Cardápio em QA (`?qa_token=`)** | Vazamento do cardápio em preparação para público/bots, caching de CDN ou poluição financeira/estoque/fiscal | Token validado por `hmac.compare_digest(sha256)`, `Cache-Control: private, no-store`, checkout online bloqueado (`409`), `Comanda.onboarding_test=True` blindada em CRM, estoque, fidelidade, conciliação e SEFAZ |
| **Tenant ID 6 e banco de produção** | Mutação destrutiva automática durante investigação de agente | Ferramentas `ops:triage`, `ops:doctor` e `ops:trace` são **estritamente read-only**; testes de carga e QA usam fixtures isoladas ou QA token dedicado |

## 3. Análise MCP vs. CLI para Operação AI-Native

- **Quando usar CLI versionado (`ops:triage`, `ops:doctor`, `ops:trace`, `ops:onboarding`)**:
  - Contrato fechado em código e coberto por testes unitários (`tests/opsTriage.test.ts`, `tests/ops-observability.test.ts`).
  - Overhead de contexto mínimo: em vez de carregar dezenas de schemas MCP mutáveis em cada turno do agente, o agente executa um comando único (`npm run ops:triage -- --support-code <id> --json`) e recebe um JSON compacto com saúde ao vivo, pool de banco, trace e playbooks aplicáveis.
  - Segurança por construção: `ops:triage` e `ops:doctor` não possuem rota de escrita; mesmo com Railway CLI autenticado, executam apenas `railway logs` read-only.
- **Quando manter MCP**:
  - Inspeções pontuais e exploratórias que não justificam script fixo (ex.: inspeção read-only em Supabase, GitHub PRs ou DevTools em navegador local), sempre mantendo separação estrita entre leitura e aprovação humana para escrita.

## 4. Modelo de Custo 24/7 Orientado a Eventos (Frugalidade)

De acordo com o baseline de [`infra-frugal-capacity.md`](../engineering/infra-frugal-capacity.md):

| Componente | Modelo | Custo mensal estimado |
| --- | --- | --- |
| **Backend API + Print Queue** | Railway Hobby (1 réplica compartilhada, `DB_POOL_SIZE=4`, `DB_MAX_OVERFLOW=0`) | Piso US\$ 5/mês (incluído no plano Hobby) |
| **Frontend estático (`app` / `central`)** | Cloudflare Pages | US\$ 0 |
| **Monitor 5 em 5 min (`ops/availability-worker`)** | Cloudflare Workers Free Tier (~8.640 execuções cron/mês vs 100.000/dia grátis) + Telegram Bot API | US\$ 0 |
| **Monitor backup (`external-availability-monitor.yml`)** | GitHub Actions agendado a cada 30 min | US\$ 0 (cota gratuita pública/padrão) |
| **Agente de engenharia/triagem** | **Orientado a eventos** (acionado apenas em incidente/ticket real ou sob demanda, nunca polling LLM 24/7) | Variável proporcional apenas a incidentes reais |
| **Railway Agent autônomo** | Mantido com limite **US\$ 0** salvo autorização explícita | US\$ 0 |
