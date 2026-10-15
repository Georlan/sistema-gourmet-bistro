# KÔMA Pocket — políticas de avisos e teto de custo

## O que reutilizar

- Transições de domínio `koma.order.created`, `koma.order.ready`,
  `koma.order.dispatched`, `koma.order.rejected` e
  `koma.order.cancelled` já publicadas pela outbox.
- O tracking de pedidos do Cardápio Online já consome estados reais via SSE
  e snapshot; **não** instalar polling do WhatsApp nem consultas por pedido.
- `tenant_order_whatsapp.py` já possui de-dup por evento,
  verificação de identidade, proteção para tentativa de resultado incerto
  e circuito por restaurante.
- `central_whatsapp.py` já provou envio do Business, mas permanece
  um **piloto de um único restaurante/telefone de teste**. Não remover esse gate.
- O cadastro central de telefone por tenant é independente do piloto;
  registrar um número não habilita mensagens.

## Regras canônicas

A função `customer_notice_for_event` traduz um único evento em uma intenção
e não envia nada:

| Evento | Retirada | Entrega |
| --- | --- | --- |
| `created` (liberado para operação) | Recebido | Recebido |
| `ready` | Pronto para retirada | **Sem aviso** |
| `dispatched` | **Sem aviso** | Saiu para entrega |
| `rejected` / `cancelled` | Cancelado | Cancelado |
| `accepted`, `preparing`, `completed` | **Sem aviso** | **Sem aviso** |

Pedido agendado ainda não liberado, Pix pendente, canais externos e
restaurante sem destinatário autorizado: nenhum aviso.

Ao enviar, `still_relevant` revalida o **último estado no banco** e a
modalidade. Prazos expirados, mudança de status ou evento desconhecido não
geram notificação. Não enviar um aviso `recebido` depois de `pronto` ou
`cancelado`. A prioridade pretendida é: comanda do operador; exceção de
cancelamento; marco final; aviso de recebido.

## Volume e orçamento

Hipótese empresarial: 50 pedidos online/dia/restaurante, 30 dias,
duas mensagens de status por pedido com 100% de opt-in.
Resultado = 1.500 pedidos e 3.000 mensagens por restaurante/mês.

Para um **exemplo matemático de tarifa** de R$ 0,035 por mensagem utilitária,
3.000 × R$ 0,035 = R$ 105/mês/restaurante. R$ 10 seriam 285 mensagens
inteiras, ou 9,5% das mensagens projetadas. Estes números **não**
constituem cotação da Meta e não significam cobrança na Evolution.
Obter preço efetivo no provedor e país antes de ativar o transporte oficial.

Em 10 restaurantes, 15.000 pedidos e 30.000 mensagens seriam esperados
sob a mesma hipótese; com tarifa ilustrativa, R$ 1.050/mês, bem acima
de R$ 100/mês (10 × R$ 10).

### Requisitos do enforcement real, ainda NÃO implementado

1. Reservas transacionais com limite por tenant e por remetente **compartilhado**,
   para que 10 restaurantes não disparem simultaneamente.
2. Orçamento mensal separado por tenant e por tipo de aviso; sem crédito,
   pular opt-in de aviso não essencial e conservar tracking web gratuito.
3. Controlar `queued`, `provider_accepted`, `delivered`, `unknown`,
   `cancelled` e `dead_letter`; 2xx do conector não é entrega lida.
4. Telefone de operador vindo da configuração do próprio tenant,
   autorização válida, e revogação eficiente (ao trocar número, cancelar
   eventos pendentes).
5. Atualizar custo unitário a partir da tabela oficial aplicada, não de
   constantes no código. Não exceder o teto sem aprovação explícita.
6. Não registrar mensagem integral, telefone, JID ou dados de cliente na
   outbox/logs. Usar IDs canônicos; decriptar o mínimo necessário no dispatch.
7. Opt-out, opt-in e prova de posse de telefone para cliente antes de ativar.
8. Caso Evolution sofra desconexão, bloqueio, repetidos 429 ou outros erros:
   interromper envios, sem reenvio cego nem burlar limites.
9. Sem controle de aprovação via WhatsApp: Kanban e Cardápio seguem fonte
   de verdade.

## Estado desta entrega

Somente **política pura + testes + projeção matemática**; nenhuma instância
é criada, nenhuma mensagem é enviada, nenhum worker novo é iniciado,
nenhum tenant além do piloto é habilitado. As decisões sobre o checkout
guest (digitou número x verificou titularidade) permanecem deliberadamente
abertas para preservar conversão sem enviar para número de terceiro.
