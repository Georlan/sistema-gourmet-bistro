# Canais de comunicação

Inscrição, confirmação de cadastro, recuperação de senha e convites da equipe usam e-mail pelo Resend. Inscrição não cria notificações WhatsApp, mesmo com a configuração legada habilitada. Telegram é exclusivo do administrador da plataforma para acompanhamento das inscrições; não envia convites a funcionários ou clientes.

Pedidos do cardápio online preservam o WhatsApp operacional do restaurante. A regra entre impressora e WhatsApp fica para a revisão de impressão: com impressora operacional, o alerta WhatsApp pode ser dispensado. Esta mudança não altera impressão nem suprime alertas de pedidos.

O worker mantém tentativas e expiração dos convites e inscrições. Cadastro de cliente e recuperação de senha repetem somente falhas temporárias, com a mesma chave de idempotência. Eventos assinados do Resend registram entrega, atraso ou rejeição sem armazenar destinatário, conteúdo ou token. Eventos duplicados ou atrasados não regridem uma entrega concluída para envio pendente.

Configurar um webhook no Resend para `POST /api/webhooks/resend` com eventos `email.sent`, `email.delivered`, `email.delivery_delayed`, `email.bounced`, `email.complained`, `email.failed` e `email.suppressed`. Definir o segredo do webhook em `RESEND_WEBHOOK_SECRET`; sem ele o endpoint responde 503. O endpoint verifica a assinatura sobre o corpo original e limita o tamanho da requisição. O responsável HTTP é `backend/app/routes/resend_webhook.py`; o transporte e os recibos ficam em `services/email_delivery.py`.

Metadados são gravados por funções restritas do PostgreSQL. A consulta de convites retorna apenas o restaurante autenticado. O status "entregue" significa entrega ao servidor do destinatário, não leitura ou ativação da conta. A ativação continua dependendo do uso válido do convite.
