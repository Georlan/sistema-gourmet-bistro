# Composição operacional do pedido

Escopo aprovado em 03/10/2026: apresentar a composição por grupos de forma
compacta no perfil Marmitaria, em impressão, Kanban, novos pedidos/aceite,
detalhes, cozinha, consumo da mesa e histórico do cliente.

## Contrato

- `ItemModificador` continua sendo a fonte das escolhas e unidades repetidas;
  `preco_aplicado` continua sendo o valor histórico. Não recalcular preços pelo catálogo.
- A leitura operacional acrescenta `grupo_id` e `grupo_nome` aos modificadores e
  `composicao_agrupada` ao item. O perfil vem de `RestauranteOperationProfile`,
  consultado com o restaurante explícito. Não inferir perfil pelo nome do produto.
- Os grupos e nomes vêm do cadastro existente. Não classificar alimento pelo nome.
- O carregamento é em lote, filtrado por restaurante, inclusive nas junções;
  não filtrar opções pausadas que já fazem parte de um pedido.
- A observação original continua persistida e disponível para clientes antigos.
  A apresentação separa somente o sufixo `Opções:` que corresponde integralmente
  às escolhas registradas, inclusive repetições. A ordem do sufixo não precisa
  ser a mesma da leitura. Texto livre ou opções renomeadas que não correspondem
  são preservados; não migrar nem reescrever pedidos históricos.

## Apresentação

Na Marmitaria, os grupos seguem a ordem operacional de montagem: **Guarnições →
Proteínas → Saladas**; os demais grupos vêm depois sem perder sua ordem relativa.
Cada grupo continua sendo uma linha lógica, mas a impressão deixa um respiro antes
da composição e entre grupos. Categoria e ingredientes usam altura ampliada no
papel; somente o rótulo da categoria fica em negrito. Nas telas, a composição sobe
de 11 px para 12 px, com rótulo mais forte e espaçamento vertical maior. O recado
do cliente permanece secundário em `OBS:`.

As telas usam `OrderItemComposition` e o helper puro `orderItemComposition`.
A impressão usa o helper de domínio equivalente e o renderer universal; o
Print Agent continua recebendo somente o documento pronto. Primeira via,
reimpressão, conta da mesa e via delta de alteração recebem a composição.

Fora da Marmitaria, o texto gerado legado preserva sua apresentação. Quando
há modificadores persistidos sem texto gerado, exibir `COMPLEMENTOS:` evita
perder escolhas de pedidos feitos por outros canais. Em qualquer perfil, a
assinatura das escolhas e dos preços aplicados participa do agrupamento visual
e impresso, impedindo juntar composições diferentes apenas pelo nome do produto.

Não altera status, fatias do Kanban, limites por tamanho, catálogo, estoque,
pagamento, impostos, notificações sonoras nem cadastros do restaurante.
Avisos curtos de status/chat continuam curtos; não espelhar composição em
mensagens da conversa nem enviar mensagens externas para validar esta mudança.

## Evidência

Testes de domínio e leitura cobrem grupos, porções repetidas, separação do
recado, compatibilidade legada, opções em outra ordem e isolamento por tenant.
O renderer é exercitado em 32, 40 e 48 colunas, incluindo total e separação
de duas quentinhas com composições distintas. Cenários de navegador cobrem
cards, detalhes, edição do recado, aceite e cozinha em celular e desktop.
Impressão física permanece uma homologação no equipamento do restaurante.
