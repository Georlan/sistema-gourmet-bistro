import datetime
import pytest
from fastapi.testclient import TestClient

from app.database import Base, SessionLocal, engine, tenant_session_scope
from app.main import app
from app.models import (
    Distribuidor,
    Insumo,
    MovimentacaoEstoque,
    Restaurante,
    Usuario,
)
from app.security import get_password_hash


client = TestClient(app)


@pytest.fixture(autouse=True)
def setup_database():
    Base.metadata.drop_all(bind=engine)
    Base.metadata.create_all(bind=engine)
    db = SessionLocal()
    try:
        r1 = db.query(Restaurante).filter(Restaurante.id == 1).first()
        if r1:
            r1.nome = "Restaurante Um"
            r1.slug = "rest-um"
            r1.plano = "premium"
        else:
            db.add(Restaurante(id=1, nome="Restaurante Um", slug="rest-um", plano="premium"))
        if not db.query(Restaurante).filter(Restaurante.id == 2).first():
            db.add(Restaurante(id=2, nome="Restaurante Dois", slug="rest-dois", plano="premium"))
        db.flush()
        db.add_all([
            Usuario(
                id="u-admin-1",
                restaurante_id=1,
                nome="Admin 1",
                email="admin1@test.com",
                cargo="admin",
                status="ativo",
                senha_hash=get_password_hash("senha1234"),
            ),
            Usuario(
                id="u-admin-2",
                restaurante_id=2,
                nome="Admin 2",
                email="admin2@test.com",
                cargo="admin",
                status="ativo",
                senha_hash=get_password_hash("senha1234"),
            ),
        ])
        db.commit()
    finally:
        db.close()


def _headers(email: str) -> dict[str, str]:
    res = client.post("/auth/login", json={"username": email, "password": "senha1234"})
    assert res.status_code == 200, res.text
    return {"Authorization": f"Bearer {res.json()['access_token']}"}


def test_manual_entry_rejects_cross_tenant_distribuidor_id():
    h1 = _headers("admin1@test.com")
    h2 = _headers("admin2@test.com")

    dist_res = client.post(
        "/estoque/distribuidores",
        json={"nome_fantasia": "Fornecedor Secreto T1", "cnpj": "11.111.111/0001-11"},
        headers=h1,
    )
    assert dist_res.status_code == 201
    t1_dist_id = dist_res.json()["id"]

    ins_res = client.post(
        "/estoque/insumos",
        json={"nome": "Farinha T2", "unidade_medida": "kg"},
        headers=h2,
    )
    assert ins_res.status_code == 201
    t2_insumo_id = ins_res.json()["id"]

    entry_res = client.post(
        "/estoque/entradas/manual",
        json={
            "distribuidor_id": t1_dist_id,
            "numero_documento": "NF-CROSS",
            "itens": [
                {
                    "insumo_id": t2_insumo_id,
                    "quantidade": 5.0,
                    "custo_unitario": 10.0,
                }
            ],
        },
        headers=h2,
    )
    assert entry_res.status_code == 404, entry_res.text


def test_manual_entry_inline_distribuidor_and_insumo_no_cross_tenant_pk_collision():
    h1 = _headers("admin1@test.com")
    h2 = _headers("admin2@test.com")

    payload = {
        "distribuidor_nome_fantasia": "Atacadão Central",
        "numero_documento": "DOC-01",
        "itens": [
            {
                "insumo_id": "",
                "insumo_nome": "Tomate Fresco",
                "quantidade": 4.0,
                "unidade_medida": "kg",
                "custo_unitario": 7.5,
            }
        ],
    }

    r1 = client.post("/estoque/entradas/manual", json=payload, headers=h1)
    assert r1.status_code == 201, r1.text

    r2 = client.post("/estoque/entradas/manual", json=payload, headers=h2)
    assert r2.status_code == 201, r2.text
    assert r1.json()["distribuidor"]["id"] != r2.json()["distribuidor"]["id"]
    assert r1.json()["itens"][0]["insumo_id"] != r2.json()["itens"][0]["insumo_id"]


def test_xml_import_with_negative_stock_does_not_corrupt_average_cost():
    h1 = _headers("admin1@test.com")

    db = SessionLocal()
    try:
        with tenant_session_scope(db, 1):
            db.add(
                Insumo(
                    id="ins-1-queijo-mussarela",
                    restaurante_id=1,
                    nome="Queijo Mussarela",
                    estoque_atual=-8.0,
                    estoque_minimo=5.0,
                    estoque_maximo=50.0,
                    unidade_medida="kg",
                    preco_medio_custo=20.0,
                )
            )
            db.commit()
    finally:
        db.close()

    xml = """<?xml version="1.0" encoding="UTF-8"?>
<nfeProc xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00">
  <NFe>
    <infNFe Id="NFe35261112345678901234550010000002011000002011" versao="4.00">
      <ide><nNF>201</nNF><dhEmi>2026-11-19T10:00:00-03:00</dhEmi></ide>
      <emit><CNPJ>22345678000199</CNPJ><xNome>Laticinios Sul</xNome></emit>
      <det nItem="1">
        <prod>
          <xProd>Queijo Mussarela</xProd>
          <uCom>KG</uCom>
          <qCom>10.0000</qCom>
          <vUnCom>10.00</vUnCom>
        </prod>
      </det>
      <total><ICMSTot><vNF>100.00</vNF></ICMSTot></total>
    </infNFe>
  </NFe>
</nfeProc>"""

    res = client.post(
        "/estoque/importar-xml",
        files={"file": ("nfe.xml", xml, "text/xml")},
        headers=h1,
    )
    assert res.status_code == 200, res.text

    insumos = client.get("/estoque/insumos", headers=h1).json()
    queijo = next(item for item in insumos if item["id"] == "ins-1-queijo-mussarela")
    assert queijo["estoque_atual"] == pytest.approx(2.0)
    assert queijo["preco_medio_custo"] == pytest.approx(10.0)


def test_xml_import_rejects_non_positive_quantity_or_negative_price():
    h1 = _headers("admin1@test.com")

    bad_xml = """<?xml version="1.0" encoding="UTF-8"?>
<nfeProc xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00">
  <NFe>
    <infNFe Id="NFe35261112345678901234550010000002021000002022" versao="4.00">
      <ide><nNF>202</nNF><dhEmi>2026-11-19T10:00:00-03:00</dhEmi></ide>
      <emit><CNPJ>22345678000199</CNPJ><xNome>Laticinios Sul</xNome></emit>
      <det nItem="1">
        <prod>
          <xProd>Item Invalido</xProd>
          <uCom>KG</uCom>
          <qCom>-5.0000</qCom>
          <vUnCom>10.00</vUnCom>
        </prod>
      </det>
      <total><ICMSTot><vNF>50.00</vNF></ICMSTot></total>
    </infNFe>
  </NFe>
</nfeProc>"""

    res = client.post(
        "/estoque/importar-xml",
        files={"file": ("bad.xml", bad_xml, "text/xml")},
        headers=h1,
    )
    assert res.status_code == 400, res.text
    assert client.get("/estoque/notas", headers=h1).json() == []


def test_inventory_count_rejects_negative_quantity_and_invalid_status():
    h1 = _headers("admin1@test.com")
    ins = client.post(
        "/estoque/insumos",
        json={"nome": "Arroz", "unidade_medida": "kg"},
        headers=h1,
    ).json()

    r_neg = client.post(
        "/estoque/contagens",
        json={
            "status": "rascunho",
            "observacao": "teste negativo",
            "itens": [{"insumo_id": ins["id"], "quantidade_contada": -2.0}],
        },
        headers=h1,
    )
    assert r_neg.status_code == 400, r_neg.text

    r_ok = client.post(
        "/estoque/contagens",
        json={
            "status": "rascunho",
            "observacao": "rascunho valido",
            "itens": [{"insumo_id": ins["id"], "quantidade_contada": 5.0}],
        },
        headers=h1,
    )
    assert r_ok.status_code == 201
    contagem_id = r_ok.json()["id"]

    r_put_neg = client.put(
        f"/estoque/contagens/{contagem_id}",
        json={
            "status": "rascunho",
            "observacao": "update negativo",
            "itens": [{"insumo_id": ins["id"], "quantidade_contada": -1.0}],
        },
        headers=h1,
    )
    assert r_put_neg.status_code == 400, r_put_neg.text

    r_put_status = client.put(
        f"/estoque/contagens/{contagem_id}",
        json={
            "status": "status_invalido",
            "observacao": "status invalido",
            "itens": [{"insumo_id": ins["id"], "quantidade_contada": 5.0}],
        },
        headers=h1,
    )
    assert r_put_status.status_code == 400, r_put_status.text


def test_inventory_count_confirm_updates_snapshot_from_current_stock():
    h1 = _headers("admin1@test.com")
    ins = client.post(
        "/estoque/insumos",
        json={"nome": "Carne Bovina", "unidade_medida": "kg"},
        headers=h1,
    ).json()
    client.post(
        f"/estoque/insumos/{ins['id']}/ajustar",
        json={"tipo": "ENTRADA", "quantidade": 10.0, "justificativa": "Saldo inicial"},
        headers=h1,
    )

    draft = client.post(
        "/estoque/contagens",
        json={
            "status": "rascunho",
            "observacao": "Contagem da noite",
            "itens": [{"insumo_id": ins["id"], "quantidade_contada": 12.0}],
        },
        headers=h1,
    )
    assert draft.status_code == 201
    contagem_id = draft.json()["id"]

    # Estoque muda antes da confirmação da contagem
    client.post(
        f"/estoque/insumos/{ins['id']}/ajustar",
        json={"tipo": "SAIDA", "quantidade": 2.0, "justificativa": "Consumo antes da confirmacao"},
        headers=h1,
    )

    confirmed = client.post(f"/estoque/contagens/{contagem_id}/confirmar", headers=h1)
    assert confirmed.status_code == 200, confirmed.text
    item = confirmed.json()["itens"][0]
    assert item["ajustado"] is True
    assert item["quantidade_sistema"] == pytest.approx(8.0)
    assert item["quantidade_contada"] == pytest.approx(12.0)
    assert item["diferenca"] == pytest.approx(4.0)


def test_movimentacoes_date_only_filter_includes_full_operational_day():
    h1 = _headers("admin1@test.com")
    ins = client.post(
        "/estoque/insumos",
        json={"nome": "Azeite", "unidade_medida": "l"},
        headers=h1,
    ).json()

    db = SessionLocal()
    try:
        with tenant_session_scope(db, 1):
            db.add_all([
                MovimentacaoEstoque(
                    restaurante_id=1,
                    insumo_id=ins["id"],
                    tipo="entrada",
                    quantidade=5.0,
                    saldo_anterior=0.0,
                    saldo_posterior=5.0,
                    custo_unitario=30.0,
                    motivo="Entrada tarde operacional",
                    origem="entrada_manual",
                    created_at=datetime.datetime(2026, 11, 19, 18, 30, tzinfo=datetime.timezone.utc),
                ),
                MovimentacaoEstoque(
                    restaurante_id=1,
                    insumo_id=ins["id"],
                    tipo="perda",
                    quantidade=1.0,
                    saldo_anterior=5.0,
                    saldo_posterior=4.0,
                    custo_unitario=30.0,
                    motivo="Perda noite operacional (22:30 Fortaleza)",
                    origem="movimentacao_manual",
                    created_at=datetime.datetime(2026, 11, 20, 1, 30, tzinfo=datetime.timezone.utc),
                ),
                MovimentacaoEstoque(
                    restaurante_id=1,
                    insumo_id=ins["id"],
                    tipo="entrada",
                    quantidade=2.0,
                    saldo_anterior=4.0,
                    saldo_posterior=6.0,
                    custo_unitario=30.0,
                    motivo="Entrada dia seguinte (00:30 Fortaleza)",
                    origem="entrada_manual",
                    created_at=datetime.datetime(2026, 11, 20, 3, 30, tzinfo=datetime.timezone.utc),
                ),
            ])
            db.commit()
    finally:
        db.close()

    res = client.get(
        "/estoque/movimentacoes",
        params={"data_inicio": "2026-11-19", "data_fim": "2026-11-19"},
        headers=h1,
    )
    assert res.status_code == 200, res.text
    motivos = {row["motivo"] for row in res.json()}
    assert motivos == {
        "Entrada tarde operacional",
        "Perda noite operacional (22:30 Fortaleza)",
    }
