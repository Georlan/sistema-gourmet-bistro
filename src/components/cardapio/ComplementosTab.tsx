import React, { useState, useEffect, useMemo } from 'react';
import { 
  Plus, Trash2, Edit3, CheckCircle2, Layers, 
  Search, Check, AlertCircle, Sparkles, DollarSign 
} from 'lucide-react';
import clsx from 'clsx';

export interface OpcaoModificador {
  id?: string;
  grupo_id?: string;
  nome: string;
  preco_adicional: number;
  ativo: boolean;
}

export interface GrupoModificador {
  id: string;
  nome: string;
  min_selecoes: number;
  max_selecoes: number;
  tipo: 'obrigatorio' | 'opcional' | 'meio_a_meio';
  opcoes: OpcaoModificador[];
  produto_ids: string[];
}

interface ComplementosTabProps {
  apiBaseUrl: string;
  authHeaders: Record<string, string>;
  produtos: Array<{ id: string; nome: string; preco: number; categoria_id: string }>;
  onShowNotification?: (msg: string, type?: 'success' | 'error') => void;
}

export default function ComplementosTab({ 
  apiBaseUrl, 
  authHeaders, 
  produtos,
  onShowNotification 
}: ComplementosTabProps) {
  const [grupos, setGrupos] = useState<GrupoModificador[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingGrupo, setEditingGrupo] = useState<GrupoModificador | null>(null);

  // Form states
  const [nome, setNome] = useState('');
  const [tipo, setTipo] = useState<'obrigatorio' | 'opcional' | 'meio_a_meio'>('opcional');
  const [minSelecoes, setMinSelecoes] = useState('0');
  const [maxSelecoes, setMaxSelecoes] = useState('1');
  const [opcoes, setOpcoes] = useState<OpcaoModificador[]>([
    { nome: '', preco_adicional: 0, ativo: true }
  ]);
  const [selectedProductIds, setSelectedProductIds] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  const fetchGrupos = async () => {
    try {
      setLoading(true);
      const res = await fetch(`${apiBaseUrl}/cardapio/modificadores/grupos`, {
        headers: authHeaders,
      });
      if (res.ok) {
        const data = await res.json();
        setGrupos(data);
      }
    } catch (err) {
      console.error('Erro ao buscar modificadores:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchGrupos();
  }, [apiBaseUrl]);

  const handleOpenModal = (grupo?: GrupoModificador) => {
    if (grupo) {
      setEditingGrupo(grupo);
      setNome(grupo.nome);
      setTipo(grupo.tipo);
      setMinSelecoes(String(grupo.min_selecoes));
      setMaxSelecoes(String(grupo.max_selecoes));
      setOpcoes(grupo.opcoes.length > 0 ? [...grupo.opcoes] : [{ nome: '', preco_adicional: 0, ativo: true }]);
      setSelectedProductIds([...grupo.produto_ids]);
    } else {
      setEditingGrupo(null);
      setNome('');
      setTipo('opcional');
      setMinSelecoes('0');
      setMaxSelecoes('1');
      setOpcoes([{ nome: '', preco_adicional: 0, ativo: true }]);
      setSelectedProductIds([]);
    }
    setIsModalOpen(true);
  };

  const handleAddOpcao = () => {
    setOpcoes(prev => [...prev, { nome: '', preco_adicional: 0, ativo: true }]);
  };

  const handleRemoveOpcao = (idx: number) => {
    setOpcoes(prev => prev.filter((_, i) => i !== idx));
  };

  const handleOpcaoChange = (idx: number, field: keyof OpcaoModificador, val: any) => {
    setOpcoes(prev => prev.map((op, i) => i === idx ? { ...op, [field]: val } : op));
  };

  const toggleProductSelection = (prodId: string) => {
    setSelectedProductIds(prev => 
      prev.includes(prodId) ? prev.filter(id => id !== prodId) : [...prev, prodId]
    );
  };

  const handleSelectAllProducts = () => {
    if (selectedProductIds.length === produtos.length) {
      setSelectedProductIds([]);
    } else {
      setSelectedProductIds(produtos.map(p => p.id));
    }
  };

  const handleSaveGrupo = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!nome.trim()) {
      onShowNotification?.('Informe o nome do grupo de complementos.', 'error');
      return;
    }

    const validOpcoes = opcoes.filter(op => op.nome.trim().length > 0);
    if (validOpcoes.length === 0) {
      onShowNotification?.('Adicione ao menos 1 opção de complemento.', 'error');
      return;
    }

    try {
      setSaving(true);
      const payload = {
        nome: nome.trim(),
        tipo,
        min_selecoes: parseInt(minSelecoes, 10) || 0,
        max_selecoes: parseInt(maxSelecoes, 10) || 1,
        opcoes: validOpcoes.map(op => ({
          ...op,
          nome: op.nome.trim(),
          preco_adicional: parseFloat(String(op.preco_adicional)) || 0,
        })),
        produto_ids: selectedProductIds,
      };

      const url = editingGrupo 
        ? `${apiBaseUrl}/cardapio/modificadores/grupos/${editingGrupo.id}`
        : `${apiBaseUrl}/cardapio/modificadores/grupos`;

      const method = editingGrupo ? 'PUT' : 'POST';

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
        throw new Error(errorData.detail || 'Erro ao salvar grupo de complementos');
      }

      onShowNotification?.(
        editingGrupo ? 'Grupo atualizado com sucesso!' : 'Grupo criado com sucesso!',
        'success'
      );
      setIsModalOpen(false);
      fetchGrupos();
    } catch (err: any) {
      onShowNotification?.(err.message || 'Falha ao salvar grupo', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteGrupo = async (id: string) => {
    if (!confirm('Deseja realmente excluir este grupo de complementos?')) return;
    try {
      const res = await fetch(`${apiBaseUrl}/cardapio/modificadores/grupos/${id}`, {
        method: 'DELETE',
        headers: authHeaders,
      });
      if (res.ok) {
        onShowNotification?.('Grupo excluído com sucesso.', 'success');
        setGrupos(prev => prev.filter(g => g.id !== id));
      }
    } catch (err) {
      onShowNotification?.('Erro ao excluir grupo.', 'error');
    }
  };

  const filteredGrupos = useMemo(() => {
    return grupos.filter(g => g.nome.toLowerCase().includes(search.toLowerCase()));
  }, [grupos, search]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-koma-card border border-koma-border p-5 rounded-2xl">
        <div>
          <div className="flex items-center gap-2 text-emerald-500 font-bold text-sm">
            <Layers className="w-5 h-5" />
            <span>Grupos de Complementos & Adicionais</span>
          </div>
          <p className="text-xs text-koma-muted mt-1">
            Configure adicionais, pontos da carne, tamanhos e acompanhamentos vinculados aos seus produtos.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <div className="relative">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-koma-muted" />
            <input
              type="text"
              placeholder="Buscar grupo..."
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
            <span>Novo Grupo</span>
          </button>
        </div>
      </div>

      {/* Grid de Grupos */}
      {loading ? (
        <div className="py-12 text-center text-xs text-koma-muted">Carregando complementos...</div>
      ) : filteredGrupos.length === 0 ? (
        <div className="py-12 text-center bg-koma-card border border-koma-border rounded-2xl">
          <Layers className="w-10 h-10 mx-auto text-koma-muted opacity-40 mb-3" />
          <h3 className="text-sm font-bold text-koma-foreground">Nenhum grupo de adicionais criado</h3>
          <p className="text-xs text-koma-muted mt-1 max-w-sm mx-auto">
            Cadastre grupos como "Ponto da Carne", "Adicionais", "Molhos Extras" e vincule aos itens do cardápio.
          </p>
          <button
            type="button"
            onClick={() => handleOpenModal()}
            className="mt-4 koma-btn-primary inline-flex items-center gap-1.5 px-4 py-2 text-xs font-bold rounded-xl"
          >
            <Plus className="w-4 h-4" />
            <span>Criar primeiro grupo</span>
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredGrupos.map(grupo => (
            <div
              key={grupo.id}
              className="bg-koma-card border border-koma-border rounded-2xl p-4 flex flex-col justify-between"
            >
              <div>
                <div className="flex items-start justify-between">
                  <div>
                    <span className={clsx(
                      'inline-block px-2 py-0.5 rounded text-[10px] font-black uppercase tracking-wider',
                      grupo.tipo === 'obrigatorio' 
                        ? 'bg-amber-500/15 text-amber-400' 
                        : 'bg-emerald-500/15 text-emerald-400'
                    )}>
                      {grupo.tipo === 'obrigatorio' ? 'Obrigatório' : 'Opcional'}
                    </span>
                    <h4 className="mt-1.5 font-black text-sm text-koma-foreground">{grupo.nome}</h4>
                    <p className="text-[11px] text-koma-muted mt-0.5">
                      {grupo.min_selecoes === grupo.max_selecoes 
                        ? `Escolha ${grupo.min_selecoes} opção`
                        : `De ${grupo.min_selecoes} a ${grupo.max_selecoes} opções`}
                    </p>
                  </div>

                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => handleOpenModal(grupo)}
                      className="p-1.5 text-koma-muted hover:text-koma-foreground rounded-lg hover:bg-koma-raised"
                      title="Editar"
                    >
                      <Edit3 className="w-4 h-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDeleteGrupo(grupo.id)}
                      className="p-1.5 text-koma-muted hover:text-rose-400 rounded-lg hover:bg-rose-500/10"
                      title="Excluir"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                {/* Opções cadastradas */}
                <div className="mt-3 space-y-1.5 max-h-36 overflow-y-auto pr-1">
                  {grupo.opcoes.map((op, idx) => (
                    <div key={idx} className="flex items-center justify-between text-xs bg-koma-raised/60 px-2.5 py-1.5 rounded-lg">
                      <span className="text-koma-foreground font-medium">{op.nome}</span>
                      <span className="text-koma-muted font-mono font-semibold">
                        {op.preco_adicional > 0 ? `+ R$ ${op.preco_adicional.toFixed(2)}` : 'Grátis'}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="mt-4 pt-3 border-t border-koma-border/60 text-[11px] text-koma-muted flex justify-between items-center">
                <span>Vinculado a:</span>
                <span className="font-bold text-koma-foreground">
                  {grupo.produto_ids.length} {grupo.produto_ids.length === 1 ? 'produto' : 'produtos'}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Modal de Criação / Edição */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 animate-fade-in overflow-y-auto">
          <div className="bg-koma-panel border border-koma-border rounded-2xl w-full max-w-lg p-6 shadow-2xl space-y-5 my-8 max-h-[90vh] flex flex-col animate-scale-up">
            <div className="flex items-center justify-between border-b border-koma-border pb-3 shrink-0">
              <h3 className="font-bold text-sm text-koma-foreground flex items-center gap-2">
                <Layers className="w-4 h-4 text-emerald-500" />
                {editingGrupo ? 'Editar Grupo de Complementos' : 'Novo Grupo de Complementos'}
              </h3>
              <button
                type="button"
                onClick={() => setIsModalOpen(false)}
                className="text-koma-muted hover:text-koma-foreground text-sm font-bold"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleSaveGrupo} className="space-y-4 overflow-y-auto flex-1 pr-1">
              <div>
                <label className="block text-xs font-bold text-koma-muted mb-1">Nome do Grupo</label>
                <input
                  type="text"
                  placeholder="Ex: Ponto da Carne, Adicionais Especiais, Molhos"
                  value={nome}
                  onChange={e => setNome(e.target.value)}
                  className="w-full px-3 py-2 bg-koma-card border border-koma-border rounded-xl text-xs text-koma-foreground focus:outline-none focus:border-emerald-500"
                  required
                />
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-bold text-koma-muted mb-1">Tipo</label>
                  <select
                    value={tipo}
                    onChange={e => setTipo(e.target.value as any)}
                    className="w-full px-3 py-2 bg-koma-card border border-koma-border rounded-xl text-xs text-koma-foreground focus:outline-none focus:border-emerald-500"
                  >
                    <option value="opcional">Opcional</option>
                    <option value="obrigatorio">Obrigatório</option>
                    <option value="meio_a_meio">Meio a Meio</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-bold text-koma-muted mb-1">Mínimo de opções</label>
                  <input
                    type="number"
                    min="0"
                    value={minSelecoes}
                    onChange={e => setMinSelecoes(e.target.value)}
                    className="w-full px-3 py-2 bg-koma-card border border-koma-border rounded-xl text-xs text-koma-foreground focus:outline-none focus:border-emerald-500 font-mono"
                    required
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-koma-muted mb-1">Máximo de opções</label>
                  <input
                    type="number"
                    min="1"
                    value={maxSelecoes}
                    onChange={e => setMaxSelecoes(e.target.value)}
                    className="w-full px-3 py-2 bg-koma-card border border-koma-border rounded-xl text-xs text-koma-foreground focus:outline-none focus:border-emerald-500 font-mono"
                    required
                  />
                </div>
              </div>

              {/* Opções do Grupo */}
              <div className="space-y-2 pt-2 border-t border-koma-border">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-bold text-koma-muted">Opções / Adicionais</label>
                  <button
                    type="button"
                    onClick={handleAddOpcao}
                    className="text-xs font-bold text-emerald-400 hover:text-emerald-300 inline-flex items-center gap-1"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>Adicionar Opção</span>
                  </button>
                </div>

                <div className="space-y-2">
                  {opcoes.map((op, idx) => (
                    <div key={idx} className="flex items-center gap-2 bg-koma-card p-2 rounded-xl border border-koma-border">
                      <input
                        type="text"
                        placeholder="Nome da opção (ex: Bacon Crocante)"
                        value={op.nome}
                        onChange={e => handleOpcaoChange(idx, 'nome', e.target.value)}
                        className="flex-1 px-2.5 py-1.5 bg-koma-raised border border-koma-border rounded-lg text-xs text-koma-foreground focus:outline-none focus:border-emerald-500"
                        required
                      />
                      <div className="w-28 relative">
                        <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[10px] text-koma-muted">R$</span>
                        <input
                          type="number"
                          step="0.01"
                          placeholder="0.00"
                          value={op.preco_adicional}
                          onChange={e => handleOpcaoChange(idx, 'preco_adicional', e.target.value)}
                          className="w-full pl-7 pr-2 py-1.5 bg-koma-raised border border-koma-border rounded-lg text-xs text-koma-foreground focus:outline-none focus:border-emerald-500 font-mono"
                        />
                      </div>
                      {opcoes.length > 1 && (
                        <button
                          type="button"
                          onClick={() => handleRemoveOpcao(idx)}
                          className="p-1.5 text-koma-muted hover:text-rose-400 rounded-lg"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              {/* Vinculação aos Produtos */}
              <div className="space-y-2 pt-2 border-t border-koma-border">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-bold text-koma-muted">Vincular a Produtos</label>
                  <button
                    type="button"
                    onClick={handleSelectAllProducts}
                    className="text-[11px] font-bold text-koma-muted hover:text-koma-foreground"
                  >
                    {selectedProductIds.length === produtos.length ? 'Desmarcar todos' : 'Selecionar todos'}
                  </button>
                </div>

                <div className="grid grid-cols-2 gap-2 max-h-40 overflow-y-auto p-1 bg-koma-card border border-koma-border rounded-xl">
                  {produtos.map(p => {
                    const isSelected = selectedProductIds.includes(p.id);
                    return (
                      <div
                        key={p.id}
                        onClick={() => toggleProductSelection(p.id)}
                        className={clsx(
                          'flex items-center gap-2 p-2 rounded-lg cursor-pointer text-xs transition border',
                          isSelected 
                            ? 'bg-emerald-500/10 border-emerald-500/40 text-emerald-400 font-bold' 
                            : 'bg-koma-raised/50 border-transparent text-koma-muted hover:text-koma-foreground'
                        )}
                      >
                        <div className={clsx(
                          'w-4 h-4 rounded flex items-center justify-center border text-[10px]',
                          isSelected ? 'bg-emerald-500 text-black border-emerald-500' : 'border-koma-border'
                        )}>
                          {isSelected && <Check className="w-3 h-3 stroke-[3]" />}
                        </div>
                        <span className="truncate">{p.nome}</span>
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="flex items-center justify-end gap-3 pt-4 border-t border-koma-border shrink-0">
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
                  {saving ? 'Salvando...' : editingGrupo ? 'Atualizar Grupo' : 'Criar Grupo'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
