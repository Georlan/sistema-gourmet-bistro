import os
os.environ["DATABASE_URL"] = "sqlite:///./test_estoque_xml.db"

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
import xml.etree.ElementTree as ET

from app.database import Base, get_db
from app.models import Restaurante, Usuario, Insumo, Distribuidor, NotaEntrada
from app.security import get_password_hash
from app.main import app

client = TestClient(app)

# Dummy standard NF-e XML content to test the importer
xml_test_content = """<?xml version="1.0" encoding="UTF-8"?>
<nfeProc xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00">
  <NFe>
    <infNFe Id="NFe35260712345678901234550010000001041000001048" versao="4.00">
      <ide>
        <cUF>35</cUF>
        <cNF>00000104</cNF>
        <natOp>Venda de mercadoria</natOp>
        <mod>55</mod>
        <serie>1</serie>
        <nNF>104</nNF>
        <dhEmi>2026-07-10T12:00:00-03:00</dhEmi>
        <tpNF>1</tpNF>
      </ide>
      <emit>
        <CNPJ>12345678000199</CNPJ>
        <xNome>Distribuidora de Alimentos S.A.</xNome>
        <xFant>Distribuidora Master</xFant>
      </emit>
      <dest>
        <CNPJ>98765432000188</CNPJ>
        <xNome>Kôma Bistrô Ltda</xNome>
      </dest>
      <det nItem="1">
        <prod>
          <cProd>001</cProd>
          <cEAN>SEM GTIN</cEAN>
          <xProd>Queijo Mussarela Pedaço KG</xProd>
          <NCM>04069010</NCM>
          <CFOP>5102</CFOP>
          <uCom>KG</uCom>
          <qCom>10.0000</qCom>
          <vUnCom>45.50</vUnCom>
          <vProd>455.00</vProd>
        </prod>
      </det>
      <det nItem="2">
        <prod>
          <cProd>002</cProd>
          <cEAN>SEM GTIN</cEAN>
          <xProd>Tomate Italiano Especial</xProd>
          <NCM>07020000</NCM>
          <CFOP>5102</CFOP>
          <uCom>KG</uCom>
          <qCom>20.0000</qCom>
          <vUnCom>8.20</vUnCom>
          <vProd>164.00</vProd>
        </prod>
      </det>
      <total>
        <ICMSTot>
          <vBC>0.00</vBC>
          <vICMS>0.00</vICMS>
          <vProd>619.00</vProd>
          <vNF>619.00</vNF>
        </ICMSTot>
      </total>
    </infNFe>
  </NFe>
</nfeProc>
"""

# Second XML with the same items but different quantities and prices to test average cost calculation
xml_test_content_update = """<?xml version="1.0" encoding="UTF-8"?>
<nfeProc xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00">
  <NFe>
    <infNFe Id="NFe35260712345678901234550010000001051000001059" versao="4.00">
      <ide>
        <cUF>35</cUF>
        <cNF>00000105</cNF>
        <natOp>Venda de mercadoria</natOp>
        <mod>55</mod>
        <serie>1</serie>
        <nNF>105</nNF>
        <dhEmi>2026-07-11T14:30:00-03:00</dhEmi>
        <tpNF>1</tpNF>
      </ide>
      <emit>
        <CNPJ>12345678000199</CNPJ>
        <xNome>Distribuidora de Alimentos S.A.</xNome>
        <xFant>Distribuidora Master</xFant>
      </emit>
      <det nItem="1">
        <prod>
          <cProd>001</cProd>
          <xProd>Queijo Mussarela Pedaço KG</xProd>
          <uCom>KG</uCom>
          <qCom>15.0000</qCom>
          <vUnCom>50.00</vUnCom>
          <vProd>750.00</vProd>
        </prod>
      </det>
      <total>
        <ICMSTot>
          <vNF>750.00</vNF>
        </ICMSTot>
      </total>
    </infNFe>
  </NFe>
</nfeProc>
"""

@pytest.fixture(autouse=True)
def setup_database():
    from app.database import engine, SessionLocal
    Base.metadata.drop_all(bind=engine)
    Base.metadata.create_all(bind=engine)
    db = SessionLocal()
    
    # Create test user (Caixa)
    u1 = Usuario(
        id="u-caixa",
        restaurante_id=1,
        nome="Caixa Operator",
        usuario="caixa_test",
        senha_hash=get_password_hash("123"),
        role="caixa"
    )
    db.add(u1)
    db.commit()
    db.close()


def get_auth_token():
    # Helper to authenticate and get JWT token
    login_data = {"username": "caixa_test", "password": "123"}
    res = client.post("/auth/login", json=login_data)
    assert res.status_code == 200
    return res.json()["access_token"]


def test_xml_import_success():
    token = get_auth_token()
    headers = {"Authorization": f"Bearer {token}"}
    
    # Upload XML file
    files = {"file": ("nfe.xml", xml_test_content, "text/xml")}
    res = client.post("/estoque/importar-xml", files=files, headers=headers)
    
    assert res.status_code == 200
    json_data = res.json()
    assert json_data["success"] is True
    assert json_data["fornecedor"] == "Distribuidora Master"
    assert json_data["insumos_criados"] == 2
    assert json_data["insumos_atualizados"] == 0
    assert json_data["valor_total"] == 619.00
    
    # Verify GET /insumos
    res_ins = client.get("/estoque/insumos", headers=headers)
    assert res_ins.status_code == 200
    insumos = res_ins.json()
    assert len(insumos) == 2
    
    # Search for "Queijo Mussarela Pedaço KG"
    mussarela = next(i for i in insumos if "mussarela" in i["id"])
    assert mussarela["estoque_atual"] == 10.0
    assert mussarela["preco_medio_custo"] == 45.50
    assert mussarela["unidade_medida"] == "kg"

    # Verify GET /distribuidores
    res_dist = client.get("/estoque/distribuidores", headers=headers)
    assert res_dist.status_code == 200
    distribuidores = res_dist.json()
    assert len(distribuidores) == 1
    assert distribuidores[0]["cnpj"] == "12345678000199"


def test_xml_import_update_and_average_cost():
    token = get_auth_token()
    headers = {"Authorization": f"Bearer {token}"}
    
    # 1. Import first XML
    files1 = {"file": ("nfe1.xml", xml_test_content, "text/xml")}
    client.post("/estoque/importar-xml", files=files1, headers=headers)
    
    # 2. Import second XML (updating quantity and recalculating cost)
    files2 = {"file": ("nfe2.xml", xml_test_content_update, "text/xml")}
    res2 = client.post("/estoque/importar-xml", files=files2, headers=headers)
    
    assert res2.status_code == 200
    json_data = res2.json()
    assert json_data["insumos_criados"] == 0
    assert json_data["insumos_atualizados"] == 1
    
    # 3. Verify weighted average cost calculations
    # Mussarela initial: 10 units at 45.50 (Total: 455.00)
    # Mussarela purchased: 15 units at 50.00 (Total: 750.00)
    # Expected total stock: 25.0
    # Expected weighted cost: (455.0 + 750.0) / 25.0 = 1205.0 / 25.0 = 48.20
    res_ins = client.get("/estoque/insumos", headers=headers)
    assert res_ins.status_code == 200
    insumos = res_ins.json()
    mussarela = next(i for i in insumos if "mussarela" in i["id"])
    assert mussarela["estoque_atual"] == 25.0
    assert round(mussarela["preco_medio_custo"], 2) == 48.20


def test_xml_import_duplicate_prevention():
    token = get_auth_token()
    headers = {"Authorization": f"Bearer {token}"}
    
    files1 = {"file": ("nfe.xml", xml_test_content, "text/xml")}
    res1 = client.post("/estoque/importar-xml", files=files1, headers=headers)
    assert res1.status_code == 200
    
    # Attempting to upload the exact same XML should fail with 400
    res2 = client.post("/estoque/importar-xml", files=files1, headers=headers)
    assert res2.status_code == 400
    assert "já foi importada anteriormente" in res2.json()["detail"]
