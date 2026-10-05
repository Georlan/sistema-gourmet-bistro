# Relatórios por dia civil

Relatórios gerenciais selecionam pagamentos aprovados por `Pagamento.criado_em` e estornos por `PagamentoEstorno.criado_em`. Os limites são meia-noite local até a meia-noite seguinte, convertidos para UTC, com início inclusivo e fim exclusivo. O fuso vem de `KOMA_TIMEZONE` (padrão America/Fortaleza). A seleção não depende da abertura, fechamento ou quantidade de turnos. O fechamento de caixa continua usando os turnos e não foi alterado.

A receita líquida é o recebido aprovado menos os estornos ocorridos no intervalo. As contas únicas usam as identidades persistidas de Atendimento/Comanda e as alocações canônicas. Vários pagamentos da mesma conta não duplicam a contagem do intervalo. Uma conta recebida em dois dias aparece em ambos os dias e uma vez no total: a contagem diária não é aditiva. Parcelas parcialmente conhecidas e sobrealocadas preservam os limites do valor aprovado.

Produtos mostram consumo operacional das comandas associadas aos recebimentos selecionados, excluindo itens cancelados. Esse valor não representa receita financeira nem é rateado proporcionalmente ao pagamento. Uma conta paga em períodos diferentes pode ter seu consumo mostrado em ambos; esses relatórios de consumo também não devem ser somados entre períodos. Custos não configurados permanecem desconhecidos.

O período fica visível nas quatro abas e persiste na sessão. Hoje, Ontem e os intervalos de 7/15/30 dias usam datas inclusivas no fuso padrão. Leituras iguais em andamento compartilham uma conexão por identidade de autenticação; trocar de período/aba cancela consumidores obsoletos. Não há cache de resultados nem polling novo.

Cada snapshot financeiro populado exige quatro consultas (pagamentos, estornos, alocações e identidades históricas); produtos omitem a consulta de estornos. Totais do mês/hoje usam duas agregações SQL em vez de carregar outro snapshot completo, ou reutilizam o resultado quando os intervalos são iguais. Os filtros continuam tenant-scoped e usam timestamps sem aplicar funções à coluna filtrada.

A conferência somente de leitura em 05/10/2026 encontrou 77 pagamentos e nenhum estorno para o tenant 6. O plano de leitura atual é uma varredura pequena, custo estimado 5,52. Não se justifica uma migração de índices nesta entrega; reavaliar um índice tenant/data parcial para pagamentos aprovados e tenant/data para estornos quando volume e plano medido justificarem.

A CI específica cobre relatórios, pagamentos, estornos e fechamento de caixa, além dos fluxos de período, troca de abas, recarga, atalhos e CSV em desktop e mobile.


## Entrada de pedidos e gestão do cardápio

O pico da visão geral usa `entrada_pedidos_por_hora`: cada Lancamento com itens
conta uma vez pela sua entrada no dia civil local, mesmo aberto ou depois cancelado.
Pedidos vazios e onboarding_test ficam fora. `horarios_pico` permanece como
projeção financeira legada para compatibilidade; não alimenta a escala operacional.
Recebimentos, estornos e metas continuam pela data do evento financeiro.

`/relatorios/inteligencia-cardapio` usa itens por entrada, incluindo pedidos abertos,
excluindo itens cancelados e pedidos recusados/cancelados. Uma linha de Item é uma
unidade. Comparação usa o intervalo anterior de mesma duração. Produto ativo hoje
não comprova disponibilidade histórica: ausência de saída exige revisão humana.
Custo e margem são estimativas pela ficha técnica atual; margem do preço atual
não inclui adicionais, impostos, taxas ou despesas e não é lucro histórico.
Custo incompleto permanece desconhecido; base anterior zero não vira crescimento 0%.
A leitura faz três consultas fixas, sem polling novo, escrita ou alteração automática
no cardápio. Permissão e plano são os mesmos dos relatórios avançados existentes.
