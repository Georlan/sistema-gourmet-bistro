from sqlalchemy import Column, ForeignKey, Integer, String

from .database import Base, current_restaurante_id


class RestauranteOperationProfile(Base):
    """Perfil operacional explícito e tenant-local do restaurante.

    O valor descreve apenas a experiência/configuração sugerida. Ele não altera
    preço, estoque, catálogo, modificadores ou regras de pedido por conta própria.
    Capabilities e templates são camadas posteriores e opt-in.
    """

    __tablename__ = "restaurante_operation_profiles"

    restaurante_id = Column(
        Integer,
        ForeignKey("restaurantes.id", ondelete="CASCADE"),
        primary_key=True,
        default=lambda: current_restaurante_id.get(),
        nullable=False,
    )
    profile_key = Column(
        String(64),
        default="generic",
        server_default="generic",
        nullable=False,
    )
