# KÔMA — Memória Arquitetural: Projeções Operacionais de Mesa (Caixa e Garçom)

Esta é uma decisão arquitetural persistente do projeto KÔMA para orientar a **Fase 7 — Convergência de Projeções de UI**.

---

## 1. PRINCÍPIO DA JANELA ÚNICA

Caixa e Garçom representam **as mesmas mesas**.
Quando representam o mesmo estado operacional, devem utilizar a **mesma linguagem visual, cores, labels e tempo decorrido**.

Caixa e Garçom devem parecer duas janelas diferentes sobre a mesma operação, e não dois sistemas com interpretações divergentes do estado da mesa.

---

## 2. SEPARAÇÃO SEMÂNTICA DE ESTADOS

$$\text{Produção (Cozinha)} \longrightarrow \text{Serviço (Salão)} \longrightarrow \text{Financeiro (Caixa)}$$

$$\text{PREPARANDO} \longrightarrow \text{PRONTO} \longrightarrow \text{ENTREGUE} \longrightarrow \text{AGUARDANDO PAGAMENTO}$$

### Regra Crítica:
**`PRONTO` $\neq$ `AGUARDANDO PAGAMENTO`**

Não inferir que uma mesa está aguardando pagamento apenas porque todos os seus itens terminaram de ser preparados na cozinha.

### Estados Operacionais Canônicos da Mesa:
1. **`FREE` (Livre)**: Mesa sem comanda ativa (Verde).
2. **`IN_SERVICE` / `PREPARING` (Em atendimento / Em preparo)**: Pedidos em produção na cozinha.
3. **`HAS_READY_ITEMS` (Tem item pronto)**: Um ou mais itens prontos aguardando retirada/serviço (Amarelo/Âmbar).
4. **`ALL_ITEMS_READY` / `READY_TO_SERVE` (Tudo pronto / Servir)**: Todos os itens produzidos aguardando entrega na mesa (Amarelo/Âmbar).
5. **`AWAITING_PAYMENT` (Aguardando pagamento / Fechamento)**: Conta solicitada ou comanda em estado explícito `aguardando_pagamento` / checkout aberto (Destaque de cobrança/fechamento).

---

## 3. ARQUITETURA ALVO (FASE 7)

**Nunca copiar lógica de `MesaCard.tsx` para `CaixaPanel.tsx` ou vice-versa.**

Construir uma projeção/seletor compartilhado e universal:

```text
               TableOperationalState
                        │
          ┌─────────────┴─────────────┐
          ▼                           ▼
    deriveTableOperationalState(table, orders, payments)
          │
          ▼
   { label, color, icon, elapsed_time, active_items_count, display_orders }
          │
    ┌─────┴─────┐
    ▼           ▼
 Garçom       Caixa
(Render)     (Render)
```

Ambos os componentes apenas consomem essa projeção padronizada.

---

## 4. PRESERVAÇÃO DE FATIAMENTO NO KANBAN

Preservar os subtotais parciais do Kanban do Caixa:
* Valor em preparo (`R$ 228`)
* Valor pronto (`R$ 48`)
* Total consolidado da mesa (`R$ 276`)

Essas fatias são intencionais para o controle operacional do restaurante.
