# Pix direto no KÔMA

## Contrato de produto

A comissão contratada incide somente sobre pagamentos online do cardápio. Dinheiro e cartão físico na entrega não criam intenção online nem comissão. Mercado Pago continua com split; Pix direto recebe na chave do restaurante e fatura a comissão posteriormente. `fee_settlement=invoiced` identifica a modalidade, mas somente a confirmação manual torna a taxa elegível ao fechamento.

O modo é opt-in por restaurante, com aceite da confirmação manual e da cobrança mensal. `DIRECT_PIX_ENABLED=false` é o padrão. Uma configuração direta selecionada com a flag desligada falha fechada: jamais redireciona vendas automaticamente ao Mercado Pago. Cobranças antigas seguem o provedor persistido na intenção, mesmo após trocar o modo.

## 1. Dados e implantação

Migração `d1e2f3a4b5c6`: coluna nullable `fee_settlement` sem default/backfill e ampliação do CHECK de provider em `online_payment_intents`. Nenhuma credencial ou linha Mercado Pago é modificada.

Configuração fica em tabela auxiliar `restaurant_direct_pix_configs`, porque `restaurant_payment_accounts` exige tokens OAuth e aceita apenas Mercado Pago. Armazena chave criptografada, tipo, nome, cidade, seleção, versão do aceite, operador e horário. QR e valor são congelados na própria intenção.

`direct_pix_receipts` registra conferência, operador, horário, referência EndToEndId e taxa monetária congelada. Uma referência bancária não pode confirmar dois pedidos do mesmo tenant. `direct_pix_fee_invoices` identifica a competência com unicidade por restaurante/mês e guarda taxas, parcela fixa, vencimento, cobrança externa e quitação.

As três tabelas novas têm RLS ENABLE/FORCE, políticas USING/WITH CHECK e grants mínimos para `koma_app`. PostgreSQL usa `lock_timeout=2s`, `statement_timeout=30s` e CHECK `NOT VALID`, evitando backfill ou varredura da tabela existente. DDL ainda exige lock breve de metadados: não é correto prometer lock zero. Validar o CHECK em uma operação posterior separada. SQLite reconstrói a tabela por batch; não aplicar essa estratégia ao PostgreSQL.

Rollback operacional: desligar novas ativações e manter resolução de intenções antigas. Downgrade de esquema recusa remover evidência se existirem intenções Pix direto.

## 2. Pix público

O backend gera TLV EMVCo, GUI `br.gov.bcb.pix`, chave, moeda 986, país BR, valor com duas casas, nome ASCII até 25 caracteres, cidade até 15, txid alfanumérico até 25 e CRC16/CCITT-FALSE. Não usa API bancária, certificado ou consulta DICT. A validação local de formato não prova registro/titularidade da chave.

O QR visual usa `qrcode.react`, já instalado no frontend; o backend entrega Copia e Cola. Não há nova dependência Python para imagem. O BR Code é estático: não recebe promessa de expiração bancária nem uso único. Cancelamento no KÔMA não invalida um QR já copiado; o restaurante precisa tratar transferências tardias e duplicadas no banco.

Referência normativa: https://www.bcb.gov.br/content/estabilidadefinanceira/pix/Regulamento_Pix/II_ManualdePadroesparaIniciacaodoPix.pdf

## 3. Operação

A intenção financeira permanece `pending` até o recebimento ser conferido. A comanda nasce com `online_payment_status=pending` e não entra na operação automaticamente. O operador com `caixa:operar` pode (a) confirmar recebimento visto no extrato ou (b) explicitamente `release-unpaid` para entrar no Kanban, preservando a intenção pendente e a comanda marcada `pending_released` (nunca paga). O painel do Caixa mantém o pedido visível em ambos os casos, inclusive sem clique de "Já paguei". O polling de 15 segundos pausa em aba oculta e é desmontado ao sair.

`POST /payments/direct-pix/{intent_id}/confirm` exige `caixa:operar`, tenant autenticado, valor integral e declaração explícita de conferência do extrato. O identificador bancário é **opcional**: quando o banco não o exibe, o recibo preserva `bank_reference=NULL`; não é inventado EndToEndId ou referência de banco. Referência fornecida continua limitada a 6–32 caracteres, única por tenant e nunca é o TXID do QR. O recibo registra operador, horário, valor/taxa, pedido e intenção; a confirmação é manual, não uma verificação automática. Usa lock e `apply_provider_snapshot_in_session`, com pagamento aprovado, itens pagos, outbox e autoaceite transacional e idempotente.

`POST /payments/direct-pix/{intent_id}/release-unpaid` exige `caixa:operar` e confirmação explícita de risco operacional: publica o pedido no Kanban e audita operador/horário, mantendo `intent.status=pending`, sem criar `Pagamento`, sem baixar como pago nem fazer autoaceite. A publicação única por pedido é reutilizada pelo caminho de aprovação: se o Pix for confirmado depois, só os efeitos financeiros se aplicam; não duplica `OrderCreated`, avisos, impressão ou estoque. Links do WhatsApp contêm somente a referência natural do pedido para contato e **nunca autorizam mudança de status**. Na UI, a ação `Liberar preparo · conferir depois` envia a confirmação de risco diretamente ao backend; não exige etapa intermediária nem identificador bancário.

`POST .../{intent_id}/cancel` exige declaração de ausência de recebimento. Não cancela Pix aprovado. Fechar caixa com Pix direto pendente exige resolvê-lo primeiro; nenhuma chamada ao Mercado Pago tenta conciliar uma transferência direta.

Comprovante, código ou aviso do cliente não validam pagamento. O número canônico do pedido (ex.: #47) permanece como identificação normal do pedido, sem uma etapa extra de copiar ou enviar um código para o Pix manual. A tela do cliente mantém QR e Pix Copia e Cola para efetuar o pagamento; o Caixa não exige digitar o identificador bancário para confirmar uma conferência real de extrato. A fila mostra todas as intenções `created`/`pending` com nome e telefone (quando disponível) apenas ao operador autorizado. O WhatsApp abre conversa voluntária com pedido/valor; não confirma nem libera sozinho. Sem ID da operação, o operador pode registrar confirmação **somente se tiver conferido efetivamente o crédito no banco**, com `bank_reference=NULL`, ou liberar **sem afirmar pagamento** por ação separada. Cancelar pedido já em produção pelo modal Pix é bloqueado; requer regularização operacional, respeitando estoque e status. Pix ainda não pago continua impedindo fechamento do turno original. Essa liberação é opt-in *por pedido de Pix direto* e não altera Mercado Pago, PagBank ou pedidos que usem outros meios. O Caixa exibe duas decisões principais: conferir a entrada do Pix no banco e marcar recebido, ou liberar ao Kanban com o Pix ainda pendente para conciliação posterior. O clique opcional do cliente em “Já paguei” não confirma recebimento nem libera preparo.

Devoluções diretas exigem o banco. A interface genérica de estorno foi bloqueada para não produzir uma devolução fictícia; o fluxo de registro bancário e ajuste/credito de comissão após devolução ainda precisa de evolução antes de uma liberação ampla.

## 4. Fechamento e recebimento SaaS

Fechamento usa mês civil em America/Sao_Paulo e data da confirmação manual, com intervalo [início, próximo mês). Considera somente receipts do tenant, aprovados e ainda não associados a fatura; soma valores arredondados persistidos, sem recalcular pela taxa de um catálogo novo. Competência aberta não pode ser fechada. Lock curto do restaurante serializa fechamentos e a unicidade torna retries idempotentes.

Anual: parcela fixa R$0; pagamento da fatura de uso não estende outro ano de assinatura. Mensal por Pix: inclui a parcela cujo vencimento está no mês seguinte à competência. Uma parcela já emitida pelo fluxo SaaS anterior mantém a cobrança anterior, evitando duplicidade na transição. Mensal com cartão/saldo recorrente: ativação é recusada até migração explícita para Pix; não alterar cobranças recorrentes silenciosamente.

O job `backend/scripts/close_direct_pix_month.py --tenant ID` fecha o mês anterior e deve ser agendado diariamente com allowlist explícita de tenants. Não há descoberta global nem alteração automática no tenant 6. O agendamento de produção não foi instalado nesta tarefa.

API `POST /payments/direct-pix/invoices/{id}/pix` gera cobrança na conta da plataforma, por valor total da fatura e idempotência determinística. A tela de Integrações lista as faturas e permite pagar/conferir. O webhook SaaS existente verifica assinatura, consulta o gateway e concilia referência, ID externo, moeda, método e valor antes de quitar. Mensalidade consolidada substitui a cobrança fixa daquele vencimento; anual não altera o período pago. Uma nova tentativa de pagamento só é criada após o gateway confirmar estado terminal da cobrança anterior; mantém histórico dos IDs e idempotência por tentativa. Cobranças pendentes são reutilizadas.

Não confundir fatura comercial com emissão de nota fiscal. Não foram implementadas suspensão, alteração de landing, mudança unilateral de contrato ou régua de cobrança por WhatsApp.

## 5. Liberação segura

1. Revisar a PR e aplicar a migração com a flag desligada. Se o lock não for obtido em 2s, falhar e reagendar; não aumentar timeout na operação ativa.
2. Homologar com chave e valores de teste em tenant descartável: QR em aplicativos bancários, conferência de extrato, repetição, cancelamento, turno, cobrança SaaS e webhook real.
3. Finalizar o fluxo de devolução/ajuste de taxa e resolver cobranças recorrentes incompatíveis.
4. Agendar o fechamento com allowlist; atualizar o aceite contratual do recebimento direto e avaliar os textos comerciais aplicáveis.
5. Ativar apenas no restaurante que escolheu esse modo. Não selecionar chave, criar pedido ou modificar configuração do tenant 6 como QA.

Testes locais não comprovam homologação bancária, webhook em produção ou ausência absoluta de latência em uma migração real.

## Evolução de cobrança e apresentação — 08/10/2026

Regra escolhida: taxas por mês civil, cobradas no próximo vencimento do restaurante.
O vencimento acompanha o fim do trial e o aniversário da assinatura, com ajuste
para o último dia dos meses curtos sem deslocar o aniversário nos meses seguintes.
O Pix da fatura usa a conta Mercado Pago da plataforma, com confirmação financeira.
A tela distingue recebimento das vendas, conferência manual da chave própria e
pagamento da fatura KÔMA. Não apresenta cartão online como disponível.

Novas faturas recebem `due_at` congelado; a migração nullable não modifica faturas
anteriores nem inventa vencimentos históricos. O demonstrativo mostra mensalidade,
taxas persistidas, total, vencimento e pagamentos por pedido, com páginas de 200
linhas. As taxas não são recalculadas pelo catálogo ou plano atual. A tela mostra
os termos comerciais aceitos e exige sua disponibilidade para ativar a chave.
Consultar o pagamento da fatura usa um GET que não gera nova cobrança e libera a
transação de leitura antes de consultar o gateway. Enquanto o QR está visível,
a consulta automática ocorre a cada 15s, por até 20 tentativas; para em aba oculta
e é desmontada ao sair. O webhook continua sendo o canal durável de confirmação.

Após 3 dias de tolerância, o Order Core recusa novas vendas, inclusive lançamentos
novos em contas existentes. Replays idempotentes, pagamento da fatura, histórico e
resolução de pedidos já criados permanecem disponíveis. A restrição financeira não
modifica `saas_status` nem remove a precedência da suspensão administrativa.
A confirmação da fatura libera essa restrição somente se não houver outra cobrança
vencida. Para mensalidade Pix, a renovação usa o vencimento contratual após o trial;
pagar atrasado não troca automaticamente o dia de vencimento.

A manutenção de cobrança fica conectada ao lifespan existente, com execução horária
e allowlist explícita `DIRECT_PIX_BILLING_TENANT_IDS`. A lista vazia não descobre nem
modifica restaurantes. Recupera até 24 competências por passagem, sem varrer todos
os tenants. Não criar faturas na implantação antes do início real do trial.
Emissão, proximidade (3 dias), atraso e pagamento enfileiram avisos para o proprietário
nos destinos existentes de email e Telegram. IDs por fatura/evento/canal evitam avisos
duplicados; um aviso de mensalidade avulsa não é repetido se houver fatura consolidada
para o mesmo vencimento. A entrega utiliza `signup_notifications`, sem fila nova.

A lista do SuperAdmin mostra cobranças abertas, vencimento, situação da assinatura
e restrição de vendas; o histórico consulta as últimas 24 competências sob o escopo
RLS do restaurante. Ausência de fatura não equivale a pagamento comprovado.

### Pendências de implantação externa

Aplicar a migração e validar o head publicado; configurar a allowlist somente para
os restaurantes autorizados; verificar entrega real dos avisos e homologar um
pagamento de fatura com o gateway. Não foi alterado nenhum tenant de produção nesta
implementação. Testes locais/CI não comprovam entrega por email/Telegram ou dinheiro
liquidado. A chave própria continua manual: confirmação automática do consumidor
exige integração validada com banco/provedor e credenciais elegíveis. Conta CPF,
por si só, não comprova disponibilidade de API. Devolução bancária e crédito de
comissão do Pix direto continuam como evolução separada.

### Liberação administrativa de teste sem contrato

`DIRECT_PIX_TEST_TENANT_IDS` é uma allowlist explícita e vazia por padrão. Ela permite
apenas registrar Pix próprio em lojas sem assinatura e sem contrato vinculado.
Não cria aceite, mensalidade ou assinatura; não substitui termos inválidos nem
contorna assinatura já existente. A tela identifica o teste e alerta que o QR
movimenta dinheiro real, com conferência manual. A ativação gera auditoria
`DIRECT_PIX_TEST_ACTIVATED`. Configurações usam `direct-pix-test-v1`; remover o ID
da allowlist impede novos pagamentos nessa configuração. Intenções anteriores
continuam podendo ser conciliadas manualmente. Sem assinatura, o fechamento
mensal automático permanece inativo; os valores de taxa registrados são de teste.
