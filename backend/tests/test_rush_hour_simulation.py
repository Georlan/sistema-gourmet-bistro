import datetime
import threading
import uuid
from concurrent.futures import ThreadPoolExecutor, as_completed
import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.database import SessionLocal, current_restaurante_id
from app.models import (
    Restaurante,
    Usuario,
    Categoria,
    Produto,
    ConfiguracaoRestaurante,
    Mesa,
    Comanda,
    Item,
    Cupom,
    Cliente,
    HistoricoFidelidade,
    CaixaTurno,
    Pagamento,
)
from app.routes.auth import create_access_token

client = TestClient(app)
SIM_REST_ID = 777


@pytest.fixture(scope="module", autouse=True)
def setup_rush_hour_environment():
    db = SessionLocal()
    token = current_restaurante_id.set(SIM_REST_ID)
    try:
        # 1. Restaurante
        rest = db.query(Restaurante).filter(Restaurante.id == SIM_REST_ID).first()
        if not rest:
            rest = Restaurante(id=SIM_REST_ID, nome="Bistrô Rush Hour", slug="rush-hour", plano="premium")
            db.add(rest)
            db.commit()

        # 2. Configurações
        config = db.query(ConfiguracaoRestaurante).filter(ConfiguracaoRestaurante.restaurante_id == SIM_REST_ID).first()
        if not config:
            config = ConfiguracaoRestaurante(
                restaurante_id=SIM_REST_ID,
                delivery_ativo=True,
                tipo_taxa_entrega="bairro",
                taxa_entrega_fixa=7.0,
                pedido_minimo=15.0,
                frete_gratis_valor=150.0,
                tabela_taxas_bairros=[
                    {"bairro": "Centro", "taxa": 5.0},
                    {"bairro": "Bairro Nobre", "taxa": 10.0},
                ],
            )
            db.add(config)
            db.commit()
        else:
            config.tipo_taxa_entrega = "bairro"
            config.tabela_taxas_bairros = [
                {"bairro": "Centro", "taxa": 5.0},
                {"bairro": "Bairro Nobre", "taxa": 10.0},
            ]
            db.commit()

        # 3. Usuários (Caixa, Garçom 1, Garçom 2, Cozinha)
        for uid, role, name in [
            ("usr-caixa-sim", "caixa", "Operador Caixa"),
            ("usr-garcom-1", "garcom", "Garçom Carlos"),
            ("usr-garcom-2", "garcom", "Garçom Ana"),
            ("usr-cozinha-1", "gerente", "Chef Roberto"),
        ]:
            if not db.query(Usuario).filter(Usuario.id == uid).first():
                db.add(Usuario(
                    id=uid,
                    restaurante_id=SIM_REST_ID,
                    nome=name,
                    email=f"{uid}@rush.test",
                    cargo=role,
                    status="ativo",
                ))
        db.commit()

        # 4. Turno de Caixa
        turno = db.query(CaixaTurno).filter(CaixaTurno.restaurante_id == SIM_REST_ID, CaixaTurno.status == "aberto").first()
        if not turno:
            turno = CaixaTurno(
                restaurante_id=SIM_REST_ID,
                aberto_por_id="usr-caixa-sim",
                saldo_inicial=200.0,
                status="aberto",
            )
            db.add(turno)
            db.commit()

        # 5. Mesas (Mesa 1 a 10)
        for m_id in range(1, 11):
            if not db.query(Mesa).filter(Mesa.restaurante_id == SIM_REST_ID, Mesa.id == m_id).first():
                db.add(Mesa(id=m_id, restaurante_id=SIM_REST_ID, capacidade=4, nome=f"Mesa {m_id}"))
        db.commit()

        # 6. Categorias e Produtos
        cat = db.query(Categoria).filter(Categoria.restaurante_id == SIM_REST_ID, Categoria.id == "cat-rush").first()
        if not cat:
            cat = Categoria(id="cat-rush", restaurante_id=SIM_REST_ID, nome="Menu Principal")
            db.add(cat)
            db.commit()

        for p_id, p_name, p_price in [
            ("prod-burger", "Hambúrguer Gourmet", 35.0),
            ("prod-pizza", "Pizza Margherita", 50.0),
            ("prod-chopp", "Chopp Artesanal 500ml", 15.0),
            ("prod-suco", "Suco Natural", 12.0),
            ("prod-sobremesa", "Petit Gâteau", 25.0),
        ]:
            if not db.query(Produto).filter(Produto.restaurante_id == SIM_REST_ID, Produto.id == p_id).first():
                db.add(Produto(
                    id=p_id,
                    restaurante_id=SIM_REST_ID,
                    categoria_id="cat-rush",
                    nome=p_name,
                    preco=p_price,
                    ativo=True,
                ))
        db.commit()

        # 7. Cliente de Fidelidade com saldo de cashback
        cli = db.query(Cliente).filter(Cliente.restaurante_id == SIM_REST_ID, Cliente.telefone == "11988880001").first()
        if not cli:
            cli = Cliente(
                id="cli-rush-vip",
                restaurante_id=SIM_REST_ID,
                telefone="11988880001",
                nome="Cliente VIP Concorrente",
                saldo_cashback=30.0,
                saldo_pontos=30,
            )
            db.add(cli)
            db.commit()
        else:
            cli.saldo_cashback = 30.0
            db.commit()

        # 8. Cupom com limite estrito de usos (apenas 2 usos permitidos)
        cup = db.query(Cupom).filter(Cupom.restaurante_id == SIM_REST_ID, Cupom.codigo == "RUSH2").first()
        if not cup:
            cup = Cupom(
                id="cup-rush-2",
                restaurante_id=SIM_REST_ID,
                codigo="RUSH2",
                tipo_desconto="fixo",
                valor_desconto=10.0,
                valor_minimo_pedido=20.0,
                limite_usos=2,
                usos_atuais=0,
                ativo=True,
            )
            db.add(cup)
            db.commit()
        else:
            cup.usos_atuais = 0
            cup.limite_usos = 2
            cup.ativo = True
            db.commit()
    finally:
        current_restaurante_id.reset(token)
        db.close()


def get_headers(user_id: str, role: str):
    token = create_access_token(subject=user_id, restaurante_id=SIM_REST_ID, role=role)
    return {"Authorization": f"Bearer {token}"}


# ==============================================================================
# TEST 1: CONCORRÊNCIA DE DOIS GARÇONS ABRINDO A MESMA MESA SIMULTANEAMENTE
# ==============================================================================
def test_two_waiters_concurrent_table_opening():
    """
    Dois garçons (Carlos e Ana) tentam abrir a Mesa 5 ao mesmo tempo.
    O sistema deve garantir integridade e não corromper ou criar duplicatas.
    """
    mesa_id = 5
    barrier = threading.Barrier(2)
    results = []

    def waiter_action(waiter_id):
        headers = get_headers(waiter_id, "garcom")
        barrier.wait(timeout=5)
        res = client.post(
            "/comandas/",
            headers=headers,
            json={
                "mesa_id": mesa_id,
                "garcom_id": waiter_id,
                "tipo": "Consumo no Local",
            }
        )
        return res.status_code, res.json() if res.status_code < 500 else res.text

    with ThreadPoolExecutor(max_workers=2) as executor:
        f1 = executor.submit(waiter_action, "usr-garcom-1")
        f2 = executor.submit(waiter_action, "usr-garcom-2")
        for f in as_completed([f1, f2]):
            results.append(f.result())

    status_codes = [r[0] for r in results]
    assert all(code in (200, 201) for code in status_codes), f"Status inesperados: {status_codes}"

    db = SessionLocal()
    token = current_restaurante_id.set(SIM_REST_ID)
    try:
        comandas = db.query(Comanda).filter(
            Comanda.restaurante_id == SIM_REST_ID,
            Comanda.mesa_id == mesa_id,
            Comanda.fechada == False,
        ).all()
        assert len(comandas) >= 1
    finally:
        current_restaurante_id.reset(token)
        db.close()


# ==============================================================================
# TEST 2: CONCORRÊNCIA DE MÚLTIPLOS GARÇONS LANÇANDO ITENS NA MESMA COMANDA
# ==============================================================================
def test_concurrent_item_ordering_on_same_table():
    """
    4 garçons lançando 8 itens simultaneamente na mesma mesa/comanda.
    Nenhum item pode ser perdido (lost update prevention).
    """
    headers_g1 = get_headers("usr-garcom-1", "garcom")
    r_init = client.post(
        "/comandas/",
        headers=headers_g1,
        json={"mesa_id": 6, "garcom_id": "usr-garcom-1", "tipo": "Consumo no Local"}
    )
    assert r_init.status_code in (200, 201)
    comanda_id = r_init.json().get("id")

    barrier = threading.Barrier(8)
    items_to_launch = [
        "prod-chopp",
        "prod-burger",
        "prod-suco",
        "prod-pizza",
        "prod-sobremesa",
        "prod-chopp",
        "prod-suco",
        "prod-burger",
    ]

    def launch_item(prod_id, idx):
        waiter = "usr-garcom-1" if idx % 2 == 0 else "usr-garcom-2"
        headers = get_headers(waiter, "garcom")
        barrier.wait(timeout=5)
        res = client.post(
            f"/comandas/{comanda_id}/lancamentos",
            headers=headers,
            json={
                "garcom_id": waiter,
                "itens": [{"produto_id": prod_id, "observacao": f"Thread {idx}", "cliente_nome": "Mesa 6"}]
            }
        )
        return res.status_code

    with ThreadPoolExecutor(max_workers=8) as executor:
        futures = [executor.submit(launch_item, prod, i) for i, prod in enumerate(items_to_launch)]
        results = [f.result() for f in as_completed(futures)]

    assert all(code in (200, 201) for code in results), f"Erros ao lançar itens: {results}"

    db = SessionLocal()
    token = current_restaurante_id.set(SIM_REST_ID)
    try:
        db_items = db.query(Item).filter(Item.comanda_id == comanda_id).all()
        assert len(db_items) == 8, f"Esperado exatamente 8 itens lançados, encontrado {len(db_items)}"
    finally:
        current_restaurante_id.reset(token)
        db.close()


# ==============================================================================
# TEST 3: CORRIDA DE CUPOM COM LIMITE DE USOS (5 CLIENTES NO MESMO MILISSEGUNDO)
# ==============================================================================
def test_coupon_usage_limit_race_condition():
    """
    Cupom RUSH2 tem limite_usos = 2.
    5 clientes tentam fazer pedido usando o cupom no exato mesmo momento.
    Exatamente 2 pedidos devem aplicar o cupom com sucesso.
    Os outros 3 não podem estourar o limite de usos no banco.
    """
    barrier = threading.Barrier(5)

    def place_order(client_idx):
        barrier.wait(timeout=5)
        res = client.post(
            "/cardapio/pedidos",
            json={
                "restaurante_id": SIM_REST_ID,
                "cliente_nome": f"Cliente Cupom {client_idx}",
                "cliente_telefone": f"1197777000{client_idx}",
                "endereco_entrega": "Rua Centro, 100",
                "bairro": "Centro",
                "tipo_pedido": "delivery",
                "cupom_codigo": "RUSH2",
                "itens": [{"produto_id": "prod-burger", "quantidade": 1}],
                "idempotency_key": f"idem-cupom-{client_idx}-{uuid.uuid4().hex[:6]}"
            }
        )
        return res.status_code, res.json()

    with ThreadPoolExecutor(max_workers=5) as executor:
        futures = [executor.submit(place_order, i) for i in range(5)]
        responses = [f.result() for f in as_completed(futures)]

    # 1. Validação de status HTTP de sucesso para todos os 5 pedidos
    assert len(responses) == 5
    for status_code, data in responses:
        assert status_code == 201, f"Falha ao criar pedido na corrida de cupom: {data}"

    # 2. Validação financeira estrita nas respostas HTTP
    # Hambúrguer R$ 35,00 + Entrega R$ 5,00 = R$ 40,00 base
    # Com cupom RUSH2 (-R$ 10,00) = R$ 30,00
    totals = [round(float(data["total"]), 2) for _, data in responses]
    discounted_totals = [t for t in totals if t == 30.0]
    full_price_totals = [t for t in totals if t == 40.0]

    assert len(discounted_totals) == 2, f"Esperado exatamente 2 pedidos com desconto (R$ 30,00), obtido: {totals}"
    assert len(full_price_totals) == 3, f"Esperado exatamente 3 pedidos a preço cheio (R$ 40,00), obtido: {totals}"

    # 3. Validação de atomicidade e integridade no banco de dados
    db = SessionLocal()
    token = current_restaurante_id.set(SIM_REST_ID)
    try:
        cup = db.query(Cupom).filter(Cupom.restaurante_id == SIM_REST_ID, Cupom.codigo == "RUSH2").first()
        assert cup.usos_atuais == 2, f"Cupom deve ter exatamente 2 usos registrados no banco: {cup.usos_atuais} / {cup.limite_usos}"

        order_ids = [data["id"] for _, data in responses]
        comandas = db.query(Comanda).filter(Comanda.id.in_(order_ids)).all()
        assert len(comandas) == 5

        comandas_com_desconto = [
            c for c in comandas
            if c.cupom_id == cup.id and round(float(c.valor_desconto_cupom or 0.0), 2) == 10.0
        ]
        comandas_sem_desconto = [
            c for c in comandas
            if c.cupom_id is None and round(float(c.valor_desconto_cupom or 0.0), 2) == 0.0
        ]

        assert len(comandas_com_desconto) == 2, f"Esperado exatamente 2 comandas persistidas com desconto: {len(comandas_com_desconto)}"
        assert len(comandas_sem_desconto) == 3, f"Esperado exatamente 3 comandas persistidas sem desconto: {len(comandas_sem_desconto)}"
    finally:
        current_restaurante_id.reset(token)
        db.close()


# ==============================================================================
# TEST 4: CASHBACK SIMULTÂNEO (EVITAR SALDO NEGATIVO)
# ==============================================================================
def test_cashback_concurrency_protection():
    """
    Cliente possui R$ 30,00 de saldo.
    Dispara 2 pedidos simultâneos resgatando cashback.
    O saldo final de fidelidade NÃO pode ficar negativo!
    """
    barrier = threading.Barrier(2)

    def order_with_cashback(order_idx):
        barrier.wait(timeout=5)
        res = client.post(
            "/cardapio/pedidos",
            json={
                "restaurante_id": SIM_REST_ID,
                "cliente_nome": "Cliente VIP Concorrente",
                "cliente_telefone": "11988880001",
                "tipo_pedido": "retirada",
                "usar_cashback": True,
                "itens": [{"produto_id": "prod-burger", "quantidade": 1}],
                "idempotency_key": f"cashback-sim-{order_idx}-{uuid.uuid4().hex[:6]}"
            }
        )
        return res.status_code, res.json()

    with ThreadPoolExecutor(max_workers=2) as executor:
        f1 = executor.submit(order_with_cashback, 1)
        f2 = executor.submit(order_with_cashback, 2)
        r1 = f1.result()
        r2 = f2.result()

    db = SessionLocal()
    token = current_restaurante_id.set(SIM_REST_ID)
    try:
        cli = db.query(Cliente).filter(Cliente.restaurante_id == SIM_REST_ID, Cliente.telefone == "11988880001").first()
        assert cli.saldo_cashback >= 0.0, f"Saldo de fidelidade ficou negativo: {cli.saldo_cashback}"
    finally:
        current_restaurante_id.reset(token)
        db.close()


# ==============================================================================
# TEST 5: SIMULAÇÃO COMPLETA DE HORA DE PICO (RUSH HOUR BLITZ)
# ==============================================================================
def test_full_rush_hour_blitz():
    """
    Simula um momento de pico com 20 operações simultâneas ocorrendo ao mesmo tempo:
    - 6 pedidos online de delivery/retirada entrando simultaneamente
    - 6 garçons abrindo mesas e lançando itens simultaneamente
    - 4 pedidos de balcão pelo caixa
    - 2 consultas de resumo de turno pelo gerente
    - 2 consultas de painel de pedidos / KDS
    """
    barrier = threading.Barrier(20)
    results = []

    def op_online_order(idx):
        barrier.wait(timeout=5)
        is_delivery = (idx % 2 == 0)
        res = client.post(
            "/cardapio/pedidos",
            json={
                "restaurante_id": SIM_REST_ID,
                "cliente_nome": f"Cliente Blitz {idx}",
                "cliente_telefone": f"1196666000{idx}",
                "tipo_pedido": "delivery" if is_delivery else "retirada",
                "endereco_entrega": "Rua Centro, 20" if is_delivery else "",
                "bairro": "Centro" if is_delivery else None,
                # Pedidos que entram direto no PDV usam apenas dinheiro físico.
                # Pix percorre a barreira online e é coberto na suíte específica.
                "forma_pagamento_detalhe": "dinheiro",
                "troco_para": 50.0 if not is_delivery else None,
                "itens": [{"produto_id": "prod-pizza", "quantidade": 1}],
                "idempotency_key": f"blitz-online-{idx}-{uuid.uuid4().hex[:6]}"
            }
        )
        return "online_order", res.status_code

    def op_waiter_table(idx):
        barrier.wait(timeout=5)
        waiter = "usr-garcom-1" if idx % 2 == 0 else "usr-garcom-2"
        headers = get_headers(waiter, "garcom")
        mesa_target = (idx % 4) + 1
        res = client.post(
            "/comandas/",
            headers=headers,
            json={
                "mesa_id": mesa_target,
                "garcom_id": waiter,
                "tipo": "Consumo no Local",
            }
        )
        return "waiter_table", res.status_code

    def op_counter_order(idx):
        barrier.wait(timeout=5)
        headers = get_headers("usr-caixa-sim", "caixa")
        res = client.post(
            "/comandas/",
            headers=headers,
            json={
                "tipo": "Retirada",
                "garcom_id": "usr-caixa-sim",
                "identificador": f"Balcão {idx}",
            }
        )
        return "counter_order", res.status_code

    def op_shift_summary(idx):
        barrier.wait(timeout=5)
        headers = get_headers("usr-caixa-sim", "caixa")
        res = client.get("/caixa/turno/resumo", headers=headers)
        return "shift_summary", res.status_code

    def op_kds_status(idx):
        barrier.wait(timeout=5)
        headers = get_headers("usr-cozinha-1", "gerente")
        res = client.get("/comandas/detalhes/todos", headers=headers)
        return "kds_status", res.status_code

    tasks = []
    # 6 online orders
    for i in range(6):
        tasks.append((op_online_order, i))
    # 6 waiter orders
    for i in range(6):
        tasks.append((op_waiter_table, i))
    # 4 counter orders
    for i in range(4):
        tasks.append((op_counter_order, i))
    # 2 shift summaries
    for i in range(2):
        tasks.append((op_shift_summary, i))
    # 2 KDS live checks
    for i in range(2):
        tasks.append((op_kds_status, i))

    with ThreadPoolExecutor(max_workers=20) as executor:
        futures = [executor.submit(fn, arg) for fn, arg in tasks]
        for f in as_completed(futures):
            results.append(f.result())

    failed_ops = [r for r in results if r[1] not in (200, 201)]
    assert len(failed_ops) == 0, f"Falhas detectadas sob pico de tráfego: {failed_ops}"
    print(f"\n[RUSH HOUR BLITZ] 20 operações simultâneas executadas e concluídas com 100% de sucesso!")


# ==============================================================================
# TEST 6: ACEITE DE PEDIDO ONLINE DUPLICADO / CONCORRENTE (IDEMPOTÊNCIA)
# ==============================================================================
def test_concurrent_online_order_acceptance():
    """
    Dois operadores ou dois cliques rápidos tentam aceitar o mesmo pedido online pendente.
    O sistema deve aceitar com sucesso e o status deve permanecer 'producao' sem duplicar
    movimentações ou quebrar o fluxo.
    """
    res_order = client.post(
        "/cardapio/pedidos",
        json={
            "restaurante_id": SIM_REST_ID,
            "cliente_nome": "Cliente Aceite Concorrente",
            "cliente_telefone": "11988887766",
            "tipo_pedido": "retirada",
            "itens": [{"produto_id": "prod-burger", "quantidade": 1}],
            "idempotency_key": f"aceite-conc-{uuid.uuid4().hex[:8]}"
        }
    )
    assert res_order.status_code == 201
    comanda_id = res_order.json().get("comanda_id") or res_order.json().get("id")

    barrier = threading.Barrier(2)

    def accept_order(operator_id):
        headers = get_headers(operator_id, "caixa")
        barrier.wait(timeout=5)
        res = client.put(
            f"/comandas/{comanda_id}/delivery/status?status_novo=producao",
            headers=headers,
        )
        return res.status_code

    with ThreadPoolExecutor(max_workers=2) as executor:
        f1 = executor.submit(accept_order, "usr-caixa-sim")
        f2 = executor.submit(accept_order, "usr-caixa-sim")
        codes = [f1.result(), f2.result()]

    assert all(c in (200, 201) for c in codes), f"Erros ao aceitar concorrentemente: {codes}"

    db = SessionLocal()
    token = current_restaurante_id.set(SIM_REST_ID)
    try:
        cmd = db.query(Comanda).filter(Comanda.id == comanda_id).first()
        assert cmd.delivery_status == "producao"
    finally:
        current_restaurante_id.reset(token)
        db.close()


# ==============================================================================
# TEST 7: DIVISÃO DE CONTA CONCORRENTE NA MESMA MESA (SPLIT BILL)
# ==============================================================================
def test_concurrent_split_bill_payments():
    """
    Mesa com R$ 100,00 de total.
    4 clientes pagam R$ 25,00 cada ao mesmo tempo em métodos diferentes.
    O sistema deve somar todos os pagamentos e o valor_pago final deve ser R$ 100,00.
    """
    headers = get_headers("usr-caixa-sim", "caixa")
    r_init = client.post(
        "/comandas/",
        headers=headers,
        json={"mesa_id": 8, "garcom_id": "usr-caixa-sim", "tipo": "Consumo no Local"}
    )
    assert r_init.status_code in (200, 201)
    comanda_id = r_init.json().get("id")

    # Lança itens totalizando R$ 100 (2x Pizza Margherita R$ 50 cada)
    client.post(
        f"/comandas/{comanda_id}/lancamentos",
        headers=headers,
        json={"garcom_id": "usr-caixa-sim", "itens": [{"produto_id": "prod-pizza", "quantidade": 2}]}
    )

    barrier = threading.Barrier(4)

    def pay_portion(idx, method):
        barrier.wait(timeout=5)
        res = client.post(
            f"/caixa/comandas/{comanda_id}/pagar",
            headers=headers,
            json={
                "metodo": method,
                "valor": 25.0,
                "idempotency_key": f"pay-split-{idx}-{uuid.uuid4().hex[:6]}"
            }
        )
        return res.status_code

    methods = ["pix", "cartao", "cartao", "dinheiro"]
    with ThreadPoolExecutor(max_workers=4) as executor:
        futures = [executor.submit(pay_portion, i, methods[i]) for i in range(4)]
        codes = [f.result() for f in as_completed(futures)]

    assert all(c in (200, 201) for c in codes), f"Erros ao registrar pagamentos divididos: {codes}"

    db = SessionLocal()
    token = current_restaurante_id.set(SIM_REST_ID)
    try:
        cmd = db.query(Comanda).filter(Comanda.id == comanda_id).first()
        pagamentos = db.query(Pagamento).filter(Pagamento.comanda_id == comanda_id).all()
        total_pago = sum(float(p.valor) for p in pagamentos)
        assert total_pago == 100.0, f"Valor pago divergente: {total_pago} (esperado 100.0)"
    finally:
        current_restaurante_id.reset(token)
        db.close()


# ==============================================================================
# TEST 8: GERAÇÃO CONCORRENTE DE NÚMEROS DE PEDIDO (SEM COLISÃO)
# ==============================================================================
def test_concurrent_order_number_allocation():
    """
    10 pedidos simultâneos gerados ao mesmo tempo.
    Todos os números de pedido gerados devem ser únicos.
    """
    barrier = threading.Barrier(10)

    def create_order(idx):
        barrier.wait(timeout=5)
        res = client.post(
            "/cardapio/pedidos",
            json={
                "restaurante_id": SIM_REST_ID,
                "cliente_nome": f"Cliente Num {idx}",
                "cliente_telefone": f"119555500{idx:02d}",
                "tipo_pedido": "retirada",
                "itens": [{"produto_id": "prod-chopp", "quantidade": 1}],
                "idempotency_key": f"order-num-{idx}-{uuid.uuid4().hex[:6]}"
            }
        )
        if res.status_code == 201:
            return res.json().get("numero_pedido")
        return None

    with ThreadPoolExecutor(max_workers=10) as executor:
        futures = [executor.submit(create_order, i) for i in range(10)]
        order_numbers = [f.result() for f in as_completed(futures) if f.result() is not None]

    assert len(order_numbers) == 10, f"Nem todos os pedidos foram criados: {len(order_numbers)}/10"
    assert len(set(order_numbers)) == len(order_numbers), f"Houve colisão de números de pedido: {order_numbers}"
