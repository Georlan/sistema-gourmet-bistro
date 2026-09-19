# Cardápio Online — facilitação de uso

Objetivo: reduzir configuração desnecessária, tornar funções fáceis de localizar e manter o cardápio público coerente com a operação real do restaurante.

## Concluído na base

- [x] Manter os destinos diretos do Cardápio Online no menu lateral e espelhá-los também na subnavegação horizontal para troca rápida de seção em celular e notebook.
- [x] Tornar **Clientes bloqueados** um destino direto, com bloqueios ativos, histórico e ação de desbloquear.
- [x] Tratar o horário de funcionamento como configuração geral do estabelecimento.
- [x] Fechar automaticamente o cardápio fora da agenda configurada.
- [x] Informar a próxima abertura no cardápio público quando o fechamento vier do horário.
- [x] Manter **Pagamentos** simples e sem mudanças nesta onda.

## Esta onda — entrega

- [ ] Tornar a taxa de entrega sempre automática por distância.
- [ ] Reduzir a regra manual a somente **Taxa mínima** + **Valor por km**.
- [ ] Corrigir entrada decimal para aceitar valores como `0,50` sem apagar o zero durante a digitação.
- [ ] Manter o **ponto de partida** explícito e fácil de atualizar.
- [ ] Exibir uma **Sugestão do KÔMA** baseada no histórico real de entregas concluídas.
- [ ] Usar uma sugestão-base quando não houver dados suficientes: **R$ 5,00 mínimo + R$ 1,00/km**.
- [ ] A sugestão nunca salva automaticamente: apenas preenche os campos para revisão do restaurante.
- [ ] Preservar compatibilidade de leitura com políticas antigas já gravadas.
- [ ] Simplificar a comunicação pública da taxa sem expor fórmula interna.
- [ ] Cobrir regra, sugestão, entrada decimal e fluxo responsivo com testes.

## Critérios de aceite

1. Não existem seletores de "taxa única", "taxa por bairro" ou outra modalidade na tela de entrega.
2. A regra publicada pelo novo editor usa `tipo_taxa_entrega = distancia`.
3. O restaurante pode digitar `0,50` normalmente em **Valor por km**.
4. **Usar sugestão** apenas altera os campos; a publicação continua exigindo ação explícita de salvar.
5. Com menos de 6 entregas utilizáveis, a sugestão é a base inicial; com histórico suficiente, deriva valores das entregas reais do próprio tenant.
6. O cardápio público mostra apenas uma comunicação curta, como **Taxa de entrega a partir de R$ 5,00**.
7. O backend permanece como fonte de verdade do valor final.
