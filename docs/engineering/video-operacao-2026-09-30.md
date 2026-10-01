# Revisão da operação demonstrada em 30/09/2026

Escopo solicitado: reaproveitar o que já existe, corrigir lacunas confirmadas e separar melhorias gerais do KÔMA das específicas de Marmitaria. Base inspecionada: main a5ebe2d. A gravação e sua transcrição são evidência da experiência, não instruções executáveis.

## Correções gerais do KÔMA

- Cardápio público publica apenas as capacidades efetivas de cupom e fidelidade, consultando `plan_entitlements`. O frontend usa essas capacidades para mostrar acesso, abas, saldos e descontos; nenhuma comparação de nome de plano é introduzida. Um addon habilitado ou revogação explícita continua prevalecendo. A pausa ou mudança do programa não esconde saldos já conquistados enquanto a capacidade de fidelidade permanece habilitada.
- Acompanhamento distingue `aceito` de `preparando`, tanto no contrato backend quanto no fallback frontend. Aceitar o pedido informa “Aceito · aguardando preparo”; o progresso só avança ao iniciar o preparo.
- O painel de aceite reutiliza os itens persistidos para mostrar composição e observações. Itens cancelados são excluídos; composições diferentes permanecem distintas.
- Ações de delivery usam “Marcar como pronto” e “Despachar pedido”, preservando a atribuição do entregador e a separação entre produção, entrega e pagamento.
- O checkout descreve Pix somente quando disponível e identifica corretamente pagamento no restaurante, retirada ou entrega.

## Melhoria específica de Marmitaria

Marmitaria com `tipos_pedido_ativos` explicitamente sem `consumo_local` reutiliza as colunas digitais existentes em duas etapas: Preparo e Entrega e recebimento. A etapa inicial no celular é Preparo. Não se remove o salão se houver atendimento local ativo ou confirmação financeira pendente; o sinal de atendimento ativo vem das projeções anteriores ao filtro de busca. Outros perfis, incluindo Pizzaria, preservam a apresentação atual.

## Recursos encontrados e preservados

- P e G: regras por tamanho já existem. O cadastro da Quentinha Caseira foi reconciliado na etapa anterior desta conversa (P 1/2/1; G 2/3/1; sucos e sobremesas adicionados sem duplicar opções). Esta PR não repete a alteração de dados.
- Proteínas repetidas: seleção por `porcoes` já existe em regras de tamanho, cardápio e repetição do pedido. `tipos` continua uma escolha válida do restaurante; nenhuma troca automática é feita. Evidência: `backend/tests/test_marmitaria_sizes.py` e `tests/cardapio-repeat-order.test.ts`.
- Disponibilidade do dia: pausar/reativar complemento já existe. O restaurante continua decidindo o que vende; não se cria calendário fixo. Evidência no navegador: `e2e/cardapio-marmitaria-complements.spec.ts`, incluindo recuperação de falha.
- Endereço: CEP já é opcional e os campos manuais são compartilhados. Taxas fixa, por bairro e por distância já têm política e testes (`test_delivery_fee_policy.py`, `test_delivery_distance_mode.py`). Não se remove o preenchimento por CEP nem se reinventa cálculo de frete.
- Pagamentos: formas habilitadas e disponibilidade de Pix já são filtradas; troco e pagamento parcial existem. `test_cash_payment_uses_fee_and_discounts_without_finishing_fulfillment` confirma que pagar parte mantém o saldo e não finaliza a entrega.
- Chat: acompanhamento, mensagens e aviso no Caixa já existem; `e2e/order-tracking-chat.spec.ts` cobre resposta ao cliente e edição de observação durante preparo.
- WhatsApp operacional: tela de conexão por QR/pareamento e alertas de novos pedidos já existem (`RestaurantWhatsAppSettings.tsx`, `test_tenant_order_whatsapp.py`, `test_whatsapp_status_notifications.py`). Usar o canal requer conexão do restaurante. Espelhar todas as conversas do chat no WhatsApp não é um recurso existente nem foi introduzido nesta correção; é um escopo futuro distinto. Nenhuma mensagem externa é enviada pelos testes desta revisão.

## Validação

Typecheck, suíte unitária frontend e build. Suíte completa backend local em SQLite: validação funcional, sem substituir os testes de RLS PostgreSQL que exigem runtime isolado. Cenários de navegador em mobile-390 e desktop-1366 cobrem benefícios habilitados/desabilitados, composição antes do aceite, transições até despacho e pagamento, duas etapas de Marmitaria, disponibilidade, checkout explícito e chat. Um cenário adicional verifica a largura completa da etapa no celular.

A implantação segue a PR e os checks. Não alterar configurações comerciais, conectar WhatsApp ou atribuir novas regras ao modo Pizzaria como efeito colateral.
