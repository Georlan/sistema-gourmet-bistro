# Cardápio: direção de produto para adicionais

Decisão informada pelo usuário em 30/08/2026, durante a correção da sacola pública.

## [ALVO] Categoria especial de adicionais

- O usuário ainda vai adicionar a edição de adicionais no cardápio do app do Caixa.
- Adicionais devem ser tratados como uma categoria especial.
- O mesmo cadastro deve atender tanto à montagem do próprio lanche quanto à seleção de complementos ao abrir um produto compatível, como um sanduíche.
- A implementação será compartilhada, com cadastro, disponibilidade e vínculos pertencentes a cada restaurante; não será específica do restaurante 2.

## [OBSERVADO] Base atual e limite desta fase

- Já existem grupos/opções de modificadores e vínculos com produtos.
- O checkout público agora envia os identificadores das opções escolhidas ao servidor para cálculo e validação.
- Esta fase corrige somente a sobreposição da sacola. Não transforma categorias, não migra registros e não implementa o editor futuro do Caixa.

## Decisões ainda necessárias antes da implementação

- Como a categoria especial aparece no catálogo público e se algum adicional pode ser comprado sozinho.
- Relação com ingredientes, estoque e ficha técnica; não assumir que adicional e ingrediente são sinônimos.
- Regras de quantidade, obrigatoriedade, preço da montagem e disponibilidade por produto.
- Compatibilidade/migração dos modificadores existentes, preservando IDs, isolamento por restaurante e preços dos pedidos já registrados.

Não criar cadastros duplicados para os dois usos nem inventar regras de preço sem definir esses pontos na etapa de adicionais.
