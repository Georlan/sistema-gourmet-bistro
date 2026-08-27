import datetime
from types import SimpleNamespace
from zoneinfo import ZoneInfo

from app.database import Base, SessionLocal, current_restaurante_id, engine
from app.models import CaixaTurno, Restaurante, Usuario
from app.services.online_order_policy import evaluate_online_order_policy


RESTAURANTE_ID = 910201
USUARIO_ID = "usuario-cash-online-override"
CLOSED_SCHEDULE = [
    {"days": "Segunda a Domingo", "hours": "Fechado"},
]


def _restaurant(*, status_override: str = "Automático", schedule=None):
    return SimpleNamespace(
        id=RESTAURANTE_ID,
        status_override=status_override,
        horarios_funcionamento=CLOSED_SCHEDULE if schedule is None else schedule,
    )


def _config(*, delivery_ativo: bool = True):
    return SimpleNamespace(delivery_ativo=delivery_ativo)


def test_fora_do_horario_com_caixa_fechado_continua_bloqueado():
    policy = evaluate_online_order_policy(
        _restaurant(),
        _config(),
        modalidade="retirada",
        cash_open=False,
    )

    assert policy.accepting_orders is False
    assert policy.source == "schedule"
    assert policy.reason == "O restaurante está fora do horário de pedidos online."


def test_fora_do_horario_com_caixa_aberto_aceita_pedido():
    policy = evaluate_online_order_policy(
        _restaurant(),
        _config(),
        modalidade="retirada",
        cash_open=True,
    )

    assert policy.accepting_orders is True
    assert policy.source == "cash_open"


def test_forcado_fechado_tem_precedencia_sobre_caixa_aberto():
    policy = evaluate_online_order_policy(
        _restaurant(status_override="Forçado Fechado"),
        _config(),
        modalidade="retirada",
        cash_open=True,
    )

    assert policy.accepting_orders is False
    assert policy.source == "forced_closed"


def test_dentro_do_horario_aceita_mesmo_sem_caixa_aberto():
    now = datetime.datetime(
        2026,
        8,
        27,
        19,
        0,
        tzinfo=ZoneInfo("America/Fortaleza"),
    )
    policy = evaluate_online_order_policy(
        _restaurant(
            schedule=[{"days": "Quinta", "hours": "18:30 - 23:30"}],
        ),
        _config(),
        modalidade="retirada",
        cash_open=False,
        now=now,
    )

    assert policy.accepting_orders is True
    assert policy.source == "automatic"


def test_caixa_aberto_nao_reativa_delivery_desligado():
    policy = evaluate_online_order_policy(
        _restaurant(),
        _config(delivery_ativo=False),
        modalidade="delivery",
        cash_open=True,
    )

    assert policy.accepting_orders is False
    assert policy.source == "delivery_disabled"


def test_restaurante_anexado_a_sessao_detecta_turno_de_caixa_aberto():
    Base.metadata.create_all(bind=engine)
    db = SessionLocal()
    tenant = current_restaurante_id.set(RESTAURANTE_ID)
    try:
        restaurante = db.query(Restaurante).filter(
            Restaurante.id == RESTAURANTE_ID,
        ).first()
        if restaurante is None:
            restaurante = Restaurante(
                id=RESTAURANTE_ID,
                nome="Koma Cash Override",
                slug="koma-cash-override",
                plano="premium",
            )
            db.add(restaurante)
        restaurante.status_override = "Automático"
        restaurante.horarios_funcionamento = CLOSED_SCHEDULE

        usuario = db.query(Usuario).filter(
            Usuario.id == USUARIO_ID,
            Usuario.restaurante_id == RESTAURANTE_ID,
        ).first()
        if usuario is None:
            usuario = Usuario(
                id=USUARIO_ID,
                restaurante_id=RESTAURANTE_ID,
                nome="Operador Cash Override",
                email="cash-override@koma.test",
                cargo="admin",
                status="ativo",
            )
            db.add(usuario)
        usuario.status = "ativo"
        db.commit()

        db.query(CaixaTurno).filter(
            CaixaTurno.restaurante_id == RESTAURANTE_ID,
        ).delete(synchronize_session=False)
        db.add(CaixaTurno(
            restaurante_id=RESTAURANTE_ID,
            aberto_por_id=USUARIO_ID,
            saldo_inicial=0.0,
            status="aberto",
        ))
        db.commit()
        db.refresh(restaurante)

        policy = evaluate_online_order_policy(
            restaurante,
            _config(),
            modalidade="retirada",
        )

        assert policy.accepting_orders is True
        assert policy.source == "cash_open"
    finally:
        db.rollback()
        db.query(CaixaTurno).filter(
            CaixaTurno.restaurante_id == RESTAURANTE_ID,
        ).delete(synchronize_session=False)
        db.commit()
        current_restaurante_id.reset(tenant)
        db.close()
