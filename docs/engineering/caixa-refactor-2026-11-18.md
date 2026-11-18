# Caixa: correção de itens e leitura do turno

Base: `1792e211` (main). Escopo autorizado: refazer as telas atuais de Caixa e permitir corrigir itens errados, preservando a operação real. Produção consultada sem escritas em pedidos, pagamentos ou configurações.

## Evidência de navegação

- BeeFood: sessão autenticada em `/caixa`, listagem de 37 turnos, identificação de operadores, saldos esperados/declarados, diferença e quantidade de operações. Clique em **Cancelamentos**: filtros e histórico com registro, campo, antes/depois. Nenhuma abertura, reabertura, cancelamento ou exportação executada. Detalhes de turno não foram abertos.
- KÔMA: sessão autenticada, **Caixa → Turno atual → Movimentações → Fechamento**. Turno atual mostrou 35 contas recebidas; Movimentações mostrou zero registros; Fechamento mostrou 20 contas abertas. Não foi enviado nenhum formulário.
- O detalhe de Salão e a ausência de retirada individual foram verificados também pelas capturas fornecidas e pelo código. As novas retiradas foram exercitadas somente em fixtures isoladas.

## Três atritos

1. Corrigir uma unidade errada exigia sair do fluxo ou cancelar um escopo maior: o servidor já cancelava itens, mas o detalhe do Caixa não oferecia a ação. Agora cada grupo tem **Retirar item**, confirmação e seleção explícita da unidade, preservando os IDs individuais.
2. O resumo usava textos de 9–11 px e escondia a devolução dentro de “Ações”. Agora valores, metadados e botões têm hierarquia legível, alvos de pelo menos 44 px no Caixa e devolução direta junto do recebimento. O dinheiro esperado passa a ser o primeiro indicador.
3. “Movimentações” parecia incluir recebimentos, mas mostrava apenas entradas/retiradas manuais; o cabeçalho de métricas do componente antigo nem era renderizado pelo OperationalBanner. Agora a tela informa **Entradas e retiradas**, identifica o operador, mostra totais dos resultados e mantém motivo/observação legíveis. A lista é ordenada explicitamente do mais recente para o mais antigo.

## Caminhos e cliques

Ponto inicial: Turno atual já aberto; contagem até abrir o formulário/detalhe, sem confirmar operações financeiras. A sequência antiga de devolução foi conferida no código; a nova foi exercitada em fixture. Não há comparação de velocidade com dados sintéticos contra produção.

| Tarefa | Antes | Depois |
| --- | --- | --- |
| Ler dinheiro esperado | 0; quadro lateral | 0; primeiro indicador e composição lateral |
| Abrir devolução de uma venda recente | Ações → Fazer devolução: 2 | Devolver: 1 |
| Adicionar/retirar dinheiro | 1 | 1; texto e área de toque ampliados |
| Abrir conferência | 1 | 1; preserva confirmação final e conferência cega |
| Retirar item com detalhe já aberto | Sem ação individual | Ver itens → Retirar item → Confirmar retirada: 3; +1 escolha se agrupado |

## Contratos preservados

- `useCashierOrders` continua dono das mutações; `CaixaPanel` apenas encaminha callbacks. A retirada usa `PUT /comandas/itens/{id}/cancelar`, sem uma segunda rota de negócio.
- Cancelar item não é apagar histórico nem mudar o status do pedido/entrega. Estoque, auditoria, locks, pagamento ativo, conta fechada, isolamento de restaurante e idempotência continuam no backend.
- Cobrança online `pending`, `pending_released` ou `approved` bloqueia retirada no servidor e na interface. A correção não muda silenciosamente o valor de um Pix já emitido/confirmado.
- A última unidade ativa da conta continua exigindo o fluxo de cancelamento do pedido/mesa. A mensagem do Caixa explica isso sem mencionar regras do garçom.
- Após sucesso, o detalhe fecha e o owner relê as filas/totais canônicos. Busca e rolagem da fila não são redefinidas. Em falha, seleção e detalhe permanecem disponíveis.
- Além de `tables_updated` para caixa/garçom/KDS/SmartPOS, a transação enfileira refresh do tracking e somente do entregador associado. Usa os mecanismos existentes após commit; nenhum evento de lifecycle inventado, payload operacional público ou novo polling.
- Conferência rápida/cega, bloqueios por contas/pagamentos, autorização de gerente na retirada de dinheiro e confirmação de fechamento permanecem. Depois de uma devolução, resumo e pedidos são relidos.

## Validação e limites

Fixtures de pedidos e Caixa exercitam agrupamento, escolha de unidade, pagamento aprovado, falha do servidor, repetição de clique, ordenação, filtros, temas claro/escuro e conferência cega com falha/retenção do formulário. Larguras 360/390/1366, texto padrão e ampliado.

A comparação com `origin/main` reproduziu três falhas preexistentes em `cashier-boundaries.spec.ts` no desktop (recarga de rota, cadastro de mesa, exclusão de mesa). Os dois testes de fechamento afetados foram executados separadamente. `audit:light` também falha na base e nesta branch com os mesmos tokens ausentes no parser; não foi declarado aprovado. Não foram alterados testes para ocultar essas falhas.

Não foram criadas telas de histórico completo de turnos ou auditoria equivalente à do BeeFood: não existe API de leitura correspondente no Caixa atual. O registro de cancelamentos continua no ActivityLog existente. As fixtures não são expostas no build de produção.

Reversão: reverter o commit/PR desta alteração; não há migração ou alteração de dados legados.
