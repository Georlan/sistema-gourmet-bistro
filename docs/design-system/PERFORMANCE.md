# Economia e continuidade

Esta orientação é parte da fundação de interface. A operação correta prevalece sobre reduzir requisições. Distinguir problema medido, correção implementada, boa prática e hipótese; não atribuir economia a mudança sem medição comparável.

## Leitura e tempo real

Para cada recurso, identificar responsável, tenant, consumidores, freshness, invalidação, tratamento de erro, reconexão e momento de descarte. Uma tela com vários cards deve receber dados da consulta/projeção do responsável e compartilhá-los; não criar GET por card. Coalescer eventos repetidos e buscas digitadas quando isso não atrasar confirmação crítica. Cancelar resultados obsoletos e impedir que dados de um tenant/sessão apareçam em outro.

Não substituir eventos em tempo real por cache sem mecanismo de recuperação. Pausar trabalho em aba oculta somente quando for seguro; ao voltar, reconciliar com o servidor. Timeout de mutação não significa falha: consultar estado antes de permitir nova ação quando houver resultado incerto. Nunca repetir automaticamente uma operação financeira ou de entrega apenas por falta de resposta. Limpar subscriptions, timers e requests no desmontar/troca de identidade.

**Observado no código:** Cardápio usa WebSocket e, em acompanhamento/chat, SSE com contingência; Caixa usa WebSocket e `useCashierRealtime.ts` prevê contingência de 12 segundos quando desconectado; `useCourierRealtime.ts` mantém socket por credencial com reconexão limitada, ping e limpeza ao ficar oculto/offline. `MotoboyPwaPage.tsx` conserva snapshot e reconcilia antes de permitir confirmação em condições incertas. A existência desses mecanismos não mede seu custo real nem garante funcionamento em rede/dispositivo físico.

## Renderização e assets

`src/App.tsx` já divide Cardápio e Entregador com `React.lazy`. Preferir reaproveitar dados e componentes controlados; medir renderizações antes de adicionar memoização ou virtualização. Listas longas pedem virtualização apenas quando a medição e a interação justificarem, preservando foco e leitura por tecnologia assistiva.

Para imagens, escolher variante com dimensões próximas à apresentação, reservar proporção, usar `srcset` quando disponível, lazy fora da primeira dobra e evitar atrasar imagem principal. SVG é adequado a símbolos simples; WebP/AVIF podem reduzir transferência fotográfica, mas a escolha depende de suporte, qualidade e tamanho medidos. Guardar arquivos de marca localmente quando autorizados, não baixar imagens de parceiros por card, e configurar cache de assets versionados conforme infraestrutura. Pré-carregar apenas recursos críticos. Respeitar movimento reduzido e evitar efeitos caros sem função. Fonts externas são dependência de rede e privacidade: avaliar hospedagem, licença, fallback e peso antes de alterar.

## Como medir

Registrar commit e build, tela e cenário, dimensão, cache frio/quente, navegador, rede e aparelho. Comparar contagem de requisições e bytes transferidos por origem e recurso, conexões abertas, renderizações e LCP/CLS/INP quando o ambiente permitir. Medir navegação, retorno de aba, falha e reconexão; conferir impacto no fluxo e isolamento. Fixtures isoladas demonstram comportamento sob simulação, não custo ou desempenho de produção. Não usar pedidos, pagamentos, mensagens, impressões ou alteração de configuração do restaurante real como carga de teste.

Nesta rodada não houve medição comparável de rede nem alteração de backend ou de contratos. O build alertou sobre tamanho de chunk; isso é um indício para análise de bundle, não uma regressão ou economia quantificada.

## Otimizações recentes integradas à `main` (até `57cc6a36`)

- **#1328 (`3dff6c8a`):** consolidação de consultas de totais de turno e status do tenant no Caixa/Auth.
- **#1332 (`8f871e53`):** deduplicação de fetches no mount para `/caixa/configuracoes` e `/api/online-orders/control`.
- **#1335 (`9223c656`):** derivação de pedidos digitais pendentes a partir do snapshot ativo, evitando leitura redundante da fila.
- **#1340 (`7cb1c701`):** lazy-load da aba de clientes/fidelidade e deduplicação de fetches na troca de abas.
- **#1342 (`e5042d86`):** bypass do shell completo de `App.tsx` na entrada pública do Cardápio e paralelização da busca de populares.
- **#1348 (`3e36e213`):** deduplicação de probes de catálogo no boot do Cardápio e Garçom, e estabilização do `distinctID` por aba no PostHog.
- **#1371 (`72064065`):** redução de consumo ocioso dos Print Agents Desktop e Android.

## Medição de build local — 16/11/2026 (`57cc6a36`)

Build Vite de produção executado em `57cc6a36`:
- `CaixaPanel-*.js`: `509,47 kB` minificado (`139,48 kB` gzip) — redução frente a `512,37 kB` em 02/11.
- `CardapioPage-*.js`: `199,69 kB` minificado (`57,32 kB` gzip) — redução frente a `310,09 kB` (`84,02 kB` gzip) em 02/11 após lazy loading/splitting (#1340/#1342).
- `App-*.js`: `275,36 kB` (`76,11 kB` gzip); `SuperAdminGate-*.js`: `336,42 kB` (`75,42 kB` gzip); `MotoboyPwaPage-*.js`: `46,77 kB` (`19,30 kB` gzip); `CashierPdvView-*.js`: `45,39 kB` (`12,94 kB` gzip).
- O aviso do Vite para chunks acima de 500 kB permanece apenas em `CaixaPanel` (`509,47 kB`). Valores acima são tamanhos de emissão de bundle, não medição de LCP ou tráfego real em dispositivo.
