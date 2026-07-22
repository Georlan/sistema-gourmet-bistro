from sqlalchemy import Column, Integer, String, Float, Boolean, DateTime, ForeignKey, event, JSON, UniqueConstraint
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
    
    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    nome = Column(String(100), nullable=False)
    telefone = Column(String(50), unique=True, index=True, nullable=True)
    email = Column(String(100), unique=True, index=True, nullable=True)
    cargo = Column(String(20), nullable=False, default="garcom")  # 'caixa' | 'garcom' | 'gerente' | 'motoboy' | 'admin'
    restaurante_id = Column(Integer, ForeignKey("restaurantes.id", ondelete="CASCADE"), default=lambda: current_restaurante_id.get(), nullable=True)
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
        UniqueConstraint('restaurante_id', 'nome', name='uq_categorias_restaurante_nome'),
    )
    
    id = Column(String, primary_key=True, index=True)  # ex: "cat-hamburgueres-bovinos"
    restaurante_id = Column(Integer, ForeignKey("restaurantes.id"), default=lambda: current_restaurante_id.get(), nullable=False)
    nome = Column(String, nullable=False)
    destino_impressao = Column(String, default="COZINHA")  # "COZINHA" | "BAR" | "NENHUM"
    
    # Relationships
    produtos = relationship("Produto", back_populates="categoria")
    observacoes_predefinidas = relationship("ObservacaoPredefinida", back_populates="categoria")


class Produto(Base):
    __tablename__ = "produtos"
    
    id = Column(String, primary_key=True, index=True)
    restaurante_id = Column(Integer, ForeignKey("restaurantes.id"), default=lambda: current_restaurante_id.get(), nullable=False)
    nome = Column(String, nullable=False)
    categoria_id = Column(String, ForeignKey("categorias.id"), nullable=False)
    preco = Column(Float, nullable=False)
    descricao = Column(String, default="")
    imagem = Column(String, default="")
    ativo = Column(Boolean, default=True)  # Toggle product availability
    
    # Relationships
    categoria = relationship("Categoria", back_populates="produtos")


class Mesa(Base):
    __tablename__ = "mesas"
    
    id = Column(Integer, primary_key=True, index=True)  # Fixed ID: 1, 2, 3...
    restaurante_id = Column(Integer, ForeignKey("restaurantes.id"), default=lambda: current_restaurante_id.get(), nullable=False)
    capacidade = Column(Integer, nullable=False, default=4)
    nome = Column(String, nullable=True)  # Editable custom name (e.g. "Mesa VIP", "Varanda 1")


class ObservacaoPredefinida(Base):
    __tablename__ = "observacoes_predefinidas"
    
    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    restaurante_id = Column(Integer, ForeignKey("restaurantes.id"), default=lambda: current_restaurante_id.get(), nullable=False, index=True)
    categoria_id = Column(String, ForeignKey("categorias.id"), nullable=False)
    texto = Column(String, nullable=False)  # e.g., "Sem cebola", "Sem cheddar", "Pra viagem"
    
    # Relationships
    categoria = relationship("Categoria", back_populates="observacoes_predefinidas")


class Comanda(Base):
    __tablename__ = "comandas"
    
    id = Column(String, primary_key=True, index=True)
    restaurante_id = Column(Integer, ForeignKey("restaurantes.id"), default=lambda: current_restaurante_id.get(), nullable=False, index=True)
    mesa_id = Column(Integer, ForeignKey("mesas.id"), nullable=True, index=True)
    mesa_origem_id = Column(Integer, nullable=True)
    mesa_transferida_de = Column(Integer, nullable=True)
    garcom_id = Column(String, ForeignKey("usuarios.id"), nullable=False)
    
    tipo = Column(String, default="Consumo no Local")  # Consumo no Local | Retirada
    _identificador = Column("identificador", String, nullable=True)  # Client name encrypted
    numero_pedido = Column(Integer, nullable=False)  # Global sequential order number (shared when splitting)

    @hybrid_property
    def identificador(self):
        return decrypt_field(self._identificador)

    @identificador.setter
    def identificador(self, value):
        self._identificador = encrypt_field(value)
    
    fechada = Column(Boolean, default=False, index=True)
    criado_em = Column(DateTime, default=lambda: datetime.datetime.now(datetime.timezone.utc))
    fechado_em = Column(DateTime, nullable=True)
    valor_pago = Column(Float, default=0.0, nullable=False)  # Sum of generic partial payments made
    
    # Delivery operational fields
    delivery_status = Column(String, nullable=True)  # pendente | producao | pronto | transito | finalizado
    delivery_taxa = Column(Float, default=0.0)
    _delivery_telefone = Column("delivery_telefone", String, nullable=True)
    _delivery_endereco = Column("delivery_endereco", String, nullable=True)
    motoboy_id = Column(Integer, ForeignKey("motoboys.id"), nullable=True)

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


class Lancamento(Base):
    __tablename__ = "lancamentos"
    
    id = Column(String, primary_key=True, index=True)
    comanda_id = Column(String, ForeignKey("comandas.id"), nullable=False)
    garcom_id = Column(String, ForeignKey("usuarios.id"), nullable=False)
    timestamp = Column(DateTime, default=lambda: datetime.datetime.now(datetime.timezone.utc))
    
    # Relationships
    comanda = relationship("Comanda", back_populates="lancamentos")
    garcom = relationship("Usuario", back_populates="lancamentos_feitos")
    itens = relationship("Item", back_populates="lancamento", cascade="all, delete-orphan")


class Item(Base):
    __tablename__ = "itens"
    
    id = Column(String, primary_key=True, index=True)
    restaurante_id = Column(Integer, ForeignKey("restaurantes.id"), default=lambda: current_restaurante_id.get(), nullable=False, index=True)
    comanda_id = Column(String, ForeignKey("comandas.id"), nullable=False, index=True)
    lancamento_id = Column(String, ForeignKey("lancamentos.id"), nullable=False, index=True)
    produto_id = Column(String, ForeignKey("produtos.id"), nullable=False)
    
    preco_unit = Column(Float, nullable=False)  # Snapshot of price at order time
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
    
    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    restaurante_id = Column(Integer, ForeignKey("restaurantes.id"), default=lambda: current_restaurante_id.get(), nullable=False, index=True)
    aberto_por_id = Column(String, ForeignKey("usuarios.id"), nullable=False)
    aberto_em = Column(DateTime, default=lambda: datetime.datetime.now(datetime.timezone.utc))
    fechado_em = Column(DateTime, nullable=True)
    fechado_por_id = Column(String, ForeignKey("usuarios.id"), nullable=True)
    
    saldo_inicial = Column(Float, nullable=False)
    declarado_dinheiro = Column(Float, nullable=True)
    declarado_pix = Column(Float, nullable=True)
    declarado_cartao = Column(Float, nullable=True)
    observacao = Column(String, default="")
    status = Column(String, default="aberto", index=True)  # "aberto" | "fechado"

    aberto_por = relationship("Usuario", foreign_keys=[aberto_por_id])
    fechado_por = relationship("Usuario", foreign_keys=[fechado_por_id])


class CaixaMovimentacao(Base):
    __tablename__ = "caixa_movimentacoes"
    
    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    restaurante_id = Column(Integer, ForeignKey("restaurantes.id"), default=lambda: current_restaurante_id.get(), nullable=False, index=True)
    turno_id = Column(Integer, ForeignKey("caixa_turnos.id"), nullable=False, index=True)
    usuario_id = Column(String, ForeignKey("usuarios.id"), nullable=True)
    tipo = Column(String, nullable=False)  # "suprimento" | "sangria"
    valor = Column(Float, nullable=False)
    saldo_anterior = Column(Float, default=0.0)
    saldo_posterior = Column(Float, default=0.0)
    descricao = Column(String, default="")
    observacao = Column(String, default="")
    criado_em = Column(DateTime, default=lambda: datetime.datetime.now(datetime.timezone.utc))

    turno = relationship("CaixaTurno")
    usuario = relationship("Usuario", foreign_keys=[usuario_id])


class Pagamento(Base):
    __tablename__ = "pagamentos"
    
    id = Column(String, primary_key=True, index=True)
    restaurante_id = Column(Integer, ForeignKey("restaurantes.id"), default=lambda: current_restaurante_id.get(), nullable=False)
    comanda_id = Column(String, ForeignKey("comandas.id"), nullable=False, index=True)
    turno_id = Column(Integer, ForeignKey("caixa_turnos.id"), nullable=False)
    valor = Column(Float, nullable=False)
    metodo = Column(String, nullable=False)  # "dinheiro" | "pix" | "cartao"
    status = Column(String, default="aprovado") # "pendente" | "aprovado" | "cancelado"
    idempotency_key = Column(String, unique=True, nullable=True, index=True)
    cpf_cliente = Column(String, nullable=True, index=True)
    nome_cliente = Column(String, nullable=True)
    nsu_cartao = Column(String, nullable=True)
    chave_nfe_emitida = Column(String, nullable=True)
    criado_em = Column(DateTime, default=lambda: datetime.datetime.now(datetime.timezone.utc))

    # Relationships
    comanda = relationship("Comanda")

# Alias compatibility
Garcom = Usuario


class ConfiguracaoRestaurante(Base):
    __tablename__ = "configuracoes_restaurante"
    
    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    restaurante_id = Column(Integer, ForeignKey("restaurantes.id"), default=lambda: current_restaurante_id.get(), nullable=False)
    nicho = Column(String, default="hamburgueria")  # "hamburgueria" | "pizzaria" | "doceria" | "alacarte" | "selfservice"
    mapa_mesas_ativo = Column(Boolean, default=True)
    delivery_ativo = Column(Boolean, default=True)
    taxa_servico_ativa = Column(Boolean, default=True)
    taxa_servico_padrao = Column(Float, default=10.0)
    meta_mensal = Column(Float, default=0.0)
    unificar_vias_delivery = Column(Boolean, default=False)
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

    restaurante = relationship("Restaurante", lazy="joined")

    @property
    def plano(self):
        return self.restaurante.plano if self.restaurante else "pocket"


class ConfiguracaoIA(Base):
    __tablename__ = "configuracoes_ia"
    
    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    permitir_descontos = Column(Boolean, default=False)
    desconto_maximo = Column(Float, default=10.0)
    permitir_upsell = Column(Boolean, default=True)
    tom_de_voz = Column(String, default="direto")  # "direto" | "conversador"
    teto_interacoes = Column(Integer, default=5)


class MensagemWhatsApp(Base):
    __tablename__ = "mensagens_whatsapp"
    
    id = Column(String, primary_key=True, index=True)
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
    nome = Column(String, nullable=False)
    min_selecoes = Column(Integer, default=0)
    max_selecoes = Column(Integer, default=1)
    tipo = Column(String, default="obrigatorio")  # "obrigatorio" | "opcional" | "meio_a_meio"


class OpcaoModificador(Base):
    __tablename__ = "opcao_modificadores"
    
    id = Column(String, primary_key=True, index=True)
    grupo_id = Column(String, ForeignKey("grupo_modificadores.id"), nullable=False)
    nome = Column(String, nullable=False)
    preco_adicional = Column(Float, default=0.0)
    ativo = Column(Boolean, default=True)


class ProdutoGrupoModificador(Base):
    __tablename__ = "produto_grupo_modificadores"
    
    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    produto_id = Column(String, ForeignKey("produtos.id"), nullable=False)
    grupo_id = Column(String, ForeignKey("grupo_modificadores.id"), nullable=False)


class ItemModificador(Base):
    __tablename__ = "item_modificadores"
    
    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    item_id = Column(String, ForeignKey("itens.id"), nullable=False)
    opcao_modificador_id = Column(String, ForeignKey("opcao_modificadores.id"), nullable=False)
    preco_aplicado = Column(Float, nullable=False)


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
    preco_medio_custo = Column(Float, default=0.0)


class ConfigFidelizacao(Base):
    __tablename__ = "config_fidelizacao"
    
    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    ativo = Column(Boolean, default=False)
    tipo_recompensa = Column(String, default="PONTOS")  # PONTOS | CASHBACK
    taxa_conversao = Column(Float, default=1.0)  # R$ 1 = X points or X% cashback
    valor_ponto_em_dinheiro = Column(Float, default=0.05)  # 1 point = R$ 0.05 discount


class HistoricoFidelidade(Base):
    __tablename__ = "historico_fidelidade"
    
    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    _cliente_telefone = Column("cliente_telefone", String, nullable=False)
    tipo_movimentacao = Column(String, nullable=False)  # ACUMULO | RESGATE
    valor_delta = Column(Float, nullable=False)
    comanda_id = Column(String, ForeignKey("comandas.id"), nullable=True)
    criado_em = Column(DateTime, default=lambda: datetime.datetime.now(datetime.timezone.utc))

    @hybrid_property
    def cliente_telefone(self):
        return decrypt_field(self._cliente_telefone)

    @cliente_telefone.setter
    def cliente_telefone(self, value):
        self._cliente_telefone = encrypt_field(value)


class Cliente(Base):
    __tablename__ = "clientes"
    
    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    restaurante_id = Column(Integer, ForeignKey("restaurantes.id"), default=lambda: current_restaurante_id.get(), nullable=False)
    telefone = Column(String, nullable=False)
    nome = Column(String, nullable=False)
    endereco = Column(String, nullable=True)
    saldo_pontos = Column(Integer, default=0, nullable=False)
    saldo_cashback = Column(Float, default=0.0, nullable=False)
    criado_em = Column(DateTime, default=lambda: datetime.datetime.now(datetime.timezone.utc))
    
    __table_args__ = (
        UniqueConstraint('restaurante_id', 'telefone', name='uq_restaurante_cliente_telefone'),
    )


class Motoboy(Base):
    __tablename__ = "motoboys"
    
    id = Column(Integer, primary_key=True, index=True)
    nome = Column(String, nullable=False)
    telefone = Column(String, nullable=False)
    ativo = Column(Boolean, default=True)
    
    # Relationship to comandas
    comandas = relationship("Comanda", back_populates="motoboy")


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
    valor_total = Column(Float, default=0.0)
    
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
    preco_unitario = Column(Float, nullable=False)
    
    # Relationships
    nota = relationship("NotaEntrada", back_populates="itens")
    insumo = relationship("Insumo")


class EntradaEstoque(Base):
    __tablename__ = "entradas_estoque"
    
    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()), index=True)
    restaurante_id = Column(Integer, ForeignKey("restaurantes.id"), default=lambda: current_restaurante_id.get(), nullable=False, index=True)
    distribuidor_id = Column(String, ForeignKey("distribuidores.id"), nullable=True)
    numero_documento = Column(String, nullable=True)
    data_emissao = Column(String, nullable=True)
    observacao = Column(String, default="")
    valor_total = Column(Float, default=0.0)
    tipo_entrada = Column(String, default="MANUAL")  # MANUAL | XML
    usuario_id = Column(String, ForeignKey("usuarios.id"), nullable=True)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.datetime.now(datetime.timezone.utc))

    # Relationships
    distribuidor = relationship("Distribuidor")
    usuario = relationship("Usuario")
    itens = relationship("ItemEntradaEstoque", back_populates="entrada", cascade="all, delete-orphan")


class ItemEntradaEstoque(Base):
    __tablename__ = "itens_entrada_estoque"
    
    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    restaurante_id = Column(Integer, ForeignKey("restaurantes.id"), default=lambda: current_restaurante_id.get(), nullable=False, index=True)
    entrada_id = Column(String, ForeignKey("entradas_estoque.id"), nullable=False)
    insumo_id = Column(String, ForeignKey("insumos.id"), nullable=False)
    quantidade = Column(Float, nullable=False)
    unidade_medida = Column(String, default="un")
    custo_unitario = Column(Float, nullable=False)
    subtotal = Column(Float, nullable=False)

    # Relationships
    entrada = relationship("EntradaEstoque", back_populates="itens")
    insumo = relationship("Insumo")


class MovimentacaoEstoque(Base):
    __tablename__ = "movimentacoes_estoque"
    
    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    restaurante_id = Column(Integer, ForeignKey("restaurantes.id"), default=lambda: current_restaurante_id.get(), nullable=False, index=True)
    insumo_id = Column(String, ForeignKey("insumos.id"), nullable=False, index=True)
    tipo = Column(String, nullable=False, index=True)  # entrada | saida | perda | ajuste_positivo | ajuste_negativo | contagem
    quantidade = Column(Float, nullable=False)
    saldo_anterior = Column(Float, nullable=False)
    saldo_posterior = Column(Float, nullable=False)
    custo_unitario = Column(Float, default=0.0)
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


class PrintJob(Base):
    __tablename__ = "print_jobs"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    restaurante_id = Column(Integer, ForeignKey("restaurantes.id"), default=lambda: current_restaurante_id.get(), nullable=False, index=True)
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
    )


class PrintAgentToken(Base):
    __tablename__ = "print_agent_tokens"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    restaurante_id = Column(Integer, ForeignKey("restaurantes.id"), default=lambda: current_restaurante_id.get(), nullable=False, index=True)
    agent_id = Column(String, nullable=False)  # ex: "caixa-principal"
    token_hash = Column(String, nullable=False)  # SHA-256 hash (nunca token puro!)
    ativo = Column(Boolean, default=True, nullable=False)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.datetime.now(datetime.timezone.utc))
    last_seen_at = Column(DateTime(timezone=True), nullable=True)

    __table_args__ = (
        UniqueConstraint("restaurante_id", "agent_id", name="uq_print_agent_tokens_restaurante_agent"),
    )
