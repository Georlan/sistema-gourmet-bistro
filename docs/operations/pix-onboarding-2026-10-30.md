# Pix: conexão, publicação no cardápio e recebedor único

## Contrato

Uma autorização bancária concluída pelo administrador conecta o recebedor e
acrescenta Pix às formas do cardápio na mesma transação. Dinheiro/cartões
existentes são preservados; uma conta legada sem lista mantém Dinheiro.
Falha ou cancelamento de OAuth não publica Pix nem substitui a conta anterior.
Sandbox continua sendo teste, sem promessa de dinheiro real.

Cada restaurante pode ter somente um recebedor selecionado. Tanto a emissão da
URL OAuth quanto sua conclusão conferem essa condição. A conclusão e a criação
de pedidos compartilham o bloqueio da linha do restaurante: duas autorizações
concorrentes não podem ativar dois bancos. A tela também bloqueia o outro banco
durante a consulta e durante uma operação, mas o servidor é a autoridade.

Para trocar, desconectar primeiro. Desconexão local interrompe novos Pix;
preserva as credenciais criptografadas para consultas e reembolsos históricos.
Ela não revoga o consentimento no aplicativo do banco. Intenções created,
pending ou error impedem desconexão. Identidade/ambiente de uma conta com
histórico não podem ser sobrescritos. Revogação externa permanece um
procedimento bancário separado, incompatível com prometer acesso ao histórico.

## Liberação geral

Os dois controles abaixo são desabilitados por padrão. São configurações do
servidor, nunca parâmetros aceitos do navegador ou do restaurante:

- `PAGBANK_PRODUCTION_ONBOARDING_ENABLED=true`: novos IDs usam Connect de
  produção com as credenciais `PAGBANK_PRODUCTION_*` se `PAGBANK_ENV=sandbox`.
  O cadastro no KÔMA não autoriza o banco; o administrador precisa concluir OAuth.
  `PAGBANK_SANDBOX_RESTAURANT_IDS` preserva tenants de QA explicitamente.
  QA9 em modo de evidência continua Sandbox e não materializa recebedor.
  A exceção da conta proprietária continua exclusiva do piloto 8.
- `ONLINE_PAYMENT_RECONCILIATION_CONNECTED_TENANTS_ENABLED=true`: habilita
  recuperação sem navegador para um único recebedor automático utilizável
  conectado. Fora da lista explícita de pilotos, PagBank precisa ser produção;
  Sandbox, falta de credenciais e ambiguidade não acionam consulta financeira.
  Preserva os limites existentes: até 8 tenants por ciclo, até 3 intenções por
  tenant, rotação justa e reivindicação atômica da consulta.

As listas de piloto existentes permanecem compatíveis. Não alterar `PAGBANK_ENV`
nem copiar tokens Sandbox para produção. Antes de ligar a liberação geral,
inventariar conexões Sandbox e fixá-las na lista de QA. Confirmar a homologação
da aplicação e a capacidade de cobrar em nome do vendedor autorizado.

## Validação e limites

Executar regressões de conexão/recebedores, worker, isolamento, falhas OAuth e
desconexão com histórico; concorrência real em PostgreSQL local temporário;
frontend lint/unidades/build; browser mobile e desktop com servidor exclusivo.
Os mocks não provam resposta bancária real. Para o piloto 8, conferir cobrança,
valor, referência, status no provedor e exatamente um Pagamento aprovado.
Não criar pagamentos nem pedidos sintéticos no ID 6.

Um Pix pago só libera o pedido após confirmação autoritativa, por webhook
autenticado ou consulta ao provedor. Notificações inválidas continuam recusadas;
nenhuma mudança aqui relaxa assinatura, valores, idempotência ou RLS.

O Pix é creditado na conta bancária autorizada. Poupar Automático, seguros e
tarifas são configurações/contratos do banco; o OAuth de pagamento não as
consulta nem as desativa. Não prometer permanência integral do crédito no saldo
se o titular configurou aplicação automática. Cadastro e testes do KÔMA não
comprovam nem modificam essa configuração bancária.

## Publicação e reversão

Publicar por PR revisada com checks pertinentes verdes. Confirmar os SHAs
servidos pela API e pelo frontend antes de ativar os controles. Validar status
e projeção pública com GET, além de logs/estado financeiro do piloto.

Reversão da expansão: desligar somente os dois controles gerais, preservando
as listas dos pilotos e os dados. Não apagar contas/intencões/pagamentos nem
reaplicar cobranças. A reconciliação de novos tenants deixa de ser geral;
avaliar intenções existentes antes da reversão para não interromper recuperação.
Reversão de código: revert da PR, preservando alterações posteriores.
