from __future__ import annotations

from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]


def read(path: str) -> str:
    return (ROOT / path).read_text(encoding="utf-8")


def write(path: str, content: str) -> None:
    (ROOT / path).write_text(content, encoding="utf-8")


def replace_once(path: str, old: str, new: str) -> None:
    content = read(path)
    count = content.count(old)
    if count != 1:
        raise RuntimeError(f"{path}: expected exactly one literal match, found {count}: {old[:120]!r}")
    write(path, content.replace(old, new, 1))


def regex_once(path: str, pattern: str, replacement: str, *, flags: int = 0) -> None:
    content = read(path)
    updated, count = re.subn(pattern, replacement, content, count=1, flags=flags)
    if count != 1:
        raise RuntimeError(f"{path}: expected exactly one regex match, found {count}: {pattern[:160]!r}")
    write(path, updated)


# ---------------------------------------------------------------------------
# 1. Canonical launch origin: provenance is stored on Lancamento, where mixed
#    table activity can correctly preserve SmartPOS + waiter/cashier launches.
# ---------------------------------------------------------------------------
replace_once(
    "backend/app/models.py",
    'class Lancamento(Base):\n    __tablename__ = "lancamentos"\n    \n    id = Column(String, primary_key=True, index=True)',
    '''class Lancamento(Base):
    __tablename__ = "lancamentos"
    __table_args__ = (
        CheckConstraint(
            "origem IN ('desconhecida', 'garcom', 'caixa', 'smartpos', 'cardapio')",
            name="ck_lancamentos_origem",
        ),
    )

    id = Column(String, primary_key=True, index=True)''',
)
replace_once(
    "backend/app/models.py",
    '    garcom_id = Column(String, ForeignKey("usuarios.id"), nullable=False)\n    timestamp = Column(DateTime, default=lambda: datetime.datetime.now(datetime.timezone.utc))',
    '''    garcom_id = Column(String, ForeignKey("usuarios.id"), nullable=False)
    origem = Column(
        String(24),
        nullable=False,
        default="desconhecida",
        server_default="desconhecida",
    )
    timestamp = Column(DateTime, default=lambda: datetime.datetime.now(datetime.timezone.utc))''',
)

replace_once(
    "backend/app/schemas.py",
    '''class LancamentoCreate(BaseModel):
    garcom_id: str
    itens: List[ItemCreate]''',
    '''class LancamentoCreate(BaseModel):
    garcom_id: str
    # Proveniencia operacional para UX. Não concede permissão nem altera RBAC.
    origem: Optional[Literal["smartpos"]] = None
    itens: List[ItemCreate]''',
)
replace_once(
    "backend/app/schemas.py",
    '''class LancamentoResponse(BaseModel):
    id: str
    comanda_id: str
    garcom_id: str
    timestamp: datetime''',
    '''class LancamentoResponse(BaseModel):
    id: str
    comanda_id: str
    garcom_id: str
    origem: str = "desconhecida"
    timestamp: datetime''',
)

# Normal waiter/cashier/SmartPOS launch. The SmartPOS marker is provenance only;
# all authorization remains driven by the authenticated user and existing RBAC.
replace_once(
    "backend/app/routes/orders.py",
    '''    novo_lancamento = Lancamento(
        id=f"l-{uuid.uuid4().hex[:8]}",
        comanda_id=comanda_id,
        garcom_id=lancamento_in.garcom_id,
        timestamp=datetime.datetime.now(datetime.timezone.utc)
    )''',
    '''    operator_role = str(
        getattr(current_user, "role", None)
        or getattr(current_user, "cargo", None)
        or "garcom"
    ).lower().strip()
    launch_origin = (
        "smartpos"
        if lancamento_in.origem == "smartpos"
        else ("caixa" if operator_role in {"admin", "gerente", "caixa", "superadmin"} else "garcom")
    )
    novo_lancamento = Lancamento(
        id=f"l-{uuid.uuid4().hex[:8]}",
        comanda_id=comanda_id,
        garcom_id=lancamento_in.garcom_id,
        origem=launch_origin,
        timestamp=datetime.datetime.now(datetime.timezone.utc)
    )''',
)

# Atomic PDV/direct sale gets provenance from the authenticated role.
replace_once(
    "backend/app/routes/orders.py",
    '''        novo_lancamento = Lancamento(
            id=lancamento_id,
            comanda_id=comanda_id,
            garcom_id=garcom_id,
            timestamp=datetime.datetime.now(datetime.timezone.utc)
        )''',
    '''        operator_role = str(
            getattr(current_user, "role", None)
            or getattr(current_user, "cargo", None)
            or "garcom"
        ).lower().strip()
        novo_lancamento = Lancamento(
            id=lancamento_id,
            comanda_id=comanda_id,
            garcom_id=garcom_id,
            origem=("caixa" if operator_role in {"admin", "gerente", "caixa", "superadmin"} else "garcom"),
            timestamp=datetime.datetime.now(datetime.timezone.utc)
        )''',
)

# Public menu provenance is server-defined and cannot be supplied by the client.
replace_once(
    "backend/app/routes/cardapio.py",
    '''        novo_lancamento = Lancamento(
            id=lancamento_id,
            comanda_id=comanda_id,
            garcom_id=garcom_id,
            timestamp=datetime.datetime.now(datetime.timezone.utc)
        )''',
    '''        novo_lancamento = Lancamento(
            id=lancamento_id,
            comanda_id=comanda_id,
            garcom_id=garcom_id,
            origem="cardapio",
            timestamp=datetime.datetime.now(datetime.timezone.utc)
        )''',
)

# SmartPOS ordering explicitly marks the launch. Payment/financial rules remain
# untouched; this field exists only so the canonical Caixa can explain origin.
replace_once(
    "src/smartpos/SmartPosOrderingFlow.tsx",
    '''        body: JSON.stringify({
          garcom_id: session.user.id,
          itens: items,
        }),''',
    '''        body: JSON.stringify({
          garcom_id: session.user.id,
          origem: 'smartpos',
          itens: items,
        }),''',
)

# ---------------------------------------------------------------------------
# 2. Alembic migration: small, backwards-safe provenance column.
# ---------------------------------------------------------------------------
migration_path = ROOT / "backend/alembic/versions/b7f4d2e9c601_add_lancamento_origin.py"
if migration_path.exists():
    raise RuntimeError(f"migration already exists: {migration_path}")
migration_path.write_text('''"""add operational origin to order launches

Revision ID: b7f4d2e9c601
Revises: a3e5c7f9b124
Create Date: 2026-08-19
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "b7f4d2e9c601"
down_revision: Union[str, Sequence[str], None] = "a3e5c7f9b124"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


_ALLOWED_ORIGINS = "'desconhecida', 'garcom', 'caixa', 'smartpos', 'cardapio'"


def upgrade() -> None:
    with op.batch_alter_table("lancamentos") as batch_op:
        batch_op.add_column(
            sa.Column(
                "origem",
                sa.String(length=24),
                nullable=False,
                server_default="desconhecida",
            )
        )
        batch_op.create_check_constraint(
            "ck_lancamentos_origem",
            f"origem IN ({_ALLOWED_ORIGINS})",
        )


def downgrade() -> None:
    with op.batch_alter_table("lancamentos") as batch_op:
        batch_op.drop_constraint("ck_lancamentos_origem", type_="check")
        batch_op.drop_column("origem")
''', encoding="utf-8")

# ---------------------------------------------------------------------------
# 3. Cash projection now carries both launch provenance and payment state.
#    'criada' is an active payment too, so duplicate payment entry must be
#    blocked from the moment the intent exists, before the terminal claims it.
# ---------------------------------------------------------------------------
replace_once(
    "backend/app/routes/smartpos_cash_projection.py",
    "from ..models import Comanda, Item, Usuario",
    "from ..models import Comanda, Item, Lancamento, Usuario",
)
replace_once(
    "backend/app/routes/smartpos_cash_projection.py",
    '''    conta_pedida: bool
    pagamento: Optional[SmartPosCashPaymentProjection] = None''',
    '''    conta_pedida: bool
    origem_smartpos: bool = False
    pagamento: Optional[SmartPosCashPaymentProjection] = None''',
)
replace_once(
    "backend/app/routes/smartpos_cash_projection.py",
    '''    latest_intent_by_table: dict[int, SmartPosPaymentIntent] = {}
    for intent in intents:
        latest_intent_by_table.setdefault(int(intent.mesa_id), intent)

    grouped: dict[int, list[Comanda]] = {}''',
    '''    latest_intent_by_table: dict[int, SmartPosPaymentIntent] = {}
    for intent in intents:
        latest_intent_by_table.setdefault(int(intent.mesa_id), intent)

    smartpos_origin_tables = {
        int(mesa_id)
        for (mesa_id,) in (
            db.query(Comanda.mesa_id)
            .join(Lancamento, Lancamento.comanda_id == Comanda.id)
            .filter(
                Comanda.restaurante_id == restaurante_id,
                Comanda.fechada == False,
                Comanda.mesa_id.isnot(None),
                Lancamento.restaurante_id == restaurante_id,
                Lancamento.origem == "smartpos",
            )
            .distinct()
            .all()
        )
        if mesa_id is not None
    }

    grouped: dict[int, list[Comanda]] = {}''',
)
replace_once(
    "backend/app/routes/smartpos_cash_projection.py",
    '''        elif intent is not None and intent.status in {"pendente", "processando"}:
            operational_state = "pagamento_processando"''',
    '''        elif intent is not None and intent.status in {"criada", "pendente", "processando"}:
            operational_state = "pagamento_processando"''',
)
replace_once(
    "backend/app/routes/smartpos_cash_projection.py",
    '''            itens_prontos=ready,
            conta_pedida=account_requested,
            pagamento=_project_payment(intent),''',
    '''            itens_prontos=ready,
            conta_pedida=account_requested,
            origem_smartpos=mesa_id in smartpos_origin_tables,
            pagamento=_project_payment(intent),''',
)

# Projection tests prove provenance and the 'criada' duplicate-payment guard.
replace_once(
    "backend/tests/test_smartpos_cash_projection.py",
    '''        lancamento = Lancamento(
            id="lan-projection",
            restaurante_id=RESTAURANTE_ID,
            comanda_id=comanda.id,
            garcom_id=USER_ID,
        )''',
    '''        lancamento = Lancamento(
            id="lan-projection",
            restaurante_id=RESTAURANTE_ID,
            comanda_id=comanda.id,
            garcom_id=USER_ID,
            origem="smartpos",
        )''',
)
replace_once(
    "backend/tests/test_smartpos_cash_projection.py",
    '''        assert row.estado_operacional == "em_preparo"
        assert row.itens_preparando == 1
        assert row.saldo == Decimal("19.00")''',
    '''        assert row.estado_operacional == "em_preparo"
        assert row.itens_preparando == 1
        assert row.saldo == Decimal("19.00")
        assert row.origem_smartpos is True''',
)
insert_before = '''def test_processing_smartpos_intent_has_priority_in_cash_projection():'''
projection_tests = read("backend/tests/test_smartpos_cash_projection.py")
if projection_tests.count(insert_before) != 1:
    raise RuntimeError("could not locate projection processing test")
projection_tests = projection_tests.replace(
    insert_before,
    '''def test_created_smartpos_intent_already_blocks_duplicate_payment_flow():
    db = SessionLocal()
    try:
        item = db.query(Item).filter(Item.id == "item-projection").one()
        item.status = "pronto"
        db.commit()
        intent = _intent(db, "criada")
        row = _projection(db)
        assert row.estado_operacional == "pagamento_processando"
        assert row.pagamento is not None
        assert row.pagamento.intent_id == intent.id
        assert row.pagamento.status == "criada"
    finally:
        db.close()


''' + insert_before,
    1,
)
write("backend/tests/test_smartpos_cash_projection.py", projection_tests)

# ---------------------------------------------------------------------------
# 4. Caixa Kanban is now the only SmartPOS operational surface.
# ---------------------------------------------------------------------------
caixa_path = "src/components/CaixaPanel.tsx"
caixa = read(caixa_path)

marker = "interface SystemUser {"
if caixa.count(marker) != 1:
    raise RuntimeError("CaixaPanel: SystemUser marker not unique")
smartpos_types = '''interface SmartPosCashPaymentView {
  intent_id: string;
  status: string;
  metodo?: string;
  provider_last_error?: string | null;
  pagamento_id?: string | null;
}

interface SmartPosCashRow {
  mesa_id: number;
  estado_operacional:
    | 'em_preparo'
    | 'pronto'
    | 'aguardando_pagamento'
    | 'pagamento_processando'
    | 'aprovado_pendente_liquidacao';
  origem_smartpos?: boolean;
  pagamento?: SmartPosCashPaymentView | null;
}

interface SmartPosCardState {
  label: string;
  chipClass: 'is-muted' | 'is-primary' | 'is-attention';
  blocksPayment: boolean;
  ctaLabel?: string;
}

'''
caixa = caixa.replace(marker, smartpos_types + marker, 1)

state_marker = "  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);"
if caixa.count(state_marker) != 1:
    raise RuntimeError("CaixaPanel: mobile sidebar marker not unique")
smartpos_state = '''  const [smartPosCashRows, setSmartPosCashRows] = useState<SmartPosCashRow[]>([]);
  const smartPosAuthorization = authHeaders.Authorization || authHeaders.authorization || '';
  const smartPosCashByTable = useMemo(
    () => new Map(smartPosCashRows.map(row => [Number(row.mesa_id), row])),
    [smartPosCashRows],
  );

  const refreshSmartPosCashProjection = useCallback(async () => {
    if (activeSubTab !== 'pedidos' || !smartPosAuthorization) {
      setSmartPosCashRows([]);
      return;
    }
    try {
      const response = await fetch(`${apiBaseUrl}/auth/smartpos/caixa/operacao`, {
        headers: { Authorization: smartPosAuthorization },
        cache: 'no-store',
      });
      if (response.status === 401 || response.status === 403) {
        setSmartPosCashRows([]);
        return;
      }
      if (!response.ok) return;
      const data = await response.json().catch(() => []);
      setSmartPosCashRows(Array.isArray(data) ? data : []);
    } catch {
      // A fila principal continua utilizável; o próximo refresh reconcilia o indicador.
    }
  }, [activeSubTab, apiBaseUrl, smartPosAuthorization]);

  useEffect(() => {
    if (activeSubTab !== 'pedidos' || !smartPosAuthorization) {
      setSmartPosCashRows([]);
      return;
    }

    void refreshSmartPosCashProjection();
    const timer = window.setInterval(() => void refreshSmartPosCashProjection(), 4000);
    const refreshWhenVisible = () => {
      if (document.visibilityState === 'visible') void refreshSmartPosCashProjection();
    };
    window.addEventListener('focus', refreshWhenVisible);
    document.addEventListener('visibilitychange', refreshWhenVisible);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('focus', refreshWhenVisible);
      document.removeEventListener('visibilitychange', refreshWhenVisible);
    };
  }, [activeSubTab, refreshSmartPosCashProjection, smartPosAuthorization]);

  const getSmartPosCardState = useCallback((order: Order): SmartPosCardState | null => {
    const mesaId = Number(order?.mesaId || 0);
    if (mesaId <= 0) return null;
    const row = smartPosCashByTable.get(mesaId);
    if (!row) return null;

    if (row.pagamento?.provider_last_error) {
      return {
        label: 'SMARTPOS · ATENÇÃO',
        chipClass: 'is-attention',
        blocksPayment: true,
        ctaLabel: 'Pagamento requer atenção',
      };
    }
    if (row.estado_operacional === 'aprovado_pendente_liquidacao') {
      return {
        label: 'SMARTPOS · FINALIZANDO',
        chipClass: 'is-primary',
        blocksPayment: true,
        ctaLabel: 'Finalizando pagamento…',
      };
    }
    if (row.estado_operacional === 'pagamento_processando') {
      return {
        label: 'SMARTPOS · PROCESSANDO',
        chipClass: 'is-primary',
        blocksPayment: true,
        ctaLabel: 'Pagamento em andamento',
      };
    }
    if (row.origem_smartpos) {
      return {
        label: 'SMARTPOS',
        chipClass: 'is-muted',
        blocksPayment: false,
      };
    }
    return null;
  }, [smartPosCashByTable]);

'''
caixa = caixa.replace(state_marker, smartpos_state + state_marker, 1)

# Column 1: show provenance/state alongside existing contextual chips.
old_col1_vars = '''                          const isExpanded = !!expandedCardIds[cardId];
                          const totalVal = order.itens.reduce((sum: number, it: any) => sum + (it.preco_unit || it.preco || 0), 0);

                          return ('''
new_col1_vars = '''                          const isExpanded = !!expandedCardIds[cardId];
                          const totalVal = order.itens.reduce((sum: number, it: any) => sum + (it.preco_unit || it.preco || 0), 0);
                          const smartPosState = getSmartPosCardState(order);

                          return ('''
if caixa.count(old_col1_vars) != 1:
    raise RuntimeError(f"CaixaPanel: column 1 variable marker count={caixa.count(old_col1_vars)}")
caixa = caixa.replace(old_col1_vars, new_col1_vars, 1)

old_col1_chip = '''                                  <span className={clsx('orders-card__chip', 'is-primary')}>
                                    {order.mesaId && order.mesaId > 0 ? `MESA ${order.mesaId}` : 'BALCÃO'}
                                  </span>'''
new_col1_chip = old_col1_chip + '''
                                  {smartPosState && (
                                    <span className={clsx('orders-card__chip', smartPosState.chipClass)}>
                                      {smartPosState.label}
                                    </span>
                                  )}'''
if caixa.count(old_col1_chip) != 1:
    raise RuntimeError(f"CaixaPanel: column 1 chip marker count={caixa.count(old_col1_chip)}")
caixa = caixa.replace(old_col1_chip, new_col1_chip, 1)

# Column 3: same metadata, plus duplicate-payment guard on the canonical CTA.
old_col3_vars = '''                          const tableMovement = getTableMovementContext(order);
                          const pendingTableItems = Number((order as any).itensEmPreparoCount || 0);

                          return ('''
new_col3_vars = '''                          const tableMovement = getTableMovementContext(order);
                          const pendingTableItems = Number((order as any).itensEmPreparoCount || 0);
                          const smartPosState = getSmartPosCardState(order);

                          return ('''
if caixa.count(old_col3_vars) != 1:
    raise RuntimeError(f"CaixaPanel: column 3 variable marker count={caixa.count(old_col3_vars)}")
caixa = caixa.replace(old_col3_vars, new_col3_vars, 1)

old_col3_chip = '''                                  <span className={clsx('orders-card__chip', contaPedida ? 'is-attention' : 'is-primary')}>{badgeText}</span>'''
new_col3_chip = old_col3_chip + '''
                                  {smartPosState && (
                                    <span className={clsx('orders-card__chip', smartPosState.chipClass)}>
                                      {smartPosState.label}
                                    </span>
                                  )}'''
if caixa.count(old_col3_chip) != 1:
    raise RuntimeError(f"CaixaPanel: column 3 chip marker count={caixa.count(old_col3_chip)}")
caixa = caixa.replace(old_col3_chip, new_col3_chip, 1)

old_payment_guard = """                                  e.stopPropagation();
                                  if (isLoading) return;
                                  
                                  const tableComandas = orders.filter("""
new_payment_guard = """                                  e.stopPropagation();
                                  if (smartPosState?.blocksPayment || isLoading) return;
                                  
                                  const tableComandas = orders.filter("""
if caixa.count(old_payment_guard) != 1:
    raise RuntimeError(f"CaixaPanel: payment guard marker count={caixa.count(old_payment_guard)}")
caixa = caixa.replace(old_payment_guard, new_payment_guard, 1)

old_payment_open = """                              <button
                                type=\"button\"
                                onClick={async (e) => {
                                  e.stopPropagation();
                                  if (smartPosState?.blocksPayment || isLoading) return;"""
new_payment_open = """                              <button
                                type=\"button\"
                                disabled={smartPosState?.blocksPayment === true}
                                onClick={async (e) => {
                                  e.stopPropagation();
                                  if (smartPosState?.blocksPayment || isLoading) return;"""
if caixa.count(old_payment_open) != 1:
    raise RuntimeError(f"CaixaPanel: payment button opening count={caixa.count(old_payment_open)}")
caixa = caixa.replace(old_payment_open, new_payment_open, 1)

old_payment_label = """                                <Check size={13} /><span>Abrir pagamento</span>"""
new_payment_label = """                                {smartPosState?.blocksPayment ? (
                                  <><Smartphone size={13} /><span>{smartPosState.ctaLabel}</span></>
                                ) : (
                                  <><Check size={13} /><span>Abrir pagamento</span></>
                                )}"""
if caixa.count(old_payment_label) != 1:
    raise RuntimeError(f"CaixaPanel: payment button label count={caixa.count(old_payment_label)}")
caixa = caixa.replace(old_payment_label, new_payment_label, 1)
write(caixa_path, caixa)

# ---------------------------------------------------------------------------
# 5. Remove the floating SmartPOS concept completely and unmount it globally.
# ---------------------------------------------------------------------------
replace_once(
    "src/main.tsx",
    'import SmartPosCashAlerts from "./smartpos/SmartPosCashAlerts";\n',
    '',
)
replace_once(
    "src/main.tsx",
    '    {!isSmartPosRoute && <SmartPosCashAlerts />}\n',
    '',
)
for dead_path in (
    ROOT / "src/smartpos/SmartPosCashAlerts.tsx",
    ROOT / "src/smartpos/SmartPosCashSupervisor.tsx",
):
    if dead_path.exists():
        dead_path.unlink()

# ---------------------------------------------------------------------------
# Final structural assertions. These are intentionally strict so a changed
# branch fails the one-shot workflow instead of partially rewriting code.
# ---------------------------------------------------------------------------
checks = {
    "src/main.tsx": [
        ("SmartPosCashAlerts", False),
    ],
    "src/components/CaixaPanel.tsx": [
        ("SMARTPOS · PROCESSANDO", True),
        ("SMARTPOS · FINALIZANDO", True),
        ("Pagamento requer atenção", True),
        ("disabled={smartPosState?.blocksPayment === true}", True),
    ],
    "backend/app/routes/smartpos_cash_projection.py": [
        ("origem_smartpos", True),
        ('{"criada", "pendente", "processando"}', True),
    ],
    "src/smartpos/SmartPosOrderingFlow.tsx": [
        ("origem: 'smartpos'", True),
    ],
}
for path, expectations in checks.items():
    content = read(path)
    for needle, should_exist in expectations:
        exists = needle in content
        if exists != should_exist:
            raise RuntimeError(f"{path}: assertion failed for {needle!r}; exists={exists}")

print("PR #69 SmartPOS Kanban refactor staged successfully.")
