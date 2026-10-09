# Cardápio Online — facilitação de uso

Objetivo: reduzir configuração desnecessária, tornar funções fáceis de localizar e manter o cardápio público coerente com a operação real do restaurante.

Reconciliação em 08/10/2026 sobre main `8a7dd7c22e76`. Conclusão abaixo significa implementação incorporada; configuração de uma loja, pagamento real e resultado físico exigem evidência própria. A tasklist geral está sendo reconciliada na PR #1050; esta revisão complementa aquele trabalho sem modificar o mesmo arquivo.

## Concluído na base atual

- [x] Manter os destinos diretos do Cardápio Online no menu lateral e espelhá-los na subnavegação horizontal.
- [x] Tornar **Clientes bloqueados** um destino direto, com bloqueios ativos, histórico e ação de desbloquear. Isso não encerra a revisão de motivo da recusa do PR #328.
- [x] Tratar o horário de funcionamento como configuração geral e informativa do estabelecimento.
- [x] Manter o catálogo consultável com caixa fechado; exigir turno aberto no restaurante para novos pedidos, inclusive agendados. Pausa operacional, fechamento manual e restrições de modalidade continuam aplicáveis. [Contrato atual](../engineering/online-orders-cash-availability.md).
- [x] Usar taxa padrão e tabela de bairros no editor canônico, persistindo `tipo_taxa_entrega = bairro` (#727/#728). O valor final continua sob responsabilidade do backend. [Apresentação da entrega](../architecture/cardapio_delivery_presentation.md).
- [x] Pix: separar recebimento da venda e fatura da assinatura KÔMA; demonstrativo e situação da cobrança integrados ao Super Admin (#1046). A chave própria exige conferência manual; fatura da plataforma usa confirmação do gateway.
- [x] Pix próprio: liberação explícita para lojas de teste sem contrato (#1047) e QR derivado do Copia e Cola ao reabrir pagamento, com orientação de confirmação manual (#1049). Simulações incluíram checkout, reabertura e confirmação única; não comprovam transferência real.

## Plano anterior substituído — não executar como pendência

A antiga onda previa distância obrigatória, taxa mínima + valor/km, GPS/ponto de partida e sugestão baseada no histórico. #727/#728 substituíram essa direção por bairros. Portanto, seus critérios antigos (`tipo_taxa_entrega = distancia`, ausência de seletor de bairros e base R$ 5 + R$ 1/km) foram retirados do backlog ativo. Uma eventual volta à distância exige nova decisão de produto.

Fechamento automático por agenda e mensagem de próxima abertura como condição de aceitar pedidos também foram substituídos pela decisão de 30/09/2026: agenda informativa e disponibilidade canônica dependente do caixa. Horário e override Forçado Aberto não substituem turno aberto.

## Pendências atuais — sem duplicar trabalho paralelo

- [ ] Reconciliar bloqueio de cliente e motivo de recusa do PR #328 com os owners atuais; preservar bloqueios ativos/histórico e testar a comunicação pública sem expor dados administrativos.
- [ ] Revisar diferenças e checks das PRs #1010/#1011/#1012 antes de implementar restrição de cobertura ou atribuição de aquisição. Continuam abertas nesta consulta; não marcar cobertura restrita como entregue nem integrar as três em lote.
- [ ] Validar entrada decimal e comunicação de taxa no fluxo atual por bairros, em celular e desktop, usando APIs simuladas; não transportar automaticamente critérios do antigo campo valor/km.
- [ ] Consolidar navegação/configurações onde ainda houver duplicação, preservando os owners de entrega, pagamentos, horários e disponibilidade.
- [ ] Homologar cobrança/Pix por etapas autorizadas: migração e allowlists, demonstrativo, confirmação no gateway, desbloqueio e recibos dos avisos. Implementação incorporada não comprova configuração ou pagamento real; esta revisão não ativa lojas.
- [ ] Reconciliar pagamento dividido após conclusão da PR #1042. Está aberta e não deve aparecer como entregue.

## Critérios para a próxima onda

1. Partir da main atual e comparar PRs abertas antes de alterar o mesmo fluxo.
2. Preservar taxa por bairros, escopo do restaurante e valor final do servidor.
3. Confirmar disponibilidade pelo servidor; retorno à aba/reconexão não pode liberar pedidos com estado desconhecido.
4. Testar cliques com dados e APIs simulados, sem pedidos, pagamentos ou configurações reais.
5. Registrar separadamente implementação, checks, versão publicada e homologação operacional; manter a tasklist geral como referência das pendências de Super Admin e impressão.
