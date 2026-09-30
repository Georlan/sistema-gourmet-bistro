# Implantar uma marmitaria

Use junto ao [checklist mestre](README.md). O restaurante decide quais tamanhos,
preços e combinações vende. O perfil **Marmitaria** identifica a operação;
selecioná-lo não cria produtos, preços ou limites automaticamente.

## Preparar o cardápio

1. Colete nomes dos tamanhos vendidos, preços, acompanhamentos incluídos,
   opções com valor extra e quantidade permitida por grupo. Não presuma P, M e G.
2. No Super Admin, abra **Restaurantes → Editar** e selecione o perfil
   **Marmitaria**. Preserve o plano contratado e os benefícios individuais.
3. No restaurante, entre em **Cardápio → Produtos**. O guia **Quentinhas · P,
   M e G** permite criar a categoria **Quentinhas** e cadastrar os tamanhos
   dentro dela. Para o Quentinha Caseira, use **Quentinha P**, **Quentinha M** e
   **Quentinha G**, cada produto com seu preço definido pela cliente. Os atalhos
   mostram os tamanhos já cadastrados na categoria; use a lista de produtos para
   editar preços ou pausar vendas. Não crie uma categoria separada por tamanho.
   Para outras marmitarias, cadastre somente os tamanhos realmente vendidos.
4. Em **Cardápio → Complementos**, crie os grupos necessários: **Proteínas**,
   **Guarnições** e **Saladas**. Arroz pode ser uma opção se o consumidor escolhe
   o tipo; se já é fixo na composição, explique na descrição do produto.
5. Configure mínimo e máximo de escolhas conforme a operação real. Use valor
   adicional zero apenas para escolhas incluídas no preço. Cadastre os extras
   cobrados com seu valor real.
6. Vincule os grupos à categoria ou aos produtos. Se tamanhos têm limites
   diferentes, use grupos separados e confira cada vínculo; não associe um
   mesmo grupo com limites incompatíveis a todos os tamanhos.
7. Abra o link público e simule cada tamanho: composição, limites, preço final
   e adicionais devem corresponder ao que a cozinha vai entregar.

Não avance com composição ambígua, preço faltante ou escolha obrigatória sem
opções disponíveis. Não cadastre produtos fictícios para completar três tamanhos.

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
6. Se um grupo obrigatório não tem escolhas suficientes para cumprir seu
   mínimo, pause também os produtos dependentes até resolver com a cozinha.
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
- [ ] Grupos obrigatórios continuam possíveis de preencher.
- [ ] Link público reflete as pausas e os meios de pagamento habilitados.
- [ ] Horários e modalidade de recebimento correspondem ao turno.
- [ ] Caixa aberto e impressão física funcionando quando usada.

Registre responsável e horário da conferência nas evidências do primeiro turno.
Para pagamento, trial, fechamento e incidentes, siga o checklist mestre e seus
respectivos guias; o perfil Marmitaria não muda essas regras.
