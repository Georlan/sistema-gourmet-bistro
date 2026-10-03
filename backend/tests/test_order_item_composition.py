import re

from app.domain.orders.composition import SelectedModifier, composition_presentation
from app.domain.printing import PrintItem
from app.application.printing.comanda_renderer import ComandaVariant, render_canonical_comanda
from app.printer_service import printer_service


MODIFIERS = [
    SelectedModifier("chicken", "Frango", grupo_id="protein", grupo_nome="Proteínas"),
    SelectedModifier("rice", "Arroz à grega", grupo_id="side", grupo_nome="Guarnições"),
    SelectedModifier("egg", "Ovo", 2, "extras", "Adicionais pagos"),
    SelectedModifier("egg", "Ovo", 2, "extras", "Adicionais pagos"),
]


def test_grouped_composition_preserves_customer_note_and_portion_quantity():
    assert composition_presentation(
        "Sem salada - Opções: Frango, Arroz à grega, 2x Ovo", MODIFIERS, grouped=True,
    ) == (("PROTEÍNAS: Frango", "GUARNIÇÕES: Arroz à grega", "ADICIONAIS PAGOS: 2x Ovo"), "Sem salada")
    assert composition_presentation("Opções: Frango, Arroz à grega, Ovo, Ovo", MODIFIERS, grouped=True)[1] == ""


def test_legacy_text_and_generic_profile_are_not_reinterpreted():
    assert composition_presentation("Opções: Frango antigo", MODIFIERS, grouped=True) == ((), "Opções: Frango antigo")
    assert composition_presentation("Opções: Costela", [], grouped=True) == ((), "Opções: Costela")
    text = "Sem salada - Opções: Frango, Arroz à grega, 2x Ovo"
    assert composition_presentation(text, MODIFIERS, grouped=False) == ((), text)


def test_canonical_ticket_wraps_compact_groups_without_merging_different_meals():
    old_width = printer_service.width
    try:
        for width in (32, 40, 48):
            printer_service.width = width
            lines, notes = composition_presentation("Sem salada", MODIFIERS, grouped=True)
            items = [
                PrintItem("g", "Quentinha G", preco_unit=14, composicao=lines, observacao=notes, modifier_signature=(("chicken", 0), ("egg", 2), ("egg", 2))),
                PrintItem("g", "Quentinha G", preco_unit=14, composicao=("PROTEÍNAS: Costela",), observacao=notes, modifier_signature=(("beef", 0),)),
            ]
            ticket = render_canonical_comanda(
                restaurant_name="Quentinha Teste", restaurant_name_position="cabecalho", print_footer=None,
                order_number=24, order_type="Delivery", operator_name="Operador", items=items,
                variant=ComandaVariant(location_label=None),
            )
            assert ticket.count("1x QUENTINHA G") == 2
            assert "PROTEÍNAS: FRANGO" in ticket
            assert "PROTEÍNAS: COSTELA" in ticket
            assert "ADICIONAIS PAGOS: 2X OVO" in ticket
            assert ticket.count("OBS: SEM SALADA") == 2
            # ESC/POS controls do not occupy printable paper columns.
            clean = re.sub(r"\x1b(?:[!ME3][\x00-\xff])", "", ticket)
            assert all(len(line) <= width for line in clean.splitlines())
            assert "R$ 28,00" in ticket
    finally:
        printer_service.width = old_width


def test_verified_generated_suffix_is_independent_of_modifier_row_order():
    lines, notes = composition_presentation(
        "Sem salada - Opções: Frango, Arroz à grega, 2x Ovo", list(reversed(MODIFIERS)), grouped=True,
    )
    assert notes == "Sem salada"
    assert set(lines) == {"PROTEÍNAS: Frango", "GUARNIÇÕES: Arroz à grega", "ADICIONAIS PAGOS: 2x Ovo"}


def test_generic_print_never_merges_same_name_and_note_with_different_choices():
    ticket = render_canonical_comanda(
        restaurant_name="Restaurante Teste", restaurant_name_position="cabecalho", print_footer=None,
        order_number=25, order_type="Retirada", operator_name="Operador",
        items=[
            PrintItem("meal", "Prato", preco_unit=10, modifier_signature=(("chicken", 0),)),
            PrintItem("meal", "Prato", preco_unit=10, modifier_signature=(("beef", 0),)),
        ], variant=ComandaVariant(location_label=None),
    )
    assert ticket.count("1x PRATO") == 2
    assert "2x PRATO" not in ticket
    assert "R$ 20,00" in ticket
