import pytest
from app.domain.print import (
    DocumentType,
    PaperWidth,
    PrintItemData,
    ProductionDocumentData,
    ClosingDocumentData,
    DeliveryDocumentData,
    PrintService
)

def test_tipo1_producao_rules_and_grouping():
    """
    Testa o documento TIPO 1 - PRODUÇÃO:
    - Agrupa por cliente (MARCOS, KAROL)
    - Não imprime preços, subtotal, total ou endereço
    - Agrupa itens iguais com mesma observação no mesmo cliente
    - Imprime observações abaixo do item
    """
    data = ProductionDocumentData(
        restaurante_nome="KÔMA",
        numero_pedido="0482",
        tipo_pedido="LOCAL",
        mesa="05",
        horario="15:42",
        garcom_nome="GEORLAN",
        numero_lancamento="0123",
        itens=[
            PrintItemData(codigo="001", nome="HAMB TRADICIONAL", quantidade=1, preco_unit=19.0, cliente_nome="MARCOS", observacao="VIAGEM, PRA MESA"),
            PrintItemData(codigo="001", nome="HAMB TRADICIONAL", quantidade=1, preco_unit=19.0, cliente_nome="MARCOS", observacao="VIAGEM, PRA MESA"),
            PrintItemData(codigo="043", nome="BATATA TAILANDESA", quantidade=1, preco_unit=28.9, cliente_nome="MARCOS", observacao=""),
            PrintItemData(codigo="004", nome="CHEESE EGG", quantidade=1, preco_unit=25.0, cliente_nome="KAROL", observacao="SEM SALADA"),
        ]
    )

    output = PrintService.generate(DocumentType.PRODUCAO, data, PaperWidth.WIDTH_80MM)

    # 1. Deve conter cabeçalhos corretos
    assert "KÔMA" in output
    assert "PED #0482" in output
    assert "MESA 05" in output
    assert "LOCAL" in output
    assert "15:42" in output
    assert "GARÇOM: GEORLAN" in output

    # 2. NÃO deve conter preços nem totais
    assert "R$" not in output
    assert "19,00" not in output
    assert "SUBTOTAL" not in output
    assert "TOTAL" not in output

    # 3. Deve agrupar itens do mesmo cliente e somar quantidade (2x 001 HAMB TRADICIONAL)
    assert "MARCOS" in output
    assert "2x 001 HAMB TRADICIONAL" in output
    assert "VIAGEM, PRA MESA" in output
    assert "1x 043 BATATA TAILANDESA" in output

    assert "KAROL" in output
    assert "1x 004 CHEESE EGG" in output
    assert "SEM SALADA" in output

    # 4. Deve verificar que o nome MARCOS aparece uma única vez como cabeçalho de bloco
    assert output.count("MARCOS") == 1
    assert output.count("KAROL") == 1


def test_tipo1_producao_separated_observations():
    """
    Testa se o TIPO 1 mantém separados itens do mesmo cliente/produto com observações diferentes.
    """
    data = ProductionDocumentData(
        numero_pedido="100",
        garcom_nome="PEDRO",
        itens=[
            PrintItemData(codigo="001", nome="BURGER", quantidade=1, cliente_nome="MARCOS", observacao="Sem cebola"),
            PrintItemData(codigo="001", nome="BURGER", quantidade=1, cliente_nome="MARCOS", observacao="Com cebola extra"),
        ]
    )
    output = PrintService.generate(DocumentType.PRODUCAO, data)

    # Devem permanecer duas entradas separadas de 1x BURGER
    assert output.count("1x 001 BURGER") == 2
    assert "Sem cebola" in output
    assert "Com cebola extra" in output


def test_tipo2_fechamento_split_account():
    """
    Testa o documento TIPO 2 - FECHAMENTO com divisão de conta por clientes:
    - Exibe valores e subtotais por cliente
    - NÃO exibe observações ou receitas
    - Exibe total geral
    """
    data = ClosingDocumentData(
        restaurante_nome="KÔMA",
        mesa="05",
        data_hora="21/07 15:43",
        itens=[
            PrintItemData(codigo="001", nome="HAMB TRADICIONAL", quantidade=2, preco_unit=19.0, cliente_nome="MARCOS", observacao="Sem salada"),
            PrintItemData(codigo="043", nome="BATATA TAILANDESA", quantidade=1, preco_unit=28.9, cliente_nome="MARCOS", observacao="Capricha na pimenta"),
            PrintItemData(codigo="004", nome="CHEESE EGG", quantidade=1, preco_unit=25.0, cliente_nome="KAROL", observacao="Sem tomate"),
        ]
    )

    output = PrintService.generate(DocumentType.FECHAMENTO, data)

    # 1. Cabeçalho
    assert "KÔMA" in output
    assert "MESA 05" in output
    assert "21/07 15:43" in output

    # 2. NÃO deve imprimir observações
    assert "Sem salada" not in output
    assert "Capricha na pimenta" not in output
    assert "Sem tomate" not in output

    # 3. Subtotais dos clientes
    assert "MARCOS" in output
    assert "2x 001" in output
    assert "38,00" in output
    assert "1x 043" in output
    assert "28,90" in output
    assert "66,90" in output  # Subtotal Marcos

    assert "KAROL" in output
    assert "1x 004" in output
    assert "25,00" in output

    # 4. Total geral (66.90 + 25.00 = 91.90)
    assert "TOTAL" in output
    assert "91,90" in output


def test_tipo2_fechamento_single_account():
    """
    Testa o documento TIPO 2 - FECHAMENTO com conta única (sem divisão):
    - Imprime lista direta resumida por código + quantidade + valor
    """
    data = ClosingDocumentData(
        mesa="12",
        data_hora="21/07 18:00",
        itens=[
            PrintItemData(codigo="101", nome="SUCO DE LARANJA", quantidade=2, preco_unit=10.0, cliente_nome="Consumo Geral"),
            PrintItemData(codigo="202", nome="PIZZA MISTA", quantidade=1, preco_unit=60.0, cliente_nome="Consumo Geral"),
        ]
    )

    output = PrintService.generate(DocumentType.FECHAMENTO, data)

    assert "MESA 12" in output
    assert "2x 101" in output
    assert "20,00" in output
    assert "1x 202" in output
    assert "60,00" in output
    assert "TOTAL" in output
    assert "80,00" in output


def test_tipo3_entrega_rules_and_address():
    """
    Testa o documento TIPO 3 - ENTREGA:
    - Imprime endereço completo (Logradouro, Bairro, Complemento, Referência)
    - Imprime itens, valores, taxa de entrega e total
    - Imprime forma de pagamento e troco
    """
    data = DeliveryDocumentData(
        restaurante_nome="KÔMA",
        numero_pedido="0484",
        data_hora="21/07 15:51",
        cliente_nome="JOÃO DA SILVA",
        cliente_telefone="(88) 99999-9999",
        logradouro="R. JOSÉ DE ALENCAR, 124",
        bairro="CENTRO",
        complemento="CASA AZUL",
        ponto_referencia="PRÓX. FARMÁCIA",
        taxa_entrega=5.0,
        forma_pagamento="DINHEIRO",
        troco_para=100.0,
        itens=[
            PrintItemData(codigo="005", nome="HAMB TRADICIONAL", quantidade=2, preco_unit=29.0),
            PrintItemData(codigo="", nome="COCA 1L", quantidade=1, preco_unit=12.0),
        ]
    )

    output = PrintService.generate(DocumentType.ENTREGA, data)

    # 1. Cabeçalho
    assert "PED #0484" in output
    assert "DELIVERY" in output
    assert "21/07 15:51" in output

    # 2. Dados do Cliente
    assert "JOÃO DA SILVA" in output
    assert "(88) 99999-9999" in output
    assert "R. JOSÉ DE ALENCAR, 124" in output
    assert "CENTRO" in output
    assert "CASA AZUL" in output
    assert "REF: PRÓX. FARMÁCIA" in output

    # 3. Itens e Valores
    assert "2x 005 HAMB TRADICIONAL" in output
    assert "58,00" in output
    assert "1x COCA 1L" in output
    assert "12,00" in output

    # 4. Totais (Subtotal 70.00 + Taxa 5.00 = Total 75.00)
    assert "SUBTOTAL" in output
    assert "70,00" in output
    assert "TAXA ENTREGA" in output
    assert "5,00" in output
    assert "TOTAL" in output
    assert "75,00" in output

    # 5. Pagamento e Troco (100.00 - 75.00 = 25.00)
    assert "PAG: DINHEIRO" in output
    assert "TROCO: 25,00" in output


def test_compact_58mm_paper_width():
    """
    Comprova que a geração em papel de 58mm (32 colunas) formata o texto corretamente sem quebras estranhas.
    """
    data = ProductionDocumentData(
        numero_pedido="99",
        tipo_pedido="LOCAL",
        mesa="01",
        horario="12:00",
        garcom_nome="ANA",
        itens=[
            PrintItemData(codigo="01", nome="CAFE ESPRESSO", quantidade=1, cliente_nome="PEDRO", observacao="Duplo sem acucar")
        ]
    )

    output = PrintService.generate(DocumentType.PRODUCAO, data, PaperWidth.WIDTH_58MM)

    lines = output.splitlines()
    for line in lines:
        assert len(line) <= 32, f"Linha excedeu 32 colunas no papel de 58mm: '{line}'"


def test_invalid_document_type_raises_error():
    """
    Comprova que tentar gerar um tipo de documento inexistente lança exceção descritiva.
    """
    with pytest.raises(ValueError, match="Tipo de documento de impressão inválido"):
        PrintService.generate("TIPO_INVALIDO", {})
