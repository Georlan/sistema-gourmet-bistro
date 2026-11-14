# PDV do Caixa — contrato de rolagem móvel (revisado em 13/11/2026)

## Por que a solução anterior foi substituída

O PR #1314 manteve a navegação móvel fixa e acrescentou um segundo bloco de checkout com `position: fixed`, mas ainda deixava o conteúdo do PDV expandir com a altura do documento. No teste com Playwright e dados sintéticos, a tela **390 × 740** passou de `shell.y=0` para `shell.y=-124` ao abrir o pedido, e em **320 × 620** o shell cresceu até **895 px**. O operador via toda a página mover, apesar do total aparentemente fixo. Além disso, a navegação `Itens / Pedido` e o seletor nativo de atendimento duplicavam controles existentes.

## Regra nova: um único dono da rolagem por tarefa

Apenas quando `activeTab='operacao'` e `activeSubTab='balcao'`, a classe `cashier-shell--mobile-pdv` aplica o contrato de layout em larguras **abaixo de 1280px**. O app ocupa exatamente `100dvh`; cabeçalho de Vendas, abas, quadro do pedido e navegação principal não participam da rolagem da lista.

- **Catálogo:** cabeçalho do aplicativo, busca e categorias permanecem visíveis; **somente** `.cashier-pdv-product-scroll` rola. Ao fim da área, um único `Ver pedido · N itens | valor` participa do layout flex, sem `position: fixed` e sem sobrepor produtos.
- **Pedido:** o cabeçalho compacto contém a única ação `← Itens` (com alvo de 44 px). A lista, a modalidade customizada e os detalhes de cliente/pagamento/endereço rolam **juntos apenas dentro** de `.cashier-pdv-cart__body`.
- **Confirmação:** `.cashier-pdv-cart__footer` tem `position: static` dentro de um formulário flex com altura controlada. **Total + Lançar Pedido ficam lado a lado**, em cerca de 65 px, imediatamente acima da navegação inferior, sem sombra flutuante. Não há mais segunda ação de voltar aqui.
- **Atendimento:** o controle nativo `select` foi removido do topo. As três opções já existentes `Retirada / Delivery / Consumo local` voltaram a ficar visíveis no pedido; não se criou uma nova regra de operação.
- **Carrinho vazio:** o operador ainda acessa o pedido para conferência, mas não vê identificação de retirada ou pagamento desnecessários antes de escolher itens. O cabeçalho `← Itens` basta como retorno; não há botão duplicado na mensagem vazia.
- **Marca:** cores, contraste, ícones e tipografia vêm dos tokens do KÔMA. Nenhum banner, asset, imagem ou ícone decorativo foi criado. O destaque do produto e o pulso da contagem no botão de revisão preservam a animação de adição sem toast.
- **Larguras e alturas curtas:** 320, 360, 390, 430, 768 e 1024 px, incluindo altura 490–620 px, tema claro/escuro e formulário com foco. O formulário pode rolar internamente para revelar campos enquanto o total continua ao alcance.

## Medições após a alteração

Com o mesmo cenário sintético de uma unidade do item *Risoto da casa*:

| Tela | Shell após abrir o pedido | Área que rola | Rodapé | Navegação |
| --- | --- | --- | --- | --- |
| 390 × 740 | y=0, h=740 | body do carrinho (421px) | y=604, 65px, estático | y=675 |
| 320 × 620 | y=0, h=620 | body do carrinho (301px) | y=484, 65px, estático | y=555 |
| 430 × 800 | y=0, h=800 | body do carrinho (481px) | y=664, 65px, estático | y=735 |

Na tela de produtos, apenas a lista de produtos rola; o botão inferior é interno ao layout e mantém seu próprio espaço. O body do documento e o shell não deslocam ao trocar de tarefa. Nenhum dado real de restaurante foi consultado ou modificado para essas medições.

## Fonte e limites de manutenção

- Implementação principal: `CashierPdvView.tsx`, `cashierPdvMobileWorkspace.css`, classe no `CaixaPanel.tsx`. O contrato visual não deve ser recriado por regras globais de `index.css`.
- Removidas as antigas regras globais de scroll do PDV e os estilos mortos de `cashier-pdv-mobile-switch`, `cashier-pdv-mobile-service`, rodapé `fixed` e campos duplicados.
- A propriedade do carrinho, tipos de atendimento, mesa, observações, idempotência, cálculo, disponibilidade, pagamento e `handlePdvSubmitOrder` **não mudou**. Outros módulos do Caixa, Garçom, Entregador e seus tenants não recebem a nova classe.
- Não restaurar o rodapé `fixed` nem usar `scrollIntoView` no container inteiro ao alternar tarefas. Para resolver um campo escondido, rolar o corpo correspondente, nunca o documento.

## Critérios de homologação

`npm run lint`, `npm run test:unit`, `npm run build`, `e2e/cashier-pdv-mobile-viewport.spec.ts`, navegação entre catálogo/carrinho, checkout para retirada/local/delivery, recuperação 422/502/503, seleção de mesa, fontes ampliadas, e Playwright mobile/desktop. PR e CI devem ficar verdes antes do merge. Publicação é confirmada apenas pela versão pública em `/meta.json` e smoke **não destrutivo** de produção.
