# Conta e preferências do Caixa

## Versão local — 01/11/2026

A gaveta concentra a sessão do operador, o restaurante, sons do navegador, conexão dos pedidos e acesso à ajuda. Tema e texto ficam no cabeçalho, acessíveis em qualquer área. O controle de texto alterna Padrão → Grande → Padrão, usando a preferência persistida existente e sem requisições. Preferências antigas de acessibilidade continuam compatíveis; não reescrever o tamanho do Garçom ou Entregador.

O SVG de credencial é próprio e está em `public/brand/cashier/operator-access-v1.svg`. Inter e Space Grotesk seguem os tokens existentes. Sem download de bibliotecas de animação; o controle usa apenas transform e respeita movimento reduzido.

Preservar `useCashierAlerts` para sons e `onRefreshOrders` para consulta manual. Não criar polling ou uma segunda assinatura de tempo real. O indicador lê `isWsConnected`; não promete confirmação de pedidos pendentes. O teste de som informa se o navegador liberou o áudio, sem afirmar que houve saída física.

Diálogo modal nativo mantém foco, Escape e isolamento do fundo. O botão de origem recebe o foco ao fechar, com retorno ao menu móvel quando necessário. Alvos de 44px; cabeçalho e saída ficam acessíveis com rolagem só no conteúdo da gaveta. Sair continua limpando somente a sessão da aba pelo fluxo existente.

O Kanban usa a largura real de `cashier-content`: onde três colunas não couberem com leitura confortável, os mesmos grupos são exibidos pelas abas de etapas. Não mudar a fonte do pedido, estado, ação ou contrato de backend. Bloco numérico acompanha a escala de texto e mantém números e rótulos em uma linha.

Validar Padrão e Grande em 320, 360, 390, 430, 768, 834, 1024, 1366 e 1920px; temas claro/escuro, teclado, toque, recarga, áudio negado/permitido e acesso à ajuda. Sem escrita de teste no tenant 6. Esta etapa permanece local.

## Histórico

Etapa visual aprovada em 13/10/2026. A gaveta concentra operador, tamanho do texto, tema e som. Resumo de mesas permanece no Salão; fullscreen permanece no botão Modo PDV da barra superior. Atualização manual usa o callback existente dentro de Recuperação, recolhida por padrão.

Preserva logout por aba, armazenamento local das preferências e liberação de áudio por navegador. Nenhuma regra de pedidos, impressão, autenticação ou cálculo de ocupação foi alterada. Remove desta apresentação a projeção duplicada do salão, inclusive o fallback de 30 mesas, e os textos técnicos do rodapé.

Usa diálogo modal nativo para foco, Escape e isolamento do fundo, com restauração do foco ao botão de origem ou ao menu móvel quando o botão original deixa de existir. Controles têm alvo mínimo de 44 px, textos podem quebrar e o conteúdo tem rolagem própria. A resposta do teste de som também aparece dentro da gaveta, sem presumir confirmação física.

O teste antigo `cashier-audio-lifecycle.spec.ts` de autoaceite falhou tanto na branch quanto em checkout isolado da main a2fef79e (esperava três notas, observou zero). A implementação do hook de alertas não foi alterada; revisar esse contrato em etapa própria. Testes desta etapa validam diretamente o teste de som permitido/negado e não substituem a investigação da pendência antiga.

Reversão por revert da PR; sem migração, contratação ou escrita em produção.
