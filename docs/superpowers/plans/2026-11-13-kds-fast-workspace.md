# KDS rápido e compacto — implementation plan

1. [x] Diagnosticar rastreabilidade request/backend/snapshot com amostra de logs **sem identificadores de clientes** e registrar a causa.
2. [x] Implementar endpoint de lote atômico na API, reutilizando lifecycle, locks da comanda, autorização e isolamento de tenant; testes incluindo rollback, replay e avanço de status.
3. [x] Retirar `await onRefreshOrders()` do caminho crítico por item; atualizar UI somente após ACK e disparar reconciliação assíncrona, com guardas de sessão e IDs. Disponibilizar callback de lote nos dois portais.
4. [x] Reconstruir KDS como fila compacta: cabeçalho reduzido, default Em preparo, filtro/All Day/busca contextual, prioridade de produção, detalhes só quando necessários, ação de lote visível no topo, foco opcional.
5. [x] Cobrir com Playwright sob latências simuladas + cenários de permissão e rollback; observar prints reais 320/390/430 e desktop nos dois temas.
6. [ ] Gate lint/unit/backend/build/E2E; PR, CI obrigatório 100% verde, merge, meta SHA e smoke somente GET/OPTIONS. Sem acesso de gravação a clientes reais.
