from pydantic import BaseModel
from typing import List, Optional
from datetime import datetime

# ----------------- AUTHENTICATION -----------------
class LoginRequest(BaseModel):
    username: str
    password: str

class UsuarioResponse(BaseModel):
    id: str
    nome: str
    usuario: str
    role: str

    class Config:
        from_attributes = True

class UsuarioCreate(BaseModel):
    nome: str
    usuario: str
    senha: str
    role: str = "garcom"

class LoginResponse(BaseModel):
    access_token: str
    token_type: str
    garcom: UsuarioResponse
    usuario: UsuarioResponse


# ----------------- CATEGORY & OBSERVATION -----------------
class CategoriaResponse(BaseModel):
    id: str
    nome: str
    destino_impressao: str

    class Config:
        from_attributes = True

class ObservacaoPredefinidaResponse(BaseModel):
    id: int
    categoria_id: str
    texto: str

    class Config:
        from_attributes = True


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
    class Config:
        from_attributes = True

# Lightweight nested schemas (used inside Item/Comanda to avoid circular imports)
class ProdutoSimples(BaseModel):
    id: str
    nome: str
    preco: float
    ativo: bool = True
    class Config:
        from_attributes = True

class UsuarioSimples(BaseModel):
    id: str
    nome: str
    role: str
    class Config:
        from_attributes = True


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
    class Config:
        from_attributes = True


# ----------------- ITEM -----------------
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

    class Config:
        from_attributes = True


# ----------------- COMANDA -----------------
class ComandaResponse(BaseModel):
    id: str
    mesa_id: Optional[int] = None
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

    class Config:
        from_attributes = True


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

    class Config:
        from_attributes = True

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

    class Config:
        from_attributes = True

class CaixaMovimentacaoCreate(BaseModel):
    tipo: str  # "suprimento" | "sangria"
    valor: float
    descricao: str = ""

class CaixaMovimentacaoResponse(BaseModel):
    id: int
    turno_id: int
    tipo: str
    valor: float
    descricao: str
    criado_em: datetime

    class Config:
        from_attributes = True

class PagamentoRequest(BaseModel):
    valor: float
    metodo: str  # "dinheiro" | "pix" | "cartao"
    item_ids: Optional[List[str]] = None  # Specific item IDs to settle if paying by item

class PagamentoResponse(BaseModel):
    id: str
    comanda_id: str
    turno_id: int
    valor: float
    metodo: str
    criado_em: datetime

    class Config:
        from_attributes = True

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

    class Config:
        from_attributes = True


class ConfiguracaoRestauranteUpdate(BaseModel):
    nicho: Optional[str] = None
    mapa_mesas_ativo: Optional[bool] = None
    delivery_ativo: Optional[bool] = None
    taxa_servico_ativa: Optional[bool] = None
    taxa_servico_padrao: Optional[float] = None
    unificar_vias_delivery: Optional[bool] = None
    modo_exclusivo_salao: Optional[bool] = None


class ConfiguracaoIAResponse(BaseModel):
    id: int
    permitir_descontos: bool
    desconto_maximo: float
    permitir_upsell: bool
    tom_de_voz: str
    teto_interacoes: int

    class Config:
        from_attributes = True


class MensagemWhatsAppResponse(BaseModel):
    id: str
    cliente_telefone: str
    remetente: str
    conteudo: str
    transcricao: Optional[str] = None
    audio_url: Optional[str] = None
    criado_em: datetime

    class Config:
        from_attributes = True


class RascunhoPedidoResponse(BaseModel):
    id: str
    cliente_telefone: str
    conteudo_json: str
    ia_sugestao_resposta: Optional[str] = None
    status: str
    criado_em: datetime

    class Config:
        from_attributes = True


class InsumoResponse(BaseModel):
    id: str
    nome: str
    estoque_atual: float
    estoque_minimo: float
    estoque_maximo: float
    unidade_medida: str
    preco_medio_custo: float

    class Config:
        from_attributes = True


class ConfigFidelizacaoResponse(BaseModel):
    id: int
    ativo: bool
    tipo_recompensa: str
    taxa_conversao: float
    valor_ponto_em_dinheiro: float

    class Config:
        from_attributes = True


class HistoricoFidelidadeResponse(BaseModel):
    id: int
    cliente_telefone: str
    tipo_movimentacao: str
    valor_delta: float
    comanda_id: Optional[str] = None
    criado_em: datetime

    class Config:
        from_attributes = True


class MotoboyCreate(BaseModel):
    nome: str
    telefone: str
    ativo: Optional[bool] = True


class MotoboyResponse(BaseModel):
    id: int
    nome: str
    telefone: str
    ativo: bool

    class Config:
        from_attributes = True



