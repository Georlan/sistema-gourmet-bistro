import React, { useState, useEffect, useMemo } from 'react';
import { 
  Ticket, Plus, Trash2, Edit3, CheckCircle2, XCircle, 
  Percent, DollarSign, Calendar, AlertCircle, Sparkles,
  Search, Users, ArrowUpRight
} from 'lucide-react';
import clsx from 'clsx';

export interface CupomData {
  id: string;
  codigo: string;
  tipo_desconto: 'porcentagem' | 'fixo';
  valor_desconto: number;
  valor_minimo_pedido: number;
  limite_usos?: number | null;
  usos_atuais: number;
  valido_ate?: string | null;
  apenas_primeira_compra: boolean;
  ativo: boolean;
  cliente_id?: string | null;
  criado_em: string;
}

interface CuponsTabProps {
  apiBaseUrl: string;
  authHeaders: Record<string, string>;
  onShowNotification?: (msg: string, type?: 'success' | 'error') => void;
}

export default function CuponsTab({ apiBaseUrl, authHeaders, onShowNotification }: CuponsTabProps) {
  const [cupons, setCupons] = useState<CupomData[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingCupom, setEditingCupom] = useState<CupomData | null>(null);

  // Form states
  const [codigo, setCodigo] = useState('');
  const [tipoDesconto, setTipoDesconto] = useState<'porcentagem' | 'fixo'>('porcentagem');
  const [valorDesconto, setValorDesconto] = useState('');
  const [valorMinimo, setValorMinimo] = useState('');
  const [limiteUsos, setLimiteUsos] = useState('');
  const [validoAte, setValidoAte] = useState('');
  const [apenasPrimeiraCompra, setApenasPrimeiraCompra] = useState(false);
  const [ativo, setAtivo] = useState(true);
  const [saving, setSaving] = useState(false);

  const fetchCupons = async () => {
    try {
      setLoading(true);
      const res = await fetch(`${apiBaseUrl}/caixa/cupons`, {
        headers: authHeaders,
      });
      if (res.ok) {
        const data = await res.json();
        setCupons(data);
      }
    } catch (err) {
      console.error('Erro ao carregar cupons:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchCupons();
  }, [apiBaseUrl]);

  const handleOpenModal = (cupom?: CupomData) => {
    if (cupom) {
      setEditingCupom(cupom);
      setCodigo(cupom.codigo);
      setTipoDesconto(cupom.tipo_desconto);
      setValorDesconto(String(cupom.valor_desconto));
      setValorMinimo(String(cupom.valor_minimo_pedido || ''));
      setLimiteUsos(cupom.limite_usos ? String(cupom.limite_usos) : '');
      setValidoAte(cupom.valido_ate ? cupom.valido_ate.slice(0, 10) : '');
      setApenasPrimeiraCompra(cupom.apenas_primeira_compra);
      setAtivo(cupom.ativo);
    } else {
      setEditingCupom(null);
      setCodigo('');
      setTipoDesconto('porcentagem');
      setValorDesconto('');
      setValorMinimo('');
      setLimiteUsos('');
      setValidoAte('');
      setApenasPrimeiraCompra(false);
      setAtivo(true);
    }
    setIsModalOpen(true);
  };

  const handleSaveCupom = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!codigo.trim() || !valorDesconto) {
      onShowNotification?.('Preencha o código e o valor do desconto.', 'error');
      return;
    }

    try {
      setSaving(true);
      const payload = {
        codigo: codigo.trim().toUpperCase(),
        tipo_desconto: tipoDesconto,
        valor_desconto: parseFloat(valorDesconto),
        valor_minimo_pedido: valorMinimo ? parseFloat(valorMinimo) : 0,
        limite_usos: limiteUsos ? parseInt(limiteUsos, 10) : null,
        valido_ate: validoAte ? `${validoAte}T23:59:59Z` : null,
        apenas_primeira_compra: apenasPrimeiraCompra,
        ativo,
      };

      const url = editingCupom 
        ? `${apiBaseUrl}/caixa/cupons/${editingCupom.id}`
        : `${apiBaseUrl}/caixa/cupons`;
      
      const method = editingCupom ? 'PUT' : 'POST';

      const res = await fetch(url, {
        method,
        headers: {
          ...authHeaders,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(errorData.detail || 'Erro ao salvar cupom');
      }

      onShowNotification?.(
        editingCupom ? 'Cupom atualizado com sucesso!' : 'Cupom criado com sucesso!',
        'success'
      );
      setIsModalOpen(false);
      fetchCupons();
    } catch (err: any) {
      onShowNotification?.(err.message || 'Falha ao salvar cupom', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteCupom = async (id: string) => {
    if (!confirm('Deseja realmente excluir este cupom?')) return;
    try {
      const res = await fetch(`${apiBaseUrl}/caixa/cupons/${id}`, {
        method: 'DELETE',
        headers: authHeaders,
      });
      if (res.ok) {
        onShowNotification?.('Cupom excluído.', 'success');
        setCupons(prev => prev.filter(c => c.id !== id));
      }
    } catch (err) {
      onShowNotification?.('Erro ao excluir cupom.', 'error');
    }
  };

  const filteredCupons = useMemo(() => {
    return cupons.filter(c => 
      c.codigo.toLowerCase().includes(search.toLowerCase())
    );
  }, [cupons, search]);

  return (
    <div className="space-y-6">
      {/* Header com métricas e busca */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-koma-card border border-koma-border p-5 rounded-2xl">
        <div>
          <div className="flex items-center gap-2 text-emerald-500 font-bold text-sm">
            <Ticket className="w-5 h-5" />
            <span>Cupons de Desconto & Campanhas</span>
          </div>
          <p className="text-xs text-koma-muted mt-1">
            Crie cupons promocionais para seus clientes usarem no cardápio digital ou balcão.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <div className="relative">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-koma-muted" />
            <input
              type="text"
              placeholder="Buscar cupom..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="pl-9 pr-3 py-2 bg-koma-raised border border-koma-border rounded-xl text-xs text-koma-foreground focus:outline-none focus:border-emerald-500 w-44 sm:w-60"
            />
          </div>
          <button
            type="button"
            onClick={() => handleOpenModal()}
            className="koma-btn-primary inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-bold rounded-xl"
          >
            <Plus className="w-4 h-4" />
            <span>Novo Cupom</span>
          </button>
        </div>
      </div>

      {/* Grid de Cupons */}
      {loading ? (
        <div className="py-12 text-center text-xs text-koma-muted">Carregando cupons...</div>
      ) : filteredCupons.length === 0 ? (
        <div className="py-12 text-center bg-koma-card border border-koma-border rounded-2xl">
          <Ticket className="w-10 h-10 mx-auto text-koma-muted opacity-40 mb-3" />
          <h3 className="text-sm font-bold text-koma-foreground">Nenhum cupom cadastrado</h3>
          <p className="text-xs text-koma-muted mt-1 max-w-sm mx-auto">
            Crie seu primeiro cupom promocional para incentivar a primeira compra ou reengajar clientes.
          </p>
          <button
            type="button"
            onClick={() => handleOpenModal()}
            className="mt-4 koma-btn-primary inline-flex items-center gap-1.5 px-4 py-2 text-xs font-bold rounded-xl"
          >
            <Plus className="w-4 h-4" />
            <span>Criar primeiro cupom</span>
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredCupons.map(cupom => (
            <div
              key={cupom.id}
              className={clsx(
                'bg-koma-card border rounded-2xl p-4 flex flex-col justify-between transition relative overflow-hidden',
                cupom.ativo ? 'border-koma-border' : 'border-koma-border/40 opacity-60'
              )}
            >
              <div className="flex items-start justify-between">
                <div>
                  <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 font-mono text-xs font-black tracking-wider">
                    <Ticket className="w-3.5 h-3.5" />
                    {cupom.codigo}
                  </span>
                  <div className="mt-2 text-lg font-black text-koma-foreground">
                    {cupom.tipo_desconto === 'porcentagem' 
                      ? `${cupom.valor_desconto}% OFF` 
                      : `R$ ${cupom.valor_desconto.toFixed(2)} OFF`}
                  </div>
                </div>

                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => handleOpenModal(cupom)}
                    className="p-1.5 text-koma-muted hover:text-koma-foreground rounded-lg hover:bg-koma-raised"
                    title="Editar"
                  >
                    <Edit3 className="w-4 h-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDeleteCupom(cupom.id)}
                    className="p-1.5 text-koma-muted hover:text-rose-400 rounded-lg hover:bg-rose-500/10"
                    title="Excluir"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>

              <div className="mt-4 pt-3 border-t border-koma-border/60 space-y-1.5 text-[11px] text-koma-muted">
                {cupom.valor_minimo_pedido > 0 && (
                  <div className="flex justify-between">
                    <span>Pedido mínimo:</span>
                    <span className="font-semibold text-koma-foreground">R$ {cupom.valor_minimo_pedido.toFixed(2)}</span>
                  </div>
                )}
                <div className="flex justify-between">
                  <span>Utilizações:</span>
                  <span className="font-semibold text-koma-foreground">
                    {cupom.usos_atuais} {cupom.limite_usos ? `/ ${cupom.limite_usos}` : 'usos'}
                  </span>
                </div>
                {cupom.apenas_primeira_compra && (
                  <div className="inline-block px-2 py-0.5 rounded bg-amber-500/15 text-amber-400 text-[10px] font-bold">
                    Apenas 1ª compra
                  </div>
                )}
                {cupom.valido_ate && (
                  <div className="flex justify-between text-[10px]">
                    <span>Válido até:</span>
                    <span className="font-medium">{new Date(cupom.valido_ate).toLocaleDateString('pt-BR')}</span>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Modal de Criação / Edição */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 animate-fade-in">
          <div className="bg-koma-panel border border-koma-border rounded-2xl w-full max-w-md p-6 shadow-2xl space-y-5 animate-scale-up">
            <div className="flex items-center justify-between border-b border-koma-border pb-3">
              <h3 className="font-bold text-sm text-koma-foreground flex items-center gap-2">
                <Ticket className="w-4 h-4 text-emerald-500" />
                {editingCupom ? 'Editar Cupom' : 'Novo Cupom Promocional'}
              </h3>
              <button
                type="button"
                onClick={() => setIsModalOpen(false)}
                className="text-koma-muted hover:text-koma-foreground text-sm font-bold"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleSaveCupom} className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-koma-muted mb-1">Código do Cupom</label>
                <input
                  type="text"
                  placeholder="EX: PRIMEIRACOMPRA, PIZZA10"
                  value={codigo}
                  onChange={e => setCodigo(e.target.value.toUpperCase())}
                  className="w-full px-3 py-2 bg-koma-card border border-koma-border rounded-xl text-xs font-mono font-bold text-koma-foreground focus:outline-none focus:border-emerald-500 uppercase tracking-wider"
                  required
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-koma-muted mb-1">Tipo de Desconto</label>
                  <select
                    value={tipoDesconto}
                    onChange={e => setTipoDesconto(e.target.value as any)}
                    className="w-full px-3 py-2 bg-koma-card border border-koma-border rounded-xl text-xs text-koma-foreground focus:outline-none focus:border-emerald-500"
                  >
                    <option value="porcentagem">Porcentagem (%)</option>
                    <option value="fixo">Valor Fixo (R$)</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-bold text-koma-muted mb-1">Valor do Desconto</label>
                  <input
                    type="number"
                    step="0.01"
                    placeholder={tipoDesconto === 'porcentagem' ? '10%' : 'R$ 15.00'}
                    value={valorDesconto}
                    onChange={e => setValorDesconto(e.target.value)}
                    className="w-full px-3 py-2 bg-koma-card border border-koma-border rounded-xl text-xs text-koma-foreground focus:outline-none focus:border-emerald-500 font-mono"
                    required
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-koma-muted mb-1">Pedido Mínimo (R$)</label>
                  <input
                    type="number"
                    step="0.01"
                    placeholder="0.00"
                    value={valorMinimo}
                    onChange={e => setValorMinimo(e.target.value)}
                    className="w-full px-3 py-2 bg-koma-card border border-koma-border rounded-xl text-xs text-koma-foreground focus:outline-none focus:border-emerald-500 font-mono"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-koma-muted mb-1">Limite de Usos</label>
                  <input
                    type="number"
                    placeholder="Ilimitado"
                    value={limiteUsos}
                    onChange={e => setLimiteUsos(e.target.value)}
                    className="w-full px-3 py-2 bg-koma-card border border-koma-border rounded-xl text-xs text-koma-foreground focus:outline-none focus:border-emerald-500 font-mono"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-koma-muted mb-1">Validade (Opcional)</label>
                <input
                  type="date"
                  value={validoAte}
                  onChange={e => setValidoAte(e.target.value)}
                  className="w-full px-3 py-2 bg-koma-card border border-koma-border rounded-xl text-xs text-koma-foreground focus:outline-none focus:border-emerald-500"
                />
              </div>

              <div className="flex items-center gap-2 pt-2">
                <input
                  type="checkbox"
                  id="chk-primeira"
                  checked={apenasPrimeiraCompra}
                  onChange={e => setApenasPrimeiraCompra(e.target.checked)}
                  className="rounded border-koma-border bg-koma-card text-emerald-500 focus:ring-0"
                />
                <label htmlFor="chk-primeira" className="text-xs text-koma-foreground cursor-pointer">
                  Válido apenas para a 1ª compra do cliente
                </label>
              </div>

              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="chk-ativo"
                  checked={ativo}
                  onChange={e => setAtivo(e.target.checked)}
                  className="rounded border-koma-border bg-koma-card text-emerald-500 focus:ring-0"
                />
                <label htmlFor="chk-ativo" className="text-xs text-koma-foreground cursor-pointer">
                  Cupom ativo para uso
                </label>
              </div>

              <div className="flex items-center justify-end gap-3 pt-4 border-t border-koma-border">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="koma-btn-secondary px-4 py-2 text-xs font-bold rounded-xl"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="koma-btn-primary px-5 py-2 text-xs font-bold rounded-xl disabled:opacity-50"
                >
                  {saving ? 'Salvando...' : editingCupom ? 'Atualizar Cupom' : 'Criar Cupom'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
