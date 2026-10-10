# Implantar um restaurante KÔMA

Use este checklist em cada implantação. Marque somente o que foi conferido e
registre responsável, data e evidência. Não marque testes físicos como aprovados
por status de software. A primeira cliente provavelmente será Pocket: confirme
isso na contratação antes de conceder qualquer benefício.

## Checklist mestre

| Feito | Etapa | Conferir antes de avançar |
|---|---|---|
| [ ] | [Preparar visita e coletar dados](preparation.md) | Escopo, preços, responsável, internet e hardware confirmados |
| [ ] | [Contratar e liberar acesso](signup-and-benefits.md) | Pocket aceito, autorização recorrente pronta, convite e tenant único |
| [ ] | Registrar benefício individual de impressão | Plano Pocket preservado; override efetivo; motivo na Auditoria |
| [ ] | [Primeiro acesso e configuração](initial-setup.md) | Perfil, horários, produto ativo e modalidades completos |
| [ ] | Configurar equipe e pagamentos | Operadores com acesso mínimo; offline conferido; online opcional |
| [ ] | Conferir link público | Categorias/produtos/preços/adicionais; somente meios habilitados |
| [ ] | [Instalar impressão Windows](windows-printing.md) | Pareamento correto, fila física escolhida e cupom de teste |
| [ ] | [Liberar operação e iniciar trial](signup-and-benefits.md#iniciar-os-sete-dias) | Super Admin conferiu os quatro essenciais; datas registradas |
| [ ] | [Homologar pedido e Caixa](first-shift.md) | Pedido pago e fechado; caixa conciliado; papel conferido |
| [ ] | Acompanhar primeiro turno | Nenhum pedido perdido, duplicado ou recebimento sem destino |
| [ ] | [Guardar evidências e decidir aceite](evidence-and-support.md) | Relatório completo e nenhum bloqueio aplicável aberto |

Para uma operação de quentinhas, siga também o [guia de marmitaria](marmitaria.md),
com tamanhos livres, composição e pausa diária de produtos e complementos.

## Cliente pronto para operar

- [ ] Contratação e cobrança SaaS conferidas; processo fiscal atual confirmado.
- [ ] Tenant, plano, administrador e condição especial rastreáveis.
- [ ] Quatro essenciais publicados; liberação operacional explícita; trial com início/fim visíveis.
- [ ] Pelo menos um operador consegue criar, receber, pagar e fechar pedido sem ajuda.
- [ ] Caixa abre e fecha com valores conciliados por meio de pagamento.
- [ ] Link público correto e pagamentos correspondem à operação real.
- [ ] Fora do horário, catálogo consultável e novo pedido imediato bloqueado em Automático.
- [ ] Impressão física, recuperação e logon após reinício aprovados quando usados.
- [ ] Suporte combinado, evidências guardadas e responsável do restaurante confirma prontidão.

## Pendências por momento

**Antes de cadastrar a primeira cliente:** confirmar plano/ciclo e escopo,
identidade comercial do KÔMA/termos, checkout SaaS homologado e disponível,
acesso ao Super Admin, produção saudável e revisão publicada. Não usar tenant
administrativo/QA para substituir contratação. O recebimento dos pedidos sem
Mercado Pago não dispensa a autorização da assinatura SaaS.

**Durante a implantação:** coletar cadastro/cardápio/equipe, conceder impressão
com motivo, instalar hardware, configurar offline, publicar link, liberar
trial após essenciais, realizar pedido controlado e primeiro turno. Hardware
não disponível mantém impressão bloqueada para aceite; não impede coletar dados.

**Melhoria futura:** avaliar Pix manual no checkout público (não oferecido
atualmente), registro estruturado de validade/valor do benefício e novos modelos
de impressora. Não são requisitos para operar com Dinheiro e cartões externos.

## Fontes canônicas

Este playbook orienta o operador; regras e critérios detalhados permanecem em:

- [Inscrição e cobrança](../signup-automation.md).
- [Gate de aceite](../first-client-acceptance.md) e [relatório](../first-client-acceptance-report-template.md).
- [Print Agent interno e distribuição via ZIP](../../../print-agent/README.md).
- [Incidentes](../first-client-incident-response.md) e [backup/restore](../backup-restore-drill.md).
- [Roadmap do piloto](../../../ROADMAP_PRIMEIRO_CLIENTE.md), histórico de planejamento; regras comerciais atuais prevalecem.
