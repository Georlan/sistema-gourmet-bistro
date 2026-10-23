# Aceite promocional confirmado pelo WhatsApp do cliente

Decisão do titular: aceite por restaurante e confirmação pela própria conta do cliente. Preparar, copiar, abrir ou visualizar um convite nunca registra autorização nem interação. O canal fica desligado por padrão e não envia convites ou mensagens automaticamente.

## Fluxo

1. Após pedido do cliente, operador com permissão `clientes:operar` prepara um convite para um cliente da própria loja. O servidor valida a liberação e o telefone e grava somente um desafio pendente com validade de 30 minutos. Um convite novo invalida o anterior.
2. O link usa `/w/c#...`: o token fica no fragmento, é removido antes da inicialização da interface e não entra em analytics, armazenamento local ou query string. A prévia é limitada por IP, não grava consentimento e não consulta o provedor.
3. A página identifica a loja e o final do telefone. O cliente escolhe abrir seu WhatsApp e enviar o texto explícito, sem alterações. Não há confirmação por clique HTTP.
4. Somente o receptor autenticado de entrada pode consumir o desafio e registrar autorização, momento e impressão digital do comprovante. É necessário corresponder loja, cliente, telefone atual, conta remetente da mensagem e texto explícito. O registro é confirmado dentro da transação com escopo do restaurante. O operador usa “Conferir aceite” para uma leitura nova daquele cliente; não há polling nem confirmação local sem resposta do servidor. Cancelamento de promoções é refletido nessa leitura e não expira com a janela de interação.
5. Mensagens repetidas não renovam a janela de 21 dias. Dois eventos concorrentes com IDs diferentes consomem o mesmo desafio uma única vez. Cancelamento posterior à emissão do convite prevalece; este fluxo não reativa descadastros existentes.

Não inferir interação de compra/cadastro nem atribuir qualquer conversa no número compartilhado a todas as lojas. Neste piloto, a interação comprovada vem da confirmação identificando a loja; mensagens comuns sem contexto autenticado de restaurante são ignoradas. Pode ser necessário renovar o convite após 21 dias. LIDs só são aceitos quando o provedor autenticado fornece `remoteJidAlt` com telefone; sem esse mapeamento não existe inferência nem consulta adicional.

## Receptor e liberação

`POST /api/integrations/whatsapp/central/inbound` exige o header secreto `x-koma-whatsapp-secret` antes de ler o corpo ou criar sessão SQL. Sem liberação retorna 503; sem autenticação retorna 401. Corpo limitado a 64 KiB. Aceita somente `messages.upsert` da instância central configurada, com identidade do Business correspondente ao número autorizado do KÔMA, mensagem recebida (`fromMe=false`), conversa individual e texto suportado. Eventos com mais de dez minutos ou mais de um minuto no futuro são ignorados; pequeno desvio futuro é limitado ao momento observado. Grupos, eco de envio, mídia, ausência de identidade, telefone divergente e alteração do texto não geram aceite.

Variáveis, todas ausentes/desligadas por padrão:

- `KOMA_CENTRAL_WA_CONSENT_ENABLED=false`
- `KOMA_CENTRAL_WA_CONSENT_RESTAURANT_IDS=` — lista explícita, independente da lista de campanhas.
- `KOMA_CENTRAL_WA_INBOUND_SECRET=` — segredo aleatório de pelo menos 32 caracteres, diferente da chave administrativa do provedor. Não colocar em URL, mensagens, logs ou repositório.

Antes de liberar: conferir a configuração existente da instância Evolution, preservar outros consumidores e configurar callback HTTPS, autenticação customizada e `MESSAGES_UPSERT`, sem base64 de mídia. Validar a configuração por nova leitura. A instância consultada em 23/10 não tinha webhook próprio cadastrado; isso não prova ausência de integrações globais. Não substituir um consumidor existente sem reconciliar o uso.

A captura de aceite tem chave própria. Habilitá-la não habilita campanhas: `KOMA_CENTRAL_WA_CAMPAIGNS_ENABLED` permanece desligada até liberação específica e prova do caminho real. Não usar o ID 6 para testes nem gerar mensagens, pedidos ou configurações sintéticas.

## Migração e reversão

`f6a7b8c9d0e1` adiciona quatro campos nullable às preferências CRM; não concede autorização nem altera pedidos, pagamentos ou impressão. A migração deve preceder o início da aplicação. Em reversão, desligar a captura de aceite e os disparos, preservar os comprovantes e os cancelamentos e reverter a aplicação mantendo o esquema aditivo. O downgrade recusa apagar auditoria de consentimentos já recebidos sem sua preservação prévia. Reverter o esquema só depois de tratar explicitamente a evidência; não apagar consentimentos para forçar deploy. Preservar a remoção do fragmento e o bloqueio de analytics em `/w/c` também numa reversão de frontend, inclusive para convites antigos.

## Evidência e limites

Testes isolados cobrem autenticação antes de SQL, token expirado/alterado, texto/telefone divergentes, cancelamento, repetição, PN/LID e prova HTTP. PostgreSQL usa papel restrito com FORCE RLS e dois recebimentos concorrentes pelo mesmo desafio. Browser verifica convite, ausência de confirmação por visualização, privacidade do fragmento e bloqueio da campanha enquanto falta prova.

Fixture local e resposta HTTP não comprovam recebimento real do WhatsApp. Após publicação, o receptor continua desligado até autorização de configuração e escolha explícita da loja piloto. Nenhuma mensagem real foi enviada pelos testes.
