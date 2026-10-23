# WhatsApp central: cadastro, suspensão e retomada

Decisão de produto de 23/10/2026: avisos operacionais partem somente do número do KÔMA para um destinatário explicitamente cadastrado no restaurante. Não provisionar QR, pairing ou sessão Evolution individual.

## Invariantes

- Sem transporte liberado, a publicação retorna antes de consultar a configuração do restaurante. Sem destinatário, consentimento ou permissão, não cria aviso nem consulta Evolution.
- Criação, liberação de agendados e aprovação Pix publicam somente o canal central; preservam evento canônico, push, impressão e isolamento. Hooks de status/courier legados não criam tarefas nem sessões.
- Eventos históricos do canal individual são encerrados como `dead_letter`, sem enviar nem consultar o dispositivo. Não apagar histórico.
- Desconexão/identidade ausente ou divergente do número central suspende o remetente de forma persistida. Enquanto suspenso, não criar novos avisos nem repetir chamadas por pedido.
- SuperAdmin exibe uma indicação persistente e botão explícito de retomada. Retomada faz prova nova de conexão/identidade; nunca usa o cache de leitura. A fila anterior ao instante de retomada não é enviada.
- Timeout após envio continua sem repetição automática. HTTP 429 mantém pausa conservadora; autorização e destino são relidos antes do envio.
- Cadastro e visualização do restaurante não consultam Evolution. Associação individual antiga não vira autorização central implícita; o operador cadastra explicitamente o destinatário e confirma recebimento.

## Migração e reversão

Migração `d4e5f6a7b8c9` adiciona dois timestamps nullable à tabela técnica global do remetente, sem alterar configurações/contatos/pedidos de restaurantes. Executar Alembic antes de iniciar os novos workers. Reversão de aplicação antes de downgrade de esquema; não religar o transporte individual para recuperar avisos antigos.

## Evidência e limites

Validar sem mensagens reais: nenhuma chamada externa nos caminhos inelegíveis, suspensão entre eventos, retomada somente com identidade correta, descarte de fila antiga, consentimento/cadastro, isolamento e manutenção da operação sem WhatsApp. Testes de browser simulam backend; não demonstram entrega no aparelho. ID 6: somente leitura.

Campanhas são entrega separada: valores aprovados inicialmente de interação em 21 dias, intervalo de 7 dias e até 5 por dia. Sem comprovação de interação, bloquear; não inferir conversa a partir de compra/cadastro. Esses limites em dias não se aplicam às comandas.
