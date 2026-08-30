# Cardápio: clareza de entrega e retirada — 30/08/2026

## Escopo desta fase

Foco solicitado: apresentação profissional, legibilidade mobile e eficiência. Ideias novas de funcionalidade ou fluxo devem ser propostas ao usuário antes de implementar.

- [AMBIGUIDADE DE UI] A opção de entrega usava o zero da retirada e anunciava frete grátis. Agora sua prévia usa a mesma regra de cotação da entrega, independentemente da opção selecionada.
- [AMBIGUIDADE DE UI] Sem bairro selecionado, a taxa padrão continua no cálculo existente, mas aparece como estimada. Selecionar um bairro atualiza a apresentação e a taxa como antes.
- [AMBIGUIDADE DE UI] “Total final” foi alinhado a “Total estimado”, como já ocorre na revisão. O servidor continua sendo a fonte definitiva.
- Endereço de retirada saiu do botão estreito para uma área própria; bairro e endereço têm rótulos e textos maiores. O valor restante para o mínimo existente fica visível antes de avançar.
- [BUG CONFIRMADO] A condição numérica da promoção renderizava um zero solto quando não havia promoção. A condição agora é booleana.

Nenhuma tabela, configuração de restaurante, regra de mínimo, desconto ou cobrança foi alterada. `getDeliveryQuote` extrai a mesma precedência anterior: limiar gratuito, bairro e taxa padrão/fallback.

## Pendências de regra — não corrigidas nesta fase visual

- [BUG CONFIRMADO] `CardapioPage` usa `restaurant.taxa_entrega_padrao || 7`, convertendo o zero recebido em 7 antes de construir `BrandConfig`. O cálculo da sacola já preservava zero, mas o adaptador não. Antes de mudar valores enviados, alinhar o contrato: o payload público também retorna zero quando o atributo não existe.
- [BUG CONFIRMADO] A sacola aplica o mínimo também à retirada, enquanto `domain/orders/validation.py` limita `minimum_delivery_subtotal` a `FulfillmentType.DELIVERY`. Manter o bloqueio existente nesta fase; propor correção separada ao usuário antes de alterar o fluxo.
- [NÃO DETERMINADO] O payload público não inclui prazo de entrega. Não inventar minutos nem copiar o prazo de concorrentes.

## Ideia aguardando aprovação

Resumo compacto de mínimo e acesso às taxas no topo do cardápio, antes de encher a sacola. Não implementado nesta fase sem resposta do usuário.

## Validação

Testes unitários de cotação, isolamento das configurações e contratos de UI. Prévia local com dados fictícios de duas lojas; nenhuma requisição de teste é encaminhada à API real. Validar bairro pago/gratuito, taxa padrão, limiar de promoção, mínimo, retirada e ausência de overflow em telas estreitas.
