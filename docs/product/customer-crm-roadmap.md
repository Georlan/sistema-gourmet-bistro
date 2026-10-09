# CRM Kôma: conhecer, reter e reconhecer clientes

Pesquisa: 9 de outubro de 2026. Fontes públicas oficiais; recurso não descrito não significa inexistente.

## Referências

- Consumer Connect: ranking de quem mais consumiu por período, clientes inativos por dias e mapa de concentração. https://ajuda.programaconsumer.com.br/quais-relatorios-estao-presentes-no-consumer-connect/
- Consumer: programa por pontos ou cashback. https://loja.consumer.com.br/home/compare
- Saipos CRM/Glutões: segunda compra, reativação, cashback, campanhas via API oficial do WhatsApp e horário médio de consumo. https://saipos.com/sistema/saipos-crm
- Sischef: extrato, histórico e ticket médio; campanhas por novos, frequentes e inativos; recuperação de carrinho e mensuração de retorno. https://sischef.com/planos/ e https://sischef.com/modulo-crm/
- Linx: fidelidade personalizada para restaurantes; Reshop fornece inteligência promocional, cashback e CRM no varejo. Não presumir que todo recurso do Reshop está no Menew. https://mkt.linx.com.br/food-sistema-para-restaurantes e https://www.linx.com.br/linx-reshop/
- Anota AI: apresenta CRM e marketing, além de integração com RD Station; a página não detalha todas as métricas. https://anota.ai/home/ e https://anota.ai/home/integracoes/

## Primeira entrega implementada

Lista como conteúdo principal, sem precisar atravessar os painéis de satisfação. Ordenação inicial por compras concluídas, desempate por valor pago, nome e ID. Ordens alternativas por valor, recência, ausência e nome. Filtros de recorrentes (2+), atenção, reativar e sem compra; busca por telefone com ou sem máscara.

Cada cliente apresenta compras concluídas, última compra, total pago, ticket médio, até três produtos favoritos e benefício já existente. As métricas abrangem todo o histórico, sem filtro de período nesta entrega. “Pedidos” preserva o contrato atual: conta Comandas fechadas elegíveis, não lançamentos de produção. Item representa uma unidade; favoritos usam contagem de unidades, sem cancelados, com vínculo explícito de restaurante, comanda e cliente. Nome do favorito é o nome atual do catálogo, não uma reconstrução do nome na data da compra.

Painéis anteriores seguem disponíveis em “Relacionamento e satisfação”. Cadastro, edição, saldo, regras de fidelidade, cupons e checkout permanecem nos fluxos canônicos. Sem migração, backfill, unificação de clientes ou alteração de dados de produção.

## Próximas etapas

1. Ficha do cliente: linha do tempo paginada de compras, valor, canal, itens e benefícios; períodos 30/90 dias e total; intervalo entre compras, primeiro pedido e comparação do ticket. Consultar por ID e tenant, nunca adivinhar a identidade pelo nome/telefone.
2. Qualidade da base: identificar telefone inválido, cliente genérico de retirada e possíveis duplicatas. A lista deve explicar “sem compra identificada”, pois isso não prova que a pessoa nunca comprou. Eventual união de cadastros exige revisão e trilha de auditoria.
3. Fidelidade: aproveitar pontos/cashback atuais. Acrescentar extrato auditável de aquisição, resgate, ajuste e estorno; crédito idempotente após elegibilidade financeira, reversão de cancelamento; mostrar saldo e regra ao cliente. Definir prêmio, limite por compra, produtos elegíveis, acúmulo com cupom e custo máximo antes de ativar. Pontos atuais não serão convertidos automaticamente.
4. Ações: incentivar segunda compra, aniversário opcional, marcos de recorrência e reativação. Guardar preferência de contato e autorização para campanhas, respeitar descadastro e limitar frequência. Uma sugestão de contato não dispara mensagem.
5. Resultados: clientes recorrentes, taxa de segunda compra, reativação, custo dos benefícios e receita/margem incremental. Distinguir compra após mensagem de efeito comprovado; usar grupo de controle para avaliar incremento.

## Diferenciais propostos para validar

Estas ideias não foram identificadas nas páginas consultadas; não há evidência suficiente para alegar exclusividade.

- Ritmo individual: alguém que compra a cada 3 dias pode merecer atenção depois de 10; alguém mensal não deve receber o mesmo alerta. Exigir histórico suficiente, explicar a regra e permitir ajuste, preservando os segmentos 30/60 dias até validação.
- Recuperar experiência antes de ofertar: combinar reclamação/avaliação com atraso ou cancelamento e sugerir atendimento humano antes de campanha. Mostrar fatos e evitar inferir insatisfação apenas por ausência.
- Oferta pelo prato favorito e pela margem: sugerir benefício relevante, disponível e economicamente viável, evitando desconto automático indiscriminado. Não inferir alergias a partir de pedidos; restrições alimentares precisam ser declaradas.
- Explicar cada oportunidade: “comprou 8 vezes, costuma voltar em 7 dias, está há 21 dias sem pedir”. Mostrar a amostra e incerteza, sem um score opaco.
- Separar pedidos coletivos de preferência individual: uma comanda familiar não prova que o titular consumiu todos os itens; apresentar como produtos mais pedidos pela conta.
- Planejamento operacional: cruzar provável demanda de recorrentes com produção e capacidade. Não enviar promoções durante sobrecarga ou com favorito indisponível.
- Fidelidade por experiência: benefícios de conveniência, mimo escolhido ou acesso a novidade, além de desconto; medir custo e retorno.

## Proteção da operação id 6

Desenvolvimento em branch isolada a partir do main atual, dados simulados e banco de testes local. API ampliada de forma aditiva; sem alteração de saldo, identidade, estado de pedidos ou critérios financeiros. Testar isolamento, cancelamentos, ranking, telefone, navegação mobile e edição. Merge e publicação ficam pendentes de autorização e checks verdes. Depois da publicação, confirmar revisão servida e validar leitura no id 6, sem criar pedidos ou editar clientes para provar o CRM.

## Limites conhecidos

Favoritos acrescentam uma consulta agrupada, compartilhada com o carregamento canônico de clientes; número de consultas não cresce por cliente, mas o custo cresce com o histórico de itens. Avaliar plano de execução em base representativa antes de ampliar para períodos, previsão e campanhas. A lista atual ainda carrega toda a base; paginação e ranking no servidor devem anteceder volumes grandes. Não implementado nesta etapa: automação de mensagens, alertas pelo ritmo individual, nova mecânica de recompensas, perfil detalhado ou mensuração incremental.
