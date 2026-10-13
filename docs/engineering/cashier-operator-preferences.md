# Conta e preferências do Caixa

Etapa visual aprovada em 13/10/2026. A gaveta concentra operador, tamanho do texto, tema e som. Resumo de mesas permanece no Salão; fullscreen permanece no botão Modo PDV da barra superior. Atualização manual usa o callback existente dentro de Recuperação, recolhida por padrão.

Preserva logout por aba, armazenamento local das preferências e liberação de áudio por navegador. Nenhuma regra de pedidos, impressão, autenticação ou cálculo de ocupação foi alterada. Remove desta apresentação a projeção duplicada do salão, inclusive o fallback de 30 mesas, e os textos técnicos do rodapé.

Usa diálogo modal nativo para foco, Escape e isolamento do fundo, com restauração do foco ao botão de origem ou ao menu móvel quando o botão original deixa de existir. Controles têm alvo mínimo de 44 px, textos podem quebrar e o conteúdo tem rolagem própria. A resposta do teste de som também aparece dentro da gaveta, sem presumir confirmação física.

O teste antigo `cashier-audio-lifecycle.spec.ts` de autoaceite falhou tanto na branch quanto em checkout isolado da main a2fef79e (esperava três notas, observou zero). A implementação do hook de alertas não foi alterada; revisar esse contrato em etapa própria. Testes desta etapa validam diretamente o teste de som permitido/negado e não substituem a investigação da pendência antiga.

Reversão por revert da PR; sem migração, contratação ou escrita em produção.
