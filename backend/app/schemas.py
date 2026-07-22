from pydantic import BaseModel, ConfigDict, field_validator
from typing import List, Optional, Union, Any
from datetime import datetime
import uuid

# ----------------- AUTHENTICATION -----------------
class LoginRequest(BaseModel):
    username: str
    password: str

class UsuarioResponse(BaseModel):
    id: str
    nome: str
    telefone: Optional[str] = None
    email: Optional[str] = None
    cargo: Optional[str] = "garcom"
    restaurante_id: Optional[int] = None
    status: Optional[str] = "pendente_ativacao"
    created_at: Optional[datetime] = None
    usuario: Optional[str] = None
    role: Optional[str] = None
    token_convite: Optional[Union[str, Any]] = None

    @field_validator('token_convite', mode='before')
    @classmethod
    def convert_uuid_to_str(cls, v):
        if v is not None:
            return str(v)
        return v

    model_config = ConfigDict(from_attributes=True)

class UsuarioCreate(BaseModel):
    nome: str
    telefone: Optional[str] = None
    email: Optional[str] = None
    cargo: Optional[str] = "garcom"
    restaurante_id: Optional[int] = None
    usuario: Optional[str] = None
    senha: Optional[str] = None
    role: Optional[str] = "garcom"

class LoginResponse(BaseModel):
    access_token: str
    token_type: str
    garcom: UsuarioResponse
    usuario: UsuarioResponse

class AtivarContaRequest(BaseModel):
    token_convite: str
    email: str
    senha: str


# ----------------- CATEGORY & OBSERVATION -----------------
class CategoriaResponse(BaseModel):
    id: str
    nome: str
    destino_impressao: str

    model_config = ConfigDict(from_attributes=True)

class ObservacaoPredefinidaResponse(BaseModel):
    id: int
    categoria_id: str
    texto: str

    model_config = ConfigDict(from_attributes=True)


# ----------------- PRODUCT -----------------
class ProdutoBase(BaseModel):
    id: str
    nome: str
    categoria_id: str
    preco: float
    descricao: str = ""
    imagem: str = ""
    ativo: bool = True

class ProdutoCreate(ProdutoBase):
    pass

class ProdutoUpdate(BaseModel):
    nome: Optional[str] = None
    categoria_id: Optional[str] = None
    preco: Optional[float] = None
    descricao: Optional[str] = None
    imagem: Optional[str] = None
    ativo: Optional[bool] = None

class ProdutoResponse(ProdutoBase):
    categoria: Optional[CategoriaResponse] = None
    model_config = ConfigDict(from_attributes=True)

# Lightweight nested schemas (used inside Item/Comanda to avoid circular imports)
class ProdutoSimples(BaseModel):
    id: str
    nome: str
    preco: float
    ativo: bool = True
    model_config = ConfigDict(from_attributes=True)

class UsuarioSimples(BaseModel):
    id: str
    nome: str
    role: str
    model_config = ConfigDict(from_attributes=True)


# ----------------- MESA (TABLE) -----------------
class MesaBase(BaseModel):
    id: int
    capacidade: int
    nome: Optional[str] = None

class MesaCreate(BaseModel):
    id: int
    capacidade: int
    nome: Optional[str] = None

class MesaUpdate(BaseModel):
    nome: Optional[str] = None
    capacidade: Optional[int] = None

class MesaResponse(MesaBase):
    model_config = ConfigDict(from_attributes=True)


# ----------------- ITEM -----------------
class ItemUpdate(BaseModel):
    observacao: Optional[str] = None
    cliente_nome: Optional[str] = None
    quantidade_adicional: Optional[int] = None

class ItemResponse(BaseModel):
    id: str
    comanda_id: str
    lancamento_id: str
    produto_id: str
    preco_unit: float
    observacao: str
    cliente_nome: str
    status: str
    cancelado_por: Optional[str] = None
    impresso_em: Optional[datetime] = None
    pago: bool
    # Nested: produto name for display (populated via SQLAlchemy relationship)
    produto: Optional[ProdutoSimples] = None

    model_config = ConfigDict(from_attributes=True)


# ----------------- COMANDA -----------------
class ComandaResponse(BaseModel):
    id: str
    mesa_id: Optional[int] = None
    mesa_origem_id: Optional[int] = None
    mesa_transferida_de: Optional[int] = None
    garcom_id: str
    tipo: str
    identificador: Optional[str] = None
    numero_pedido: int
    fechada: bool
    criado_em: datetime
    fechado_em: Optional[datetime] = None
    valor_pago: float
    
    # Delivery attributes
    delivery_status: Optional[str] = None
    delivery_telefone: Optional[str] = None
    delivery_endereco: Optional[str] = None
    delivery_taxa: float = 0.0
    motoboy_id: Optional[int] = None

    # Cashier flow
    status_comanda: Optional[str] = None  # null | aguardando_pagamento

    model_config = ConfigDict(from_attributes=True)


# ----------------- ACTIONS & CREATIONS -----------------
class ComandaCreate(BaseModel):
    mesa_id: Optional[int] = None
    garcom_id: str
    tipo: str = "Consumo no Local"
    identificador: Optional[str] = None
    delivery_status: Optional[str] = None
    delivery_telefone: Optional[str] = None
    delivery_endereco: Optional[str] = None
    delivery_taxa: float = 0.0
    motoboy_id: Optional[int] = None

class ItemCreate(BaseModel):
    produto_id: str
    observacao: str = ""
    cliente_nome: str = "Consumo Geral"

class VendaDiretaItemSchema(BaseModel):
    produto_id: str
    observacao: Optional[str] = None
    cliente_nome: Optional[str] = None

class VendaDiretaCreate(BaseModel):
    mesa_id: Optional[int] = None
    garcom_id: Optional[str] = None
    tipo: str = "Retirada"
    identificador: Optional[str] = None
    delivery_status: Optional[str] = None
    delivery_telefone: Optional[str] = None
    delivery_endereco: Optional[str] = None
    delivery_taxa: float = 0.0
    itens: List[VendaDiretaItemSchema]

class LancamentoCreate(BaseModel):
    garcom_id: str
    itens: List[ItemCreate]

class LancamentoResponse(BaseModel):
    id: str
    comanda_id: str
    garcom_id: str
    timestamp: datetime
    itens: List[ItemResponse] = []
    dispensado_impressao: Optional[bool] = False

    model_config = ConfigDict(from_attributes=True)

class ComandaDetail(ComandaResponse):
    itens: List[ItemResponse] = []
    lancamentos: List[LancamentoResponse] = []
    # Nested: garcom name (populated via SQLAlchemy relationship)
    criada_por: Optional[UsuarioSimples] = None


# ----------------- CAIXA (CASHIER SHIFT & PAYMENTS) -----------------
class CaixaTurnoCreate(BaseModel):
    saldo_inicial: float

class CaixaTurnoFechar(BaseModel):
    declarado_dinheiro: float
    declarado_pix: float
    declarado_cartao: float

class CaixaTurnoResponse(BaseModel):
    id: int
    aberto_por_id: str
    aberto_em: datetime
    fechado_em: Optional[datetime] = None
    fechado_por_id: Optional[str] = None
    saldo_inicial: float
    declarado_dinheiro: Optional[float] = None
    declarado_pix: Optional[float] = None
    declarado_cartao: Optional[float] = None
    status: str

    model_config = ConfigDict(from_attributes=True)

class CaixaMovimentacaoCreate(BaseModel):
    tipo: str  # "suprimento" | "sangria"
    valor: float
    descricao: str = ""
    motivo: Optional[str] = None
    observacao: Optional[str] = None

class SangriaCreate(BaseModel):
    valor: float
    motivo: Optional[str] = None
    observacao: Optional[str] = None

class SuprimentoCreate(BaseModel):
    valor: float
    motivo: Optional[str] = None
    observacao: Optional[str] = None

class CaixaMovimentacaoResponse(BaseModel):
    id: int
    turno_id: int
    usuario_id: Optional[str] = None
    usuario_nome: Optional[str] = None
    tipo: str
    valor: float
    saldo_anterior: float = 0.0
    saldo_posterior: float = 0.0
    descricao: str = ""
    observacao: str = ""
    criado_em: datetime

    model_config = ConfigDict(from_attributes=True)

class CaixaTurnoResumoResponse(BaseModel):
    turno_id: Optional[int] = None
    status: str
    operador_id: Optional[str] = None
    operador_nome: Optional[str] = None
    aberto_em: Optional[datetime] = None
    tempo_aberto_minutos: int = 0
    saldo_inicial: float = 0.0
    total_vendas: float = 0.0
    total_dinheiro: float = 0.0
    total_pix: float = 0.0
    total_cartao: float = 0.0
    total_sangrias: float = 0.0
    total_suprimentos: float = 0.0
    saldo_esperado_dinheiro: float = 0.0
    total_pedidos_pagos: int = 0
    ultima_movimentacao: Optional[dict] = None
    resumo_dia: Optional[dict] = None

class FechamentoCaixaRequest(BaseModel):
    declarado_dinheiro: float
    declarado_cartao: float = 0.0
    declarado_pix: float = 0.0
    observacao: str = ""

class FechamentoCaixaResponse(BaseModel):
    turno_id: int
    status: str
    fechado_em: datetime
    fechado_por_nome: str
    declarado_dinheiro: float
    esperado_dinheiro: float
    diferenca_dinheiro: float
    declarado_cartao: float
    esperado_cartao: float
    diferenca_cartao: float
    declarado_pix: float
    esperado_pix: float
    diferenca_pix: float
    total_declarado: float
    total_esperado: float
    diferenca_total: float

class PagamentoRequest(BaseModel):
    valor: float
    metodo: str  # "dinheiro" | "pix" | "cartao"
    item_ids: Optional[List[str]] = None  # Specific item IDs to settle if paying by item
    idempotency_key: Optional[str] = None
    cpf_cliente: Optional[str] = None
    nome_cliente: Optional[str] = None

class PagamentoResponse(BaseModel):
    id: str
    comanda_id: str
    turno_id: int
    valor: float
    metodo: str
    status: str
    idempotency_key: Optional[str] = None
    cpf_cliente: Optional[str] = None
    nome_cliente: Optional[str] = None
    nsu_cartao: Optional[str] = None
    chave_nfe_emitida: Optional[str] = None
    criado_em: datetime

    model_config = ConfigDict(from_attributes=True)

class CaixaTurnoDetalhe(CaixaTurnoResponse):
    movimentacoes: List[CaixaMovimentacaoResponse] = []
    pagamentos: List[PagamentoResponse] = []
    total_esperado_dinheiro: float = 0.0
    total_esperado_pix: float = 0.0
    total_esperado_cartao: float = 0.0


# ----------------- WHITE-LABEL & HYBRID IA -----------------
class ConfiguracaoRestauranteResponse(BaseModel):
    id: int
    nicho: str
    mapa_mesas_ativo: bool
    delivery_ativo: bool
    taxa_servico_ativa: bool
    taxa_servico_padrao: float
    unificar_vias_delivery: bool
    modo_exclusivo_salao: bool
    perm_garcom_delivery: bool
    perm_garcom_editar: bool
    perm_garcom_taxas: bool
    perm_garcom_cancelar: bool
    perm_garcom_status: bool
    perm_garcom_abrir_vazia: bool
    perm_garcom_print: bool
    perm_garcom_fechar: bool
    perm_garcom_desconto: bool
    perm_garcom_acrescimo: bool
    perm_garcom_pessoas: bool
    perm_garcom_transferir_mesa: bool
    perm_garcom_transferir_item: bool
    perm_garcom_chamar: bool
    perm_garcom_ociosas: bool
    plano: Optional[str] = "pocket"

    model_config = ConfigDict(from_attributes=True)


class ConfiguracaoRestauranteUpdate(BaseModel):
    nicho: Optional[str] = None
    plano: Optional[str] = None
    mapa_mesas_ativo: Optional[bool] = None
    delivery_ativo: Optional[bool] = None
    taxa_servico_ativa: Optional[bool] = None
    taxa_servico_padrao: Optional[float] = None
    unificar_vias_delivery: Optional[bool] = None
    modo_exclusivo_salao: Optional[bool] = None
    perm_garcom_delivery: Optional[bool] = None
    perm_garcom_editar: Optional[bool] = None
    perm_garcom_taxas: Optional[bool] = None
    perm_garcom_cancelar: Optional[bool] = None
    perm_garcom_status: Optional[bool] = None
    perm_garcom_abrir_vazia: Optional[bool] = None
    perm_garcom_print: Optional[bool] = None
    perm_garcom_fechar: Optional[bool] = None
    perm_garcom_desconto: Optional[bool] = None
    perm_garcom_acrescimo: Optional[bool] = None
    perm_garcom_pessoas: Optional[bool] = None
    perm_garcom_transferir_mesa: Optional[bool] = None
    perm_garcom_transferir_item: Optional[bool] = None
    perm_garcom_chamar: Optional[bool] = None
    perm_garcom_ociosas: Optional[bool] = None


class ConfiguracaoIAResponse(BaseModel):
    id: int
    permitir_descontos: bool
    desconto_maximo: float
    permitir_upsell: bool
    tom_de_voz: str
    teto_interacoes: int

    model_config = ConfigDict(from_attributes=True)


class MensagemWhatsAppResponse(BaseModel):
    id: str
    cliente_telefone: str
    remetente: str
    conteudo: str
    transcricao: Optional[str] = None
    audio_url: Optional[str] = None
    criado_em: datetime

    model_config = ConfigDict(from_attributes=True)


class RascunhoPedidoResponse(BaseModel):
    id: str
    cliente_telefone: str
    conteudo_json: str
    ia_sugestao_resposta: Optional[str] = None
    status: str
    criado_em: datetime

    model_config = ConfigDict(from_attributes=True)


class InsumoResponse(BaseModel):
    id: str
    nome: str
    estoque_atual: float
    estoque_minimo: float
    estoque_maximo: float
    unidade_medida: str
    preco_medio_custo: float

    model_config = ConfigDict(from_attributes=True)


class ConfigFidelizacaoResponse(BaseModel):
    id: int
    ativo: bool
    tipo_recompensa: str
    taxa_conversao: float
    valor_ponto_em_dinheiro: float

    model_config = ConfigDict(from_attributes=True)


class HistoricoFidelidadeResponse(BaseModel):
    id: int
    cliente_telefone: str
    tipo_movimentacao: str
    valor_delta: float
    comanda_id: Optional[str] = None
    criado_em: datetime

    model_config = ConfigDict(from_attributes=True)


class MotoboyCreate(BaseModel):
    nome: str
    telefone: str
    ativo: Optional[bool] = True


class MotoboyResponse(BaseModel):
    id: int
    nome: str
    telefone: str
    ativo: bool

    model_config = ConfigDict(from_attributes=True)


class DistribuidorResponse(BaseModel):
    id: str
    nome_fantasia: str
    razao_social: Optional[str] = None
    cnpj: Optional[str] = None
    lead_time_dias: int

    model_config = ConfigDict(from_attributes=True)


class ItemNotaEntradaResponse(BaseModel):
    id: int
    nota_id: str
    insumo_id: str
    quantidade: float
    preco_unitario: float
    insumo: Optional[InsumoResponse] = None

    model_config = ConfigDict(from_attributes=True)


class NotaEntradaResponse(BaseModel):
    id: str
    chave_acesso: Optional[str] = None
    numero_nota: str
    data_emissao: Optional[str] = None
    distribuidor_id: str
    valor_total: float
    distribuidor: Optional[DistribuidorResponse] = None
    itens: Optional[list[ItemNotaEntradaResponse]] = None

    model_config = ConfigDict(from_attributes=True)


# ─── SCHEMAS EXPANDIDOS DE ESTOQUE ───────────────────────────────────────────
class ItemEntradaEstoqueCreate(BaseModel):
    insumo_id: str
    insumo_nome: Optional[str] = None
    quantidade: float
    unidade_medida: str = "un"
    custo_unitario: float

class EntradaEstoqueManualCreate(BaseModel):
    distribuidor_id: Optional[str] = None
    distribuidor_nome_fantasia: Optional[str] = None
    distribuidor_cnpj: Optional[str] = None
    numero_documento: Optional[str] = None
    data_emissao: Optional[str] = None
    observacao: str = ""
    itens: list[ItemEntradaEstoqueCreate]

class ItemEntradaEstoqueResponse(BaseModel):
    id: int
    entrada_id: str
    insumo_id: str
    quantidade: float
    unidade_medida: str
    custo_unitario: float
    subtotal: float
    insumo: Optional[InsumoResponse] = None

    model_config = ConfigDict(from_attributes=True)

class EntradaEstoqueResponse(BaseModel):
    id: str
    numero_documento: Optional[str] = None
    data_emissao: Optional[str] = None
    observacao: str
    valor_total: float
    tipo_entrada: str
    distribuidor_id: Optional[str] = None
    distribuidor: Optional[DistribuidorResponse] = None
    created_at: datetime
    itens: list[ItemEntradaEstoqueResponse] = []

    model_config = ConfigDict(from_attributes=True)

class MovimentacaoEstoqueCreate(BaseModel):
    insumo_id: str
    tipo: str  # perda | ajuste_positivo | ajuste_negativo
    quantidade: float
    motivo: str
    observacao: str = ""

class MovimentacaoEstoqueResponse(BaseModel):
    id: int
    insumo_id: str
    tipo: str
    quantidade: float
    saldo_anterior: float
    saldo_posterior: float
    custo_unitario: float
    motivo: str
    observacao: str
    origem: str
    referencia_id: Optional[str] = None
    usuario_id: Optional[str] = None
    created_at: datetime
    insumo: Optional[InsumoResponse] = None

    model_config = ConfigDict(from_attributes=True)

class ItemContagemEstoqueCreate(BaseModel):
    insumo_id: str
    quantidade_contada: float

class SessaoContagemEstoqueCreate(BaseModel):
    observacao: str = ""
    status: str = "rascunho"  # rascunho | confirmada
    itens: list[ItemContagemEstoqueCreate]

class ItemContagemEstoqueResponse(BaseModel):
    id: int
    contagem_id: str
    insumo_id: str
    quantidade_sistema: float
    quantidade_contada: float
    diferenca: float
    ajustado: bool
    insumo: Optional[InsumoResponse] = None

    model_config = ConfigDict(from_attributes=True)

class SessaoContagemEstoqueResponse(BaseModel):
    id: str
    status: str
    observacao: str
    usuario_id: Optional[str] = None
    created_at: datetime
    confirmada_em: Optional[datetime] = None
    itens: list[ItemContagemEstoqueResponse] = []

    model_config = ConfigDict(from_attributes=True)


# ----------------- CONFIGURAÇÕES WHITELABEL DO RESTAURANTE -----------------
class RestauranteConfigResponse(BaseModel):
    id: int
    nome: str
    slug: Optional[str] = None
    logo_url: Optional[str] = None
    banner_url: Optional[str] = None
    cardapio_logo_path: Optional[str] = None
    cardapio_banner_path: Optional[str] = None
    subtitulo: Optional[str] = None
    sobre_nos: Optional[str] = None
    endereco: Optional[str] = None
    google_maps_url: Optional[str] = None
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    status_override: Optional[str] = "Automático"
    socials: Optional[Any] = None
    horarios_funcionamento: Optional[Any] = None
    formas_pagamento_aceitas: Optional[Any] = None
    cor_primaria: Optional[str] = "#00b894"
    cor_fundo: Optional[str] = "#090a0f"

    model_config = ConfigDict(from_attributes=True)

class RestauranteConfigUpdate(BaseModel):
    nome: Optional[str] = None
    slug: Optional[str] = None
    logo_url: Optional[str] = None
    banner_url: Optional[str] = None
    subtitulo: Optional[str] = None
    sobre_nos: Optional[str] = None
    endereco: Optional[str] = None
    google_maps_url: Optional[str] = None
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    status_override: Optional[str] = None
    socials: Optional[Any] = None
    horarios_funcionamento: Optional[Any] = None
    formas_pagamento_aceitas: Optional[Any] = None
    cor_primaria: Optional[str] = None
    cor_fundo: Optional[str] = None


# ----------------- PEDIDOS CARDAPIO DIGITAL -----------------
class CardapioItemPedido(BaseModel):
    produto_id: str
    quantidade: int
    observacao: Optional[str] = ""
    cliente_nome: Optional[str] = "Cliente Online"

class CardapioPedidoCreate(BaseModel):
    restaurante_id: int
    itens: List[CardapioItemPedido]
    cliente_nome: str
    cliente_telefone: str
    endereco_entrega: str
    taxa_entrega: float = 0.0
    forma_pagamento: str  # Pix | Cartão na Entrega | Dinheiro
    tipo_pedido: str = "delivery"  # delivery | retirada


# ----------------- JORNADA SEM SENHA & OTP CARDAPIO -----------------
class CardapioIdentificarRequest(BaseModel):
    restaurante_id: int
    telefone: str


class CardapioVerificarOtpRequest(BaseModel):
    restaurante_id: int
    telefone: str
    otp: str




