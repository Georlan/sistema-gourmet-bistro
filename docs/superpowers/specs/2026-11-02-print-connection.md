# KÔMA Print — conexão simples e diagnóstico confiável

Proposta de 2 de novembro de 2026. Escopo: evoluir o agente existente, conforme escolha do usuário; manter o KÔMA no navegador.

## Problema observado

O agente Linux do ID 8 está em execução, comunica-se com o servidor e responde à identificação local. O Brave nega a consulta do site ao conector com `LocalNetworkAccessPermissionDenied`. A tela reduz qualquer falha a “KÔMA Print não identificado”. O botão atual abre o launcher, que corretamente preserva o worker já em execução, e tenta a mesma consulta depois de três segundos; ele não trata a permissão.

A KA7 é a impressora KA-1445, pareada por Bluetooth. As tentativas físicas observadas falharam com `Host is down`. Corrigir a identificação no navegador não comprova, por si só, que a impressora voltou a receber dados.

Não há evidência de que a publicação grande tenha causado o bloqueio. O módulo de descoberta e o agente não foram modificados nessa publicação; o navegador impõe uma autorização própria. Não foi determinado quando essa autorização passou a bloquear este perfil.

## Resultado esperado desta primeira fatia

1. Quem já instalou e autorizou o agente mantém o vínculo e a identificação automática, sem reinstalar, copiar token ou configurar portas.
2. Quando faltar autorização do navegador, o KÔMA explica isso e oferece uma ação de conectar. A solicitação ocorre a partir desse clique, respeitando a decisão do usuário e sem desativar proteções do navegador.
3. Uma recusa persistente aparece como acesso bloqueado, com orientação específica; o KÔMA não entra num ciclo de “preparando” nem afirma que o agente está ausente.
4. Mudanças na permissão são reconciliadas. Leituras concorrentes, cliques repetidos e troca de loja não ressuscitam a identidade antiga.
5. O monitor mantém separados a identidade deste computador, o contato do agente com o servidor e a disponibilidade física da impressora. Um agente remoto da mesma loja nunca será adotado como se estivesse neste computador.
6. O worker continua em segundo plano com a fila durável atual. Fechar o navegador ou bloquear sua descoberta não cancela pedidos nem desliga o agente.

## Preservação e limites

- Manter Windows do ID 6 e Linux do ID 8, tokens, destinos, pareamento e configurações existentes. A primeira fatia deve funcionar com o agente atualmente instalado, sem exigir atualização do binário no restaurante.
- Não criar outro aplicativo, serviço na nuvem, banco, cache por tenant, protocolo concorrente de impressão ou substituição da fila existente.
- Não ampliar permissões automaticamente, desativar Shields, forçar pareamento, adotar o primeiro agente online, nem guardar credenciais novas no browser.
- Não reimprimir os onze trabalhos falhos e não gerar teste físico sem autorização específica. Produção somente leitura nesta implementação; o ID 6 fica intocado.
- Melhorias adicionais do instalador e atualização do agente serão uma fatia posterior, caso esta investigação identifique uma necessidade concreta. Não prometer eliminar uma autorização que o navegador exige.

## Validação e entrega

Reproduzir em fixtures o agente ativo com acesso negado, autorização pendente, autorização concedida, navegador antigo sem API de permissão, agente indisponível, porta alternativa, troca de loja, cliques repetidos e resposta tardia. Verificar no navegador uma mensagem acionável e ausência de comandos de impressão nas tentativas de conexão. Rodar testes de compatibilidade do agente e de isolamento, lint, unitários e build pertinentes, e revisar os estados em desktop/mobile.

Entregar branch a partir da main remota atual, PR e CI. Sem merge ou publicação sem autorização. Separar testes locais/CI, versão publicada, identificação do agente e saída física.
