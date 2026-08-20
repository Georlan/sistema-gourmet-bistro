# Kôma — Handoff técnico

> Atualizado em 2026-08-20. Fonte de verdade: código, migrações e workflows da branch corrente.

## Estado do produto

- Frontend: React 19, TypeScript e Vite.
- Backend: Python 3.12, FastAPI, SQLAlchemy e Alembic.
- Produção: PostgreSQL/Supabase, Railway e Cloudflare Pages.
- Domínios existentes: salão, Caixa/PDV, KDS, cardápio digital, delivery próprio, PWA de motoboy, impressão e SmartPOS simulado.

## Roadmap vigente

1. **Fase A — SmartPOS:** núcleo F1–F12 implementado; integração PagBank/PlugPag, estorno no adquirente, APK release e homologação física ainda pendentes.
2. **Fase B — Delivery Kôma:** há capacidades implementadas, mas falta auditoria de produto vendável após a Fase A.
3. **Fase C — Channel Gateway:** não iniciado.
4. **Fase D — iFood inbound:** não iniciado.
5. **Fase E — iFood bidirecional:** não iniciado.
6. **Fase F — outros marketplaces:** não iniciado.

## Qualidade e execução

- A suíte local usa SQLite descartável e recusa bancos externos por padrão.
- O smoke B1.4 usa PostgreSQL 17 efêmero apenas quando `KOMA_PYTEST_USE_EXTERNAL_DATABASE=true` é definido pelo workflow dedicado.
- O Quality Gate executa tipos/build do frontend e o recorte crítico do backend.

```bash
python -m pip install -r backend/requirements-dev.txt
python -m pytest backend/tests -q
bash scripts/regression_check.sh
npm ci
npm run lint
npm audit --audit-level=high
npm run build
```

## Regra para o SmartPOS

`KOMA_SMARTPOS_PROVIDER` permanece `disabled` por padrão. `pagbank_simulator` serve somente para desenvolvimento e testes; não representa cobrança, estorno ou homologação reais.
