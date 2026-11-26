---
name: koma-fast-support
description: >-
  Protocolo operacional permanente de suporte rápido e entrega em produção no KÔMA
  (Georlan/sistema-gourmet-bistro). Ative automaticamente em qualquer pedido de
  suporte, correção de bug, ajuste de botão/layout/comportamento, erro relatado
  por restaurante ou incidente em produção.
---

# KÔMA — Fast Support Protocol

Fluxo enxuto e paralelo para ir do relato do problema até a validação real em produção no menor tempo seguro, sem pular gates nem comprometer restaurantes ativos.

## 1. Classificação Automática (obrigatória antes de agir)

Classifique internamente toda solicitação pelo impacto real — sem exigir que o usuário informe o modo:

| Nível | Escopo | Diagnóstico & Validação | Alvo de ciclo |
|---|---|---|---|
| **FAST** | Textos, botões, layout, responsividade, estados visuais, bugs localizados de baixo risco | Diagnóstico focal (sem auditoria geral), reprodução visual quando UI, teste focal + `npm run focus:check`, PR pequeno, auto-merge | **5–10 min** |
| **STANDARD** | Frontend + backend, regras operacionais, pedidos, estoque, sincronização, cache, integrações | Investigação direcionada + cruzamento de serviços/logs, teste de integração focal, `focus:check`, PR, CI, merge e smoke | **10–20 min** |
| **CRITICAL** | Pagamentos, Pix, segurança, auth, multitenancy/RLS, migrations, fiscal, billing, dados de clientes | Investigação aprofundada, testes de segurança/concorrência/PG, plano de rollback explícito, aprovação quando exigida | Rigor máximo |
| **INCIDENT** | Operação parada ou degradação severa em produção (restaurante impedido de operar) | Contenção imediata, baseline de rollback (`ops:preflight`), correção mínima em worktree limpo, 1 push, auto-merge, smoke + confirmação passiva | **< 10 min** |

## 2. Matriz Real de Ferramentas (use a mais rápida e confiável)

- **GitHub (PRs, checks, runs, rulesets):** preferir `gh` CLI (mais rápido e autenticado). *Nota:* `github-mcp-server` pode estar com token expirado (`401`); não perca turnos insistindo nele.
- **Triagem & Baseline de Produção (somente leitura):**
  - `npm run ops:preflight` (< 1.5s): captura em paralelo `PREV_FRONTEND_SHA`, `PREV_API_SHA`, readiness, drift local e PRs abertos.
  - `npm run ops:triage -- --symptom "<sintoma>"` (ou `--support-code` / `--tenant`): consulta memória de incidentes e telemetria read-only.
  - `npm run ops:doctor`: saúde agregada (API, pool, frontend).
- **Backend / Logs (Railway):** `railway_mcp` (`get-logs`, `list-deployments`, `describe-service`) ou `railway` CLI. Serviço canônico: `Kôma` (`adedb907-3bee-4bca-ace7-b41910743fe2`, `watchPatterns: ["/backend/**"]`).
- **Banco (Supabase):** `supabase_mcp` (`execute_sql` **estritamente SELECT / somente leitura** para diagnóstico; nunca mutar dados de produção nem tocar tenant ID 6).
- **Frontend / Deploy (Cloudflare Pages):** `https://app.komafood.com.br/meta.json` (~30–45s após merge na `main`) e `cloudflare_cloudflare` MCP quando precisar inspecionar deploys/Workers.
- **Tela real / Reprodução Visual:**
  - Problema visual ou interação em app/tela: reproduzir **na tela real** com subagente `browser` (passando `Model: "flash"`) ou `chrome-devtools-mcp` / Playwright (`mobile-390` + `desktop-1366`). Nunca inferir UI apenas lendo código ou teste unitário.
  - Regressão automatizada reutilizável: spec Playwright em `e2e/` (`KOMA_E2E_PORT=4283 npm run test:e2e -- <spec> --project=mobile-390 --project=desktop-1366 --workers=4`).

## 3. Caminho Crítico Paralelizado (5 etapas)

### Etapa 1 — Preflight + Diagnóstico em paralelo (T = 0)
No mesmo turno, dispare em paralelo apenas o necessário para o sintoma:
1. `npm run ops:preflight` (captura SHAs de produção e checa se o workspace está atrás de `origin/main`).
2. Leitura direta dos arquivos do módulo afetado (use o Mapa na Seção 4).
3. Se houver relato de produção: `railway_mcp` (`get-logs`) ou `npm run ops:triage` em paralelo.
4. Se for bug de interface: reprodução visual no navegador (ambiente local/preview ou leitura passiva).

### Etapa 2 — Worktree Limpo + Correção Cirúrgica + Teste Focal
- **Nunca** trabalhe sobre branch antiga nem sobrescreva alterações pendentes do usuário.
- Crie worktree limpo direto de `origin/main`:
  ```bash
  git fetch origin main
  git worktree add -b fix/<escopo-curto> /tmp/koma-fix-<escopo> origin/main
  ln -s /home/testuser/Koma_LOCAL/node_modules /tmp/koma-fix-<escopo>/node_modules
  ```
- Aplique a menor correção causal + 1 teste focal de regressão (unitário, pytest ou Playwright).

### Etapa 3 — Validação Local Única (antes do push)
Rode **uma única vez** após finalizar as edições:
```bash
npm run focus:check            # lint + test:unit + build em paralelo + pytest focal
npm run focus:check -- --e2e   # quando alterou UI/fluxo crítico
```
- Python local com `pytest`/`alembic`: `/home/testuser/Projetos/sistema-gourmet-bistro/.venv/bin/python` (resolvido automaticamente pelo `focus:check`).

### Etapa 4 — 1 Push, PR Pequeno e Auto-Merge Condicionado
Faça apenas **1 push** (evita cancelar e reiniciar runners):
```bash
git push -u origin fix/<escopo-curto>
gh pr create --base main --title "fix(<escopo>): <descrição objetiva>" --body "<causa raiz, arquivos, teste, PREV_FRONTEND_SHA/PREV_API_SHA>"
gh pr merge --auto --squash --delete-branch
```
- Required checks ativos na `main`: `Merge verdict`, `Browser targeted regressions`, `Gitleaks secret scan`, `PostgreSQL critical boundaries`. Todos precisam ficar verdes (o auto-merge integra automaticamente assim que concluírem).

### Etapa 5 — Monitoramento Paralelo de Deploy + Smoke + Limpeza
Assim que o PR mergear:
```bash
git fetch origin main
MERGE_SHA=$(git rev-parse origin/main)
# Frontend-only:
npm run ops:preflight -- --watch-deploy "$MERGE_SHA" --smoke
# Se alterou backend/**:
npm run ops:preflight -- --watch-deploy "$MERGE_SHA" --backend --smoke
```
- Remova o worktree temporário ao finalizar: `git worktree remove /tmp/koma-fix-<escopo>`.
- Confirme que o sintoma cessou (leitura passiva / inspeção visual) antes de declarar resolvido.

## 4. Mapa Compacto de Módulos do KÔMA

| Área / Sintoma | Código principal | Testes focais / E2E |
|---|---|---|
| **Cardápio Público / Sacola / Dock** | `src/cardapio/`, `src/components/cardapio/` | `e2e/public-menu-order.spec.ts`, `e2e/cardapio-promotions.spec.ts` |
| **Caixa / PDV / Checkout** | `src/components/caixa/pdv/`, `src/components/caixa/checkout/` | `e2e/cashier-pdv-product-card.spec.ts`, `e2e/cashier-mixed-payment.spec.ts` |
| **Pedidos / Kanban / Delivery / Motoboy** | `src/components/caixa/orders/`, `src/components/courier/`, `backend/app/application/orders/` | `e2e/cashier-fulfillment-workspaces.spec.ts`, `backend/tests/test_order_lifecycle_authority.py` |
| **Mesas / Garçom** | `src/components/mesas/`, `src/domain/operationalState.ts`, `backend/app/routes/atendimentos.py` | `e2e/waiter-salon-wave1.spec.ts`, `backend/tests/test_atendimento_identity.py` |
| **Pagamentos / Pix Direto / PagBank / MP** | `src/components/caixa/orders/DirectPix*`, `backend/app/routes/direct_pix.py`, `backend/app/services/online_payments/` | `e2e/direct-pix.spec.ts`, `backend/tests/test_online_payment_gate.py` |
| **Impressão / Agente Térmico** | `src/components/printing/`, `backend/app/application/printing/`, `backend/app/routes/print_agents.py` | `e2e/print-local-connection.spec.ts`, `backend/tests/test_print_agents.py` |
| **Auth / Onboarding / Planos** | `src/components/auth/`, `src/components/onboarding/`, `backend/app/routes/onboarding.py` | `e2e/auth-persistence.spec.ts`, `backend/tests/test_critical_auth_flow.py` |
| **Suporte / Ajuda / Triagem** | `scripts/ops-triage.mjs`, `backend/app/services/support_investigation_service.py`, `docs/operations/incident-memory/index.json` | `tests/opsTriage.test.ts`, `backend/tests/test_support_diagnostics_and_context.py` |

## 5. Regras Invioláveis

- Nunca fazer push direto em `main`, `--force`, desativar rulesets ou ignorar CI vermelho.
- Nunca escrever dados sintéticos, pedidos, pagamentos ou reimpressões no **tenant ID 6 (Quentinha Caseira)** ou em produção.
- Nunca expor tokens, segredos, `.env` ou PII em chats, commits ou logs.
- Nunca declarar resolvido sem evidência de PR mergeado + SHA publicado + validação real.
