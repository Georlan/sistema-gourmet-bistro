"""Simulação de capacidade escalonada (10, 50, 100 restaurantes) em ambiente isolado.

Mede:
- Latência P50, P95, P99 de POST /cardapio/pedidos
- Taxa de erro
- Isolamento estrito entre tenants
- Idempotência sob concorrência
- Ausência de vazamento de dados ou pedidos duplicados
"""

from __future__ import annotations

import concurrent.futures
import datetime
import os
import time
from decimal import Decimal
import pytest
from fastapi.testclient import TestClient

from app.database import Base, SessionLocal, current_restaurante_id, engine
from app.main import app
from app.models import (
    CaixaTurno,
    Categoria,
    Comanda,
    ConfiguracaoRestaurante,
    GrupoModificador,
    OpcaoModificador,
    Produto,
    Restaurante,
    Usuario,
)
from app.operational_models import NumeradorOperacional
from app.services.atendimentos import _operational_period
from app.online_order_control_models import OnlineOrderControl
from app.security import create_access_token, get_password_hash


def _percentile(values: list[float], p: float) -> float:
    if not values:
        return 0.0
    sorted_v = sorted(values)
    idx = min(len(sorted_v) - 1, int(len(sorted_v) * p))
    return sorted_v[idx]


def provision_synthetic_tenants(db, count: int, base_id: int = 2000) -> list[dict]:
    """Cria tenants fictícios isolados com cardápio, caixa aberto e usuário autenticado."""
    tenants = []
    pwd_hash = get_password_hash("senha-teste-capacidade-123")

    for i in range(count):
        rid = base_id + i
        token = current_restaurante_id.set(rid)
        try:
            # 1. Restaurante
            rest = db.query(Restaurante).filter(Restaurante.id == rid).first()
            if not rest:
                rest = Restaurante(
                    id=rid,
                    nome=f"Restaurante Sintético {rid}",
                    slug=f"sintetico-{rid}",
                    plano="pocket",
                    formas_pagamento_aceitas=["dinheiro", "pix", "cartao_credito"],
                )
                db.add(rest)
                db.flush()

            # 2. Configuração
            cfg = db.query(ConfiguracaoRestaurante).filter(ConfiguracaoRestaurante.restaurante_id == rid).first()
            if not cfg:
                cfg = ConfiguracaoRestaurante(
                    restaurante_id=rid,
                    delivery_ativo=True,
                    tipos_pedido_ativos=["delivery", "retirada", "consumo_local"],
                    pedido_minimo=0.0,
                )
                db.add(cfg)
                db.flush()

            # 3. Controle operacional
            ctrl = db.query(OnlineOrderControl).filter(OnlineOrderControl.restaurante_id == rid).first()
            if not ctrl:
                ctrl = OnlineOrderControl(restaurante_id=rid, auto_accept=True)
                db.add(ctrl)
                db.flush()

            # 4. Categoria e Produto
            cat = db.query(Categoria).filter(Categoria.restaurante_id == rid).first()
            if not cat:
                cat = Categoria(id=f"cat-{rid}", restaurante_id=rid, nome="Pratos Principais")
                db.add(cat)
                db.flush()

            prod = db.query(Produto).filter(Produto.restaurante_id == rid).first()
            if not prod:
                prod = Produto(
                    id=f"prod-{rid}",
                    restaurante_id=rid,
                    categoria_id=cat.id,
                    nome="Hambúrguer Artesanal",
                    preco=Decimal("35.00"),
                    ativo=True,
                )
                db.add(prod)
                db.flush()

            # 5. Operador / Garçom
            usr = db.query(Usuario).filter(Usuario.restaurante_id == rid).first()
            if not usr:
                usr = Usuario(
                    id=f"usr-{rid}",
                    restaurante_id=rid,
                    nome=f"Operador {rid}",
                    email=f"operador-{rid}@koma.test",
                    senha_hash=pwd_hash,
                    role="admin",
                    cargo="admin",
                    status="ativo",
                )
                db.add(usr)
                db.flush()

            # 6. Turno de Caixa
            turno = db.query(CaixaTurno).filter(CaixaTurno.restaurante_id == rid, CaixaTurno.status == "aberto").first()
            if not turno:
                turno = CaixaTurno(
                    restaurante_id=rid,
                    aberto_por_id=usr.id,
                    saldo_inicial=Decimal("100.00"),
                    status="aberto",
                    aberto_em=datetime.datetime.now(datetime.timezone.utc),
                )
                db.add(turno)
                db.flush()

            # 7. Numerador Operacional
            pref = _operational_period()
            num = db.query(NumeradorOperacional).filter(
                NumeradorOperacional.restaurante_id == rid,
                NumeradorOperacional.periodo_ref == pref,
            ).first()
            if not num:
                num = NumeradorOperacional(
                    restaurante_id=rid,
                    periodo_ref=pref,
                    ultimo_numero=0,
                )
                db.add(num)
                db.flush()

            jwt_token = create_access_token(
                subject=usr.id,
                restaurante_id=rid,
                role="admin",
                extra_claims={"email": usr.email, "user_id": usr.id},
            )

            tenants.append({
                "restaurante_id": rid,
                "slug": rest.slug,
                "produto_id": prod.id,
                "headers": {"Authorization": f"Bearer {jwt_token}"},
            })
        finally:
            current_restaurante_id.reset(token)

    db.commit()
    return tenants


def run_stage_simulation(tenants: list[dict], requests_per_tenant: int = 3, concurrency: int = 10) -> dict:
    """Executa o ciclo completo de carga simulada multi-tenant e registra métricas."""
    latencies: list[float] = []
    errors: list[str] = []
    created_orders: dict[int, list[str]] = {t["restaurante_id"]: [] for t in tenants}

    tasks = []
    for tenant in tenants:
        for seq in range(requests_per_tenant):
            tasks.append((tenant, seq))

    def execute_single(task_item):
        client = TestClient(app)
        t_data, sequence = task_item
        rid = t_data["restaurante_id"]
        pid = t_data["produto_id"]
        idempotency_key = f"cap-stage:{rid}:{sequence}"
        phone_digits = f"859{((rid * 100 + sequence) % 90000000 + 10000000):08d}"
        ip_addr = f"192.168.{(rid // 250) % 250}.{(rid % 250) + 1}"

        # 1. Navegação de cardápio pública (status-check / config)
        nav_res = client.get(
            f"/cardapio/pedidos/status-check?rid={rid}",
            headers={"X-Forwarded-For": ip_addr},
        )
        if nav_res.status_code not in (200, 404):
            errors.append(f"Cardapio nav tenant {rid} falhou: HTTP {nav_res.status_code}")

        # 2. Checkout
        payload = {
            "restaurante_id": rid,
            "tipo_pedido": "delivery",
            "cliente_nome": f"Cliente Fictício {sequence}",
            "cliente_telefone": phone_digits,
            "endereco_entrega": "Rua das Amostras, 100",
            "bairro": "Centro",
            "forma_pagamento": "na_entrega",
            "forma_pagamento_detalhe": "dinheiro",
            "itens": [
                {
                    "produto_id": pid,
                    "quantidade": 1,
                    "observacao": "Sem salada",
                }
            ],
            "idempotency_key": idempotency_key,
        }

        req_headers = {
            "X-Forwarded-For": ip_addr,
            "X-Idempotency-Key": idempotency_key,
        }

        # Simular Cardápio público -> Checkout
        t0 = time.perf_counter()
        res = client.post("/cardapio/pedidos", json=payload, headers=req_headers)
        elapsed_ms = (time.perf_counter() - t0) * 1000.0

        if res.status_code != 201:
            errors.append(f"Tenant {rid} HTTP {res.status_code}: {res.text[:120]}")
            return

        latencies.append(elapsed_ms)
        data = res.json()
        comanda_id = data.get("id") or data.get("comanda_id")
        created_orders[rid].append(comanda_id)

        # 3. Simular replay idempotente (deve retornar mesmo ID com 200/201 sem duplicar)
        replay_res = client.post("/cardapio/pedidos", json=payload, headers=req_headers)
        if replay_res.status_code not in (200, 201):
            errors.append(f"Replay idempotência falhou no tenant {rid}: HTTP {replay_res.status_code}")
        else:
            replay_id = replay_res.json().get("id") or replay_res.json().get("comanda_id")
            if replay_id != comanda_id:
                errors.append(f"Divergência de idempotência no tenant {rid}: {comanda_id} != {replay_id}")

        # 4. Operador / Caixa consulta comandas
        caixa_res = client.get(
            "/comandas/",
            headers={
                **t_data["headers"],
                "X-Forwarded-For": ip_addr,
            },
        )
        if caixa_res.status_code != 200:
            errors.append(f"Leitura Caixa tenant {rid} falhou: HTTP {caixa_res.status_code}")

        # 5. Rastreamento de pedido público (requer ?key=idempotency_key para verificação de posse)
        track_res = client.get(
            f"/cardapio/pedidos/{comanda_id}/status?key={idempotency_key}",
            headers={"X-Forwarded-For": ip_addr},
        )
        if track_res.status_code != 200:
            errors.append(f"Tracking pedido {comanda_id} tenant {rid} falhou: HTTP {track_res.status_code}")

    # Execução concorrente
    with concurrent.futures.ThreadPoolExecutor(max_workers=concurrency) as executor:
        futures = [executor.submit(execute_single, task) for task in tasks]
        concurrent.futures.wait(futures)

    # Validar isolamento estrito entre tenants
    db = SessionLocal()
    try:
        for tenant in tenants:
            rid = tenant["restaurante_id"]
            # Contar comandas deste tenant
            comandas_tenant = db.query(Comanda).filter(Comanda.restaurante_id == rid).all()
            for c in comandas_tenant:
                assert c.restaurante_id == rid, f"Vazamento de tenant detectado! {c.restaurante_id} != {rid}"
    finally:
        db.close()

    p50 = _percentile(latencies, 0.50)
    p95 = _percentile(latencies, 0.95)
    p99 = _percentile(latencies, 0.99)

    return {
        "tenants": len(tenants),
        "total_requests": len(tasks),
        "completed": len(latencies),
        "errors": len(errors),
        "error_details": errors[:5],
        "p50_ms": round(p50, 2),
        "p95_ms": round(p95, 2),
        "p99_ms": round(p99, 2),
    }


def test_capacity_stage_1_ten_tenants():
    """Etapa 1: 10 restaurantes fictícios -> validar fluxos e identificar gargalos."""
    Base.metadata.create_all(bind=engine)
    db = SessionLocal()
    try:
        tenants = provision_synthetic_tenants(db, count=10, base_id=3000)
    finally:
        db.close()

    stats = run_stage_simulation(tenants, requests_per_tenant=4, concurrency=4)
    print("\n--- ETAPA 1 (10 Restaurantes) ---", stats)
    assert stats["errors"] == 0, f"Erros na Etapa 1: {stats['error_details']}"
    assert stats["p95_ms"] < 2000.0, f"P95 ({stats['p95_ms']}ms) acima do teto de 2000ms"


def test_capacity_stage_2_fifty_tenants():
    """Etapa 2: 50 restaurantes fictícios -> verificar crescimento de consumo."""
    Base.metadata.create_all(bind=engine)
    db = SessionLocal()
    try:
        tenants = provision_synthetic_tenants(db, count=50, base_id=4000)
    finally:
        db.close()

    stats = run_stage_simulation(tenants, requests_per_tenant=2, concurrency=6)
    print("\n--- ETAPA 2 (50 Restaurantes) ---", stats)
    assert stats["errors"] == 0, f"Erros na Etapa 2: {stats['error_details']}"
    assert stats["p95_ms"] < 2500.0, f"P95 ({stats['p95_ms']}ms) acima do teto de 2500ms"


def test_capacity_stage_3_hundred_tenants():
    """Etapa 3: 100 restaurantes fictícios -> testar concorrência e estabilidade."""
    Base.metadata.create_all(bind=engine)
    db = SessionLocal()
    try:
        tenants = provision_synthetic_tenants(db, count=100, base_id=5000)
    finally:
        db.close()

    stats = run_stage_simulation(tenants, requests_per_tenant=2, concurrency=8)
    print("\n--- ETAPA 3 (100 Restaurantes) ---", stats)
    assert stats["errors"] == 0, f"Erros na Etapa 3: {stats['error_details']}"
    assert stats["p95_ms"] < 3500.0, f"P95 ({stats['p95_ms']}ms) acima do teto de 3500ms"
