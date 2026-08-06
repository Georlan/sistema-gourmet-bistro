# THIRD_PARTY_NOTICES.md — Kôma Sistema de Gestão Gourmet

Este documento lista os componentes de terceiros utilizados no projeto Kôma, suas licenças e obrigações de atribuição.

---

## 1. Dependências do Frontend (Node.js / TypeScript)

As dependências abaixo são declaradas em `package.json` e instaladas via npm.

| Pacote | Versão mínima | Licença | Uso |
|---|---|---|---|
| `react` | ^19.0.1 | MIT | Framework de UI |
| `react-dom` | ^19.0.1 | MIT | Renderização no DOM |
| `@supabase/supabase-js` | ^2.110.5 | MIT | Cliente Supabase (cardápio digital) |
| `@sentry/react` | ^10.64.0 | MIT (modo cloud SDK) | Monitoramento de erros |
| `@tailwindcss/vite` | ^4.1.14 | MIT | Integração Tailwind + Vite |
| `@vitejs/plugin-react` | ^5.0.4 | MIT | Plugin React para Vite |
| `clsx` | ^2.1.1 | MIT | Utilitário de classes CSS condicionais |
| `lucide-react` | ^0.546.0 | ISC | Ícones SVG |
| `motion` (Framer Motion) | ^12.23.24 | MIT | Animações |
| `vite` | ^6.2.3 | MIT | Bundler |
| `typescript` | ~5.8.2 | Apache-2.0 | Compilador TypeScript |
| `tailwindcss` | ^4.1.14 | MIT | Utilitários CSS |
| `autoprefixer` | ^10.4.21 | MIT | Prefixos CSS automáticos |
| `esbuild` | ^0.25.0 | MIT | Bundler rápido (usado pelo Vite) |
| `tsx` | ^4.21.0 | MIT | Execução TypeScript |
| `@types/react` | ^19.2.17 | MIT | Tipos TypeScript para React |
| `@types/react-dom` | ^19.2.3 | MIT | Tipos TypeScript para React DOM |
| `@types/express` | ^4.17.21 | MIT | Tipos TypeScript para Express |
| `@types/node` | ^22.14.0 | MIT | Tipos TypeScript para Node.js |

---

## 2. Dependências do Backend (Python / FastAPI)

As dependências abaixo são declaradas em `backend/requirements.txt`.

| Pacote | Versão mínima | Licença | Uso |
|---|---|---|---|
| `fastapi` | >=0.110.0 | MIT | Framework web API |
| `uvicorn[standard]` | >=0.28.0 | BSD-3-Clause | Servidor ASGI |
| `sqlalchemy` | >=2.0.0 | MIT | ORM / SQL |
| `pydantic` | >=2.6.0 | MIT | Validação de dados |
| `pyjwt` | >=2.8.0 | MIT | Tokens JWT |
| `bcrypt` | >=4.0.0 | Apache-2.0 | Hash de senhas |
| `python-multipart` | >=0.0.9 | Apache-2.0 | Upload de arquivos |
| `cryptography` | >=42.0.0 | Apache-2.0 / BSD | Criptografia Fernet (PII) |
| `sentry-sdk` | >=1.40.0 | MIT | Monitoramento de erros |
| `psycopg2-binary` | >=2.9.0 | LGPL-3.0 | Driver PostgreSQL |
| `alembic` | >=1.13.0 | MIT | Migrations de banco de dados |
| `httpx` | >=0.27.0 | BSD-3-Clause | Cliente HTTP assíncrono |
| `pywin32` | >=306 (Windows only) | PSF | APIs Win32 (impressora térmica) |

### Nota sobre psycopg2-binary (LGPL-3.0)
A licença LGPL-3.0 é compatível com software proprietário desde que a biblioteca seja utilizada por importação dinâmica (não vinculação estática). O uso em Python via `import psycopg2` atende a esse requisito. Nenhuma modificação foi feita na biblioteca.

---

## 3. Dependências do Print Agent (Python)

As dependências abaixo são declaradas em `print-agent/requirements.txt`.

| Pacote | Versão mínima | Licença | Uso |
|---|---|---|---|
| `requests` | >=2.28.0 | Apache-2.0 | Requisições HTTP |
| `pywin32` | >=305 (Windows only) | PSF | APIs Win32 (impressora) |

---

## 4. Inventário de Cabeçalhos de Licença no Código-Fonte e Proveniência

### Grupo A — 27 arquivos com `SPDX-License-Identifier: Apache-2.0`

Os seguintes arquivos possuem cabeçalho inserido automaticamente por ferramentas Google (Google AI Studio / Gemini), que injeta `Apache-2.0` em código gerado:

```
src/App.tsx
src/cardapio/CardapioConfig.ts
src/cardapio/CardapioPage.tsx
src/cardapio/CardapioTypes.ts
src/cardapio/SupabaseClient.ts
src/cardapio/components/CardapioAiChefAssistant.tsx
src/cardapio/components/CardapioAuthModal.tsx
src/cardapio/components/CardapioCartDrawer.tsx
src/cardapio/components/CardapioCategoryNav.tsx
src/cardapio/components/CardapioDigital.tsx
src/cardapio/components/CardapioHeader.tsx
src/cardapio/components/CardapioProductCard.tsx
src/cardapio/components/CardapioProductModal.tsx
src/cardapio/components/CardapioStoreInfoDrawer.tsx
src/cardapio/components/CardapioUserProfileModal.tsx
src/cardapio/supabaseSync.ts
src/components/FechamentoCegoModal.tsx
src/components/KitchenPanel.tsx
src/components/ManagerPinModal.tsx
src/components/MenuPanel.tsx
src/components/MesaCard.tsx
src/components/MesaDetailsModal.tsx
src/config/api.ts
src/data.ts
src/domain.ts
src/types.ts
src/utils/authSession.ts
```

**Classificação:** Código gerado por IA (Google AI Studio/Gemini) com cabeçalho Apache-2.0 inserido automaticamente pela ferramenta geradora.

**Situação legal:** Código gerado por IA não é obra de autoria de terceiros. O cabeçalho Apache-2.0 é inserido como template pela ferramenta — não indica que o código é uma cópia de obra Apache-2.0 pré-existente. Esses arquivos foram substancialmente editados e expandidos pelo autor (Georlan) após a geração inicial.

**⚠️ Ponto para revisão jurídica:** A relicenciamento desses 27 arquivos de Apache-2.0 para proprietário deve ser avaliado por um advogado que considere:
1. Em que medida o conteúdo é obra original do autor versus template gerado.
2. Se os termos de uso do Google AI Studio transferem direitos autorais ao usuário.
3. Se o cabeçalho Apache-2.0 foi inserido intencionalmente ou como boilerplate automático.

Enquanto essa análise não for concluída, **os cabeçalhos Apache-2.0 são mantidos** nesses 27 arquivos por precaução.

### Grupo B — Arquivos sem cabeçalho de licença

Todos os demais arquivos em `src/` (ex.: `CaixaPanel.tsx`, subcomponentes de `caixa/`, `equipe/`, `estoque/`, `relatorios/`, etc.) e todo o backend Python (`backend/app/**/*.py`) **não possuem cabeçalho de licença**.

**Classificação:** Código autoral do projeto, criado exclusivamente pelo autor (Georlan) sem geração automática de cabeçalhos por ferramentas de IA.

**Ação recomendada:** Após resolução jurídica dos 27 arquivos do Grupo A, adicionar cabeçalho proprietário a todos os arquivos do Grupo B.

---

## 5. Obrigações de Atribuição

Os componentes listados nas seções 1, 2 e 3 são utilizados como dependências externas sem modificação do código-fonte. As licenças MIT, ISC, BSD-3-Clause e Apache-2.0 exigem a preservação de avisos de copyright, que são atendidos pela manutenção das dependências em seus respectivos diretórios de distribuição.

A licença LGPL-3.0 do `psycopg2-binary` é satisfeita pelo uso via importação dinâmica Python.

---

*Documento gerado em: 2026-08-06*
*Versão: 1.0*
*Responsável: Georlan*
