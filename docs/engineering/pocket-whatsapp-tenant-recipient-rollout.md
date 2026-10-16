> Atualização: o contrato de roteamento cadastrado, descadastro e rollout controlado está em [whatsapp-registered-routing.md](./whatsapp-registered-routing.md). O texto abaixo registra a preparação anterior; não usar as antigas variáveis de destinatário para o novo sender.

# WhatsApp Pocket — transição de conta individual para destinatário por restaurante

## Estado

Esta entrega implanta **somente o cadastro tenant-scoped de destinatário**,
sem habilitar envio central em massa. O número Business do KÔMA continua sendo
um único remetente gerenciado pela plataforma; jamais deve ser usado como
instância por restaurante ou copiado no frontend.

No cardápio online, o telefone do cliente representa a identidade do cliente
para aquele pedido, não é, por si só, autorização para mensagens WhatsApp.

## Contrato do restaurante

- `GET /caixa/configuracoes/whatsapp` retorna `mode=central` para quem não tem
  instância individual e para destinatários centrais já cadastrados.
- `POST /caixa/configuracoes/whatsapp/recipient` exige permissão
  `configuracoes:administrar`, telefone BR válido e confirmação explícita de
  autorização do titular para *avisos operacionais do restaurante*.
- O backend armazena o telefone somente na configuração daquele restaurante,
  com marcador `koma-central`, **não** com o nome real da instância na Evolution.
- Registrar ou remover destinatário não consulta a Evolution, não gera QR
  Code, não liga o envio, não altera o canal do cliente, não afeta outros tenants.
- O administrador não pode trocar silenciosamente uma instância individual
  conectada por um destinatário central; deve desconectar voluntariamente
  o canal legado antes de se registrar.
- `/enable` **não** ativa o marcador central; permanece bloqueado até existir
  circuito de envio global e validado. Na tela a inscrição mostra
  `Aguardando liberação`, nunca `Conectado`.

## Próxima etapa: envio central de várias comandas

O piloto `KOMA_CENTRAL_WA_*` anterior era de um único tenant autorizado.
Não promover esse mecanismo diretamente a multi-tenant apenas removendo
`PILOT_RESTAURANT_ID` e `PILOT_CUSTOMER_PHONE`. Antes de ativar:

1. Um gate compartilhado e persistido **por remetente central**, não apenas
   por restaurante, para controle de vazão e circuit breaker.
2. A fila carrega IDs canônicos com `restaurante_id`, jamais telefone em claro.
   No dispatch, buscar o destinatário na configuração do MESMO tenant,
   confirmar opt-in ainda ativo e revalidar identidade do remetente.
3. Mudança/desativação de destinatário deve cancelar eventos pendentes
   anteriores, sem enviar para o número cadastrado por engano.
4. Separar aceite HTTP da Evolution de entrega/lida e de
   `dead_letter`/cancelado; nunca repetir send de resultado incerto.
5. Testes em dois tenants com destinos diferentes, pedido simultâneo,
   desconexão, restrição por spam e retomada, sem reprocessar pedidos antigos.

## Próxima etapa: notificações ao cliente

- O telefone autenticado/confirmado no checkout deve estar ligado ao pedido;
  não usar telefones de outros clientes, de outros pedidos ou do restaurante.
- Obter **consentimento específico** e revogável para avisos WhatsApp no checkout,
  armazenar snapshot e proveniência, e deixar a opção desligada por padrão.
- Criar eventos idempotentes para transições relevantes: aceite, pronto para
  retirada, saída para entrega, cancelamento/recusa. Evitar cada microetapa.
- Destinatário carregado somente em dispatch com tenant-scoping e comparação
  do telefone confirmado no pedido. Sem opt-in, nenhum evento WhatsApp.
- Acompanhamento pela página do pedido e notificações internas permanecem
  funcionando sem WhatsApp.
- Implementar adapter da Meta Cloud API com templates utilitários aprovados
  para mensagens proativas, inclusive fora da janela de atendimento de 24h;
  não habilitar broadcast por Evolution.

## Prevenção de abusos e conformidade

Não existe algoritmo ou intervalo que impeça bloqueio de conta não oficial.
Não implementar mensagens aleatórias, simulação de digitação/humano,
rotação de números para fugir de limites nem técnicas para contornar detecção.
Usar identidade transparente, opt-in, opt-out, envio mínimo, cooldown,
limites conservadores, circuito aberto em falha/429 e migração à API oficial.

Referências: https://www.whatsapp.com/legal/messaging-guidelines
e https://business.whatsapp.com/policy/
