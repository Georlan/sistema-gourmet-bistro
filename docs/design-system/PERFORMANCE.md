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

## Medição de build local — 02/11/2026

Build Vite de produção baseado em `214cdc1`, com a alteração local de tipografia de endereço proposta no PR #1242 e dependências do lockfile, reportou `CaixaPanel` 512,37 kB minificado (138,88 kB gzip), `CardapioPage` 310,09 kB (84,02 kB gzip) e o asset `koma-phone-graphite-shell-v2.png` 1.146,50 kB. Esses são tamanhos de arquivos emitidos, não bytes totais baixados por uma visita, nem impacto medido de LCP ou custo real. O aviso do Vite para chunks acima de 500 kB identifica uma oportunidade de investigação; avaliar dependências, rotas e frequência de uso antes de dividir ou recomprimir. A medição precede o PR #1239 e não estabelece baseline de produção.
