"""Presentation of persisted choices; never changes order prices or selections."""
from collections import OrderedDict
from dataclasses import dataclass
from typing import Sequence


@dataclass(frozen=True)
class SelectedModifier:
    id: str
    nome: str
    preco: float = 0.0
    grupo_id: str | None = None
    grupo_nome: str | None = None


def composition_presentation(
    observation: str, modifiers: Sequence[SelectedModifier], *, grouped: bool,
) -> tuple[tuple[str, ...], str]:
    """Remove only a verifiable generated suffix, preserving all other notes.

    A renamed historical option cannot prove the old text was generated. In
    that case retain the original observation instead of rewriting history.
    """
    notes = str(observation or "").strip()
    if not modifiers:
        return (), notes
    summary: dict[str, tuple[str, int]] = OrderedDict()
    for modifier in modifiers:
        name, count = summary.get(modifier.id, (modifier.nome, 0))
        summary[modifier.id] = (name, count + 1)
    names = [f"{count}x {name}" if count > 1 else name for name, count in summary.values()]
    candidates = [", ".join(names), ", ".join(mod.nome for mod in modifiers)]
    generated = False
    normalized = notes.casefold()
    marker = " - opções: "
    if normalized.startswith("opções: "):
        prefix, selection = "", notes[len("Opções: "):]
    elif marker in normalized:
        index = normalized.rfind(marker)
        prefix, selection = notes[:index].strip(), notes[index + len(marker):]
    else:
        prefix, selection = notes, None
    if selection is not None:
        # History may return the same persisted choices in a different order.
        # Compare the entire known suffix, including repeated-unit counts.
        tokens = sorted(part.strip().casefold() for part in selection.split(", "))
        generated = any(tokens == sorted(part.strip().casefold() for part in candidate.split(", ")) for candidate in candidates)
        if generated:
            notes = prefix
    if "opções:" in notes.casefold() and not generated:
        return (), notes
    if not grouped:
        # Preserve the general layout when its generated option text is present.
        if generated:
            return (), str(observation or "").strip()
        return (f"COMPLEMENTOS: {', '.join(names)}",), notes
    groups: dict[str, tuple[str, dict[str, tuple[str, int]]]] = OrderedDict()
    for modifier in modifiers:
        key = modifier.grupo_id or ""
        label, options = groups.setdefault(key, (modifier.grupo_nome or "Complementos", OrderedDict()))
        name, count = options.get(modifier.id, (modifier.nome, 0))
        options[modifier.id] = (name, count + 1)
    lines = tuple(
        f"{label.upper()}: " + ", ".join(f"{count}x {name}" if count > 1 else name for name, count in options.values())
        for label, options in groups.values()
    )
    return lines, notes
