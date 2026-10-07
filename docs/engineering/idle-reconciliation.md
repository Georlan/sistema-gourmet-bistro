# Históricos ociosos e rajadas — 07/10/2026

O Caixa consultava históricos de entregas/retiradas a cada 30 segundos, além das
invalidações por evento. O monitor de impressão fazia o mesmo e podia abrir
consultas concorrentes durante rajadas.

Agora os históricos reconciliam a cada cinco minutos com WebSocket conectado,
sem atrasar eventos: janela de agrupamento de 250 ms, sem adiar indefinidamente
uma rajada contínua. Sem WebSocket, preservam o fallback de 30 segundos. Ao
reconectar ou retornar à aba, reconciliam. Abas ocultas não fazem consultas.
Uma invalidação durante uma consulta fica pendente para uma única nova leitura;
erros não encerram o retry. Cleanup remove listeners e timers.

O monitor usa o mesmo agrupamento e exclusão de consultas automáticas concorrentes,
mas conserva os 30 segundos: a ausência de um heartbeat não gera evento, portanto
cinco minutos poderiam atrasar a indicação de agente offline. Descoberta local,
claim, heartbeat, comandos, autenticação e manutenção do backend não mudam.

## Simulação e limites

- Uma hora saudável: 13 leituras por histórico (incluindo bootstrap) versus 121,
  ~89,3% menos nessa rotina. Não é previsão de economia total nem capacidade.
- 1.000 eventos agrupados; uma invalidação em voo preservada; sem sobreposição.
- Aba oculta, retorno/foco, queda/reconexão, erro e desmontagem simulados.
- Fixture Chromium monta os três componentes reais, com API e agente locais
  simulados. Nenhum pedido, impressão ou mensagem real é enviado.
- Testes de manutenção existentes verificam throttling por tenant, recuperação,
  compactação do histórico e preservação dos jobs ativos.

## Observação passiva

Em 07/10, 01:49 Fortaleza: sete conexões runtime, zero lock waiters. Tenant 6:
nenhum pending/claimed, uma falha antiga já compactada; heartbeat ativo. Tenant 8:
16 pending, zero tentativas, payload preservado e nenhum agente ativo cadastrado.
A manutenção de filas depende de acessos do agente: um tenant sem agente pode
reter jobs além da janela até haver acesso. Essa lacuna fica registrada para
trabalho separado; este PR não coleta nem cancela jobs em produção.

Estatísticas SQL acumuladas desde julho não medem uma rajada atual. Verificação
passiva e simulação não provam pico de 100/1.000 restaurantes nem impressão física.
