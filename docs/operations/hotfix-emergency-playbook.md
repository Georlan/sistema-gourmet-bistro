# Playbook Operacional Permanente — Hotfix Urgente (KÔMA)

Este documento define o fluxo canônico de **hotfix urgente** para incidentes reais de clientes em produção no KÔMA (`Georlan/sistema-gourmet-bistro`), preservando velocidade de entrega (**PR + validação em ~2–4 minutos**), proteção de `main` (`Protect main branch` / `Merge verdict`), isolamento multitenant e capacidade de rollback em **menos de 2 minutos**.

---

## 1. Critérios de Severidade e Travas Obrigatórias

| Severidade | Critério | Meta de Validação PR | Ação |
|---|---|---|---|
| **S0 (Crítico)** | Operação parada: criação de pedidos, caixa/PDV, pagamentos/Pix, impressão em restaurante ativo, login/sessão ou vazamento cross-tenant | **2–4 min** | Fluxo expresso imediato + congelar merges concorrentes em `main` até concluir |
| **S1 (Alto)** | Degradação severa sem contorno operacional (ex.: falha em modal/cardápio, erro 5xx intermitente) | **2–4 min** | Fluxo expresso no mesmo protocolo |
| **S2 (Moderado)** | Bug localizado com contorno ou impacto visual não bloqueante | Fluxo padrão de PR | Segue fila normal de PRs sem pausar `main` |

### Proibições absolutas (inclusive em S0)
- **Nunca** fazer push direto em `main`, `--force`, desativar o ruleset ou contornar `Merge verdict`.
- **Nunca** incluir migration destrutiva (`DROP`, `RENAME`, `ALTER` incompatível ou constraint bloqueante) em hotfix urgente. Se uma migration for indispensável, ela **deve ser estritamente aditiva e retrocompatível**, garantindo que o código anterior continue operando durante rolling deploy ou rollback.
- **Nunca** executar pedidos sintéticos, pagamentos reais, reimpressões ou gravações de teste no **tenant ID 6** (produção é estritamente somente leitura para diagnóstico; reproduza em fixtures locais isoladas).

---

## 2. Fase 0 — Baseline de Rollback (T = 0s, ~15s)

Antes de integrar o hotfix, registre o estado estável atual em produção para permitir rollback instantâneo caso necessário:

```bash
# 1. SHA ativo no frontend (Cloudflare Pages)
curl -sS https://app.komafood.com.br/meta.json

# 2. SHA completo (40 chars) ativo no backend (Railway)
curl -sS https://sistema-gourmet-bistro-production.up.railway.app/api/contracts/readiness

# 3. Último deployment Railway com status SUCCESS e canRollback=true (nunca usar SKIPPED)
railway deployment list --limit 5
```

Anote imediatamente:
- `PREV_FRONTEND_SHA` (campo `sha` de `/meta.json`) e o deployment ativo no Cloudflare Pages (`sistema-gourmet-bistro`).
- `PREV_API_SHA` (campo `deploymentGitSha`, 40 caracteres exatos).
- `PREV_RAILWAY_DEPLOYMENT_ID` (ID do deployment `SUCCESS` anterior elegível para rollback).

---

## 3. Fase 1 — Correção Cirúrgica, Validação Local e PR (alvo: 2–4 min)

1. **Criar worktree ou branch limpa a partir de `origin/main`:**
   ```bash
   git fetch origin main
   git worktree add -b hotfix/<escopo-curto> /tmp/koma-hotfix origin/main
   cd /tmp/koma-hotfix
   ```
   *(Durante a janela do hotfix S0, evite integrar outros PRs na `main`, pois `strict_required_status_checks_policy: true` exige branch atualizada e invalidaria o `Merge verdict` em execução.)*

2. **Aplicar correção mínima + teste focal de regressão e validar localmente ANTES do push:**
   Faça apenas **1 push** quando tudo estiver validado localmente, evitando cancelamento e reexecução por `concurrency`:
   - **Sempre:** `npm run lint`, `npm run test:unit` (ou `npx tsx --test` do módulo afetado), `npm run build` e `python -m compileall -q backend/app`.
   - **Se alterou `backend/app/**`:** rodar o teste focal do bug + `backend/tests/test_print_agents.py` + `alembic heads` (se alterou modelos/migrations).
   - **Se alterou UI crítica:** validar com Playwright local o spec do fluxo afetado.

3. **Abrir PR e acompanhar gates obrigatórios e de risco:**
   ```bash
   git push -u origin hotfix/<escopo-curto>
   gh pr create --base main --title "fix(hotfix): <descrição objetiva>" --body "<causa raiz, arquivo(s), teste de regressão, baseline PREV_API_SHA/PREV_FRONTEND_SHA>"
   gh pr checks --watch
   ```

### Orçamento de tempo esperado por tipo de hotfix

| Tipo de alteração | Checks disparados no PR | Tempo típico até verde |
|---|---|---|
| **Frontend / UI isolada (`src/...`)** | `Merge verdict` + `Browser Targeted Gate` (specs do módulo) + `Secret history scan` | **~2–3 min** |
| **Backend rota / serviço SQLite (`backend/app/...`)** | `Merge verdict` (inclui `orders_payments_inventory` / `run` / `print` + testes alterados) + `Secret history scan` | **~2,5–3,5 min** |
| **Persistência / RLS / Postgres (`models.py`, `alembic/`, serviços PG)** | `Merge verdict` (inclui fiscal PG se aplicável) + `PostgreSQL Critical Boundaries` (apenas domínios afetados) + `Secret history scan` | **~3–4 min** |

4. **Integrar com gates verdes:**
   ```bash
   gh pr merge --squash --delete-branch
   ```
   *(Preferir `--squash` para garantir `git revert` atômico caso seja necessário reverter.)*

---

## 4. Fase 2 — Acompanhamento de Deploy e Smoke Pós-Deploy (~1–2 min)

Após o merge na `main`:
1. Obtenha o SHA integrado:
   ```bash
   git fetch origin main
   export MERGE_SHA=$(git rev-parse origin/main)
   ```
2. Acompanhe o pipeline pós-merge e as plataformas:
   - **GitHub Actions:** `Main Push Safety Gate` (`~1m20s`). Como `deploymentTriggers.checkSuites` do Railway pode publicar em paralelo, qualquer falha no `Main Push Safety Gate` exige avaliação imediata de rollback.
   - **Cloudflare Pages (`app.komafood.com.br`):** publica automaticamente em todo push na `main` (`~35–60s`).
   - **Railway (`Kôma`):** dispara apenas quando `backend/**` muda (`watchPatterns: ["/backend/**"]`). Se o hotfix foi **apenas frontend**, o deployment do Railway será `SKIPPED` e a API permanecerá no `PREV_API_SHA`.
3. **Execute o smoke não destrutivo conferindo os SHAs exatos:**
   - **Se alterou `backend/**`:**
     ```bash
     KOMA_EXPECTED_FRONTEND_SHA="$MERGE_SHA" \
     KOMA_EXPECTED_API_SHA="$MERGE_SHA" \
     node scripts/production-smoke.mjs
     ```
   - **Se NÃO alterou `backend/**`:**
     ```bash
     KOMA_EXPECTED_FRONTEND_SHA="$MERGE_SHA" \
     KOMA_EXPECTED_API_SHA="$PREV_API_SHA" \
     node scripts/production-smoke.mjs
     ```
4. Confirme via leitura passiva (logs Railway / telemetria) que o sintoma original cessou, sem realizar gravações sintéticas em produção.

---

## 5. Fase 3 — Rollback de Emergência em < 2 Minutos

Acione imediatamente se `production-smoke.mjs` falhar após estabilização, `/health/ready` degradar, `Main Push Safety Gate` falhar ou surgirem erros `5xx` em produção:

1. **Estancamento imediato por artefato imutável (~30–90s, sem aguardar rebuild):**
   - **Frontend (Cloudflare Pages):** Dashboard → *Workers & Pages* → `sistema-gourmet-bistro` → *Deployments* → localizar deployment de `$PREV_FRONTEND_SHA` → **Rollback to this deployment**.
   - **Backend (Railway):** Dashboard → `passionate-truth` → `Kôma` → *Deployments* → `$PREV_RAILWAY_DEPLOYMENT_ID` → **Rollback** (ou `railway deployment redeploy` / `deploymentRollback` sem rebuild).
2. **Validação do rollback:**
   ```bash
   KOMA_EXPECTED_FRONTEND_SHA="$PREV_FRONTEND_SHA" \
   KOMA_EXPECTED_API_SHA="$PREV_API_SHA" \
   node scripts/production-smoke.mjs
   ```
3. **Reconciliação de `main`:** após estabilizar produção, abra imediatamente um PR com `git revert --no-edit "$MERGE_SHA"` a partir de `origin/main` e integre após `Merge verdict` verde para manter a branch principal consistente com a versão em produção.
