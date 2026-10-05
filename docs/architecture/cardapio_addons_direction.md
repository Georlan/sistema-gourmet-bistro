# Cardápio: direção de produto para adicionais

## Adicionais sincronizados no cardápio diário — 05/10/2026

Opções com origem sincronizada são informativas, sem checkbox, rótulo clicável
ou aparência de seleção. Disponibilidade e preço continuam visíveis e acompanham
o rascunho da origem. Um grupo composto somente por essas opções mostra Automático
em vez de Cadastrar / editar; o cadastro e os preços permanecem em Cadastros.
Opções independentes, inclusive num grupo misto, continuam selecionáveis.
Nenhum payload de disponibilidade ou regra de sincronização é alterado.

## Cadastro direto de opções — 05/10/2026

Na marmitaria, o editor oferece um campo separado para o nome e o valor da nova
opção, com Adicionar à lista. Enter adiciona ao rascunho; salvar também inclui
um nome ainda digitado nesse campo. Nomes equivalentes por caixa/acentos são
recusados na inclusão. Salvar/cancelar ficam fora da lista rolável. A configuração
de sincronização permanece disponível numa seção recolhida abaixo da lista,
com os vínculos e preços existentes preservados. Cadastro geral fora da marmitaria
mantém seu fluxo anterior. Nenhuma gravação acontece ao adicionar ao rascunho.

## Ordem de cadastro e próxima evolução — 05/10/2026

Os grupos de origem vêm antes dos adicionais sincronizados em Cadastros, como
no Cardápio do dia; as opções de cada grupo continuam em ordem alfabética.
O usuário considera redundante editar duas listas e propôs, para uma próxima
etapa, reunir disponibilidade e preço do adicional na mesma linha da origem.
Essa proposta ainda não altera cobrança, vínculos ou registros: a implementação
de uma interface unificada deve preservar os IDs atuais e preços históricos.

## Remoção de complementos e cadastro diário — 05/10/2026

Escopo solicitado pelo usuário: opções em ordem alfabética, listas compactas,
busca no editor e remoção de complementos mesmo quando já utilizados ou ligados
a adicionais. A revisão do grupo aplica a remoção ao salvar; cancelar mantém o
cadastro anterior.

Remover significa retirar do cadastro ativo, sem apagar referências de pedidos.
`OpcaoModificador.arquivada=true` e `ativo=false` preservam ID, grupo, nome e
preço. Os adicionais que apontam para a opção removida recebem as mesmas flags
na mesma transação. Pausar continua permitindo reativação; uma opção removida
não pode ser reativada por um cliente desatualizado nem reaparecer por sincronização.
A leitura histórica não filtra esse arquivo, mantendo composição e preço aplicado.
Cadastrar novamente um nome removido cria uma nova opção, sem alterar o histórico.

Excluir um grupo permitido também mantém seu registro e suas opções como arquivo.
Grupos vinculados a tamanhos ou sincronização continuam exigindo resolver esses
vínculos antes da exclusão. Nenhum tamanho, preço de venda ou seleção real do
restaurante é modificado automaticamente.

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
Todos os itens ficam na mesma lista em Cardápio → Produtos. Novo produto oferece
Marmita, Sobremesa e Bebida; o assistente de tamanho aparece ao criar uma marmita e
também é reutilizado para editar sua composição. Tamanho, preço e as regras
min/max por grupo pertencem ao produto P/M/G.
Complementos, no perfil Marmitaria, mantém somente os grupos/opções compartilhados
(Proteínas, Guarnições, Saladas etc.) e sua disponibilidade diária; não apresenta
limites globais de quantidade. O mesmo grupo pode ter 0–1 em P e 0–2 em G.
Hambúrguer, Pizza e demais perfis preservam o editor genérico e suas regras globais.
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

## Guarnições livres e adicionais pagos — 02/10/2026 (Correção P0 Tenant 6)

### 1. Mínimo 0 opcional
- Grupos com `min_selecoes: 0` são estritamente opcionais.
- O cardápio público e o modal do produto não exibem tag "OBRIGATÓRIO" quando `min_selecoes: 0`.
- O cliente pode avançar ou adicionar o produto à sacola sem selecionar itens desse grupo (0 itens válido).
- Limites máximos configurados (ex.: 2 proteínas) bloqueiam seleções além da quantidade contratada.

### 2. Adicionais pagos da marmitaria
- Extras além do que está incluso na quentinha (ex.: carnes extras a R$ 5,00 cada, ovos extras a R$ 2,00 cada)
  são cadastrados como um grupo regular ("Adicionais" ou "Adicionais pagos") com opções contendo `preco_adicional`.
- O grupo é vinculado à quentinha com `min_selecoes: 0`, `modo_selecao: "porcoes"` e teto amplo (ex.: 20).
- Cada unidade selecionada soma seu respectivo `preco_adicional` no cliente e no Order Core autoritativo do backend.
- A observação do pedido sumariza as quantidades escolhidas (ex.: `2x Ovo Cozido, 1x Carne adicional`) e o Caixa recebe itens e totais precisos.

### 3. Dívida Técnica: Teto numérico em Guarnições Livres
- **Observado**: O domínio atual (`ProdutoGrupoModificador`, `RegraTamanho`, `OrderValidationService`) exige
  inteiro estrito para `max_selecoes` (`1 <= max_selecoes <= 100`).
- **Impacto**: Se o operador cadastrar `maximo: 3` em Guarnições, a validação do backend e a UI tratam 3 como teto real.
- **Solução Operacional Segura Adotada**: Para guarnições livres sem limite prático, o operador define um teto
  operacional amplo (ex.: 20), e a interface pública apresenta "Escolha à vontade" e badge "Livre" somente para Guarnições do perfil Marmitaria, quando `max >= 20` e `min = 0`. Adicionais pagos e demais perfis mostram o teto real. O snapshot público informa o perfil efetivo através de `produto.marmitaria`; nomes de produtos ou categorias não ativam essa apresentação.
- **Dívida Técnica Registrada**: Em evolução futura aprovada, o domínio deve suportar formalmente `max_selecoes = null` / `unlimited` sem quebrar constraints de banco ou modelos intermediários.

## Adicionais vinculados — 03/10/2026

O dono pode escolher explicitamente um grupo de origem no editor de adicionais.
Nomes e disponibilidade acompanham as opções de origem, mantendo um ID próprio
para o extra pago e o seu preço. Cópias existentes com nome equivalente são
reaproveitadas somente quando a correspondência é inequívoca. Itens independentes
não são vinculados por suposição. Novas opções usam os preços configurados no grupo
(incluindo uma tarifa própria para ovos). A migração adiciona campos nulos, sem
configurar nenhum restaurante automaticamente.

As escritas canônicas de grupo e de disponibilidade sincronizam na mesma transação,
serializada por restaurante. Ciclos, origem de outro restaurante e exclusão de
opções vinculadas são bloqueados; pausa preserva as referências históricas.
Guarnições continuam compartilhadas pelas quentinhas sem criar extras pagos.
