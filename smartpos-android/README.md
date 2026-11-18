# KÔMA Garçom para SmartPOS

App Android nativo para lançar pedidos no salão em telas pequenas. Usa o login do KÔMA e a habilitação SmartPOS do restaurante. Com o caixa aberto, o operador pode consultar mesas e consumo, selecionar produtos do cardápio ativo, configurar complementos, informar observações, revisar e enviar para a operação. O mesmo lançamento do garçom web segue para cozinha e impressão conforme a configuração do restaurante.

A interface usa componentes do Android, sem WebView, imagens de catálogo ou dependências de UI externas. O catálogo carrega ao abrir um novo pedido. As mesas são atualizadas por solicitação e após confirmação de um pedido, sem consultas periódicas. O servidor mantém autoridade sobre disponibilidade, preços, permissões e identificação do pedido.

## Reenvio

O app reserva a chave e o corpo do lançamento em armazenamento privado, cifrado com o Android Keystore, por restaurante e operador. Em caso de resposta perdida, **Confirmar envio** usa a mesma comanda e chave. A fila tem um envio pendente por operador e o app pede confirmação antes de voltar a lançar. A credencial e a sessão ficam apenas em memória. Se o app perder acesso ao envio guardado, confira o pedido pelo Caixa antes de relançar.

## Desenvolvimento

No Android SDK 36 e com Gradle 9.5.0:

```sh
gradle -p smartpos-android test :app:testDebugUnitTest :app:assembleDebug
```

O workflow SmartPOS publica o artefato `koma-garcom-smartpos-apk`. O APK debug é para Android 7.1 ou superior. Para um backend isolado em emulador, use `-PkomaApiUrl=http://10.0.2.2:8000`. Builds release usam a API de produção por HTTPS.

## Primeiro terminal

O PagBank é o primeiro candidato por já existir uma fronteira de pagamentos, testes do simulador e contratos de recuperação no KÔMA. A Stone oferece um deeplink direto para pagamentos e impressão, mas exigiria um adaptador adicional. Mercado Pago e Cielo também têm programas de apps embarcados. O binário atual tem o fluxo de pedidos. Os testes do bridge simulado continuam no módulo Kotlin e a cobrança física ainda depende de implementação e homologação.

Para o piloto, solicitar um terminal de desenvolvimento PagBank e validar o modelo e firmware com a parceria. A FAQ lista GPOS 780 e P2 para desenvolvimento. Validar o fluxo salão → cozinha em ambiente isolado, inclusive corte de rede e reenvio. A etapa de pagamento usa PlugPag, com confirmação e recuperação no backend, antes de enviar o APK release para homologação e vincular os terminais de produção.

- [PagBank SmartPOS — integração](https://developer.pagbank.com.br/docs/integracao-smartpos-1)
- [PagBank SmartPOS — FAQ](https://developer.pagbank.com.br/docs/faq-smartpos)
- [Stone — Deeplink](https://sdkandroid.stone.com.br/reference/explicacao-deeplink)
- [Mercado Pago — SmartApps](https://www.mercadopago.com.br/developers/pt/docs/smartapps/overview)
- [Cielo — LIO Local](https://developercielo.github.io/manual/lio-local)
