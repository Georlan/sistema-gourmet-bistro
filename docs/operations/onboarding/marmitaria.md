# Implantar uma marmitaria

Use junto ao [checklist mestre](README.md). O restaurante decide quais tamanhos,
preços e combinações vende. O perfil **Marmitaria** identifica a operação;
selecioná-lo não cria produtos, preços ou limites automaticamente.

## Preparar o cardápio

1. No Super Admin, selecione o perfil **Marmitaria**, preservando plano e benefícios.
   O perfil não cria produtos nem define preços automaticamente.
2. Entre em **Cardápio → Produtos**. Marmitas, sobremesas e bebidas aparecem
   na mesma lista, com busca e filtro por categoria. Use **Editar** no cartão.
3. Em **Cardápio → Complementos → Proteínas, guarnições e saladas**, cadastre primeiro
   os grupos e as opções uma única vez. Complementos define apenas **o que pode ir**
   na quentinha; não define quantidades globais no perfil Marmitaria. Use adicional
   zero para escolhas incluídas; extras cobrados mantêm o valor real.
4. Para adicionar uma marmita, clique **Novo produto → Marmita**, escolha P, M ou G
   e informe nome e preço. No mesmo cadastro, em **Composição deste tamanho**, escolha
   os grupos existentes e informe **Mínimo** e **Máximo** de cada um. Exemplo:
   Quentinha P pode usar Proteínas 0–1 e Quentinha G Proteínas 0–2.
5. **Permitir repetir a mesma opção** aceita duas porções de Frango quando o máximo
   permitir. Desmarcada, exige opções diferentes. Essa regra também pertence ao
   produto/tamanho, não ao grupo compartilhado.
6. Marque **Disponível para venda** quando a composição estiver completa e houver
   opções suficientes. Clique **Salvar marmita**. Se ainda não houver grupos,
   salve a marmita pausada, cadastre os grupos em Complementos e volte a Produtos.
7. Tamanhos já cadastrados ficam bloqueados no assistente de criação. Use **Editar**
   no cartão para preço, foto e descrição e **Salvar e configurar composição da
   quentinha** para alterar os limites daquele produto sem criar outro tamanho.
8. Para adicionar outros itens, escolha **Novo produto → Sobremesa** ou **Bebida**:
   a categoria correspondente é reaproveitada ou preparada automaticamente.
9. Simule cada tamanho no link público: preço, escolhas, repetição, adicionais
   e impressão devem corresponder à configuração. O servidor valida os limites
   por produto e bloqueia pedidos incompletos ou excedentes.

**Produtos** concentra a lista e é a autoridade sobre tamanho, preço e composição
de cada P/M/G. **Complementos**, no perfil Marmitaria, concentra somente grupos,
opções e disponibilidade diária; não cria tamanhos nem define mínimo/máximo global.
O mesmo grupo pode ser reutilizado com limites diferentes em cada quentinha.
Hambúrguer, Pizza e demais perfis continuam usando as regras genéricas de
Complementos. Cada tamanho possui identidade única por restaurante, com proteção
também no banco. Criar P novamente exige editar o cadastro existente.

## Cadastros existentes

Quentinha P/M/G na categoria Quentinhas/Marmitas e produtos do assistente antigo
aparecem no mesmo cadastro. Leituras não convertem registros. Ao salvar a
configuração, o sistema reaproveita o ID, preço informado, foto, descrição e
histórico, e grava as regras diretamente no produto. Produtos do assistente
antigo passam à categoria compartilhada ao serem configurados, sem excluir
suas antigas categorias ou alterar pedidos recebidos.

Categorias antigas com composição continuam legíveis enquanto não forem
configuradas. Regras de outros catálogos mantêm a herança existente. Para as
marmitas configuradas, os vínculos diretos são a composição completa: retirar
Guarnições não volta a herdá-las da categoria.

Se já houver duplicados antigos, nenhum deles é apagado ou escolhido
silenciosamente. Resolva a ambiguidade antes de atribuir a mesma identidade a
mais de um produto. Alterar perfil não migra catálogos automaticamente.

## Preparar o cardápio de cada dia

A oferta é decidida diariamente pela cliente. Não há programação semanal
necessária para este fluxo.

1. Antes de abrir o atendimento, confirme com a cozinha o que será servido.
2. Em **Cardápio → Produtos**, use **Pausar venda** nos produtos indisponíveis.
   Para vários, selecione-os e use **Pausar**. Eles ficam ocultos no link público.
3. Em **Cardápio → Complementos**, localize o grupo e clique em **Pausar** ao
   lado da proteína, guarnição ou salada que não será oferecida. Confira o
   indicador **Pausado**. A opção fica oculta no Cardápio Online.
4. Para voltar, use **Voltar a vender** no produto e **Reativar** no complemento.
   A pausa preserva cadastro, preço e vínculos. Não exclua e recrie diariamente.
5. Uma opção compartilhada afeta todos os produtos vinculados ao grupo.
   Confirme o alcance antes de pausar.
6. Se uma quentinha exige um mínimo de escolhas e não há opções suficientes
   disponíveis no grupo correspondente, pause o produto até resolver com a cozinha.
   Não reduza a exigência de composição só para permitir um pedido incompleto.
7. Atualize o link público e confira o resultado como consumidor. Faça um
   pedido de homologação após a configuração inicial e mudanças de composição.
   Confira também a impressão das escolhas na cozinha.

Ao acabar uma proteína durante o turno, repita a pausa imediatamente. Um
consumidor com página antiga pode precisar atualizar; o backend valida opções
inativas ao receber o pedido. Confira pedidos já recebidos com a cozinha:
pausar uma opção não cancela nem altera esses pedidos.

## Conferência diária

- [ ] Tamanhos e preços corretos; somente produtos oferecidos hoje estão ativos.
- [ ] Proteínas, guarnições e saladas disponíveis conferidas com a cozinha.
- [ ] Os mínimos configurados em cada quentinha continuam possíveis de preencher.
- [ ] Link público reflete as pausas e os meios de pagamento habilitados.
- [ ] Horários e modalidade de recebimento correspondem ao turno.
- [ ] Caixa aberto e impressão física funcionando quando usada.

Registre responsável e horário da conferência nas evidências do primeiro turno.
Para pagamento, trial, fechamento e incidentes, siga o checklist mestre e seus
respectivos guias; o perfil Marmitaria não muda essas regras.
