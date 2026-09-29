from app.models import Pagamento


def test_legacy_payment_customer_snapshots_are_encrypted_in_memory():
    pagamento = Pagamento(
        id="pay-pii-test",
        restaurante_id=1,
        comanda_id="cmd-pii-test",
        turno_id=1,
        valor=10,
        metodo="pix",
        cpf_cliente="85999991234",
        nome_cliente="Cliente Pagamento",
    )

    assert pagamento.cpf_cliente == "85999991234"
    assert pagamento.nome_cliente == "Cliente Pagamento"
    assert pagamento._cpf_cliente != "85999991234"
    assert pagamento._nome_cliente != "Cliente Pagamento"
    assert pagamento._cpf_cliente.startswith("gAAAAA")
    assert pagamento._nome_cliente.startswith("gAAAAA")
