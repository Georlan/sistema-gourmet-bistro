# Estados autoritativos no bootstrap do Caixa

## Regra

Estado remoto ainda não carregado é **desconhecido**, não `false`, `0`, vazio, fechado ou pendente.

A interface pode usar placeholders locais para composição, mas não pode apresentá-los como verdade operacional nem permitir uma ação crítica baseada neles antes da primeira leitura autoritativa.

## Aplicação atual

- **Turno de caixa**: `loading | loaded | error`; `turno === null` só significa caixa fechado depois de `loaded`.
- **Pedidos digitais**: a hidratação inicial aceita somente um `deliveryStatus` ativo explícito. Nenhuma ausência de status vira `pendente` por fallback.
- **Alertas**: pedidos presenciais e digitais têm donos separados. Pedidos digitais são deduplicados por `id`, e o primeiro snapshot apenas estabelece a baseline.
- **Cardápio online**: antes da primeira leitura, a UI mostra sincronização/indisponibilidade, nunca `0 pedidos` ou `despausado` por default.
- **Configurações do caixa**: defaults internos não podem dirigir checkout ou ser exibidos como valor do servidor antes de `settingsLoadState === loaded`.
- **Fretistas**: `[]` só significa lista vazia depois de a leitura concluir; antes disso a UI mostra sincronização.
- **Movimentações do caixa**: a lista inicia em estado de loading; vazio só é autoritativo após fetch.
- **Resumo/fechamento do caixa**: não assume `Sem turno`/fechado enquanto o resumo ainda está carregando.

## Princípio para novos recursos

Todo recurso remoto com impacto operacional deve modelar pelo menos três estados: `unknown/loading`, `loaded` e `error`. O domínio real (`open/closed`, `enabled/disabled`, lista vazia, valor zero etc.) só pode ser interpretado dentro de `loaded`.
