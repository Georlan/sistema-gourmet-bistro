# Avisos de componentes de terceiros — KÔMA

Este documento é um inventário operacional das dependências diretas e dos identificadores de licença presentes no checkout. Ele não altera licenças, não presume autoria ou titularidade e não substitui os textos de licença distribuídos por cada fornecedor.

Revisão de referência: commit `b7276bf038f1a0ae8c093432b7904884ac76f183`, em 2026-08-22. As faixas de versão abaixo vêm dos manifests; as versões efetivamente resolvidas devem ser conferidas nos lockfiles e nos artefatos de cada release.

## 1. Frontend e ferramentas Node.js

Fonte: `package.json` e `package-lock.json`. A coluna “licença declarada” reproduz o identificador informado nos metadados dos pacotes instalados durante esta revisão; valide-o novamente ao atualizar o lockfile.

### Dependências de execução

| Pacote | Faixa declarada | Licença declarada |
|---|---:|---|
| `@number-flow/react` | `^0.6.2` | MIT |
| `@sentry/react` | `^10.64.0` | MIT |
| `@tailwindcss/vite` | `^4.1.14` | MIT |
| `@vitejs/plugin-react` | `^5.0.4` | MIT |
| `clsx` | `^2.1.1` | MIT |
| `lucide-react` | `^0.546.0` | ISC |
| `motion` | `^12.23.24` | MIT |
| `react` | `^19.0.1` | MIT |
| `react-dom` | `^19.0.1` | MIT |
| `recharts` | `^3.10.1` | MIT |
| `vite` | `^6.2.3` | MIT |

### Dependências de desenvolvimento e teste

| Pacote | Faixa declarada | Licença declarada |
|---|---:|---|
| `@playwright/test` | `^1.58.2` | Apache-2.0 |
| `@types/node` | `^22.14.0` | MIT |
| `@types/react` | `^19.2.17` | MIT |
| `@types/react-dom` | `^19.2.3` | MIT |
| `tailwindcss` | `^4.1.14` | MIT |
| `tsx` | `^4.21.0` | MIT |
| `typescript` | `~5.8.2` | Apache-2.0 |

Dependências transitivas também podem impor obrigações. O `package-lock.json`, e não apenas esta tabela, deve alimentar o inventário completo do artefato distribuído.

## 2. Backend Python

Fonte: `backend/requirements.txt` e `backend/requirements-dev.txt`. Como esses manifests usam intervalos, a licença deve ser confirmada na versão resolvida no ambiente de build.

| Distribuição | Faixa declarada | Licença/expressão declarada nos metadados revisados |
|---|---:|---|
| `fastapi` | `>=0.110.0` | MIT |
| `uvicorn[standard]` | `>=0.28.0` | BSD-3-Clause |
| `sqlalchemy` | `>=2.0.0` | MIT |
| `pydantic` | `>=2.6.0` | MIT |
| `pyjwt` | `>=2.8.0` | MIT |
| `bcrypt` | `>=4.0.0` | Apache-2.0 |
| `pywin32` (Windows) | `>=306` | Python Software Foundation License |
| `python-multipart` | `>=0.0.9` | Apache-2.0 |
| `cryptography` | `>=42.0.0` | Apache-2.0 OR BSD-3-Clause |
| `sentry-sdk` | `>=1.40.0` | MIT |
| `psycopg2-binary` | `>=2.9.0` | LGPL com exceções, conforme metadados do pacote |
| `alembic` | `>=1.13.0` | MIT |
| `httpx` | `>=0.27.0` | BSD-3-Clause |
| `pytest` (desenvolvimento) | `>=8.0,<9.0` | MIT |

Este documento não declara que uma forma específica de empacotamento, linking ou distribuição satisfaz uma licença. Essa análise depende do artefato efetivamente entregue e deve preservar avisos, textos e código-fonte/ofertas quando exigidos pela licença aplicável.

## 3. Agente de impressão

Fonte: `print-agent/requirements.txt`.

| Distribuição | Faixa declarada | Licença declarada |
|---|---:|---|
| `requests` | `>=2.28.0` | Apache-2.0 |
| `pywin32` (Windows) | `>=305` | Python Software Foundation License |

As dependências transitivas do `requests` devem constar do inventário do instalador final.

## 4. Bridge SmartPOS Android

Fontes: `smartpos-android/build.gradle.kts`, `smartpos-android/app/build.gradle.kts` e `smartpos-android/settings.gradle.kts`.

| Componente | Versão declarada | Licença upstream a verificar no artefato |
|---|---:|---|
| Kotlin Gradle/JVM plugin e `kotlin-test-junit5` | `2.4.10` | Apache-2.0 |
| Android Gradle Plugin | `9.1.1` | Apache-2.0 |
| JUnit Jupiter Engine | `5.11.4` | EPL-2.0 |

O Android SDK, as ferramentas de build, os SDKs de adquirentes e eventuais bibliotecas embarcadas podem ter termos próprios. A presença nos repositórios `google()` ou `mavenCentral()` não concede automaticamente permissão de redistribuição. O bridge atual não documenta um lockfile Gradle; registre e arquive as dependências resolvidas no build de release.

## 5. Licenças por arquivo e proveniência

Um inventário jurídico anterior registrava 27 arquivos com indicação Apache-2.0. A verificação automatizada desta revisão, após a remoção do protótipo `CardapioAiChefAssistant.tsx`, encontrou 25 arquivos **de código-fonte** com o cabeçalho `SPDX-License-Identifier: Apache-2.0`:

```text
src/App.tsx
src/cardapio/CardapioConfig.ts
src/cardapio/CardapioPage.tsx
src/cardapio/CardapioTypes.ts
src/cardapio/components/CardapioAuthModal.tsx
src/cardapio/components/CardapioCartDrawer.tsx
src/cardapio/components/CardapioCategoryNav.tsx
src/cardapio/components/CardapioDigital.tsx
src/cardapio/components/CardapioHeader.tsx
src/cardapio/components/CardapioProductCard.tsx
src/cardapio/components/CardapioProductModal.tsx
src/cardapio/components/CardapioStoreInfoDrawer.tsx
src/cardapio/components/CardapioUserProfileModal.tsx
src/components/FechamentoCegoModal.tsx
src/components/KitchenPanel.tsx
src/components/ManagerPinModal.tsx
src/components/MenuPanel.tsx
src/components/MesaCard.tsx
src/components/MesaDetailsModalBase.tsx
src/components/mesas/MesasView.tsx
src/config/api.ts
src/data.ts
src/domain.ts
src/types.ts
src/utils/authSession.ts
```

A diferença para o inventário anterior decorre de arquivos removidos, não de retirada de cabeçalhos em arquivos mantidos. Reproduza e reconcilie o inventário em cada release com:

```bash
rg -l 'SPDX-License-Identifier: Apache-2\.0' src | sort
```

Regras para esses arquivos:

- preserve o cabeçalho e os avisos associados;
- não presuma que um cabeçalho foi “apenas inserido por IA” nem que isso elimina obrigações;
- não relicencie sem cadeia documental de titularidade e revisão dos termos aplicáveis;
- registre a origem, autores/revisores humanos, ferramentas usadas, termos vigentes na data e mudanças substanciais;
- trate arquivos sem cabeçalho como “licença/proveniência a verificar”, e não automaticamente como propriedade exclusiva do projeto.

O histórico registra a introdução de MIT no commit `0901cc9ef75f138845a6d32b681388ebf0f9225b` e a adoção do arquivo proprietário no commit `396f16bfd2fa5a252dd91bdda2e8add28b7f7bd5`. Licenças já concedidas para revisões efetivamente distribuídas e licenças de terceiros ou por arquivo continuam relevantes; este documento não tenta revogá-las.

## 6. Marcas, mídia, fontes e outros ativos

Imagens, logotipos, vídeos, apresentações, cardápios, textos, dados de demonstração, fontes e material produzido com ferramentas generativas não estão validados apenas por aparecerem no repositório. Antes de distribuição comercial, mantenha um registro de ativos contendo, no mínimo:

- caminho e hash do arquivo;
- criador e vínculo contratual;
- origem ou ferramenta utilizada e data;
- licença, autorização ou cessão aplicável;
- restrições de marca, imagem, dados pessoais e redistribuição;
- comprovante armazenado fora do repositório público.

As fontes carregadas de serviços externos e serviços de telemetria também exigem análise de termos, privacidade e fluxo internacional de dados, independentemente da licença do código cliente.

## 7. Processo de atualização e release

Em toda alteração de dependências ou preparação de release:

1. instale de forma reproduzível (`npm ci`) e registre as versões Python/Gradle resolvidas;
2. gere um SBOM e um relatório de licenças com ferramentas versionadas no CI;
3. compare dependências diretas e transitivas com os manifests e lockfiles;
4. preserve os textos completos de licença e avisos exigidos no artefato distribuído;
5. execute varredura de vulnerabilidades, segredos, PII e arquivos binários inesperados;
6. reconcilie os cabeçalhos SPDX e o registro de proveniência de ativos;
7. revise manualmente licenças copyleft, exceções, SDKs proprietários e termos de serviços externos;
8. atualize este arquivo com o commit/data de referência e arquive as evidências da revisão.

Uma tabela desatualizada não constitui comprovação de conformidade. Os textos originais das licenças e os termos dos fornecedores prevalecem sobre este resumo.
