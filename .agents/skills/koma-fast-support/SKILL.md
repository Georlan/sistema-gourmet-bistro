---
name: koma-fast-support
description: >-
  Protocolo operacional permanente de suporte rápido e entrega em produção no KÔMA
  (Georlan/sistema-gourmet-bistro). Ative automaticamente em qualquer pedido de
  suporte, correção de bug, ajuste de botão/layout/comportamento, erro relatado
  por restaurante ou incidente em produção.
---

# KÔMA — Fast Support Protocol (Definitivo)

**Princípio permanente:** IA para diagnóstico e decisões; software determinístico para execução repetitiva; skills para conhecimento acumulado; ferramentas escolhidas por eficiência comprovada.

## 1. Classificação Automática (e reclassificação dinâmica)

Classifique internamente toda solicitação pelo impacto real — **sem exigir que o usuário informe o modo**. Se a investigação focal revelar complexidade ou risco maior, **reclassifique imediatamente** para `STANDARD`, `CRITICAL` ou `INCIDENT`.

| Nível | Escopo | Diretriz | Meta experimental |
|---|---|---|---|
| **FAST** | Textos, botões, layout, responsividade, estados visuais, bugs localizados de baixo risco | Execução direta (1 agente), `ops:locate`, 2–4 leituras cirúrgicas, reprodução visual quando UI, fix mínimo + teste focal, `focus:check`, PR + auto-merge + smoke | **5–7 min** |
| **STANDARD** | Frontend + backend, regras operacionais, pedidos, estoque, sync/cache, integrações | `ops:locate` + cruzamento de logs/serviços, teste de integração focal, `focus:check`, PR, CI, auto-merge e smoke | **10–20 min** |
| **CRITICAL** | Pagamentos, Pix, segurança, auth, multitenancy/RLS, migrations, fiscal, billing, PII | Investigação aprofundada, testes PG/segurança/concorrência, plano de rollback, **aprovação explícita antes de merge** (`--ship` bloqueia auto-merge automaticamente) | Rigor máximo |
| **INCIDENT** | Operação parada ou degradação severa em produção | Contenção imediata, `ops:preflight --start`, correção mínima, 1 push, auto-merge, `--watch-deploy --smoke` | **< 10 min** |

## 2. Regras Anti-Overkill Permanentes (chamados FAST)

- **Não** começar com auditoria global nem produzir planos extensos para correções simples.
- **Não** fazer dezenas de `read_file` antes da 1ª edição: comece sempre com `npm run ops:locate -- "<relato>"` (~60–90ms).
- **Não** pesquisar novamente informações já presentes nesta skill ou em `AGENTS.md`.
- **Não** usar MCP lento quando CLI resolve melhor (`gh` CLI 604ms, `railway` CLI 2.5s, HTTP direto 300ms).
- **Não** criar subagentes sem ganho concreto nem gerar artefatos intermediários desnecessários.
- **Não** repetir testes equivalentes nem consultar serviços em loop manual.
- **Não** produzir relatórios longos para chamados simples nem pedir confirmação quando já há informação e autorização suficientes.
- **Não** encerrar na implementação local quando o escopo autorizado inclui publicação em produção.

## 3. Matriz Definitiva de Ferramentas (primária → fallback)

| Tarefa | Primária | Fallback | Evitar |
|---|---|---|---|
| **Localizar arquivos/endpoints/testes** | `npm run ops:locate -- "<relato>"` (`rg` 28ms + fallback `git grep` 38ms) | `rg -n "<termo>" src/ backend/app/` | Leituras exploratórias em cascata |
| **GitHub (PRs, checks, merge)** | `gh` CLI (~600ms) | — | `github-mcp-server` (PAT expirado `401`) |
| **Baseline / Worktree / Ship / Deploy** | `npm run ops:preflight` (`--start`, `--ship`, `--watch-deploy --smoke`, `--cleanup`) | `curl /meta.json` + `/api/contracts/readiness` | Comandos manuais repetidos |
| **Railway status / logs** | `railway` CLI (`status`, `deployment list`, ~2.5s) | `railway_mcp` (`get-logs`) | `railway_mcp list-deployments` (~25s) |
| **Triagem / Saúde / Banco** | `npm run ops:triage -- --symptom "..."` / `ops:doctor` (read-only) | `supabase_mcp` somente quando autenticado | `supabase_mcp execute_sql` (rejeitado por transport) |
| **Tela real / UI** | Subagente `browser` (`Model: "flash"`) ou `chrome-devtools-mcp` | Playwright focal (`mobile-390` + `desktop-1366`) | Assumir correção visual só com `build` verde |

## 4. Ciclo Determinístico de 5 Passos

1. **Turno 1 (em paralelo):**
   - `npm run ops:locate -- "<relato>"`
   - `npm run ops:preflight -- --start <escopo-curto>` *(verifica hash do `package-lock.json` antes de linkar `node_modules`, lista worktrees concorrentes e preserva `/home/testuser/Koma_LOCAL` intacto)*
   - Se relato de produção: `npm run ops:triage -- --symptom "<relato>"` ou `railway_mcp get-logs`.
   - Se bug visual/UI: reprodução real na tela (ambiente local/preview ou leitura passiva).
2. **Leitura cirúrgica + Correção + Teste focal:**
   - Leia apenas os 2–4 arquivos apontados pelo `ops:locate`.
   - Para UI: **Reprodução real → Causa → Correção → Repetição da interação → Confirmação visual** (reaproveite specs `e2e/` e fixtures em `KOMA_E2E_PORT=4283`).
3. **Validação local única (no worktree):**
   - `npm run focus:check` (`lint` + `test:unit` + `build` em paralelo ~30s + `pytest` focal) ou `npm run focus:check -- --e2e`.
4. **1 Push + PR + Auto-Merge Seguro:**
   - `npm run ops:preflight -- --ship --title "fix(<escopo>): <descrição>" --body "..."`
   - `--ship` reutiliza PR existente em caso de falha parcial e **bloqueia auto-merge automaticamente** em migrations, segurança, pagamentos/Pix, fiscal, workflows e `product-contract.json` (use `--no-auto-merge` para revisões estéticas pendentes).
5. **Deploy Watch (resiliente a deploys concorrentes) + Smoke + Limpeza:**
   - `git fetch origin main && MERGE_SHA=$(git rev-parse origin/main)`
   - `npm run ops:preflight -- --watch-deploy "$MERGE_SHA" --smoke` *(adicione `--backend` se alterou `backend/**`)*
   - `npm run ops:preflight -- --cleanup <escopo-curto>`

## 5. Telemetria Compacta Obrigatória (1 linha ao encerrar chamado real)

Sem relatórios extensos — registre apenas esta linha sem PII/segredos:
`[fast-support] class=<FAST|STANDARD|CRITICAL|INCIDENT> first_edit=<Xs> tools=<N> reads=<N> impl=<Xs> validate=<Xs> ci=<Xs> merge=<Xs> deploy=<Xs> total=<Xs> status=<ok|blocked>`

## 6. Regras Invioláveis

- Nunca fazer push direto em `main`, `--force`, desativar rulesets ou ignorar CI vermelho.
- Nunca escrever dados sintéticos, pedidos, pagamentos ou reimpressões no **tenant ID 6 (Quentinha Caseira)** ou em produção.
- Nunca expor tokens, segredos, `.env` ou PII em chats, commits ou logs.
- Nunca declarar resolvido sem evidência de PR mergeado + SHA publicado (ou descendente confirmado) + validação real.
