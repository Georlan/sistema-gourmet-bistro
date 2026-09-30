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


## Tamanhos de marmita — 29/09/2026

Escopo aprovado: configuração assistida por tamanho, mantendo opções do dia
compartilhadas. O Super Admin define `profile_key=marmitaria`; selecionar o perfil
não cria catálogo. O dono configura explicitamente em Cardápio → Complementos.

Cada tamanho criado pelo assistente tem uma categoria marcada `marmitaria_tamanho`
e um produto com preço próprio. Os grupos/opções continuam canônicos e compartilhados.
`CategoriaGrupoModificador.min_selecoes/max_selecoes/modo_selecao` são overrides opcionais de
composição; null mantém o comportamento anterior. A categoria mais próxima prevalece
na herança. `effective_modifier_payloads_by_product` aplica esses limites nos canais;
`modifier_limits_by_product` alimenta a validação do Order Core para os vínculos com
limites explícitos. Por grupo/tamanho, o dono escolhe `porcoes` (conta unidades,
permite repetir até o teto) ou `tipos` (uma escolha por opção, limita tipos diferentes).
O picker compartilhado, o cardápio público, a repetição de pedido e o backend usam
esse modo. Vínculos legados sem override mantêm quantidades livres por adicional
com limite de tipos; não recebem novos limites automaticamente.

O editor geral preserva overrides nos vínculos mantidos. Remover vínculo/excluir grupo
usado em tamanhos exige ajustar a composição no assistente. Pausar uma opção continua
usando o registro original, ocultando-a em todos os tamanhos que compartilham o grupo.
Não migra catálogos existentes nem aplica programação semanal, plano ou pagamentos.

## Cadastro unificado de marmitaria — 30/09/2026

A direção anterior de categoria por tamanho foi substituída pelo escopo aprovado
pelo usuário: uma categoria Marmitas/Quentinhas com P, M e G e limites por produto.
Tamanho, preço, foto e descrição ficam em Cardápio → Produtos → Marmitas.
Grupos e regras de escolha por tamanho ficam exclusivamente em Complementos.
O atalho em Produtos abre o mesmo produto em Complementos; não cria outro tamanho.
O modelo antigo permanece legível por compatibilidade.

`Produto.marmitaria_tamanho` armazena a identidade normalizada do tamanho, única
por restaurante. Registros manuais reconhecidos e categorias do assistente antigo
são mostrados na leitura sem criar/converter dados. Configurar um registro existente
preserva seu ID e metadados, passa-o à categoria compartilhada e grava overrides em
`ProdutoGrupoModificador.min_selecoes/max_selecoes/modo_selecao`.

Produtos configurados usam exclusivamente seus vínculos diretos de composição;
produtos legados mantêm herança por categoria. A resolução canônica atende
Cardápio Online, Caixa, Garçom, repetir pedido e validação do Order Core.
Escritas de tamanhos bloqueiam o restaurante durante a transação, detectam
aliases P/pequena, M/média, G/grande e duplicados antigos, com índice único como
última proteção contra concorrência. Cadastro, importação e movimentação genéricos
não criam novos tamanhos paralelos; foto/descrição e pausa continuam disponíveis.
A edição de grupos preserva overrides por produto e exige removê-los pela marmita
antes de desvincular/excluir. Sem regras, é permitido salvar apenas pausado;
ativação genérica e em lote também verifica a composição.

Migration aditiva z6d7e8f9a0b1; não converte dados nem elimina categorias antigas.
Configuração explícita reaproveita a categoria Quentinhas/Marmitas existente,
preservando nomes/IDs dos pedidos históricos. Duplicados antigos exigem resolução
explícita; nenhum produto ou pedido real é excluído pela atualização.
