# Artes do Caixa KÔMA

SVGs originais desenhados em código para acompanhar CourierRideArtwork e os glifos do Garçom.

- `cashier-counter-v1.svg`: personagem no balcão com pedido e PDV. Cabeçalho do Caixa; decorativo, sem texto ou estado de operação.
- `salon-empty-v1.svg`: mesa ilustrada para o estado vazio do Salão, decorativa.
- `order-ticket-v1.svg`: comanda e cloche. Estado vazio dos pedidos sem mesa.

Arquivos separados, fundo transparente, sem fontes, scripts, filtros, animações ou dependências. A marca completa continua nos arquivos oficiais existentes. Preservar a paleta verde/minta e a geometria arredondada assimétrica; nunca sobrepor os desenhos a valores ou ações. Use alt vazio quando a arte for decorativa e deixe a mensagem do estado no texto HTML.

## Modalidades

`pickup-v1.svg`, `delivery-v1.svg`, `counter-v1.svg` e `dine-in-v1.svg` são assets separados para o bloco numérico do pedido. O nome da modalidade acompanha o número no rótulo acessível e na dica do bloco. Não são indicadores de pagamento.

## Detalhes dos pedidos

- `detail-table-v2.svg`: mesa redonda vista de cima, quatro cadeiras e louça; distingue mesa de cama/bandeja em tamanhos pequenos.
- `detail-delivery-v2.svg`: exportação estática do CourierRideArtwork aprovado, com cores explícitas; não duplicar a implementação de comportamento do Entregador.
- `detail-pickup-v2.svg`: sacola e comprovante de retirada.
- `detail-print-v2.svg`: impressora térmica para ações de produção/conta; fundo de papel no controle.

- `operator-access-v1.svg`: credencial ilustrada do operador na gaveta de conta; decorativa, sem dados ou promessas de autenticação adicionais.

## Ações compactas

`src/components/caixa/orders/CashierDetailActionArt.tsx` contém nove silhuetas SVG originais separadas por intenção: adicionar, receber, imprimir, conta, transferir, mesclar, cancelar, itens e alterar modalidade. São decorativas; cada controle mantém um texto acessível. O cancelamento usa recibo recortado em vermelho fechado; conta usa papel azul; impressão usa papel claro.

## PDV / Novo pedido

- `pdv-empty-cart-v1.svg`: arte original, vetorial, sem gradientes, filtros, scripts nem imagem externa. Representa uma comanda sobre a bandeja do pedido, usada exclusivamente no carrinho vazio do PDV. Decoração com `alt=""`; o estado e a próxima ação permanecem em texto HTML. Criada para a refatoração visual de 12/11/2026, sem copiar a referência BeeFood.
