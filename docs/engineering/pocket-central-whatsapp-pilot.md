> Atualização: o contrato de roteamento cadastrado, descadastro e rollout controlado está em [whatsapp-registered-routing.md](./whatsapp-registered-routing.md). O texto abaixo registra a preparação anterior; não usar as antigas variáveis de destinatário para o novo sender.

# KÔMA Pocket — WhatsApp central (piloto controlado)

## Estado desta entrega

**Somente o caminho restaurante/operador**, com envio desligado por padrão.
Não há número Business configurado no repositório. Não há envio, template,
consentimento de consumidor nem automação de status do cliente ativados.
Essa segunda metade exige implementação independente e revisão de UX/consentimento
no checkout antes do piloto real.

A integração utiliza o evento canônico `OrderCreated`, nos fluxos de criação
normal, confirmação do pagamento online e liberação de agendamento; a mensagem
é enfileirada na mesma transação do pedido e não interfere no Caixa/Kanban.
O destinatário da mensagem nunca é recuperado de dados de outro tenant.

## Fail-closed

Todos os parâmetros a seguir permanecem ausentes/desativados em produção:

- `KOMA_CENTRAL_WA_ENABLED=false` — feature flag principal.
- `KOMA_CENTRAL_WA_PILOT_RESTAURANT_ID` — apenas **um** tenant explicitamente aprovado; ID 8 é D8 Burger, piloto de produção, não tenant QA.
- `KOMA_CENTRAL_WA_OPERATOR_PHONE` — número do operador que autorizou os avisos.
- `KOMA_CENTRAL_WA_PILOT_CUSTOMER_PHONE` — **único** telefone de checkout autorizado a acionar a comanda central neste piloto; outros clientes do mesmo restaurante nunca enfileiram alertas centrais.
- `KOMA_CENTRAL_WA_SENDER_PHONE` — número Business remetente, distinto do destinatário.
- `KOMA_CENTRAL_WA_INSTANCE_NAME` — instância Evolution exclusiva do Business;
  não reutilizar `koma-restaurant-*` nem o número pessoal.
- `EVOLUTION_API_URL` e `EVOLUTION_API_KEY` — já existentes, somente no backend.

Não registrar os números, chaves, QR, tokens, mensagens nem configuração real
em commits, PRs, issues, testes ou logs. Registrar consentimento e possibilidade
de cancelamento em evidência privada antes de habilitar a flag. A flag,
restaurante único, destinatário e remetente válido precisam coexistir.
Configuração parcial, id incorreto, cliente que não esteja na allowlist ou instância de tenant resultam em **sem evento**. O worker verifica novamente o telefone da comanda com tenant-scoping antes de qualquer envio.

## Comanda e privacidade

A outbox grava somente tenant, IDs do pedido/comanda, número legível, modalidade
e total — nunca telefone, nome ou endereço do cliente. Na entrega a mensagem é
montada pela leitura tenant-scoped dos itens, complementos, observações e nome
da comanda. Evitar incluir número/endereço do consumidor na mensagem central.

A Evolution precisa estar conectada à instância esperada e reportar como
`ownerJid` o telefone Business configurado. O remetente pode ser diferente
do número do operador, mas **não** pode ser a mesma conta por acidente.

O WhatsApp é redundância. O pedido só é aceito no KÔMA. Não usar mensagens
recebidas no WhatsApp como comandos do pedido nem confiar em texto livre.
Ao perder rede, o Caixa/Kanban continua fonte de verdade.

## Vazão, idempotência e falhas

- Um evento determinístico por pedido e tenant; alterações/refresh não recriam.
- Intervalo mínimo inicial de 15 segundos por restaurante piloto, usando
  `whatsapp_next_send_at` existente com lock de configuração; o piloto permite
  um só restaurante porque compartilhar número entre múltiplos exige gate global
  de vazão persistido separado.
- Apenas uma tentativa de rede com resultado incerto: dead-letter, sem reenvio
  automático que possa gerar outra comanda. HTTP 429 confirmado usa retry limitado.
- O recebimento HTTP 2xx da Evolution prova aceitação pelo conector, **não**
  entrega/lida no WhatsApp; registrar esse limite na homologação.
- O canal não serve para contornar limites, camuflar automação, variar mensagens
  aleatoriamente ou simular ações humanas.

## Próximos gates antes de habilitar

1. Conferir cobertura da suíte CI/POSTGRES e testes dos três fluxos de pedido.
2. Confirmar a sessão Business dedicada e o destino autorizado em teste isolado, sem
   tocar restaurantes de produção. Não ativar o ID 6.
3. Em D8 Burger (ID 8), fazer no máximo um pedido de teste canônico sem pagamento real, com o telefone explicitamente autorizado no checkout; conferir exibição no
   Kanban, uma comanda no destino, conteúdo completo e ausência de vazamento.
4. Verificar desconexão, número divergente, flood, pedido duplicado,
   reinício do worker e perda de rede; manter o canal desligado se algum gate falhar.
5. Para clientes: implementar consentimento explícito por pedido, revogação/
   opt-out, modelos utilitários autorizados, vínculo do destinatário com a
   comanda, transições de status e fila durável. Não reutilizar a flag do operador.
6. Rever conveniência e risco do Baileys/Evolution para um único número
   comercial da marca. Planejar API oficial antes de prometer SLA do WhatsApp.

Nenhum número ou chave é requisito para revisar e integrar esta entrega
com os testes verdes. O piloto só é ativado após o responsável aprovar
os destinatários e o procedimento de homologação.
