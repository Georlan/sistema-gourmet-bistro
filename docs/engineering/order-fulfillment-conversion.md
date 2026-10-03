# Alteração de modalidade no Caixa

Implementação restrita ao pedido operacional existente. O registro financeiro é
`Comanda`, o pedido/lote é `Lancamento`, e as unidades são `Item`.
`FulfillmentType` define `pickup`, `delivery`, `dine_in`; a Comanda continua
persistindo `Retirada`, `Delivery`/`Entrega`, `Consumo no Local`. Não há migração.

## Matriz

| Origem | Destino | Etapas elegíveis | Condições adicionais |
| --- | --- | --- | --- |
| Retirada | Entrega | analise, pendente, aceito, producao, pronto | modalidade habilitada, endereço estruturado, telefone válido, mínimo de entrega |
| Delivery/Entrega | Retirada | mesmas etapas | retirada habilitada; mínimo de retirada quando configurado |
| Mesa / Consumo no Local / venda rápida / SmartPOS | qualquer | nenhuma | fluxo de atendimento/conta não faz parte desta operação |
| Qualquer | mesma modalidade ou consumo local | nenhuma | operação explícita não aceita atualização arbitrária |

As duas primeiras linhas exigem pedido aberto, com itens ativos, sem mesa,
sem entregador atribuído, sem pagamento/cobrança registrada, sem documento fiscal,
sem cupom/cashback e sem referência de integração externa. Somente admin,
gerente e caixa possuem `pedidos:alterar_modalidade`; cozinha mantém a permissão
independente para alterar status.

`transito`, `finalizado`, `recusado`, fechamento e solicitação de conta bloqueiam
a operação. Etapas desconhecidas ou ausentes também falham de forma conservadora.
O valor de troco informado não pode ficar menor que o novo total.

## Fonte de verdade e transação

- `GET /comandas/{id}/modalidade/opcoes`: opções autorizadas e destino histórico.
- `POST /comandas/{id}/modalidade/previa`: taxa, total anterior/novo e token da prévia.
- `POST /comandas/{id}/modalidade`: recalcula e exige o token e um motivo de 3–500 caracteres.

Pedido e configuração são consultados com bloqueio transacional, sempre no tenant.
O token vincula modalidade, etapa, itens/status/preços, pagamentos, descontos,
instruções financeiras, telefone, destino e resultado da cotação. Mudanças entre
prévia e confirmação exigem nova revisão. As validações financeiras/fiscais e
logísticas são repetidas na confirmação. Os fluxos existentes continuam sendo
responsáveis por pagamento, atribuição, despacho e conclusão.

A taxa usa `OrderApplicationService.resolve_server_delivery_fee`: fixa, bairro,
distância e frete grátis. Bairro fora da tabela usa a taxa fixa configurada;
distância sem coordenadas usa a mínima; limites de distância continuam bloqueando
cobertura antes do frete grátis. Não existe um fallback canônico de taxa manual
no Order Core atual: configuração ausente/inválida bloqueia a conversão.
Taxas e totais enviados pelo cliente nunca são autoridade.

O endereço usa `delivery_address_from_payload`/`DeliveryAddressInput` e
`persist_delivery_address_snapshot`, criptografado e imutável. Os campos legados
são preenchidos para entrega. Na volta à retirada, endereço e telefone permanecem
como histórico e a taxa fica zero. Uma reconversão usa o mesmo destino histórico;
endereço diferente fica bloqueado. Status, itens e complementos não são modificados.

A auditoria usa `ActivityLog/CONVERT_FULFILLMENT`, com operador, horário do registro,
modalidades, taxas e motivo. O refresh de tracking é enfileirado na transação;
`tables_updated/fulfillment_changed` é enviado depois do commit. Uma falha antes
do commit reverte modalidade, endereço, taxa e auditoria.

O endpoint legado de entrega → retirada continua disponível, com os novos
bloqueios de segurança. A atribuição de entregador deve ser removida explicitamente
no fluxo canônico antes de converter; não é mais removida silenciosamente.

## Interface e validação

O modal exibe “Alterar tipo do pedido” somente após consultar opções do backend.
Reutiliza `DeliveryAddressFields`; coleta motivo/telefone, calcula a prévia e exige
uma confirmação separada com taxa e total. Após sucesso aplica o snapshot completo
confirmado pelo servidor e revalida as leituras. Falhas não criam estado otimista e
provocam refresh; a prévia precisa ser refeita.

Regressões: `test_fulfillment_conversion.py`, `test_delivery_flow.py`,
`test_delivery_address_snapshot.py`, `deliveryDispatchControl.test.ts` e
`cashier-fulfillment-conversion.spec.ts` (desktop e mobile). O workflow de fulfillment
inclui as novas regressões. Concorrência de estado antigo é exercitada via API;
SQLite não comprova locks PostgreSQL sob corrida real.
