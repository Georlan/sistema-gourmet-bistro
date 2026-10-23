# Estratégia de Recomendação e Rentabilidade (Ficha Técnica / CMV)

## Contexto e Objetivo

O KÔMA possui suporte completo a ficha técnica, composição por insumos e cálculo de CMV (Custo de Mercadoria Vendida) através dos modelos e serviços em:
- `backend/app/routes/financial_product_routes.py`
- `backend/app/models.py` (`ProdutoInsumo`, `Insumo`)
- `backend/app/services/menu_intelligence.py` (`complete_recipe_unit_cost`)

O objetivo de produto é orientar as recomendações e sugestões complementares do cardápio online para favorecer produtos com boa margem de contribuição (lucro bruto unitário em reais ou percentual de markup saudável), sem canibalizar a experiência gastronômica do consumidor.

---

## Invariantes Críticos e Regras de Segurança

### 1. Sigilo Comercial Absoluto (Zero Vazamento no Cliente Público)
- **Nunca expor dados financeiros no navegador:** O Cardápio Online (`/cardapio`) é uma superfície pública não autenticada ou autenticada por consumidor final.
- Sob nenhuma hipótese campos como `custo_unitario`, `cmv_estimado`, `margem_lucro`, `preco_insumo` ou `ficha_tecnica` devem trafegar nas rotas públicas (`/api/cardapio-digital/**`).
- Revelar o custo de insumos ou a margem de um restaurante para clientes ou concorrentes viola a segurança de negócio do parceiro KÔMA.

### 2. Separação de Responsabilidades e RBAC
- O cálculo financeiro detalhado exige a permissão `relatorios:consultar` e a entitlement `advanced_reports` no backend (conforme `financial_product_routes.py`).
- O motor público do cardápio apenas consome **resultados consolidados e anonimizados** (ordenações de IDs).

### 3. Frugalidade de Infraestrutura (Sem Endpoints Prematuros)
- Não criar endpoints adicionais de streaming ou polling desnecessários.
- A ponderação de rentabilidade deve ser computada no mesmo ciclo de cache do ranking de popularidade já existente (`/api/cardapio-digital/populares`), reaproveitando o TTL de cache de borda.

---

## Arquitetura de Integração Proposta (Server-Side Weighting)

```
[ Banco de Dados ]
  - Vendas (ComandaItem)
  - Ficha Técnica (ProdutoInsumo)
          │
          ▼
[ Worker / Job de Inteligência KÔMA (Backend) ]
  1. Calcula Popularidade Bruta: P_i = total_vendas(i)
  2. Calcula Margem de Contribuição: M_i = preco(i) - complete_recipe_unit_cost(i)
  3. Normaliza escores: P_norm, M_norm in [0, 1]
  4. Computa Escore Composto:
     Score(i) = (α * P_norm) + (β * M_norm)
     (onde α = 0.60 e β = 0.40 como calibração recomendada)
  5. Salva lista ordenada de IDs em cache de leitura (Redis / Supabase Cache):
     populares: [id_1, id_2, id_3, ...]
          │
          ▼
[ Rota Pública: /api/cardapio-digital/populares ]
  Retorna APENAS:
  {
    "produtos": [
      { "produto_id": "101", "escolhas": 142 },
      { "produto_id": "205", "escolhas": 98 }
    ]
  }
          │
          ▼
[ Frontend KÔMA (CardapioArtisticExperience / CardapioCartDrawer) ]
  - Consome apenas a lista de IDs persistida em brand.popularProductIds.
  - Ordena e prioriza vitrines de "Mais escolhidos" e sugestões de harmonização
    sem conhecer nenhum custo nem violar os contratos de isolamento.
```

---

## Harmonização Contextual Inteligente

O motor client-side (`pairingRecommendations.ts`) já respeita as regras gastronômicas:
1. **Nunca sugere pratos principais (mains) como harmonização de outros pratos.**
2. **Prioriza categorias ausentes na sacola do cliente:**
   - Se o cliente pediu apenas burger: prioriza bebida e acompanhamento.
   - Se o cliente já adicionou bebida: prioriza sobremesa e porções.
3. **Ponderação por Rentabilidade:**
   - Dentre os candidatos de uma mesma categoria (ex.: duas opções de refrigerante vs. suco artesanal), a ordenação fornecida pelo ranking do restaurante colocará a opção de maior contribuição no topo.
   - O cliente recebe uma sugestão natural, bonita e vantajosa para o restaurante, sem atrito comercial.
