# Oferta comercial — 01/09/2026

## Decisão

A oferta comercial do KÔMA passa a usar três planos sem taxa de implantação e sem add-ons. A mensalidade remunera o software e a comissão variável diminui conforme o restaurante sobe de plano.

A fonte de preços e recursos exibidos no frontend é `src/config/subscriptionPlans.ts`. A fonte de verdade financeira das taxas usadas pelo backend é `backend/app/subscription.py`.

## Oferta vigente

| Plano | Assinatura mensal | Taxa KÔMA por pedido online pago | Posicionamento |
| --- | ---: | ---: | --- |
| Pocket | R$ 109/mês | 1,49% | Entrada simples |
| Pro | R$ 209/mês | 0,69% | Mais recomendado |
| Premium | R$ 309/mês | 0,29% | Menor taxa |

Regras:

- Taxa de implantação: **R$ 0**.
- Add-ons: **não existem na oferta atual**.
- Recursos que não pertencem ao plano exigem upgrade; não são vendidos separadamente.
- A taxa KÔMA incide somente sobre pedido online efetivamente pago pelo fluxo integrado.
- Custos do provedor de pagamento são separados e seguem as condições do provedor.
- Uma assinatura por estabelecimento.
- O plano anual mantém 10% de desconto apenas sobre a assinatura fixa; a taxa por pedido não recebe desconto.

## Recursos por plano

### Pocket

- Mesas, comandas e balcão.
- Cardápio digital e QR Code com pedidos no PDV.
- Retirada e delivery no mesmo caixa.
- Fila de preparo na tela, sem impressora.
- Caixa, fechamento e resumo de vendas.
- Clientes e histórico de pedidos.

### Pro

Tudo do Pocket, mais:

- KDS e impressão automática.
- Estoque, fichas técnicas e financeiro.
- Garçom web e permissões da equipe.
- Relatórios completos.

### Premium

Tudo do Pro, mais:

- App do entregador.
- Pontos, cashback e cupons.
- Suporte prioritário.

O app do entregador não promete GPS ao vivo e suporte prioritário não significa plantão 24 horas.

## Plano anual

Com 10% de desconto sobre a mensalidade fixa:

| Plano | Equivalente mensal | Total anual | Economia anual |
| --- | ---: | ---: | ---: |
| Pocket | R$ 98,10 | R$ 1.177,20 | R$ 130,80 |
| Pro | R$ 188,10 | R$ 2.257,20 | R$ 250,80 |
| Premium | R$ 278,10 | R$ 3.337,20 | R$ 370,80 |

A comissão por pedido continua em 1,49% / 0,69% / 0,29% independentemente do ciclo mensal ou anual.

## Pontos econômicos de upgrade

Considerando apenas mensalidade + taxa KÔMA e o mesmo volume de pagamentos online:

- Pocket e Pro se igualam em **R$ 12.500/mês** de GMV online: ambos geram/custam R$ 295,25 antes dos custos do provedor.
- Pro e Premium se igualam em **R$ 25.000/mês** de GMV online: ambos geram/custam R$ 381,50 antes dos custos do provedor.

Isso cria a escada econômica pretendida: Pocket para menor volume, Pro como faixa intermediária e Premium para operações com maior volume online. O upgrade também libera funcionalidades, então a decisão não depende apenas da matemática da taxa.

## Comunicação comercial

Na landing:

- Pro recebe o destaque **“Mais recomendado”**. Não usar “mais comprado” enquanto não houver dado real que sustente essa afirmação.
- Premium recebe **“Menor taxa”**, que é uma afirmação objetiva do catálogo.
- Destacar “Sem taxa de implantação”, “Sem add-ons” e “Você só paga a taxa quando vende online”.
- Não somar nem prometer uma taxa total do provedor + KÔMA sem confirmar as condições atuais da conta do restaurante.

## Segurança financeira da ativação

As taxas por plano estão definidas no backend, mas a cobrança é protegida por `ONLINE_PAYMENT_PLAN_FEES_ENABLED=false` por padrão.

Somente depois de validar contrato, documentação fiscal, OAuth/marketplace, reembolso, chargeback e conciliação a variável deve ser alterada para `true` no ambiente que realmente cobrará a comissão. Um merge de código, sozinho, não deve iniciar cobrança em produção.

Planos legados continuam normalizados como Premium para compatibilidade de funcionalidades. O modo de teste Premium não altera a assinatura salva e também não deve reduzir a taxa financeira do plano contratado.
