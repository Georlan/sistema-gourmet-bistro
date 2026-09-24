# Oferta comercial — atualizada em 23/09/2026

## Decisão

A oferta comercial vigente do KÔMA usa três planos sem taxa de implantação e sem add-ons. O Pocket é a porta de entrada com mensalidade de R$ 39 e já inclui o App do Garçom; Pro e Premium adicionam gestão e operação avançadas e reduzem a taxa KÔMA conforme o restaurante cresce.

O catálogo vigente serve para **novas contratações**. Ele não substitui os termos comerciais já aceitos por um tenant. Para contratos existentes, a autoridade financeira é o snapshot comercial vinculado ao restaurante.

A fonte compartilhada do catálogo público no frontend é `src/config/subscriptionPlans.ts`. O backend mantém o catálogo de novas contratações em `backend/app/subscription.py`, mas split e billing de um tenant contratado devem resolver os valores do respectivo `ContractAcceptance`.

## Oferta vigente

| Plano | Assinatura mensal | Taxa KÔMA por pagamento online elegível | Posicionamento |
| --- | ---: | ---: | --- |
| Pocket | R$ 39/mês | 1,79% | Comece com o essencial |
| Pro | R$ 129/mês | 0,50% | Seu restaurante cresceu. Sua taxa diminui |
| Premium | R$ 249/mês | 0,20% | Mais volume, menor taxa |

Regras:

- Taxa de implantação: **R$ 0**.
- Add-ons: **não existem na oferta atual**.
- Recursos que não pertencem ao plano exigem upgrade; não são vendidos separadamente.
- A taxa KÔMA incide somente sobre pagamentos online aprovados e elegíveis no fluxo integrado.
- Tarifas do provedor de pagamento são separadas da taxa KÔMA.
- Uma assinatura por estabelecimento.
- Pocket, Pro e Premium podem usar plano anual com 10% de desconto somente no componente fixo.
- Novas contratações Pocket, Pro e Premium têm 7 dias de teste do componente fixo após a implantação essencial.
- A taxa percentual não recebe desconto anual.
- Contratos antigos Pocket de R$ 0 não criam recorrência de R$ 0.
- Não existe upgrade automático por GMV.
- Mudança do catálogo não altera contratos antigos.

## Recursos por plano

### Pocket

- Mesas, comandas e balcão.
- App do Garçom para salão e comandas.
- Cardápio digital e QR Code com pedidos no PDV.
- Retirada e delivery no mesmo caixa.
- Fila de preparo na tela, sem impressora.
- Caixa, fechamento e resumo de vendas.
- Clientes e histórico de pedidos.

### Pro

Tudo do Pocket, mais:

- KDS e impressão automática.
- Estoque, fichas técnicas e financeiro.
- Gestão de equipe e permissões avançadas.
- Relatórios completos.

### Premium

Tudo do Pro, mais:

- App do entregador.
- Pontos, cashback e cupons.
- Suporte prioritário.

O app do entregador não promete GPS ao vivo e suporte prioritário não significa plantão 24 horas.

## Plano anual

O desconto de 10% vale exclusivamente para o componente fixo:

| Plano | Equivalente mensal | Total anual | Economia anual |
| --- | ---: | ---: | ---: |
| Pocket | R$ 35,10 | R$ 421,20 | R$ 46,80 |
| Pro | R$ 116,10 | R$ 1.393,20 | R$ 154,80 |
| Premium | R$ 224,10 | R$ 2.689,20 | R$ 298,80 |

As taxas permanecem 1,79% / 0,50% / 0,20% para novas contratações, independentemente do ciclo do componente fixo.

## Pontos econômicos de comparação

Considerando apenas mensalidade fixa + taxa KÔMA e o mesmo volume mensal de pagamentos online elegíveis:

- Pocket e Pro se igualam em aproximadamente **R$ 6.976,74/mês**: R$ 39 + 1,79% × volume = R$ 129 + 0,50% × volume.
- Pro e Premium se igualam em **R$ 40.000/mês**: R$ 129 + 0,50% × R$ 40.000 = R$ 329, e R$ 249 + 0,20% × R$ 40.000 = R$ 329.

Esses pontos podem futuramente embasar recomendações de economia, mas **não autorizam mudança automática de plano**.

## Grandfathering e autoridade comercial

É válido coexistirem simultaneamente, por exemplo:

- Pocket legado: R$ 109 + 1,49%.
- Pocket v2.6: R$ 0 + 1,79%.
- Pocket v2.7: R$ 39,90 + 1,79%.
- Pocket vigente: R$ 39 + 1,79%.
- Pro vNext: R$ 129 + 0,50%.
- Premium vNext: R$ 249 + 0,20%.

Para tenants com aceite vinculado, preço fixo, billing amount, taxa transacional e versão jurídica vêm do snapshot aceito. Tenants realmente legados sem aceite vinculado usam o fallback v2.5 explicitamente congelado até existir processo de migração.

`OnlinePaymentIntent.marketplace_fee` congela a fee de cada pagamento no momento de criação. Mudanças comerciais posteriores não recalculam intenções já criadas.

## Comunicação comercial

Na landing:

- Pocket: **“Comece com o essencial por R$ 39/mês.”**
- Pro: **“Seu restaurante cresceu. Sua taxa diminui.”**
- Premium: **“Mais volume, menor taxa.”**
- Pro mantém o destaque “Mais recomendado” enquanto essa for a decisão editorial; não usar “mais comprado” sem dado real.
- Destacar “Sem taxa de implantação”, “Sem add-ons” e que a taxa KÔMA se aplica somente ao pagamento online elegível.
- Não somar nem prometer uma taxa total do provedor + KÔMA sem confirmar as condições da conta do restaurante.

## Segurança financeira da ativação

A cobrança de `application_fee` continua protegida por `ONLINE_PAYMENT_PLAN_FEES_ENABLED=false` por padrão.

Quando a flag estiver desligada, a fee deve ser zero. Quando estiver habilitada, o backend usa a taxa **contratada pelo tenant**, não simplesmente a taxa atual do slug do plano.

Somente depois de homologar contrato, OAuth/marketplace, split, refund, chargeback e conciliação a variável deve ser alterada para `true` no ambiente que realmente cobrará a comissão. Um merge de código, sozinho, não deve iniciar cobrança em produção.

Contratos Pocket novos exigem cobrança fixa de R$ 39 e usam o fluxo pago do checkout. Contratos anteriores Pocket R$ 0 não exigem assinatura recorrente de R$ 0 no Mercado Pago. O tenant conecta separadamente a conta Mercado Pago OAuth do restaurante para receber pagamentos online dos seus clientes.
