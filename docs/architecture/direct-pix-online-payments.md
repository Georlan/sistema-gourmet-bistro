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

A intenção permanece `pending` e a comanda mantém `online_payment_status=pending`; a interface usa o rótulo `aguardando_aprovacao_pix`, sem criar outro estado financeiro incompatível. O painel de pendências fica na tela de pedidos do Caixa, separado da fila de produção. Polling de 15 segundos pausa em aba oculta e é desmontado ao sair.

`POST /payments/direct-pix/{intent_id}/confirm` exige `caixa:operar`, tenant autenticado, valor integral, EndToEndId e declaração de conferência do extrato. Usa lock da intenção, auditoria única e o mesmo `apply_provider_snapshot_in_session`: Pagamento aprovado, itens pagos, outbox e autoaceite conforme a configuração existente, tudo na mesma transação. Repetição não duplica financeiro, estoque, impressão ou publicação.

`POST .../{intent_id}/cancel` exige declaração de ausência de recebimento. Não cancela Pix aprovado. Fechar caixa com Pix direto pendente exige resolvê-lo primeiro; nenhuma chamada ao Mercado Pago tenta conciliar uma transferência direta.

Comprovante do cliente não valida pagamento. A confirmação depende do julgamento do operador; não equivale a verificação bancária automática. EndToEndId pode ser difícil de localizar em alguns aplicativos — validar esse processo com a cliente antes da ativação.

Devoluções diretas exigem o banco. A interface genérica de estorno foi bloqueada para não produzir uma devolução fictícia; o fluxo de registro bancário e ajuste/credito de comissão após devolução ainda precisa de evolução antes de uma liberação ampla.

## 4. Fechamento e recebimento SaaS

Fechamento usa mês civil em America/Sao_Paulo e data da confirmação manual, com intervalo [início, próximo mês). Considera somente receipts do tenant, aprovados e ainda não associados a fatura; soma valores arredondados persistidos, sem recalcular pela taxa de um catálogo novo. Competência aberta não pode ser fechada. Lock curto do restaurante serializa fechamentos e a unicidade torna retries idempotentes.

Anual: parcela fixa R$0; pagamento da fatura de uso não estende outro ano de assinatura. Mensal por Pix: inclui a parcela cujo vencimento está no mês seguinte à competência. Uma parcela já emitida pelo fluxo SaaS anterior mantém a cobrança anterior, evitando duplicidade na transição. Mensal com cartão/saldo recorrente: ativação é recusada até migração explícita para Pix; não alterar cobranças recorrentes silenciosamente.

O job `backend/scripts/close_direct_pix_month.py --tenant ID` fecha o mês anterior e deve ser agendado diariamente com allowlist explícita de tenants. Não há descoberta global nem alteração automática no tenant 6. O agendamento de produção não foi instalado nesta tarefa.

API `POST /payments/direct-pix/invoices/{id}/pix` gera cobrança na conta da plataforma, por valor total da fatura e idempotência determinística. A tela de Integrações lista as faturas e permite pagar/conferir. O webhook SaaS existente verifica assinatura, consulta o gateway e concilia referência, ID externo, moeda, método e valor antes de quitar. Mensalidade consolidada substitui a cobrança fixa daquele vencimento; anual não altera o período pago. Reemissão de cobranças encerradas exige conciliação e não cria outro Pix silenciosamente.

Não confundir fatura comercial com emissão de nota fiscal. Não foram implementadas suspensão, alteração de landing, mudança unilateral de contrato ou régua de cobrança por WhatsApp.

## 5. Liberação segura

1. Revisar a PR e aplicar a migração com a flag desligada. Se o lock não for obtido em 2s, falhar e reagendar; não aumentar timeout na operação ativa.
2. Homologar com chave e valores de teste em tenant descartável: QR em aplicativos bancários, conferência de extrato, repetição, cancelamento, turno, cobrança SaaS e webhook real.
3. Finalizar o fluxo de devolução/ajuste de taxa e resolver cobranças recorrentes incompatíveis.
4. Agendar o fechamento com allowlist; atualizar o aceite contratual do recebimento direto e avaliar os textos comerciais aplicáveis.
5. Ativar apenas no restaurante que escolheu esse modo. Não selecionar chave, criar pedido ou modificar configuração do tenant 6 como QA.

Testes locais não comprovam homologação bancária, webhook em produção ou ausência absoluta de latência em uma migração real.
