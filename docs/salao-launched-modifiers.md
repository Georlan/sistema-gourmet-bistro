# Adicionais no consumo do Salão

A tela **Salão > Consumo** deve exibir os adicionais persistidos de cada item já lançado, inclusive após refresh ou em outro dispositivo.

## Fonte de verdade

- A seleção continua sendo gravada em `item_modificadores` pelo fluxo canônico de pedidos.
- A projeção de leitura da comanda consulta essas linhas em lote e devolve `item.modificadores`.
- Repetições são preservadas no payload; a interface apenas agrupa visualmente, por exemplo `2x Ovo`.
- O frontend não reconstrói adicionais pelo preço e não depende do estado local do modal que lançou o item.

Assim, impressão, histórico persistido e visão do garçom partem da mesma seleção salva no pedido.
