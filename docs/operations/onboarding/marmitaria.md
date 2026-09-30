# Implantar uma marmitaria

Use junto ao [checklist mestre](README.md). O restaurante decide quais tamanhos,
preços e combinações vende. O perfil **Marmitaria** identifica a operação;
selecioná-lo não cria produtos, preços ou limites automaticamente.

## Preparar o cardápio

1. Colete nomes dos tamanhos vendidos, preços, acompanhamentos incluídos,
   opções com valor extra e quantidade permitida por grupo. Não presuma P, M e G.
2. No Super Admin, abra **Restaurantes → Editar** e selecione o perfil
   **Marmitaria**. Preserve o plano contratado e os benefícios individuais.
3. No restaurante, entre em **Cardápio → Complementos** e cadastre uma única
   lista de opções em cada grupo: **Proteínas**, **Guarnições**, **Saladas**.
   Arroz pode ser um grupo se o consumidor escolhe o tipo. Se já é fixo na
   composição, explique depois na descrição do produto.
4. Use valor adicional zero apenas para escolhas incluídas no preço. Cadastre
   os extras cobrados com seu valor real. Os limites gerais do grupo continuam
   atendendo outros produtos; cada tamanho terá seus próprios limites.
5. Na mesma aba, em **Tamanhos de marmita**, clique **Adicionar tamanho**.
   Informe nome e preço reais. Clique **Adicionar grupo de escolhas**, escolha
   um grupo e preencha mínimo/máximo. Repita para os demais grupos usados.
   Não é necessário duplicar as proteínas para cada tamanho.
6. Em **Como contar as escolhas**, decida por grupo:
   - **Porções — pode repetir a mesma opção:** mínimo 2 e máximo 2 aceita duas
     porções de Frango ou uma de Frango e uma de Carne; não aceita uma terceira.
   - **Tipos diferentes — uma escolha de cada:** mínimo 2 e máximo 2 exige
     duas opções diferentes e não permite repetir a mesma.
   Mínimo 0 e máximo 1 em Saladas permite deixar sem salada. A cliente define
   esses limites; as combinações acima são exemplos, não condições comerciais.
7. Marque **Disponível para venda** somente quando houver opções suficientes
   para cumprir os mínimos; caso contrário salve pausado. Clique **Salvar tamanho**.
   O sistema cria a categoria e o produto desse tamanho com destino **Cozinha**;
   confira esse destino em **Cardápio → Categorias** durante a homologação.
8. Para mudar preço ou limites, clique **Configurar** no tamanho. Para foto,
   descrição e demais dados do produto, use **Cardápio → Produtos**.
9. Abra o link público e simule cada tamanho: composição, limites, preço final
   e adicionais devem corresponder ao que a cozinha vai entregar. O backend
   também confere mínimo/máximo por tamanho ao receber o pedido.

O tipo de operação é definido pelo Super Admin, não pelo dono do restaurante.
Mudar o perfil não converte nem preenche o catálogo automaticamente. Um catálogo
montado anteriormente pelo fluxo geral continua válido: não cadastre uma segunda
cópia dos produtos para experimentar o assistente; não há migração automática.
Os vínculos de grupos usados pelo assistente devem ser removidos em **Configurar**
no tamanho, antes de excluir o grupo. Editar as opções preserva os limites dos tamanhos.

## Cadastro manual já existente

Em **Cardápio → Produtos**, o guia **Quentinhas · P, M e G** continua permitindo
criar a categoria **Quentinhas** e cadastrar os tamanhos dentro dela. Para o
Quentinha Caseira, os nomes previstos são **Quentinha P**, **Quentinha M** e
**Quentinha G**, com preços definidos pela cliente. Para outras marmitarias,
cadastre somente os tamanhos vendidos. Os atalhos mostram os produtos existentes;
use a lista para editar preços ou pausar vendas.

Nesse fluxo manual, mantenha os tamanhos dentro de **Quentinhas**. Ele não cria
os limites por tamanho do assistente acima: os grupos seguem seus vínculos e
limites gerais. Se o catálogo já estiver cadastrado assim, confira os vínculos
antes de mudar a composição; não duplique os produtos. Para um catálogo novo
com composições diferentes por tamanho e opções compartilhadas, use
**Tamanhos de marmita**, que cria uma categoria e um produto por tamanho.

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
