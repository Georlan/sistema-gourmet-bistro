# Cardápio: direção arquitetural de famílias de produtos

## Definição canônica

Famílias de produtos agrupam variantes para simplificar a apresentação visual sem unificar registros de estoque, preparo ou faturamento.

## Contexto e motivação

No onboarding e validação do cardápio comercial do JE Lanches (restaurante ID 1), o catálogo continha originalmente 28 produtos individuais cadastrados. Embora a separação em produtos independentes seja essencial para a operação interna (relatórios de vendas, estoque, comandas, impressão térmica KÔMA e KDS), exibir 28 cartões individuais em telas de celulares gerava sobrecarga cognitiva e rolagem excessiva para o consumidor final (ex.: 4 cartões de batata quase idênticos, 6 cartões de pastel de sabores diferentes, 4 garrafinhas de suco e 4 de vitamina).

A solução arquitetural de **Famílias de Produtos** resolve esse dilema separando a **projeção visual do catálogo** da **entidade de dados operacional**:
- **Na vitrine (leitura pública):** Itens com afinidade visual e de consumo são condensados em cards mestres elegantes (ex.: card "Batata Frita", card "Pastéis (Médio e Pastelão)", card "Sucos Naturais (300 ml)", card "Vitaminas Especiais (300 ml)", card "Refrigerante 1L").
- **No modal de customização:** O cliente seleciona a variante desejada (sabor, preparação, corte), onde cada variante aponta diretamente para o seu `Product` real subjacente.
- **Na sacola, checkout, backend e pedidos:** O item adicionado ao carrinho é o produto real correspondente, com seu `product_id`, preço individual, modificadores e complementos intactos. Nenhuma comanda, impressão ou nota fiscal recebe um ID fictício de família.

## Invariantes de arquitetura

1. **Separação estrita de registros:**
   Nenhum registro de banco de dados, tabela de estoque, ordem de produção ou faturamento é mesclado ou consolidado. A identidade do item na comanda permanece exata (ex.: "1x Pastel de Frango", "1x Batata Frita Especial").
2. **Preço 'A partir de' autoritativo e transparente:**
   O valor inicial exibido no card da família (`minPrice`) considera estritamente variantes ativas e disponíveis (`isAvailable !== false`). O cálculo inclui o menor custo adicional entre opções obrigatórias (`calculateProductMinStartingPrice`), evitando frustração no consumidor ao abrir o modal.
3. **Isolamento multitenant:**
   O agrupamento visual automático de famílias foi restrito e validado no JE Lanches (ID 1). Os demais restaurantes da plataforma mantêm seu comportamento e renderização padrão de produtos individuais, garantindo compatibilidade reversa e estabilidade operacional. A ativação para novos estabelecimentos poderá ser habilitada futuramente de forma configurável por tenant.
4. **Adicionais visíveis e expansão transparente:**
   Para maximizar a conversão comercial de adicionais (ex.: bacon, ovo, queijo, carne extra a R$ 2,00) sem fricção oculta:
   - Grupos opcionais de adicionais pagos ou identificados como "Adicionais" iniciam expandidos por padrão em todos os restaurantes da plataforma (incluindo Marmitaria e ID 6).
   - Complementos gratuitos e escolhas de composição (proteínas, guarnições, saladas) continuam visíveis por padrão.
   - Nenhum adicional é pré-marcado automaticamente (seleção estritamente opt-in pelo cliente).
   - O consumidor possui controle total para recolher o grupo via accordion; uma vez recolhido, a preferência do usuário é respeitada e o grupo não reabre sozinho.

## Task futura: Classificação comercial explícita na gestão

- **Escopo futuro (fora do PR #1257):** Conectar o papel comercial explícito (`commercial_role`: `Principal`, `Acompanhamento`, `Bebida`, `Sobremesa`, `Outro`) à interface de cadastro de produtos no Caixa/Admin, persistência no banco e payload da API pública `/api/cardapio-digital/public`.
- **Estado atual:** O motor de recomendações complementares (`src/cardapio/pairingRecommendations.ts`) já aceita e respeita essa propriedade com precedência determinística sobre os matchers semânticos, permitindo ativação imediata assim que o campo for disponibilizado nos formulários operacionais.

