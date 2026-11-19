# KÔMA Garçom Android / PagBank

Aplicativo Android nativo. Estado real e limitações em [arquitetura e validação](../docs/payments/pagbank-smartpos-architecture.md).

## Build

Java 17, Gradle 9.5.0, Android SDK 36 / Build Tools 36.0.0.

```sh
gradle -p smartpos-android :test :app:testPhoneDebugUnitTest :app:testPagbankDebugUnitTest :app:assemblePhoneDebug :app:assemblePagbankDebug
```

- Celular: `app/build/outputs/apk/phone/debug/app-phone-debug.apk`, versão 0.4.0 (7), package `br.com.koma.smartpos.dev`.
- PagBank: `app/build/outputs/apk/pagbank/debug/app-pagbank-debug.apk`, package candidato `br.com.koma.smartpos.pagbank`, SDK 1.35.0 efetivamente empacotado. Não homologado.
- CI também compila as variantes release, sem presumir assinatura comercial.
- Configure API de teste com `-PkomaApiUrl=https://seu-endpoint-de-teste`. Release usa a URL canônica de produção; não testar finanças reais nela.

O celular não executa transações físicas. Simulador somente em phoneDebug e backend development/test. PagBank não oferece dinheiro/registro externo no fluxo do terminal.

Sessões respeitam o exp real do JWT. Pagamento pendente preserva solicitação e chaves entre reinícios e impede troca de operador/desvinculação; reconciliar a operação anterior antes de outra cobrança.

Ainda não há provisionamento por código/PIN/revogação independente do dispositivo. Integração financeira física continua desabilitada no backend produtivo até segurança e homologação. Instalar em celular não comprova integração PagBank.
