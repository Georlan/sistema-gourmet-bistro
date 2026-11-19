# KÔMA Garçom Android e SmartPOS PagBank

Revalidação: 19/11/2026. Base inicial: `0f1c65eb` (PRs #1400 e #1402 integrados).
Este documento descreve implementação e limites; não atesta homologação ou teste físico.

## Separação de responsabilidades

- `app/src/main`: interface Android nativa, sessão de operador, salão, cardápio, rascunhos e recuperação de pagamento.
- `app/src/phone`: adaptador sem SDK/serviço PagBank. Não executa cobrança física. Simulador somente em debug, com backend isolado explicitamente configurado para teste.
- `app/src/pagbank`: adaptador tipado de `PlugPagServiceWrapper:1.35.0`. O AAR oficial é dependência obrigatória desta variante; nenhuma reflexão.
- Bridge JVM: comando, reserva local antes do SDK, coordenação, correlação e resultado.
- Backend: permissões, identidade de tenant, intenção, idempotência, saldo, liquidação, caixa, liberação de atendimento e notificações.
- Provisionamento de identidade de dispositivo no servidor: **pendente**. O identificador `POS-*` atual é identificador local da instalação, não autenticação do hardware nem número de série.

WebView/WebApps continuam proibidos pela FAQ PagBank consultada. A aplicação é nativa.

## Builds e dependências

| Variante | Application ID | SDK PagBank | Simulação | Recebimento externo/dinheiro |
| --- | --- | --- | --- | --- |
| phoneDebug | br.com.koma.smartpos.dev | ausente | somente com backend development/test | disponível, sujeito a permissão do servidor |
| phoneRelease | br.com.koma.smartpos.dev | ausente | bloqueada | disponível, sujeito a permissão do servidor |
| pagbankDebug / pagbankRelease | br.com.koma.smartpos.pagbank | 1.35.0 obrigatório | bloqueada | opções removidas e execução bloqueada no cliente |

Versão: 0.4.0, código 7. O ID PagBank é candidato, ainda sem homologação comprovada; confirmar antes da primeira publicação. Alterar ID ou assinatura após publicação exige nova homologação. Release compilado não significa release assinado/apto à distribuição.

Repositório Maven exclusivo do grupo do SDK: `https://raw.githubusercontent.com/pagseguro/PlugPagServiceWrapper/master`. O POM oficial não declara dependências transitivas; AndroidX Core 1.13.1 é necessário ao FileProvider do AAR. Não foram copiados projetos ou assets do SmartCoffee. Consultar `THIRD_PARTY_NOTICES.md` para fontes e limites de licença.

## Compatibilidade declarada e alvo

| Modelo | Android segundo FAQ | APK minSdk 25 | Validação física neste trabalho |
| --- | --- | --- | --- |
| GPOS780 | 11 | elegível; alvo inicial preferido | não realizada |
| P2 | 11 | elegível; alvo inicial alternativo | não realizada |
| A930 / P2-B | 7 | elegível, exige regressão no firmware concreto | não realizada |
| A50 | 8 | elegível, exige regressão no firmware concreto | não realizada |
| SK800 | 6 | fora do suporte deste APK | não realizada |

`compileSdk=36` e `targetSdk=36` são parâmetros de compilação/comportamento; não comprovam compatibilidade operacional. A FAQ informa que os modelos debug fornecidos normalmente são GPOS780/P2 Android 11. Nenhum terminal disponível foi identificado. Serviços PagBank e ativação são necessários; um celular e sandbox de API online não os substituem.

## Sessão, vínculo e limites de segurança

AES-256-GCM no AndroidKeyStore protege tokens e solicitações financeiras locais; a URL base faz parte do AAD. A senha não é persistida. A restauração conserva a data original e limita a validade ao `exp` do JWT; não renova credencial no servidor. Tokens malformados/expirados exigem login. Revogação de operador é verificada pelo backend. Invalidar/remover um operador não seleciona silenciosamente outra pessoa.

O vínculo atual ainda depende do login do funcionário. Não existe código temporário emitido no painel, credencial própria do aparelho, rotação de refresh token, PIN individual protegido no servidor ou revogação independente da maquininha. A troca local de restaurante não atende ao provisionamento autorizado solicitado. Não liberar como solução final de dispositivos até concluir esse contrato.

Pagamento pendente mantém restaurante, operador, mesa, valor, itens e chave estáveis. Troca de operador e desvinculação ficam bloqueadas até conciliação. Falha de leitura dos dados protegidos preserva o arquivo e bloqueia a operação; não vira instalação nova.

## Pedido e pagamento

Rascunhos são separados por API/restaurante/mesa; pedido pendente usa o envio idempotente existente. A projeção Android exige modalidade de consumo no local e mesa correspondente; retirada/delivery/modalidade ausente não entram no consumo, mesmo com mesa_id. Não validar produção por pedidos sintéticos, especialmente tenant 6.

A solicitação financeira completa e sua chave são persistidas antes do primeiro POST. Criação e confirmação manual reutilizam as mesmas chaves após interrupção. Para cobrança integrada, a reserva do `TerminalCoordinator` antecede o SDK. Resultado aprovado fica no journal se a sincronização falhar; retomada consulta/reenvia resultado, sem outro `doPayment`.

`getLastApprovedTransaction` só recupera aprovação com referência de operação, valor inteiro em centavos e identificador da adquirente. Ausência/divergência mantém erro/pendência de conciliação. A última transação não é histórico completo: não prova operações antigas quando outra transação a substituiu. Resultados diretos conflitantes também não são aprovados. Os códigos de recusa, cancelamento, timeout e erro foram revalidados no AAR 1.35.0; um teste da variante PagBank usa as constantes reais para evitar divergência entre o fake JVM e o SDK.

A liberação usa `mesa_liberada` do backend; falha ao consultar o detalhe não significa mesa livre. O servidor mantém pagamento parcial e alocação por itens como fonte de verdade.

**Limite atual do backend:** `integrated_provider_available()` habilita apenas `pagbank_simulator` em development/test. Preparação e resultado do terminal estão desabilitados em produção. Não remover esse bloqueio para fazer o APK cobrar: faltam autenticação independente do dispositivo, verificação do resultado realmente suportada pelo produto PagBank e validação física. Um `outcome`/reference do cliente não é prova autônoma de pagamento.

## Verificação do recebedor

A FAQ informa terminal vinculado a uma única loja/CNPJ. Não foi comprovada API do wrapper que forneça atestado de CNPJ recebedor verificável pelo backend. Confirmar no cadastro comercial/PagBank o terminal, série e recebedor correto; registrar vínculo operacional autorizado. `terminal_id` local não resolve isso. Consultar PagBank sobre mecanismos reais de comprovação/reconciliação antes do rollout financeiro.

## Testes e evidências

A suíte inclui expiração/restauração de sessão, preservação da identidade, criação idempotente, journal corrompido, recuperação persistida, concorrência e correlação do pagamento. O workflow `.github/workflows/smartpos-android-bridge.yml` testa bridge e variantes, compila debug/release e publica APKs, SHA de origem e XMLs de teste. Conferir a execução do SHA final do PR; existência deste documento não significa checks verdes.

| Etapa | Estado observado |
| --- | --- |
| Repositório e referências oficiais | inspecionados |
| Testes automáticos / build do SHA final | consultar execução anexada ao PR |
| Celular USB | não detectado por ADB nem inventário USB em 19/11; não instalado/testado |
| Terminal PagBank | não identificado/testado |
| Homologação | não realizada |

## Uso e próximos passos

1. No celular, instalar `phoneDebug` preservando os dados/assinatura do APK anterior. Login autorizado restaura o restaurante retornado pelo servidor; isso ainda não é provisionamento de dispositivo.
2. Testar exclusivamente com fixtures/ambiente local e usuários autorizados: login/reabertura, rede, mesas, modificadores, rascunho, envio e recuperação financeira. Não apontar simulador para produção.
3. Implementar código de vínculo de uso único, expiração/consumo atômico/limites de tentativas, dispositivo revogável, autenticação limitada e PIN individual. Validar A/B tenants e operador/dispositivo em todas as rotas.
4. Obter/confirmar parceria e terminal debug GPOS780 ou P2. Identificar Android, série, PlugPagService e TerminalService; ativar segundo instruções comerciais.
5. Com backend financeiro seguro e ambiente autorizado, instalar `pagbankDebug` e validar cobrança, recusa, interrupção, cancelamento/estorno e impressão físicos. O adaptador oferece ativação, doPayment, consulta, void e abort; a experiência completa de estorno/impressão/eventos ainda precisa validação/conclusão.
6. Confirmar application ID/keystore definitivo, assinar release, preparar vídeo e guia, listar endpoints/IPs e enviar homologação. Não gerar assinatura de produção descartável.

No estado atual há pendências internas além do hardware: provisionamento/PIN/revogação do dispositivo, confiança do resultado físico no backend, validação de isolamento e modalidades no app/servidor e conclusão de capacidades/eventos/comprovantes/estorno. Não resumir tudo a uma única credencial externa.

## Fontes oficiais consultadas em 19/11/2026

- https://developer.pagbank.com.br/docs/integracao-smartpos-1
- https://developer.pagbank.com.br/docs/faq-smartpos
- https://developer.pagbank.com.br/docs/desenvolvimento-smartpos
- https://developer.pagbank.com.br/docs/homologacao-smartpos
- https://developer.pagbank.com.br/docs/producao-smartpos
- https://pagseguro.github.io/pagseguro-sdk-plugpagservicewrapper/
- SDK: https://github.com/pagseguro/pagseguro-sdk-plugpagservicewrapper (db556419b2e9634a69d4a835de9c3cba892de069)
- Exemplo: https://github.com/pagseguro/pagseguro-plugpagservicewrapper-smartcoffeedemo (2140b19e211bd5f7b35c05140456f819ce7a0088)
