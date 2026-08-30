from sqlalchemy import (
    Boolean,
    CheckConstraint,
    Column,
    DateTime,
    Float,
    ForeignKey,
    ForeignKeyConstraint,
    Index,
    Integer,
    JSON,
    Numeric,
    String,
    Text,
    UniqueConstraint,
    event,
    text,
)
from sqlalchemy.orm import relationship
from sqlalchemy.ext.hybrid import hybrid_property
import datetime
import uuid
from .database import Base, current_restaurante_id
from .crypt import encrypt_field, decrypt_field

class Restaurante(Base):
    __tablename__ = "restaurantes"
    
    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    nome = Column(String, nullable=False)
    plano = Column(String, default="pocket", nullable=False)
    slug = Column(String, nullable=True)
    logo_url = Column(String, nullable=True)
    banner_url = Column(String, nullable=True)
    cardapio_logo_path = Column(String, nullable=True)
    cardapio_banner_path = Column(String, nullable=True)
    subtitulo = Column(String, nullable=True)
    sobre_nos = Column(String, nullable=True)
    endereco = Column(String, nullable=True)
    google_maps_url = Column(String, nullable=True)
    latitude = Column(Float, nullable=True)
    longitude = Column(Float, nullable=True)
    status_override = Column(String, default="Automático")
    socials = Column(JSON, nullable=True)
    horarios_funcionamento = Column(JSON, nullable=True)
    formas_pagamento_aceitas = Column(JSON, nullable=True)
    cor_primaria = Column(String, default="#00b894")
    cor_fundo = Column(String, default="#090a0f")


class Usuario(Base):
    __tablename__ = "usuarios"
    __table_args__ = (
        CheckConstraint(
            "cargo IN ('admin', 'superadmin', 'caixa', 'garcom', 'gerente', 'motoboy')",
            name="ck_usuarios_cargo",
        ),
        CheckConstraint(
            "status IS NULL OR status IN ('pendente_ativacao', 'ativo', 'inativo')",
            name="ck_usuarios_status",
        ),
        UniqueConstraint(
            "restaurante_id",
            "email",
            name="uq_usuarios_restaurante_email",
        ),
        UniqueConstraint(
            "restaurante_id",
            "telefone",
            name="uq_usuarios_restaurante_telefone",
        ),
    )
    
    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    nome = Column(String(100), nullable=False)
    telefone = Column(String(50), index=True, nullable=True)
    email = Column(String(100), index=True, nullable=True)
    cargo = Column(String(20), nullable=False, default="garcom")  # 'caixa' | 'garcom' | 'gerente' | 'motoboy' | 'admin'
    restaurante_id = Column(Integer, ForeignKey("restaurantes.id", ondelete="CASCADE"), default=lambda: current_restaurante_id.get(), nullable=False)
    senha_hash = Column(String(255), nullable=True)
    token_convite = Column(String, nullable=True)
    token_expira_em = Column(DateTime(timezone=True), nullable=True)
    status = Column(String(20), default="pendente_ativacao")  # 'pendente_ativacao' | 'ativo' | 'inativo'
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.datetime.now(datetime.timezone.utc))

    @hybrid_property
    def role(self):
        return self.cargo

    @role.setter
    def role(self, value):
        self.cargo = value

    @hybrid_property
    def tenant_id(self):
        return self.restaurante_id

    @tenant_id.setter
    def tenant_id(self, value):
        self.restaurante_id = value

    @tenant_id.expression
    def tenant_id(cls):
        return cls.restaurante_id


    @role.expression
    def role(cls):
        return cls.cargo

    @hybrid_property
    def usuario(self):
        return self.email or self.telefone

    @usuario.setter
    def usuario(self, value):
        if value and "@" in value:
            self.email = value
        else:
            self.telefone = value

    @usuario.expression
    def usuario(cls):
        return cls.email

    # Relationships
    comandas_abertas = relationship("Comanda", back_populates="criada_por")
    lancamentos_feitos = relationship("Lancamento", back_populates="garcom")


class Categoria(Base):
    __tablename__ = "categorias"
    __table_args__ = (
        UniqueConstraint('restaurante_id', 'id', name='uq_categorias_restaurante_id_negocio'),
        UniqueConstraint('restaurante_id', 'nome', name='uq_categorias_restaurante_nome'),
    )

    pk = Column(Integer, primary_key=True, autoincrement=True)
    id = Column(String, nullable=False, index=True)  # Chave de negócio, ex: "cat-hamburgueres-bovinos"
    restaurante_id = Column(Integer, ForeignKey("restaurantes.id"), default=lambda: current_restaurante_id.get(), nullable=False)
    nome = Column(String, nullable=False)
    destino_impressao = Column(String, default="COZINHA")  # "COZINHA" | "BAR" | "NENHUM"
    
    # Relationships
    produtos = relationship("Produto", back_populates="categoria")
    observacoes_predefinidas = relationship("ObservacaoPredefinida", back_populates="categoria")


class Produto(Base):
    __tablename__ = "produtos"
    __table_args__ = (
        UniqueConstraint('restaurante_id', 'id', name='uq_produtos_restaurante_id_negocio'),
        ForeignKeyConstraint(
            ['restaurante_id', 'categoria_id'],
            ['categorias.restaurante_id', 'categorias.id'],
            name='fk_produtos_categoria_tenant',
            ondelete='RESTRICT',
        ),
        CheckConstraint(
            "preco >= 0",
            name="ck_produtos_preco_nonnegative_finite",
        ),
        Index(
            "ix_produtos_tenant_categoria_fk",
            "restaurante_id",
            "categoria_id",
        ).ddl_if(dialect="postgresql"),
    )

    pk = Column(Integer, primary_key=True, autoincrement=True)
    id = Column(String, nullable=False, index=True)
    restaurante_id = Column(Integer, ForeignKey("restaurantes.id"), default=lambda: current_restaurante_id.get(), nullable=False)
    nome = Column(String, nullable=False)
    categoria_id = Column(String, nullable=False)
    preco = Column(Numeric(14, 2, asdecimal=False), nullable=False)
    descricao = Column(String, default="")
    imagem = Column(String, default="")
    imagens_galeria = Column(JSON, default=list)  # Up to 3 product gallery URLs
    ativo = Column(Boolean, default=True)  # Toggle product availability
    
    # Relationships
    categoria = relationship("Categoria", back_populates="produtos")
    ficha_tecnica = relationship(
        "ProdutoInsumo",
        back_populates="produto",
        cascade="all, delete-orphan",
    )


class ProdutoInsumo(Base):
    """Quantidade de um ingrediente consumida por uma unidade vendida."""

    __tablename__ = "produto_insumos"
    __table_args__ = (
        UniqueConstraint(
            "restaurante_id",
            "produto_id",
            "insumo_id",
            name="uq_produto_insumos_tenant_produto_insumo",
        ),
        ForeignKeyConstraint(
            ["restaurante_id", "produto_id"],
            ["produtos.restaurante_id", "produtos.id"],
            name="fk_produto_insumos_produto_tenant",
            ondelete="CASCADE",
        ),
        CheckConstraint(
            "quantidade > 0",
            name="ck_produto_insumos_quantidade_positive_finite",
        ),
        Index(
            "ix_produto_insumos_tenant_produto",
            "restaurante_id",
            "produto_id",
        ),
    )

    id = Column(Integer, primary_key=True, autoincrement=True)
    restaurante_id = Column(
        Integer,
        ForeignKey("restaurantes.id"),
        default=lambda: current_restaurante_id.get(),
        nullable=False,
        index=True,
    )
    produto_id = Column(String, nullable=False)
    insumo_id = Column(String, ForeignKey("insumos.id", ondelete="RESTRICT"), nullable=False)
    quantidade = Column(Float, nullable=False)

    produto = relationship("Produto", back_populates="ficha_tecnica")
    insumo = relationship("Insumo")


class Mesa(Base):
    __tablename__ = "mesas"
    __table_args__ = (
        UniqueConstraint('restaurante_id', 'id', name='uq_mesas_restaurante_numero'),
    )

    pk = Column(Integer, primary_key=True, autoincrement=True)
    id = Column(Integer, nullable=False, index=True)  # Número visível: 1, 2, 3...
    restaurante_id = Column(Integer, ForeignKey("restaurantes.id"), default=lambda: current_restaurante_id.get(), nullable=False)
    capacidade = Column(Integer, nullable=False, default=4)
    nome = Column(String, nullable=True)  # Editable custom name (e.g. "Mesa VIP", "Varanda 1")
    # NOTA: ocupação é derivada via Comanda.mesa_id (WHERE fechada=False), não armazenada aqui.



class ObservacaoPredefinida(Base):
    __tablename__ = "observacoes_predefinidas"
    __table_args__ = (
        ForeignKeyConstraint(
            ['restaurante_id', 'categoria_id'],
            ['categorias.restaurante_id', 'categorias.id'],
            name='fk_observacoes_categoria_tenant',
            ondelete='CASCADE',
        ),
        Index(
            "ix_observacoes_tenant_categoria_fk",
            "restaurante_id",
            "categoria_id",
        ).ddl_if(dialect="postgresql"),
    )
    
    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    restaurante_id = Column(Integer, ForeignKey("restaurantes.id"), default=lambda: current_restaurante_id.get(), nullable=False, index=True)
    categoria_id = Column(String, nullable=False)
    texto = Column(String, nullable=False)  # e.g., "Sem cebola", "Sem cheddar", "Pra viagem"
    
    # Relationships
    categoria = relationship("Categoria", back_populates="observacoes_predefinidas")


class Cupom(Base):
    __tablename__ = "cupons"
    
    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    restaurante_id = Column(Integer, ForeignKey("restaurantes.id"), default=lambda: current_restaurante_id.get(), nullable=False, index=True)
    codigo = Column(String, nullable=False, index=True)
    tipo_desconto = Column(String, default="porcentagem")  # "porcentagem" | "fixo"
    valor_desconto = Column(Numeric(14, 2, asdecimal=False), nullable=False)
    valor_minimo_pedido = Column(Numeric(14, 2, asdecimal=False), default=0.0)
    limite_usos = Column(Integer, nullable=True)
    usos_atuais = Column(Integer, default=0)
    valido_ate = Column(DateTime, nullable=True)
    apenas_primeira_compra = Column(Boolean, default=False)
    ativo = Column(Boolean, default=True)
    cliente_id = Column(String, nullable=True)
    criado_em = Column(DateTime, default=lambda: datetime.datetime.now(datetime.timezone.utc))

    __table_args__ = (
        UniqueConstraint('restaurante_id', 'codigo', name='uq_cupons_restaurante_codigo'),
        CheckConstraint("valor_desconto >= 0", name="ck_cupons_valor_desconto_nonnegative"),
    )


class Comanda(Base):
    __tablename__ = "comandas"
    __table_args__ = (
        ForeignKeyConstraint(
            ['restaurante_id', 'mesa_id'],
            ['mesas.restaurante_id', 'mesas.id'],
            name='fk_comandas_mesa_tenant',
            ondelete='RESTRICT',
        ),
        ForeignKeyConstraint(
            ['restaurante_id', 'cliente_id'],
            ['clientes.restaurante_id', 'clientes.id'],
            name='fk_comandas_cliente_tenant',
            ondelete='RESTRICT',
        ),
        UniqueConstraint(
            'restaurante_id',
            'idempotency_key',
            name='uq_comandas_restaurante_idempotency',
        ),
        CheckConstraint(
            "valor_pago >= 0 AND (delivery_taxa IS NULL OR delivery_taxa >= 0)",
            name="ck_comandas_valores_nonnegative_finite",
        ),
        CheckConstraint(
            "idempotency_key IS NULL OR trim(idempotency_key) <> ''",
            name="ck_comandas_idempotency_nonblank",
        ),
        CheckConstraint(
            "tipo IS NULL OR tipo IN ('Consumo no Local', 'Retirada', 'Entrega', 'Delivery')",
            name="ck_comandas_tipo",
        ),
        CheckConstraint(
            "delivery_status IS NULL OR delivery_status IN "
            "('analise', 'pendente', 'producao', 'pronto', 'transito', 'finalizado', 'recusado')",
            name="ck_comandas_delivery_status",
        ),
        CheckConstraint(
            "status_comanda IS NULL OR status_comanda = 'aguardando_pagamento'",
            name="ck_comandas_status_comanda",
        ),
        Index(
            "ix_comandas_tenant_mesa_fk",
            "restaurante_id",
            "mesa_id",
        ).ddl_if(dialect="postgresql"),
        Index(
            "ix_comandas_tenant_cliente_fk",
            "restaurante_id",
            "cliente_id",
        ).ddl_if(dialect="postgresql"),
        Index(
            "ix_comandas_tenant_open_created",
            "restaurante_id",
            "criado_em",
            "id",
            postgresql_where=text("fechada = false"),
        ).ddl_if(dialect="postgresql"),
    )
    
    id = Column(String, primary_key=True, index=True)
    restaurante_id = Column(Integer, ForeignKey("restaurantes.id"), default=lambda: current_restaurante_id.get(), nullable=False, index=True)
    mesa_id = Column(Integer, nullable=True, index=True)
    mesa_origem_id = Column(Integer, nullable=True)
    mesa_transferida_de = Column(Integer, nullable=True)
    garcom_id = Column(String, ForeignKey("usuarios.id"), nullable=False)
    cliente_id = Column(String, nullable=True)
    
    tipo = Column(String, default="Consumo no Local")  # Consumo no Local | Retirada
    _identificador = Column("identificador", String, nullable=True)  # Client name encrypted
    numero_pedido = Column(Integer, nullable=False)  # Global sequential order number (shared when splitting)
    idempotency_key = Column(String(128), nullable=True, index=True)

    @hybrid_property
    def identificador(self):
        return decrypt_field(self._identificador)

    @identificador.setter
    def identificador(self, value):
        self._identificador = encrypt_field(value)
    
    fechada = Column(Boolean, default=False, index=True)
    criado_em = Column(DateTime, default=lambda: datetime.datetime.now(datetime.timezone.utc))
    fechado_em = Column(DateTime, nullable=True)
    valor_pago = Column(Numeric(14, 2, asdecimal=False), default=0.0, nullable=False)  # Sum of generic partial payments made
    
    # Delivery operational fields
    delivery_status = Column(String, nullable=True)  # analise | pendente | producao | pronto | transito | finalizado
    delivery_taxa = Column(Numeric(14, 2, asdecimal=False), default=0.0)
    _delivery_telefone = Column("delivery_telefone", String, nullable=True)
    _delivery_endereco = Column("delivery_endereco", String, nullable=True)
    motoboy_id = Column(Integer, ForeignKey("motoboys.id"), nullable=True)
    cupom_id = Column(String, ForeignKey("cupons.id"), nullable=True)
    valor_desconto_cupom = Column(Numeric(14, 2, asdecimal=False), default=0.0)
    valor_desconto_cashback = Column(Numeric(14, 2, asdecimal=False), default=0.0)
    delivery_forma_pagamento = Column(String, nullable=True)
    delivery_troco_para = Column(Numeric(14, 2, asdecimal=False), nullable=True)
    delivery_bairro = Column(String, nullable=True)

    # Cashier flow field
    status_comanda = Column(String, nullable=True)  # null (normal) | aguardando_pagamento (table requested bill)

    @hybrid_property
    def delivery_telefone(self):
        return decrypt_field(self._delivery_telefone)

    @delivery_telefone.setter
    def delivery_telefone(self, value):
        self._delivery_telefone = encrypt_field(value)

    @hybrid_property
    def delivery_endereco(self):
        return decrypt_field(self._delivery_endereco)

    @delivery_endereco.setter
    def delivery_endereco(self, value):
        self._delivery_endereco = encrypt_field(value)

    # Relationships
    criada_por = relationship("Usuario", back_populates="comandas_abertas")
    lancamentos = relationship("Lancamento", back_populates="comanda", cascade="all, delete-orphan")
    itens = relationship("Item", back_populates="comanda", cascade="all, delete-orphan")
    motoboy = relationship("Motoboy", back_populates="comandas")
    cliente = relationship("Cliente", back_populates="comandas")


class Lancamento(Base):
    __tablename__ = "lancamentos"
    __table_args__ = (
        UniqueConstraint(
            "restaurante_id",
            "idempotency_key",
            name="uq_lancamentos_restaurante_idempotency",
        ),
        CheckConstraint(
            "origem IN ('desconhecida', 'garcom', 'caixa', 'smartpos', 'cardapio')",
            name="ck_lancamentos_origem",
        ),
        CheckConstraint(
            "idempotency_key IS NULL OR trim(idempotency_key) <> ''",
            name="ck_lancamentos_idempotency_nonblank",
        ),
        CheckConstraint(
            "status IN ('pendente', 'aceito', 'producao', 'pronto', 'finalizado', 'recusado', 'cancelado')",
            name="ck_lancamentos_status",
        ),
    )

    id = Column(String, primary_key=True, index=True)
    restaurante_id = Column(Integer, ForeignKey("restaurantes.id"), default=lambda: current_restaurante_id.get(), nullable=False, index=True)
    comanda_id = Column(String, ForeignKey("comandas.id"), nullable=False)
    garcom_id = Column(String, ForeignKey("usuarios.id"), nullable=False)
    idempotency_key = Column(String(128), nullable=True, index=True)
    origem = Column(
        String(24),
        nullable=False,
        default="desconhecida",
        server_default="desconhecida",
    )
    status = Column(
        String(32),
        nullable=False,
        default="pendente",
        server_default="pendente",
        index=True,
    )
    timestamp = Column(DateTime, default=lambda: datetime.datetime.now(datetime.timezone.utc))
    
    # Relationships
    comanda = relationship("Comanda", back_populates="lancamentos")
    garcom = relationship("Usuario", back_populates="lancamentos_feitos")
    itens = relationship("Item", back_populates="lancamento", cascade="all, delete-orphan")


class Item(Base):
    __tablename__ = "itens"
    __table_args__ = (
        ForeignKeyConstraint(
            ['restaurante_id', 'produto_id'],
            ['produtos.restaurante_id', 'produtos.id'],
            name='fk_itens_produto_tenant',
            ondelete='RESTRICT',
        ),
        CheckConstraint(
            "preco_unit >= 0",
            name="ck_itens_preco_unit_nonnegative_finite",
        ),
        CheckConstraint(
            "status IS NULL OR status IN ('preparando', 'pronto', 'entregue', 'cancelado')",
            name="ck_itens_status",
        ),
        Index(
            "ix_itens_tenant_produto_fk",
            "restaurante_id",
            "produto_id",
        ).ddl_if(dialect="postgresql"),
    )
    
    id = Column(String, primary_key=True, index=True)
    restaurante_id = Column(Integer, ForeignKey("restaurantes.id"), default=lambda: current_restaurante_id.get(), nullable=False, index=True)
    comanda_id = Column(String, ForeignKey("comandas.id"), nullable=False, index=True)
    lancamento_id = Column(String, ForeignKey("lancamentos.id"), nullable=False, index=True)
    produto_id = Column(String, nullable=False)
    
    preco_unit = Column(Numeric(14, 2, asdecimal=False), nullable=False)  # Snapshot of price at order time
    observacao = Column(String, default="")
    _cliente_nome = Column("cliente_nome", String, default=lambda: encrypt_field("Consumo Geral"))

    @hybrid_property
    def cliente_nome(self):
        return decrypt_field(self._cliente_nome)

    @cliente_nome.setter
    def cliente_nome(self, value):
        self._cliente_nome = encrypt_field(value)
    
    status = Column(String, default="preparando", index=True)  # preparando | pronto | entregue | cancelado
    cancelado_por = Column(String, ForeignKey("usuarios.id"), nullable=True)
    impresso_em = Column(DateTime, nullable=True)  # Individual unit print log
    pago = Column(Boolean, default=False, nullable=False)  # Settle item payment individually
    
    # Relationships
    comanda = relationship("Comanda", back_populates="itens")
    lancamento = relationship("Lancamento", back_populates="itens")
    produto = relationship("Produto")


class CaixaTurno(Base):
    __tablename__ = "caixa_turnos"
    __table_args__ = (
        CheckConstraint(
            "saldo_inicial >= 0 "
            "AND (declarado_dinheiro IS NULL OR declarado_dinheiro >= 0) "
            "AND (declarado_pix IS NULL OR declarado_pix >= 0) "
            "AND (declarado_cartao IS NULL OR declarado_cartao >= 0)",
            name="ck_caixa_turnos_valores_nonnegative_finite",
        ),
        CheckConstraint(
            "status IS NULL OR status IN ('aberto', 'fechado')",
            name="ck_caixa_turnos_status",
        ),
        Index(
            "uq_caixa_turnos_tenant_open",
            "restaurante_id",
            unique=True,
            postgresql_where=text("status = 'aberto'"),
        ).ddl_if(dialect="postgresql"),
    )
    
    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    restaurante_id = Column(Integer, ForeignKey("restaurantes.id"), default=lambda: current_restaurante_id.get(), nullable=False, index=True)
    aberto_por_id = Column(String, ForeignKey("usuarios.id"), nullable=False)
    aberto_em = Column(DateTime, default=lambda: datetime.datetime.now(datetime.timezone.utc))
    fechado_em = Column(DateTime, nullable=True)
    fechado_por_id = Column(String, ForeignKey("usuarios.id"), nullable=True)
    
    saldo_inicial = Column(Numeric(14, 2, asdecimal=False), nullable=False)
    declarado_dinheiro = Column(Numeric(14, 2, asdecimal=False), nullable=True)
    declarado_pix = Column(Numeric(14, 2, asdecimal=False), nullable=True)
    declarado_cartao = Column(Numeric(14, 2, asdecimal=False), nullable=True)
    observacao = Column(String, default="")
    status = Column(String, default="aberto", index=True)  # "aberto" | "fechado"

    aberto_por = relationship("Usuario", foreign_keys=[aberto_por_id])
    fechado_por = relationship("Usuario", foreign_keys=[fechado_por_id])


class CaixaMovimentacao(Base):
    __tablename__ = "caixa_movimentacoes"
    __table_args__ = (
        CheckConstraint(
            "valor > 0",
            name="ck_caixa_movimentacoes_valor_positive_finite",
        ),
        CheckConstraint(
            "tipo IN ('suprimento', 'sangria')",
            name="ck_caixa_movimentacoes_tipo",
        ),
        Index(
            "ix_caixa_movimentacoes_usuario_fk",
            "usuario_id",
        ).ddl_if(dialect="postgresql"),
        Index(
            "ix_caixa_movimentacoes_tenant_turno_tipo",
            "restaurante_id",
            "turno_id",
            "tipo",
            postgresql_include=("valor",),
        ).ddl_if(dialect="postgresql"),
        Index(
            "ix_caixa_movimentacoes_tenant_turno_latest",
            "restaurante_id",
            "turno_id",
            text("criado_em DESC"),
            text("id DESC"),
        ).ddl_if(dialect="postgresql"),
    )
    
    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    restaurante_id = Column(Integer, ForeignKey("restaurantes.id"), default=lambda: current_restaurante_id.get(), nullable=False, index=True)
    turno_id = Column(Integer, ForeignKey("caixa_turnos.id"), nullable=False, index=True)
    usuario_id = Column(String, ForeignKey("usuarios.id"), nullable=True)
    tipo = Column(String, nullable=False)  # "suprimento" | "sangria"
    valor = Column(Numeric(14, 2, asdecimal=False), nullable=False)
    saldo_anterior = Column(Numeric(14, 2, asdecimal=False), default=0.0)
    saldo_posterior = Column(Numeric(14, 2, asdecimal=False), default=0.0)
    descricao = Column(String, default="")
    observacao = Column(String, default="")
    criado_em = Column(DateTime, default=lambda: datetime.datetime.now(datetime.timezone.utc))

    turno = relationship("CaixaTurno")
    usuario = relationship("Usuario", foreign_keys=[usuario_id])


class Pagamento(Base):
    __tablename__ = "pagamentos"
    __table_args__ = (
        CheckConstraint(
            "valor > 0",
            name="ck_pagamentos_valor_positive_finite",
        ),
        CheckConstraint(
            "metodo IN ('dinheiro', 'pix', 'cartao', 'cartao_debito', 'cartao_credito')",
            name="ck_pagamentos_metodo",
        ),
        CheckConstraint(
            "status IS NULL OR status IN ('pendente', 'aprovado', 'cancelado')",
            name="ck_pagamentos_status",
        ),
        CheckConstraint(
            "idempotency_key IS NULL OR trim(idempotency_key) <> ''",
            name="ck_pagamentos_idempotency_nonblank",
        ),
        UniqueConstraint(
            "restaurante_id",
            "idempotency_key",
            name="uq_pagamentos_restaurante_idempotency",
        ),
        ForeignKeyConstraint(
            ["restaurante_id", "cliente_id"],
            ["clientes.restaurante_id", "clientes.id"],
            name="fk_pagamentos_cliente_tenant",
            ondelete="RESTRICT",
        ),
        Index(
            "ix_pagamentos_tenant_cliente_fk",
            "restaurante_id",
            "cliente_id",
        ).ddl_if(dialect="postgresql"),
        Index(
            "ix_pagamentos_tenant_turno_aprovado_metodo",
            "restaurante_id",
            "turno_id",
            "metodo",
            postgresql_where=text("status = 'aprovado'"),
            postgresql_include=("valor", "comanda_id"),
        ).ddl_if(dialect="postgresql"),
    )
    
    id = Column(String, primary_key=True, index=True)
    restaurante_id = Column(Integer, ForeignKey("restaurantes.id", ondelete="CASCADE"), default=lambda: current_restaurante_id.get(), nullable=False, index=True)
    comanda_id = Column(String, ForeignKey("comandas.id"), nullable=False, index=True)
    turno_id = Column(Integer, ForeignKey("caixa_turnos.id"), nullable=False)
    valor = Column(Numeric(14, 2, asdecimal=False), nullable=False)
    metodo = Column(String, nullable=False)  # "dinheiro" | "pix" | "cartao"
    status = Column(String, default="aprovado") # "pendente" | "aprovado" | "cancelado"
    idempotency_key = Column(String(128), nullable=True, index=True)
    cliente_id = Column(String, nullable=True)
    cpf_cliente = Column(String, nullable=True, index=True)
    nome_cliente = Column(String, nullable=True)
    nsu_cartao = Column(String, nullable=True)
    chave_nfe_emitida = Column(String, nullable=True)
    criado_em = Column(DateTime, default=lambda: datetime.datetime.now(datetime.timezone.utc))

    # Relationships
    comanda = relationship("Comanda")
    cliente = relationship("Cliente", back_populates="pagamentos")

# Alias compatibility
Garcom = Usuario


class ConfiguracaoRestaurante(Base):
    __tablename__ = "configuracoes_restaurante"
    __table_args__ = (
        CheckConstraint(
            "taxa_servico_padrao IS NULL OR taxa_servico_padrao BETWEEN 0 AND 100",
            name="ck_config_restaurante_taxa_servico",
        ),
        CheckConstraint(
            "impressao_nome_posicao IN ('cabecalho', 'rodape', 'oculto')",
            name="ck_config_restaurante_impressao_nome_posicao",
        ),
    )
    
    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    restaurante_id = Column(Integer, ForeignKey("restaurantes.id"), default=lambda: current_restaurante_id.get(), nullable=False)
    nicho = Column(String, default="hamburgueria")  # "hamburgueria" | "pizzaria" | "doceria" | "alacarte" | "selfservice"
    mapa_mesas_ativo = Column(Boolean, default=True)
    delivery_ativo = Column(Boolean, default=True)
    pedido_minimo = Column(Numeric(14, 2, asdecimal=False), default=0.0)
    frete_gratis_valor = Column(Numeric(14, 2, asdecimal=False), default=0.0)
    tipo_taxa_entrega = Column(String, default="fixa")  # "fixa" | "bairro" | "distancia"
    tabela_taxas_bairros = Column(JSON, default=list)
    tabela_taxas_km = Column(JSON, default=list)
    taxa_servico_ativa = Column(Boolean, default=True)
    taxa_servico_padrao = Column(Float, default=10.0)
    meta_mensal = Column(Numeric(14, 2, asdecimal=False), default=0.0)
    unificar_vias_delivery = Column(Boolean, default=False)
    impressao_nome_restaurante = Column(String(80), nullable=True)
    impressao_nome_posicao = Column(
        String(20),
        default="cabecalho",
        nullable=False,
    )
    impressao_mensagem_rodape = Column(String(160), nullable=True)
    impressao_mostrar_descricao = Column(Boolean, default=True, nullable=False)
    modo_exclusivo_salao = Column(Boolean, default=True)
    perm_garcom_delivery = Column(Boolean, default=True)
    perm_garcom_editar = Column(Boolean, default=True)
    perm_garcom_taxas = Column(Boolean, default=False)
    perm_garcom_cancelar = Column(Boolean, default=False)
    perm_garcom_status = Column(Boolean, default=True)
    perm_garcom_abrir_vazia = Column(Boolean, default=False)
    perm_garcom_print = Column(Boolean, default=True)
    perm_garcom_fechar = Column(Boolean, default=False)
    perm_garcom_desconto = Column(Boolean, default=False)
    perm_garcom_acrescimo = Column(Boolean, default=False)
    perm_garcom_pessoas = Column(Boolean, default=True)
    perm_garcom_transferir_mesa = Column(Boolean, default=True)
    perm_garcom_transferir_item = Column(Boolean, default=True)
    perm_garcom_chamar = Column(Boolean, default=True)
    perm_garcom_ociosas = Column(Boolean, default=True)
    webhook_url = Column(String(255), nullable=True)
    webhook_secret = Column(String(128), nullable=True)
    webhook_ativo = Column(Boolean, default=False, nullable=False)

    restaurante = relationship("Restaurante", lazy="joined")

    @property
    def plano(self):
        return self.restaurante.plano if self.restaurante else "pocket"


class ConfiguracaoIA(Base):
    __tablename__ = "configuracoes_ia"
    __table_args__ = (
        CheckConstraint(
            "desconto_maximo IS NULL OR desconto_maximo BETWEEN 0 AND 100",
            name="ck_config_ia_desconto_maximo",
        ),
    )
    
    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    restaurante_id = Column(Integer, ForeignKey("restaurantes.id"), default=lambda: current_restaurante_id.get(), nullable=False, index=True)
    permitir_descontos = Column(Boolean, default=False)
    desconto_maximo = Column(Float, default=10.0)
    permitir_upsell = Column(Boolean, default=True)
    tom_de_voz = Column(String, default="direto")  # "direto" | "conversador"
    teto_interacoes = Column(Integer, default=5)


class MensagemWhatsApp(Base):
    __tablename__ = "mensagens_whatsapp"
    
    id = Column(String, primary_key=True, index=True)
    restaurante_id = Column(Integer, ForeignKey("restaurantes.id"), default=lambda: current_restaurante_id.get(), nullable=False, index=True)
    _cliente_telefone = Column("cliente_telefone", String, nullable=False)
    remetente = Column(String, nullable=False)  # "cliente" | "ia" | "humano"
    _conteudo = Column("conteudo", String, nullable=False)
    _transcricao = Column("transcricao", String, nullable=True)
    audio_url = Column(String, nullable=True)
    criado_em = Column(DateTime, default=lambda: datetime.datetime.now(datetime.timezone.utc))

    @hybrid_property
    def cliente_telefone(self):
        return decrypt_field(self._cliente_telefone)

    @cliente_telefone.setter
    def cliente_telefone(self, value):
        self._cliente_telefone = encrypt_field(value)

    @hybrid_property
    def conteudo(self):
        return decrypt_field(self._conteudo)

    @conteudo.setter
    def conteudo(self, value):
        self._conteudo = encrypt_field(value)

    @hybrid_property
    def transcricao(self):
        return decrypt_field(self._transcricao)

    @transcricao.setter
    def transcricao(self, value):
        self._transcricao = encrypt_field(value)


class RascunhoPedido(Base):
    __tablename__ = "rascunhos_pedidos"
    
    id = Column(String, primary_key=True, index=True)
    restaurante_id = Column(Integer, ForeignKey("restaurantes.id"), default=lambda: current_restaurante_id.get(), nullable=False, index=True)
    _cliente_telefone = Column("cliente_telefone", String, nullable=False)
    _conteudo_json = Column("conteudo_json", String, nullable=False)
    _ia_sugestao_resposta = Column("ia_sugestao_resposta", String, nullable=True)
    status = Column(String, default="pendente")  # "pendente" | "aprovado" | "recusado"
    criado_em = Column(DateTime, default=lambda: datetime.datetime.now(datetime.timezone.utc))

    @hybrid_property
    def cliente_telefone(self):
        return decrypt_field(self._cliente_telefone)

    @cliente_telefone.setter
    def cliente_telefone(self, value):
        self._cliente_telefone = encrypt_field(value)

    @hybrid_property
    def conteudo_json(self):
        return decrypt_field(self._conteudo_json)

    @conteudo_json.setter
    def conteudo_json(self, value):
        self._conteudo_json = encrypt_field(value)

    @hybrid_property
    def ia_sugestao_resposta(self):
        return decrypt_field(self._ia_sugestao_resposta)

    @ia_sugestao_resposta.setter
    def ia_sugestao_resposta(self, value):
        self._ia_sugestao_resposta = encrypt_field(value)


class GrupoModificador(Base):
    __tablename__ = "grupo_modificadores"
    
    id = Column(String, primary_key=True, index=True)
    restaurante_id = Column(Integer, ForeignKey("restaurantes.id"), default=lambda: current_restaurante_id.get(), nullable=False, index=True)
    nome = Column(String, nullable=False)
    min_selecoes = Column(Integer, default=0)
    max_selecoes = Column(Integer, default=1)
    tipo = Column(String, default="obrigatorio")  # "obrigatorio" | "opcional" | "meio_a_meio"


class OpcaoModificador(Base):
    __tablename__ = "opcao_modificadores"
    
    id = Column(String, primary_key=True, index=True)
    restaurante_id = Column(Integer, ForeignKey("restaurantes.id"), default=lambda: current_restaurante_id.get(), nullable=False, index=True)
    grupo_id = Column(String, ForeignKey("grupo_modificadores.id"), nullable=False)
    nome = Column(String, nullable=False)
    preco_adicional = Column(Numeric(14, 2, asdecimal=False), default=0.0)
    ativo = Column(Boolean, default=True)


class ProdutoGrupoModificador(Base):
    __tablename__ = "produto_grupo_modificadores"
    __table_args__ = (
        ForeignKeyConstraint(
            ['restaurante_id', 'produto_id'],
            ['produtos.restaurante_id', 'produtos.id'],
            name='fk_produto_grupo_produto_tenant',
            ondelete='CASCADE',
        ),
        Index(
            "ix_produto_grupo_tenant_produto_fk",
            "restaurante_id",
            "produto_id",
        ).ddl_if(dialect="postgresql"),
    )
    
    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    restaurante_id = Column(Integer, ForeignKey("restaurantes.id"), default=lambda: current_restaurante_id.get(), nullable=False, index=True)
    produto_id = Column(String, nullable=False)
    grupo_id = Column(String, ForeignKey("grupo_modificadores.id"), nullable=False)


class ItemModificador(Base):
    __tablename__ = "item_modificadores"
    
    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    restaurante_id = Column(Integer, ForeignKey("restaurantes.id"), default=lambda: current_restaurante_id.get(), nullable=False, index=True)
    item_id = Column(String, ForeignKey("itens.id"), nullable=False)
    opcao_modificador_id = Column(String, ForeignKey("opcao_modificadores.id"), nullable=False)
    preco_aplicado = Column(Numeric(14, 2, asdecimal=False), nullable=False)


class ActivityLog(Base):
    __tablename__ = "activity_logs"
    
    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    restaurante_id = Column(Integer, ForeignKey("restaurantes.id"), default=lambda: current_restaurante_id.get(), nullable=False, index=True)
    garcom_id = Column(String, ForeignKey("usuarios.id"), nullable=False)
    action = Column(String, nullable=False)  # e.g., "CANCEL_ITEM", "APPLY_DISCOUNT", "REOPEN_CAIXA", "GDPR_DELETE"
    details = Column(String, default="")
    timestamp = Column(DateTime, default=lambda: datetime.datetime.now(datetime.timezone.utc))


# Register ORM event listeners to enforce log immutability


@event.listens_for(ActivityLog, 'before_update')
def block_activity_log_update(mapper, connection, target):
    raise PermissionError("Activity logs are immutable and cannot be updated.")

@event.listens_for(ActivityLog, 'before_delete')
def block_activity_log_delete(mapper, connection, target):
    raise PermissionError("Activity logs are immutable and cannot be deleted.")


class Insumo(Base):
    __tablename__ = "insumos"
    
    id = Column(String, primary_key=True, index=True)
    restaurante_id = Column(Integer, ForeignKey("restaurantes.id"), default=lambda: current_restaurante_id.get(), nullable=False)
    nome = Column(String, nullable=False)
    estoque_atual = Column(Float, default=0.0)
    estoque_minimo = Column(Float, default=10.0)
    estoque_maximo = Column(Float, default=50.0)
    unidade_medida = Column(String, default="un")  # kg, g, l, ml, un
    preco_medio_custo = Column(Numeric(14, 4, asdecimal=False), default=0.0)


class ConfigFidelizacao(Base):
    __tablename__ = "config_fidelizacao"
    
    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    restaurante_id = Column(
        Integer,
        ForeignKey("restaurantes.id"),
        default=lambda: current_restaurante_id.get(),
        nullable=False,
    )
    ativo = Column(Boolean, default=False)
    tipo_recompensa = Column(String, default="PONTOS")  # PONTOS | CASHBACK
    taxa_conversao = Column(Float, default=1.0)  # R$ 1 = X points or X% cashback
    valor_ponto_em_dinheiro = Column(Numeric(14, 4, asdecimal=False), default=0.05)  # 1 point = R$ 0.05 discount


class HistoricoFidelidade(Base):
    __tablename__ = "historico_fidelidade"
    __table_args__ = (
        ForeignKeyConstraint(
            ["restaurante_id", "cliente_id"],
            ["clientes.restaurante_id", "clientes.id"],
            name="fk_historico_fidelidade_cliente_tenant",
            ondelete="RESTRICT",
        ),
        Index(
            "ix_historico_fidelidade_tenant_cliente_fk",
            "restaurante_id",
            "cliente_id",
        ).ddl_if(dialect="postgresql"),
    )
    
    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    restaurante_id = Column(
        Integer,
        ForeignKey("restaurantes.id"),
        default=lambda: current_restaurante_id.get(),
        nullable=False,
    )
    cliente_id = Column(String, nullable=True)
    _cliente_telefone = Column("cliente_telefone", String, nullable=False)
    tipo_movimentacao = Column(String, nullable=False)  # ACUMULO | RESGATE
    valor_delta = Column(Numeric(14, 4, asdecimal=False), nullable=False)
    comanda_id = Column(String, ForeignKey("comandas.id"), nullable=True)
    criado_em = Column(DateTime, default=lambda: datetime.datetime.now(datetime.timezone.utc))

    @hybrid_property
    def cliente_telefone(self):
        return decrypt_field(self._cliente_telefone)

    @cliente_telefone.setter
    def cliente_telefone(self, value):
        self._cliente_telefone = encrypt_field(value)

    cliente = relationship("Cliente", back_populates="historico_fidelidade")


class Cliente(Base):
    __tablename__ = "clientes"
    
    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    restaurante_id = Column(Integer, ForeignKey("restaurantes.id"), default=lambda: current_restaurante_id.get(), nullable=False)
    telefone = Column(String, nullable=False)
    nome = Column(String, nullable=False)
    endereco = Column(String, nullable=True)
    saldo_pontos = Column(Integer, default=0, nullable=False)
    saldo_cashback = Column(Numeric(14, 2, asdecimal=False), default=0.0, nullable=False)
    criado_em = Column(DateTime, default=lambda: datetime.datetime.now(datetime.timezone.utc))
    
    __table_args__ = (
        UniqueConstraint(
            'restaurante_id',
            'id',
            name='uq_clientes_restaurante_id_id',
        ),
        UniqueConstraint('restaurante_id', 'telefone', name='uq_restaurante_cliente_telefone'),
        CheckConstraint(
            "saldo_cashback >= 0",
            name="ck_clientes_cashback_nonnegative_finite",
        ),
    )

    comandas = relationship("Comanda", back_populates="cliente")
    pagamentos = relationship("Pagamento", back_populates="cliente")
    historico_fidelidade = relationship(
        "HistoricoFidelidade",
        back_populates="cliente",
    )


class Motoboy(Base):
    __tablename__ = "motoboys"
    
    id = Column(Integer, primary_key=True, index=True)
    restaurante_id = Column(Integer, ForeignKey("restaurantes.id"), default=lambda: current_restaurante_id.get(), nullable=False, index=True)
    nome = Column(String, nullable=False)
    telefone = Column(String, nullable=False)
    ativo = Column(Boolean, default=True)
    
    # Relationship to comandas
    comandas = relationship("Comanda", back_populates="motoboy")


class MotoboyTokenAtivo(Base):
    __tablename__ = "motoboy_tokens_ativos"
    
    jti = Column(String(64), primary_key=True, index=True)
    motoboy_id = Column(Integer, ForeignKey("motoboys.id"), nullable=False, index=True)
    restaurante_id = Column(Integer, ForeignKey("restaurantes.id"), default=lambda: current_restaurante_id.get(), nullable=False, index=True)
    criado_em = Column(DateTime(timezone=True), default=lambda: datetime.datetime.now(datetime.timezone.utc))
    revogado = Column(Boolean, default=False, nullable=False)

    motoboy = relationship("Motoboy")


class Distribuidor(Base):
    __tablename__ = "distribuidores"
    
    id = Column(String, primary_key=True, index=True)
    restaurante_id = Column(Integer, ForeignKey("restaurantes.id"), default=lambda: current_restaurante_id.get(), nullable=False)
    nome_fantasia = Column(String, nullable=False)
    razao_social = Column(String, nullable=True)
    cnpj = Column(String, nullable=True)
    lead_time_dias = Column(Integer, default=3)


class NotaEntrada(Base):
    __tablename__ = "notas_entrada"
    
    id = Column(String, primary_key=True, index=True)
    restaurante_id = Column(Integer, ForeignKey("restaurantes.id"), default=lambda: current_restaurante_id.get(), nullable=False)
    chave_acesso = Column(String, nullable=True)
    numero_nota = Column(String, nullable=False)
    data_emissao = Column(String, nullable=True)
    distribuidor_id = Column(String, ForeignKey("distribuidores.id"), nullable=False)
    valor_total = Column(Numeric(14, 2, asdecimal=False), default=0.0)
    
    # Relationships
    distribuidor = relationship("Distribuidor")
    itens = relationship("ItemNotaEntrada", back_populates="nota", cascade="all, delete-orphan")


class ItemNotaEntrada(Base):
    __tablename__ = "itens_nota_entrada"
    
    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    restaurante_id = Column(Integer, ForeignKey("restaurantes.id"), default=lambda: current_restaurante_id.get(), nullable=False)
    nota_id = Column(String, ForeignKey("notas_entrada.id"), nullable=False)
    insumo_id = Column(String, ForeignKey("insumos.id"), nullable=False)
    quantidade = Column(Float, nullable=False)
    preco_unitario = Column(Numeric(14, 4, asdecimal=False), nullable=False)
    
    # Relationships
    nota = relationship("NotaEntrada", back_populates="itens")
    insumo = relationship("Insumo")


class EntradaEstoque(Base):
    __tablename__ = "entradas_estoque"
    __table_args__ = (
        Index(
            "ix_entradas_estoque_distribuidor_fk",
            "distribuidor_id",
        ).ddl_if(dialect="postgresql"),
        Index(
            "ix_entradas_estoque_usuario_fk",
            "usuario_id",
        ).ddl_if(dialect="postgresql"),
    )
    
    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()), index=True)
    restaurante_id = Column(Integer, ForeignKey("restaurantes.id"), default=lambda: current_restaurante_id.get(), nullable=False, index=True)
    distribuidor_id = Column(String, ForeignKey("distribuidores.id"), nullable=True)
    numero_documento = Column(String, nullable=True)
    data_emissao = Column(String, nullable=True)
    observacao = Column(String, default="")
    valor_total = Column(Numeric(14, 2, asdecimal=False), default=0.0)
    tipo_entrada = Column(String, default="MANUAL")  # MANUAL | XML
    usuario_id = Column(String, ForeignKey("usuarios.id"), nullable=True)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.datetime.now(datetime.timezone.utc))

    # Relationships
    distribuidor = relationship("Distribuidor")
    usuario = relationship("Usuario")
    itens = relationship("ItemEntradaEstoque", back_populates="entrada", cascade="all, delete-orphan")


class ItemEntradaEstoque(Base):
    __tablename__ = "itens_entrada_estoque"
    __table_args__ = (
        Index(
            "ix_itens_entrada_entrada_fk",
            "entrada_id",
        ).ddl_if(dialect="postgresql"),
        Index(
            "ix_itens_entrada_insumo_fk",
            "insumo_id",
        ).ddl_if(dialect="postgresql"),
    )
    
    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    restaurante_id = Column(Integer, ForeignKey("restaurantes.id"), default=lambda: current_restaurante_id.get(), nullable=False, index=True)
    entrada_id = Column(String, ForeignKey("entradas_estoque.id"), nullable=False)
    insumo_id = Column(String, ForeignKey("insumos.id"), nullable=False)
    quantidade = Column(Float, nullable=False)
    unidade_medida = Column(String, default="un")
    custo_unitario = Column(Numeric(14, 4, asdecimal=False), nullable=False)
    subtotal = Column(Numeric(14, 2, asdecimal=False), nullable=False)

    # Relationships
    entrada = relationship("EntradaEstoque", back_populates="itens")
    insumo = relationship("Insumo")


class MovimentacaoEstoque(Base):
    __tablename__ = "movimentacoes_estoque"
    __table_args__ = (
        Index(
            "ix_movimentacoes_estoque_usuario_fk",
            "usuario_id",
        ).ddl_if(dialect="postgresql"),
    )
    
    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    restaurante_id = Column(Integer, ForeignKey("restaurantes.id"), default=lambda: current_restaurante_id.get(), nullable=False, index=True)
    insumo_id = Column(String, ForeignKey("insumos.id"), nullable=False, index=True)
    tipo = Column(String, nullable=False, index=True)  # entrada | saida | perda | ajuste_positivo | ajuste_negativo | contagem
    quantidade = Column(Float, nullable=False)
    saldo_anterior = Column(Float, nullable=False)
    saldo_posterior = Column(Float, nullable=False)
    custo_unitario = Column(Numeric(14, 4, asdecimal=False), default=0.0)
    motivo = Column(String, nullable=False)
    observacao = Column(String, default="")
    origem = Column(String, default="movimentacao_manual")  # entrada_manual | xml | movimentacao_manual | contagem
    referencia_id = Column(String, nullable=True)
    usuario_id = Column(String, ForeignKey("usuarios.id"), nullable=True)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.datetime.now(datetime.timezone.utc))

    # Relationships
    insumo = relationship("Insumo")
    usuario = relationship("Usuario")


class SessaoContagemEstoque(Base):
    __tablename__ = "sessoes_contagem_estoque"
    __table_args__ = (
        Index(
            "ix_sessoes_contagem_usuario_fk",
            "usuario_id",
        ).ddl_if(dialect="postgresql"),
    )
    
    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()), index=True)
    restaurante_id = Column(Integer, ForeignKey("restaurantes.id"), default=lambda: current_restaurante_id.get(), nullable=False, index=True)
    status = Column(String, default="rascunho", nullable=False, index=True)  # rascunho | confirmada
    observacao = Column(String, default="")
    usuario_id = Column(String, ForeignKey("usuarios.id"), nullable=True)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.datetime.now(datetime.timezone.utc))
    confirmada_em = Column(DateTime(timezone=True), nullable=True)

    # Relationships
    usuario = relationship("Usuario")
    itens = relationship("ItemContagemEstoque", back_populates="contagem", cascade="all, delete-orphan")


class ItemContagemEstoque(Base):
    __tablename__ = "itens_contagem_estoque"
    __table_args__ = (
        Index(
            "ix_itens_contagem_contagem_fk",
            "contagem_id",
        ).ddl_if(dialect="postgresql"),
        Index(
            "ix_itens_contagem_insumo_fk",
            "insumo_id",
        ).ddl_if(dialect="postgresql"),
    )
    
    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    restaurante_id = Column(Integer, ForeignKey("restaurantes.id"), default=lambda: current_restaurante_id.get(), nullable=False, index=True)
    contagem_id = Column(String, ForeignKey("sessoes_contagem_estoque.id"), nullable=False)
    insumo_id = Column(String, ForeignKey("insumos.id"), nullable=False)
    quantidade_sistema = Column(Float, nullable=False)
    quantidade_contada = Column(Float, nullable=False)
    diferenca = Column(Float, nullable=False)
    ajustado = Column(Boolean, default=False)

    # Relationships
    contagem = relationship("SessaoContagemEstoque", back_populates="itens")
    insumo = relationship("Insumo")


class OtpChallenge(Base):
    __tablename__ = "otp_challenges"

    id = Column(Integer, primary_key=True, autoincrement=True)
    restaurante_id = Column(
        Integer,
        ForeignKey("restaurantes.id", ondelete="CASCADE"),
        default=lambda: current_restaurante_id.get(),
        nullable=False,
        index=True,
    )
    telefone_hash = Column(String(64), nullable=False)
    otp_hash = Column(String(64), nullable=False)
    expira_em = Column(DateTime(timezone=True), nullable=False)
    tentativas = Column(Integer, nullable=False, default=0)
    ultimo_envio_em = Column(DateTime(timezone=True), nullable=False)
    janela_iniciada_em = Column(DateTime(timezone=True), nullable=False)
    envios_na_janela = Column(Integer, nullable=False, default=1)

    __table_args__ = (
        UniqueConstraint(
            "restaurante_id",
            "telefone_hash",
            name="uq_otp_challenges_restaurante_telefone",
        ),
    )


class PublicRateLimit(Base):
    __tablename__ = "public_rate_limits"

    id = Column(Integer, primary_key=True, autoincrement=True)
    restaurante_id = Column(
        Integer,
        ForeignKey("restaurantes.id", ondelete="CASCADE"),
        default=lambda: current_restaurante_id.get(),
        nullable=False,
        index=True,
    )
    scope = Column(String(50), nullable=False)
    key_hash = Column(String(64), nullable=False)
    janela_iniciada_em = Column(DateTime(timezone=True), nullable=False)
    requisicoes = Column(Integer, nullable=False, default=0)

    __table_args__ = (
        UniqueConstraint(
            "restaurante_id",
            "scope",
            "key_hash",
            name="uq_public_rate_limits_tenant_scope_key",
        ),
    )


class PrintJob(Base):
    __tablename__ = "print_jobs"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    restaurante_id = Column(Integer, ForeignKey("restaurantes.id", ondelete="CASCADE"), default=lambda: current_restaurante_id.get(), nullable=False, index=True)
    document_type = Column(String, nullable=False)  # "producao" | "fechamento" | "entrega"
    destination = Column(String, nullable=False, default="COZINHA")  # "COZINHA" | "BAR" | "FECHAMENTO" | "ENTREGA"
    source_type = Column(String, nullable=False)  # "pedido" | "comanda" | "delivery"
    source_id = Column(String, nullable=False)
    payload_text = Column(String, nullable=False)
    status = Column(String, nullable=False, default="pending", index=True)  # "pending" | "claimed" | "printing" | "printed" | "failed" | "cancelled"
    attempts = Column(Integer, nullable=False, default=0)
    idempotency_key = Column(String, nullable=False, index=True)
    agent_id = Column(String, nullable=True)
    printer_name = Column(String, nullable=True)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.datetime.now(datetime.timezone.utc))
    claimed_at = Column(DateTime(timezone=True), nullable=True)
    printed_at = Column(DateTime(timezone=True), nullable=True)
    last_error = Column(String, nullable=True)

    __table_args__ = (
        UniqueConstraint("restaurante_id", "idempotency_key", name="uq_print_jobs_restaurante_idempotency"),
        Index(
            "ix_print_jobs_tenant_pending_fifo",
            "restaurante_id",
            "created_at",
            "id",
            postgresql_where=text("status = 'pending'"),
        ),
        Index(
            "ix_print_jobs_tenant_status_created",
            "restaurante_id",
            "status",
            "created_at",
        ),
    )


class PrintAgentToken(Base):
    __tablename__ = "print_agent_tokens"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    restaurante_id = Column(Integer, ForeignKey("restaurantes.id", ondelete="CASCADE"), default=lambda: current_restaurante_id.get(), nullable=False, index=True)
    agent_id = Column(String, nullable=False)  # ex: "caixa-principal"
    token_hash = Column(String, nullable=False)  # SHA-256 hash (nunca token puro!)
    ativo = Column(Boolean, default=True, nullable=False)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.datetime.now(datetime.timezone.utc))
    last_seen_at = Column(DateTime(timezone=True), nullable=True)
    printer_diagnostics = Column(JSON, nullable=True)
    diagnostics_updated_at = Column(DateTime(timezone=True), nullable=True)
    pending_command = Column(JSON, nullable=True)
    command_requested_at = Column(DateTime(timezone=True), nullable=True)
    last_command_result = Column(JSON, nullable=True)
    command_completed_at = Column(DateTime(timezone=True), nullable=True)

    __table_args__ = (
        UniqueConstraint("restaurante_id", "agent_id", name="uq_print_agent_tokens_restaurante_agent"),
    )


class NotificacaoWhatsApp(Base):
    __tablename__ = "notificacoes_whatsapp"

    id = Column(Integer, primary_key=True, autoincrement=True, index=True)
    restaurante_id = Column(Integer, ForeignKey("restaurantes.id", ondelete="CASCADE"), default=lambda: current_restaurante_id.get(), nullable=True, index=True)
    comanda_id = Column(String(100), nullable=True, index=True)

    telefone = Column(String(20), nullable=True)
    tipo = Column(String(50), default="status_pedido", nullable=True)  # "otp", "status_pedido", "marketing"
    status_envio = Column(String(20), default="pendente", nullable=True)  # "pendente", "enviado", "entregue", "falhou"
    wamid = Column(String(255), nullable=True, index=True)
    recipient_id = Column(String(50), nullable=True)
    status = Column(String(50), nullable=True)
    error_code = Column(Integer, nullable=True)
    error_title = Column(Text, nullable=True)
    error_message = Column(Text, nullable=True)
    conteudo = Column(Text, nullable=True)
    raw_payload = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.datetime.now(datetime.timezone.utc))
    updated_at = Column(DateTime(timezone=True), default=lambda: datetime.datetime.now(datetime.timezone.utc), onupdate=lambda: datetime.datetime.now(datetime.timezone.utc))


class IntegrationOutbox(Base):
    """Tabela de Transactional Outbox para mensageria e integrações assíncronas do KÔMA."""
    __tablename__ = "integration_outbox"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    restaurante_id = Column(Integer, ForeignKey("restaurantes.id", ondelete="CASCADE"), default=lambda: current_restaurante_id.get(), nullable=False, index=True)
    event_id = Column(String(64), nullable=False, index=True)
    event_name = Column(String(64), nullable=False)  # ex: "koma.order.created", "koma.order.ready"
    aggregate_type = Column(String(32), nullable=False, default="order")
    aggregate_id = Column(String(64), nullable=False)
    payload = Column(JSON, nullable=False)
    status = Column(String(20), nullable=False, default="pending", index=True)  # "pending", "processing", "delivered", "failed", "dead_letter"
    attempts = Column(Integer, nullable=False, default=0)
    max_attempts = Column(Integer, nullable=False, default=5)
    next_retry_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.datetime.now(datetime.timezone.utc), nullable=False)
    processed_at = Column(DateTime(timezone=True), nullable=True)
    locked_at = Column(DateTime(timezone=True), nullable=True)
    locked_by = Column(String(64), nullable=True)
    last_error = Column(Text, nullable=True)
    response_status_code = Column(Integer, nullable=True)

    __table_args__ = (
        UniqueConstraint("restaurante_id", "event_id", name="uq_integration_outbox_tenant_event"),
        Index("ix_integration_outbox_dispatch_queue", "restaurante_id", "status", "next_retry_at", "created_at"),
        Index("ix_integration_outbox_processing_stale", "status", "locked_at"),
    )


class ExternalOrderReference(Base):
    """Mapeamento canônico de referências e IDs de pedidos de marketplaces externos."""
    __tablename__ = "external_order_references"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    restaurante_id = Column(Integer, ForeignKey("restaurantes.id", ondelete="CASCADE"), default=lambda: current_restaurante_id.get(), nullable=False, index=True)
    provider = Column(String(32), nullable=False)  # "ifood", "99food", "keeta", "whatsapp", "api"
    external_order_id = Column(String(128), nullable=False)
    internal_order_id = Column(String(64), nullable=False)
    raw_payload = Column(JSON, nullable=True)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.datetime.now(datetime.timezone.utc), nullable=False)

    __table_args__ = (
        UniqueConstraint("restaurante_id", "provider", "external_order_id", name="uq_external_order_ref_provider_order"),
        Index("ix_external_order_ref_internal_lookup", "restaurante_id", "internal_order_id"),
    )
