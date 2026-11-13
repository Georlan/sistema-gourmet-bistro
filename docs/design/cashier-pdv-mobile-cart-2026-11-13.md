# PDV do Caixa — carrinho móvel sempre navegável (13/11/2026)

## Problema reproduzido

Em celulares, o seletor de tarefas `Itens / Pedido` ficava acima de uma lista longa e saía da área visível. O botão inferior `Ver pedido` era montado **somente quando já existia item** e apenas enquanto o operador estava nos produtos; após abrir o carrinho, desaparecia. Na finalização, `cashierPdvCart.css` tornava o form e o body expansíveis, e o rodapé `sticky` não permanecia preso à janela quando a página inteira rolava. Uma captura real com carrinho vazio ainda mostrava identificação de cliente e pagamento opcionais antes de escolher produtos.

## Nova experiência

- **Produtos:** controle inferior permanente `Ver pedido · N itens | total`, inclusive no carrinho vazio, imediatamente acima da navegação do Caixa. Atualiza quantidades e preço sem desmontar o controle.
- **Carrinho:** rodapé fixo e de alto contraste, acima da mesma navegação, com `← Itens` (voltar sem descartar) + total atualizado + `Lançar Pedido`. Aviso de indisponibilidade continua dentro do rodapé. Este é o único ponto de lançamento; alternar abas não envia vendas.
- **Conteúdo:** itens e campos continuam roláveis, mas total e ação não desaparecem; espaçamento de segurança no final evita conteúdo encoberto.
- **Vazio:** `Carrinho vazio`, orientação direta e botão para escolher produtos. Não exibe campos opcionais de retirada enquanto não há itens. Modos entrega e consumo local mantêm seus controles necessários.
- **Estado:** alternância preserva o mesmo carrinho, personalizações, modalidade, mesa, cliente, pagamento, notas, chaves de idempotência e erros. O deslocamento à nova tarefa só ocorre quando há troca explícita de tarefa, não a cada atualização.
- **Performance e visual:** total memoizado por carrinho; estilo com Inter, Space Grotesk e tokens existentes. Sem novas imagens, novos SVGs, endpoints ou dependências.
- **Acessibilidade:** regiões com labels anteriores, ações móveis com pelo menos 44px, foco visível, `prefers-reduced-motion` e safe-area na parte inferior.

## Limites

Não tocar em backend, regras fiscais, split, Mercado Pago, disponibilidade, cálculo dos itens, pedidos persistidos, outras telas do Caixa ou isolamento tenant. Submissão permanece no `handlePdvSubmitOrder` existente e o botão continua bloqueado em carrinho vazio, carga ou indisponibilidade.

## Validação

`npm run lint`, `npm run test:unit`, `npm run build` e Playwright mobile (320/390/430 px), desktop 1366 px, modalidade delivery, checkout e recuperação de erro 422/502/503. Confirmar geometria do total acima da barra móvel e integridade de nome/pagamento após voltar aos produtos. Após PR e CI verdes, deploy na `main` e smoke exclusivamente GET/OPTIONS.
