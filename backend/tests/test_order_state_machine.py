import pytest

from app.services.order_state_machine import (
    InvalidOrderTransition,
    allowed_order_targets,
    normalize_order_status,
    validate_order_transition,
)


def test_status_legado_analise_equivale_a_pendente():
    transition = validate_order_transition("analise", "producao", "Delivery")

    assert transition.current == "pendente"
    assert transition.target == "producao"
    assert transition.first_accept is True
    assert transition.changed is True


def test_delivery_segue_fluxo_pronto_transito_finalizado():
    assert allowed_order_targets("producao", "Delivery") == {"pronto", "recusado"}
    assert allowed_order_targets("pronto", "Delivery") == {"transito", "recusado"}
    assert allowed_order_targets("transito", "Delivery") == {"finalizado", "recusado"}


def test_retirada_finaliza_diretamente_de_pronto():
    assert allowed_order_targets("pronto", "Retirada") == {"finalizado", "recusado"}
    transition = validate_order_transition("pronto", "finalizado", "Retirada")
    assert transition.terminal is True


def test_repeticao_do_mesmo_status_e_idempotente():
    transition = validate_order_transition("producao", "producao", "Delivery")

    assert transition.changed is False
    assert transition.first_accept is False


def test_cancelamento_em_producao_continua_permitido():
    transition = validate_order_transition("producao", "recusado", "Delivery")

    assert transition.changed is True
    assert transition.terminal is True


def test_cancelamento_em_pronto_e_transito_permitido():
    transition_pronto = validate_order_transition("pronto", "recusado", "Retirada")
    assert transition_pronto.changed is True
    assert transition_pronto.terminal is True

    transition_transito = validate_order_transition("transito", "recusado", "Delivery")
    assert transition_transito.changed is True
    assert transition_transito.terminal is True


@pytest.mark.parametrize(
    ("current", "target", "order_type"),
    [
        ("pendente", "pronto", "Delivery"),
        ("producao", "transito", "Delivery"),
        ("pronto", "finalizado", "Delivery"),
        ("pronto", "transito", "Retirada"),
        ("finalizado", "producao", "Delivery"),
        ("recusado", "producao", "Delivery"),
    ],
)
def test_saltos_e_reaberturas_impossiveis_sao_rejeitados(current, target, order_type):
    with pytest.raises(InvalidOrderTransition):
        validate_order_transition(current, target, order_type)


def test_aliases_de_leitura_sao_normalizados_sem_criar_novos_estados():
    assert normalize_order_status("recebido") == "pendente"
    assert normalize_order_status("em_preparo") == "producao"
    assert normalize_order_status("saiu_entrega") == "transito"
    assert normalize_order_status("entregue") == "finalizado"
