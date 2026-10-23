# Campanhas pelo número central do KÔMA

Preparação separada dos avisos de pedidos. O transporte promocional permanece desligado por padrão (`KOMA_CENTRAL_WA_CAMPAIGNS_ENABLED=false`) e exige uma lista explícita `KOMA_CENTRAL_WA_CAMPAIGN_RESTAURANT_IDS`, além das permissões do transporte central. Não ativar esta entrega antes da integração de entrada autenticada e da validação da origem da autorização promocional.

## Regras aprovadas

- Mensagem recebida comprovada nos últimos 21 dias, vinculada ao telefone atual e ao restaurante. Compra, cadastro, clique ou abertura de conversa não comprovam interação.
- Autorização promocional separada e respeito ao cancelamento. A API de preferências do operador não permite fabricar autorização nem histórico recebido.
- Intervalo conservador de 7 dias por cliente, contado desde a reserva da tentativa e considerando contatos manuais confirmados anteriores.
- Até 5 tentativas promocionais no total do remetente por dia de Fortaleza, com reserva sob o mesmo bloqueio global usado pelos avisos operacionais. Comandas não consomem essa cota.
- Janela das 10h (inclusive) às 21h (exclusive), America/Fortaleza. Fora da janela ou após a quinta tentativa, reagendar para a próxima janela sem chamar o provedor nem gastar tentativa. A mensagem preparada expira em 48 horas; excedentes não são mantidos indefinidamente.
- Identificador idempotente por restaurante, campanha e cliente. Telefone e texto não são armazenados no evento. Revalidar autorização, telefone, mensagem, janela e suspensão antes do envio.
- Resposta HTTP do provedor significa aceitação, não entrega no aparelho. Timeout/resultado incerto não autoriza repetição automática.

A interface prepara o envio central e bloqueia clientes sem comprovação. Não abre o WhatsApp individual nem registra entrega manual automaticamente. O perfil canônico do CRM preenche os campos da mensagem e valida cupons; o texto identifica o restaurante e inclui saída das promoções.

## Limitação deliberada desta entrega

O adaptador de mensagens recebidas autenticadas ainda não existe. Os novos campos começam vazios e a autorização promocional começa falsa. Por isso nenhum cliente real fica elegível e nenhum envio promocional deve ser ativado nesta publicação. É necessário integrar a fonte autenticada, registrar a autorização com evidência e validar um piloto autorizado antes da ativação. Fixtures locais com evidência simulada só demonstram as regras de bloqueio e concorrência.

## Migração e reversão

`e5f6a7b8c9d0` adiciona campos às preferências CRM e dois contadores à tabela global do remetente; mantém dados existentes e não concede autorização. Rodar migração antes dos workers. Em reversão, desligar o transporte promocional, reverter a aplicação e só depois remover as colunas. Não reabrir envios manuais nem recuperar mensagens antigas como compensação.

Validação: testes locais de autorização e fila, concorrência PostgreSQL entre restaurantes pela quinta vaga, upgrade/downgrade com dados existentes, contrato CRM no celular e desktop, lint, unitários e build. Nenhuma mensagem real ou alteração de teste no ID 6.
