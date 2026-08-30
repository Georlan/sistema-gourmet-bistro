# KÔMA — Memória Arquitetural: Projeções Operacionais de Mesa (Caixa e Garçom)

Contrato da **Fase 7 — Convergência de Projeções de UI**, conforme o briefing completo de 30/08/2026. Este documento substitui a representação linear anterior: produção, serviço e financeiro são dimensões independentes.

---

## 1. PRINCÍPIO DA JANELA ÚNICA

Caixa e Garçom representam **as mesmas mesas** e consomem os mesmos fatos operacionais por seletores puros em `src/domain/operationalState.ts`.

Convergência semântica não exige redesenhar cada contexto. Cores, labels, filtros e prioridades visuais existentes permanecem protegidos por caracterização; diferenças de apresentação não são automaticamente bugs. O relógio entra explicitamente nas projeções, sem efeitos, requisições ou estado persistido derivado.

---

## 2. SEPARAÇÃO SEMÂNTICA DE ESTADOS

Produção informa itens preparando, prontos e sua contagem. Serviço informa se os itens foram servidos. Financeiro informa evidência explícita de solicitação de conta ou pagamento pendente. As dimensões coexistem; não há uma mega-enum que obrigue uma a apagar outra.

### Regra Crítica:
**`PRONTO` $\neq$ `AGUARDANDO PAGAMENTO`**

Não inferir que uma mesa está aguardando pagamento apenas porque todos os seus itens terminaram de ser preparados na cozinha ou foram servidos. Uma solicitação de conta também não torna itens em preparo prontos.

Ocupação considera a Comanda ativa e o status operacional explícito da mesa, inclusive atendimento sem itens. Pagamento pendente de confirmação permanece distinguível de conta solicitada.

[OBSERVADO] O contrato de leitura atual de `status_comanda` oferece somente `null` ou `aguardando_pagamento`. As projeções não inventam `PAID` a partir de `fechada`, `delivery_status`, `valorPago` ou `Item.pago`. Liquidação continua pertencendo ao Core e ao fluxo financeiro existente.

---

## 3. FRONTEIRAS DAS PROJEÇÕES

**Nunca copiar lógica de `MesaCard.tsx` para `CaixaPanel.tsx` ou vice-versa.**

O frontend conserva os DTOs existentes e separa suas responsabilidades:

```text
DTOs de Comanda / lançamento / item
  → operationalState: ocupação, produção, serviço, financeiro e tempo
  → cashierOrderProjection: fatias específicas do Kanban/Caixa
  → orderIdentity + orderLots: identidades persistidas e lotes
  → consumidores: Caixa, Mesa/Garçom e detalhes
```

`Order` em `src/types.ts` continua sendo o nome legado do DTO de Comanda. Seu `id` não deve ser confundido com `lancamentoId`. A identidade humana pertence a `displayNumber`, não à chave de callback, impressão ou transferência.

[OBSERVADO] `/comandas/detalhes/todos` não expõe `display_number`. O modal já recebe a identidade persistida por `/atendimentos/mesas/{id}`, em `familias[].lancamentos[].pedido_id`. Não calcular A/B por posição, nem aplicar a identidade do primeiro lançamento a um card agregado de mesa. Identidade ausente permanece ausente, com fallback visual legado explícito.

---

## 4. PRESERVAÇÃO DE FATIAMENTO NO KANBAN

Preservar os subtotais parciais do Kanban do Caixa:

- Valor em preparo: R$112.
- Valor pronto: R$48.
- Total consolidado: R$160, não R$160 em cada card.

Essas fatias são intencionais para o controle operacional do restaurante.

Quando a conta é explicitamente solicitada, o fechamento agrega todos os itens não pagos/não cancelados da Comanda. Sem solicitação, agrega apenas os prontos não pagos; os preparando permanecem na produção. A coluna de fechamento não é um estado financeiro por si só. Não alterar a elegibilidade histórica de itens pagos, servidos ou digitais incidentalmente.

## 5. PROTEÇÃO CONTRA REGRESSÕES

Antes da migração dos consumidores foram executados testes de caracterização em `tests/operationalCharacterization.test.ts`, `e2e/operational-projections.spec.ts` e `e2e/waiter-projections.spec.ts`. Os testes verificam também IDs técnicos de serviço/reimpressão e o fatiamento de itens do mesmo lançamento.

Extrações estruturais mantêm API pública, efeitos, assinaturas WebSocket, atalhos e fluxos. Casos preexistentes não bloqueantes ficam em `phase7_backlog.md`; não constituem novas subfases.

## 6. FRONTEIRAS ESTRUTURAIS DO FRONTEND

As views extraídas são controladas pelos componentes que já coordenavam os fluxos. Trocar uma aba não deve reinicializar busca, disponibilidade, seleção, confirmação ou impressão.

| Coordenador | Responsabilidades de apresentação extraídas | Responsabilidades preservadas no coordenador |
| --- | --- | --- |
| `CaixaPanel` | `CaixaOrdersWorkspace`, `CaixaSalonTab`, `KanbanOrderDetails` | Subscriptions, relógio, estado das abas/busca, atualização otimista, ações HTTP, contexto de cancelamento/transferência, checkout, idempotência e SmartPOS |
| `App` | `OperationalDrawer`, `OperationalLogin` | Roteamento, sessão/autenticação, WebSocket, polling, drafts, disponibilidade, preferências, tema e bloqueio de scroll |
| `MesaDetailsModalBase` | `MesaConsumptionPanel`, `MesaTransferMergePanel`, `MesaPrintDialogs` | API pública, aba ativa, permissões, seleção/confirmações, editor, estado e timeouts de feedback, bloqueio de scroll |

Os módulos do Caixa ficam em `src/components/caixa/orders` e `src/components/caixa/salao`; os do modal em `src/components/mesas`. Tipos de view e formatadores de apresentação não introduzem nova autoridade de domínio. Os filhos não recebem credenciais nem implementam requisições financeiras.

O checkout permanece junto de sua coordenação transacional. Extrair seu JSX apenas para diminuir o arquivo exigiria transportar estado financeiro e setters sem criar uma fronteira útil nesta fase.

As regressões de navegador exercitam os componentes através das telas reais: IDs técnicos de impressão/transferência, cancelamento por item versus mesa inteira, seleção de R$48 prontos mantendo R$112 em preparo, falhas de impressão, callbacks do modal, login e persistência do drawer. Guardrails estáticos seguem os novos arquivos proprietários e verificam a ligação real com os coordenadores; não são substituídos por strings mortas ou remoção de asserções.
