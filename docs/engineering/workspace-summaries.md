# Resumos sem banners de apresentação

Etapa aprovada em 13/10/2026. O adaptador OperationalBanner não renderiza mais faixa, slogan ou métricas no corpo das páginas. Os 25 usos existentes passam a publicar seus indicadores no botão Resumo da barra superior do painel do restaurante. Preserva IDs dos headings para acessibilidade e referências existentes.

Os valores continuam calculados pelos mesmos owners. O registro local usa a identidade da tela (tab/subTab), serializa apenas valores de apresentação e limpa entradas ao desmontar. Filtra árvores estacionadas sob hidden; a troca de tela fecha o resumo e evita mostrar dados da tela anterior. Nenhuma API, polling ou cálculo operacional foi acrescentado. Consumidores fora do painel mantêm indicadores em details recolhido, sem hero.

Erro de carregamento, pagamentos pendentes, bloqueios e avisos de segurança são componentes distintos e permanecem visíveis. Avisos necessários para interpretar custos/margens também permanecem nos relatórios. Esta etapa não altera fluxo, permissão, totais, modalidade, impressão ou regras de atendimento.

O resumo usa diálogo nativo com Escape, foco e rolagem própria. Reversão por revert da PR, sem migração ou alteração de dados.
