import pytest
from app.domain.printing import (
    PrintDocumentType,
    PaperWidth,
    PrintDestination,
    PrintItem,
    OrderPrintData,
    CommandPrintData,
    DeliveryOrderPrintData,
    PrintDocumentService,
    group_items_by_print_destination,
    is_production_destination
)

def test_01_pedido_apenas_bebidas_nenhum_nao_gera_producao():
    """1. Pedido apenas com bebidas NENHUM não gera PRODUCAO."""
    order = OrderPrintData(
        numero_pedido="101",
        itens=[
            PrintItem(codigo="010", nome="COCA-COLA 350ML", quantidade=2, preco_unit=7.0, destino_impressao="NENHUM"),
            PrintItem(codigo="011", nome="AGUA MINERAL", quantidade=1, preco_unit=4.0, destino_impressao="NENHUM")
        ]
    )
    result = PrintDocumentService.generate_production(order)
    assert result is None, "Pedido composto apenas por itens NENHUM não deve gerar documento de PRODUÇÃO"

def test_02_pedido_misto_gera_producao_apenas_com_itens_cozinha():
    """2. Pedido misto gera PRODUCAO apenas com itens COZINHA."""
    order = OrderPrintData(
        numero_pedido="102",
        itens=[
            PrintItem(codigo="001", nome="HAMBURGUER TRADICIONAL", quantidade=2, preco_unit=25.0, destino_impressao="COZINHA"),
            PrintItem(codigo="010", nome="COCA-COLA 350ML", quantidade=1, preco_unit=7.0, destino_impressao="NENHUM")
        ]
    )
    docs = PrintDocumentService.generate_production(order)
    assert docs is not None
    assert "COZINHA" in docs
    doc_text = docs["COZINHA"]
    
    assert "HAMBURGUER TRADICIONAL" in doc_text
    assert "COCA-COLA" not in doc_text

def test_03_itens_de_clientes_diferentes_nao_sao_agrupados_juntos():
    """3. Itens de clientes diferentes não são agrupados juntos."""
    order = OrderPrintData(
        numero_pedido="103",
        itens=[
            PrintItem(codigo="001", nome="HAMBURGUER", quantidade=1, cliente_nome="MARCOS", destino_impressao="COZINHA"),
            PrintItem(codigo="001", nome="HAMBURGUER", quantidade=1, cliente_nome="KAROL", destino_impressao="COZINHA")
        ]
    )
    docs = PrintDocumentService.generate_production(order)
    assert docs is not None
    doc_text = docs["COZINHA"]

    assert "MARCOS" in doc_text
    assert "KAROL" in doc_text
    assert doc_text.index("MARCOS") < doc_text.index("KAROL")
    assert doc_text.count("1x 001 HAMBURGUER") == 2

def test_04_itens_iguais_mesmo_cliente_mesma_observacao_somados():
    """4. Itens iguais do mesmo cliente e mesma observação são somados."""
    order = OrderPrintData(
        numero_pedido="104",
        itens=[
            PrintItem(codigo="001", nome="HAMBURGUER", quantidade=1, cliente_nome="MARCOS", observacao="Sem cebola", destino_impressao="COZINHA"),
            PrintItem(codigo="001", nome="HAMBURGUER", quantidade=1, cliente_nome="MARCOS", observacao="Sem cebola", destino_impressao="COZINHA")
        ]
    )
    docs = PrintDocumentService.generate_production(order)
    assert docs is not None
    doc_text = docs["COZINHA"]

    assert "2x 001 HAMBURGUER" in doc_text
    assert "SEM CEBOLA" in doc_text

def test_05_itens_iguais_mesmo_cliente_obs_diferentes_permanecem_separados():
    """5. Itens iguais do mesmo cliente com observações diferentes permanecem separados."""
    order = OrderPrintData(
        numero_pedido="105",
        itens=[
            PrintItem(codigo="001", nome="HAMBURGUER", quantidade=1, cliente_nome="MARCOS", observacao="Sem cebola", destino_impressao="COZINHA"),
            PrintItem(codigo="001", nome="HAMBURGUER", quantidade=1, cliente_nome="MARCOS", observacao="Sem queijo", destino_impressao="COZINHA")
        ]
    )
    docs = PrintDocumentService.generate_production(order)
    assert docs is not None
    doc_text = docs["COZINHA"]

    assert doc_text.count("1x 001 HAMBURGUER") == 2
    assert "SEM CEBOLA" in doc_text
    assert "SEM QUEIJO" in doc_text

def test_06_observacao_aparece_abaixo_do_item_correto():
    """6. Observação aparece abaixo do item correto."""
    order = OrderPrintData(
        numero_pedido="106",
        itens=[
            PrintItem(codigo="001", nome="HAMBURGUER TRADICIONAL", quantidade=1, observacao="Sem salada", destino_impressao="COZINHA"),
            PrintItem(codigo="043", nome="BATATA TAILANDESA", quantidade=1, observacao="Pimenta extra", destino_impressao="COZINHA")
        ]
    )
    docs = PrintDocumentService.generate_production(order)
    doc_text = docs["COZINHA"]

    hamb_pos = doc_text.index("HAMBURGUER TRADICIONAL")
    sem_salada_pos = doc_text.index("SEM SALADA")
    batata_pos = doc_text.index("BATATA TAILANDESA")
    pimenta_pos = doc_text.index("PIMENTA EXTRA")

    assert hamb_pos < sem_salada_pos < batata_pos < pimenta_pos

def test_07_producao_nao_conte_valores():
    """7. Produção não contém valores."""
    order = OrderPrintData(
        numero_pedido="107",
        itens=[
            PrintItem(codigo="001", nome="CHEESEBURGER", quantidade=2, preco_unit=35.90, destino_impressao="COZINHA")
        ]
    )
    docs = PrintDocumentService.generate_production(order)
    doc_text = docs["COZINHA"]

    assert "35,90" not in doc_text
    assert "71,80" not in doc_text
    assert "R$" not in doc_text
    assert "TOTAL" not in doc_text

def test_08_producao_nao_conte_ingredientes():
    """8. Produção não contém ingredientes da receita automáticos."""
    order = OrderPrintData(
        numero_pedido="108",
        itens=[
            PrintItem(codigo="001", nome="CHEESEBURGER", quantidade=1, observacao="", destino_impressao="COZINHA")
        ]
    )
    docs = PrintDocumentService.generate_production(order)
    doc_text = docs["COZINHA"]

    assert "INGREDIENTES:" not in doc_text
    assert "RECEITA:" not in doc_text

def test_09_fechamento_contem_todos_os_itens_inclusive_nenhum():
    """9. Fechamento contém todos os itens cobrados, inclusive NENHUM."""
    command = CommandPrintData(
        mesa="05",
        data_hora="21/07 15:43",
        itens=[
            PrintItem(codigo="001", nome="HAMBURGUER", quantidade=2, preco_unit=19.0, destino_impressao="COZINHA"),
            PrintItem(codigo="010", nome="COCA-COLA", quantidade=1, preco_unit=7.0, destino_impressao="NENHUM")
        ]
    )
    doc_text = PrintDocumentService.generate_closing(command)

    assert "2x 001" in doc_text
    assert "38,00" in doc_text
    assert "1x 010" in doc_text
    assert "7,00" in doc_text
    assert "TOTAL" in doc_text
    assert "45,00" in doc_text

def test_10_fechamento_nao_contem_observacoes():
    """10. Fechamento não contém observações."""
    command = CommandPrintData(
        mesa="05",
        itens=[
            PrintItem(codigo="001", nome="HAMBURGUER", quantidade=1, preco_unit=25.0, observacao="Sem cebola, bem passado", destino_impressao="COZINHA")
        ]
    )
    doc_text = PrintDocumentService.generate_closing(command)

    assert "Sem cebola" not in doc_text
    assert "bem passado" not in doc_text
    assert "1x 001" in doc_text
    assert "25,00" in doc_text

def test_11_entrega_contem_endereco_telefone_e_pagamento():
    """11. Entrega contém endereço, telefone e pagamento."""
    delivery = DeliveryOrderPrintData(
        numero_pedido="0484",
        cliente_nome="JOÃO DA SILVA",
        cliente_telefone="(88) 99999-9999",
        logradouro="RUA JOSÉ DE ALENCAR, 124",
        bairro="CENTRO",
        complemento="APTO 302",
        taxa_entrega=5.0,
        forma_pagamento="DINHEIRO",
        troco_para=50.0,
        itens=[
            PrintItem(codigo="001", nome="HAMBURGUER", quantidade=1, preco_unit=25.0, destino_impressao="COZINHA")
        ]
    )
    doc_text = PrintDocumentService.generate_delivery(delivery)

    assert "PED #0484" in doc_text
    assert "JOÃO DA SILVA" in doc_text
    assert "(88) 99999-9999" in doc_text
    assert "RUA JOSÉ DE ALENCAR, 124" in doc_text
    assert "CENTRO" in doc_text
    assert "APTO 302" in doc_text
    assert "SUBTOTAL" in doc_text
    assert "TAXA ENTREGA" in doc_text
    assert "5,00" in doc_text
    assert "TOTAL" in doc_text
    assert "30,00" in doc_text
    assert "PAG: DINHEIRO" in doc_text
    assert "TROCO: 20,00" in doc_text

def test_12_campos_opcionais_vazios_nao_geram_linhas_vazias_ou_rotulos():
    """12. Campos opcionais vazios não geram linhas vazias ou rótulos desnecessários."""
    delivery = DeliveryOrderPrintData(
        numero_pedido="0485",
        cliente_nome="MARIA",
        cliente_telefone="9999-8888",
        logradouro="RUA A",
        bairro="CENTRO",
        complemento=None,
        ponto_referencia=None,
        observacao_entrega=None,
        taxa_entrega=0.0,
        forma_pagamento="PIX",
        itens=[
            PrintItem(codigo="001", nome="HAMBURGUER", quantidade=1, preco_unit=20.0)
        ]
    )
    doc_text = PrintDocumentService.generate_delivery(delivery)

    assert "REF:" not in doc_text
    assert "OBS:" not in doc_text
    assert "TROCO:" not in doc_text
    assert "TAXA ENTREGA" not in doc_text

def test_13_destino_nenhum_nunca_gera_documento_de_producao():
    """13. Destino NENHUM nunca gera documento de produção."""
    assert is_production_destination("NENHUM") is False
    assert is_production_destination("nenhum") is False
    assert is_production_destination("") is False
    assert is_production_destination(None) is False
    assert is_production_destination("COZINHA") is True
    assert is_production_destination("BAR") is True

    items = [
        PrintItem(codigo="01", nome="SUCO", quantidade=1, destino_impressao="NENHUM"),
        PrintItem(codigo="02", nome="CERVEJA", quantidade=1, destino_impressao="nenhum")
    ]
    grouped = group_items_by_print_destination(items)
    assert len(grouped) == 0

def test_14_funciona_para_58mm_e_80mm_sem_cortar_valores():
    """14. Código funciona para papel de 58 mm e 80 mm sem cortar valores."""
    command = CommandPrintData(
        mesa="05",
        data_hora="21/07 15:43",
        itens=[
            PrintItem(codigo="001", nome="HAMBURGUER ESPECIAL DA CASA COM QUEIJO", quantidade=2, preco_unit=38.50),
            PrintItem(codigo="043", nome="BATATA TAILANDESA RECHEADA", quantidade=1, preco_unit=28.90),
        ]
    )

    doc_80mm = PrintDocumentService.generate_closing(command, PaperWidth.WIDTH_80MM)
    doc_58mm = PrintDocumentService.generate_closing(command, PaperWidth.WIDTH_58MM)

    # Nenhuma linha em 58mm deve exceder 32 colunas
    for line in doc_58mm.splitlines():
        assert len(line) <= 32, f"Linha excedeu 32 caracteres no papel 58mm: '{line}'"

    # Nenhuma linha em 80mm deve exceder 48 colunas
    for line in doc_80mm.splitlines():
        assert len(line) <= 48, f"Linha excedeu 48 caracteres no papel 80mm: '{line}'"

    # Valores numéricos no fechamento permanecem 100% visíveis nos dois papéis
    assert "77,00" in doc_58mm
    assert "28,90" in doc_58mm
    assert "105,90" in doc_58mm

    assert "77,00" in doc_80mm
    assert "28,90" in doc_80mm
    assert "105,90" in doc_80mm
