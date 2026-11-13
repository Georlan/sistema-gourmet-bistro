# KDS KÔMA Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Unificar o KDS de produção e a projeção de pedidos em todos os acessos do KÔMA, com UX de cozinha segura e responsiva.

**Architecture:** Reutilizar estados de itens/ordens e agrupamento por lançamento. Visão de Cozinha não cria estado de entrega; o Kanban permanece consumidor do ciclo autoritativo. UI única com adapter para o papel Cozinha.

**Tech Stack:** React, TypeScript, CSS com tokens KÔMA, Vitest/Node test, Playwright, FastAPI existente sem mudanças.

**Spec:** `docs/superpowers/specs/2026-11-13-kds-kanban-unified-design.md`.

## Global Constraints
- Não criar novos endpoints, serviços, taxas, estado financeiro, SLA obrigatório, assets ilustrativos ou migração.
- Sem gravação no restaurante real; usar fixtures e smoke de leitura.
- Respeitar autenticação, idempotência, erro de rede e estado canônico.

## Review Focus
- Último item fica pronto em pedido digital aceito e Kanban avança sem marcar entregue.
- Falha parcial em lote não comunica sucesso total nem tenta mudar estado de item já pronto.
- Ticket com múltiplos lançamentos mantém identidade, observação e ordem.
- Papel Cozinha não consegue marcar entregue nem perde acesso ao KDS.
- Mobile estreito com descrições longas preserva botões e scroll sem overflow.

### Task 1: Projeção e tempo
**Files:** `kdsProjection.ts`, `KitchenTimer.tsx`, `tests/kdsProjection.test.ts`
- [x] Cobrir invariantes/ordenação/status em teste.
- [x] Consolidar projeção e tempo de espera sem componente com 1 timer por ticket.
- [x] Rodar testes focais e revisar saída.

### Task 2: Sincronização e falhas
**Files:** `useCashierOrders.ts`, `App.tsx`, `CashierKitchen.tsx`, `e2e/kds-start-ready.spec.ts`
- [x] Testar resultado de falha e ausência de entrega pelo KDS.
- [x] Atualizar item usando callback que comunica sucesso/falha, sem `Promise.all` de lote.
- [x] Aplicar opt-in canônico `avancar_pedido=true` nos dois portais.
- [x] Rodar fluxo KDS+Kanban sintético.

### Task 3: Unificação e interface
**Files:** `CashierKitchen.tsx`, `KitchenPanel.tsx`, `kdsWorkspace.css`, `e2e/kitchen-operational-queue.spec.ts`
- [x] Substituir banner e telas divergentes por workspace compartilhado.
- [x] Criar tickets densos, indicadores reais e ação segura acessível.
- [x] Validar 320/390/430/desktop e dark/light.

### Task 4: Gate, publicação e documentação
**Files:** docs, testes.
- [x] Lint, todos testes unitários, build, E2E do KDS e regressões de Caixa/ordens.
- [ ] PR com revisão, CI verde, merge sem contornar checks.
- [ ] Verificar SHA público e smoke não destrutivo. Documentar limitações restantes.
