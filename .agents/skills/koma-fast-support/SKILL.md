---
name: koma-fast-support
description: >-
  Protocolo operacional permanente de suporte rápido e entrega em produção no KÔMA
  (Georlan/sistema-gourmet-bistro). Ative automaticamente em qualquer pedido de
  suporte, correção de bug, ajuste de botão/layout/comportamento, erro relatado
  por restaurante ou incidente em produção.
---

# KÔMA — Fast Support Protocol (v2 — Execução Determinística)

**Princípio central:** IA para diagnóstico e decisão; scripts determinísticos para localização, worktree, validação, PR e deploy. Conhecimento acumulado em vez de redescoberta.

## 1. Classificação Automática (obrigatória antes de agir)

| Nível | Escopo | Regras de execução | Meta experimental |
|---|---|---|---|
| **FAST** | Textos, botões, layout, responsividade, estados visuais, bugs localizados | **Sem** auditoria global, **sem** plano extenso, **sem** artefato intermediário, **sem** subagente extra. Localização via `ops:locate`, 2–4 leituras cirúrgicas, reprodução visual quando UI, correção mínima + teste focal, `focus:check`, PR + auto-merge | **5–7 min** (meta experimental) |
| **STANDARD** | Frontend + backend, regras operacionais, pedidos, estoque, sync/cache, integrações | `ops:locate` + cruzamento de logs/serviços, teste de integração focal, `focus:check`, PR, CI, auto-merge e smoke | **10–20 min** |
| **CRITICAL** | Pagamentos, Pix, segurança, auth, multitenancy/RLS, migrations, fiscal, billing, PII | Investigação aprofundada, testes de segurança/PG/concorrência, plano de rollback explícito, aprovação obrigatória antes de merge | Rigor máximo |
| **INCIDENT** | Operação parada ou degradação severa em produção | Contenção imediata, `ops:preflight --start`, correção mínima em worktree limpo, 1 push, auto-merge, `--watch-deploy --smoke` | **< 10 min** |

## 2. Matriz Benchmarkada de Ferramentas (primária → fallback)

| Tarefa | Ferramenta Primária (menor latência/contexto) | Fallback | Evitar |
|---|---|---|---|
| **Localizar arquivos/rotas/testes** | `npm run ops:locate -- "<relato>"` (~50–150ms, usa `rg` 28ms) | `rg -n "<termo>" src/ backend/app/` | Leituras exploratórias em cascata |
| **GitHub (PRs, checks, merge)** | `gh` CLI (~600ms, autenticado) | — | `github-mcp-server` (PAT expirado `401`) |
| **Baseline & Deploy Watch** | `npm run ops:preflight` (~1.5s, HTTP direto 300ms) | `curl /meta.json` + `/api/contracts/readiness` | MCP Cloudflare para checar SHA |
| **Railway status / deploys** | `railway` CLI (`railway deployment list --limit 5`, ~2.5s, 409B) | `railway_mcp` (`get-logs` para logs estruturados) | `railway_mcp list-deployments` (~25s) |
| **Triagem / Saúde / Banco** | `npm run ops:triage -- --symptom "..."` / `ops:doctor` (read-only) | `supabase_mcp` apenas se autorizado | `supabase_mcp execute_sql` (bloqueado por transport) |
| **Reprodução visual na tela** | Subagente `browser` (`Model: "flash"`) ou `chrome-devtools-mcp` | Playwright focal (`mobile-390` + `desktop-1366`) | Assumir correção visual só com `build` verde |

## 3. Fluxo Determinístico de 5 Passos (mínimo de turnos)

### Passo 1 — Turno único: Localização + Worktree + Baseline (em paralelo)
No **primeiro turno**, execute em paralelo:
1. `npm run ops:locate -- "<relato>"` (retorna top arquivos frontend, backend, endpoints FastAPI e testes exatos em < 150ms).
2. `npm run ops:preflight -- --start <escopo-curto>` (captura `PREV_FRONTEND_SHA`/`PREV_API_SHA` e cria `/tmp/koma-fix-<escopo>` direto de `origin/main` com `node_modules` linkado, preservando `/home/testuser/Koma_LOCAL`).
3. Se houver relato de produção: `npm run ops:triage -- --symptom "<relato>"` ou `railway_mcp` (`get-logs`).
4. Se for bug visual/UI: inicie reprodução real na tela (preview local / fixture E2E / leitura passiva — **nunca** mutação em produção).

### Passo 2 — Leitura cirúrgica + Correção mínima + Teste focal
- Leia apenas os 2–4 arquivos apontados pelo `ops:locate` (evite reler o mesmo arquivo).
- Implemente a menor correção causal + 1 teste focal de regressão (unitário, pytest ou Playwright).
- Para bugs de interface, siga a cadeia: **Reprodução real → Causa → Correção → Repetição da interação → Confirmação visual** (reutilize fixtures/specs existentes em `e2e/` com `KOMA_E2E_PORT=4283` em `mobile-390` + `desktop-1366`).

### Passo 3 — Validação Local Única
Rode **1 única vez** dentro do worktree:
```bash
npm run focus:check            # lint + test:unit + build em paralelo (~30s) + pytest focal
npm run focus:check -- --e2e   # quando alterou UI/fluxo crítico
```

### Passo 4 — 1 Push, PR e Auto-Merge Condicionado
Em **1 único comando** dentro do worktree (respeitando todos os required checks e aprovações pendentes):
```bash
npm run ops:preflight -- --ship --title "fix(<escopo>): <descrição objetiva>" --body "<causa raiz, arquivos, teste, PREV_FRONTEND_SHA/PREV_API_SHA>"
```
- **Nunca** execute `--ship` com auto-merge em alterações que exijam aprovação estética, operacional ou de segurança ainda pendente.

### Passo 5 — Deploy Watch (resiliente a deploys concorrentes) + Smoke + Limpeza
Após merge na `main`:
```bash
git fetch origin main && MERGE_SHA=$(git rev-parse origin/main)
npm run ops:preflight -- --watch-deploy "$MERGE_SHA" --smoke            # frontend-only
npm run ops:preflight -- --watch-deploy "$MERGE_SHA" --backend --smoke  # se alterou backend/**
npm run ops:preflight -- --cleanup <escopo-curto>
```
- `--watch-deploy` reconhece automaticamente commits posteriores que contenham `$MERGE_SHA` (`git merge-base --is-ancestor`), evitando falso timeout em deploys concorrentes.

## 4. Modelos, Subagentes e Instrumentação Leve

- **Execução direta (1 agente)** é o padrão em chamados `FAST` e `STANDARD` — não invoque subagentes quando 1 turno paralelo local resolve mais rápido.
- Reserve subagente `browser` (`Model: "flash"`) para interação real na tela e `research` apenas para investigações extensas multi-módulo.
- Ao encerrar qualquer chamado real, inclua **1 única linha** de telemetria (sem gerar relatórios longos):
  `[fast-support] class=<FAST|STANDARD|CRITICAL|INCIDENT> locate=<Xs> edit=<Xs> pr=<Xs> merge=<Xs> live=<Xs> reads=<N>`

## 5. Regras Invioláveis

- Nunca fazer push direto em `main`, `--force`, desativar rulesets ou ignorar CI vermelho.
- Nunca escrever dados sintéticos, pedidos, pagamentos ou reimpressões no **tenant ID 6 (Quentinha Caseira)** ou em produção.
- Nunca expor tokens, segredos, `.env` ou PII em chats, commits ou logs.
- Nunca declarar resolvido sem evidência de PR mergeado + SHA publicado (ou superseded) + validação real.
