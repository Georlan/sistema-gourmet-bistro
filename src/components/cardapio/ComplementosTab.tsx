import React, { useEffect, useMemo, useState } from 'react';
import { Check, Edit3, Layers, Plus, Search, Trash2 } from 'lucide-react';
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
  categoria_ids?: string[];
  incluir_subcategorias?: boolean;
}

interface CategoriaHierarquia {
  id: string;
  nome: string;
  destino_impressao?: string;
  parent_id?: string | null;
}

interface ComplementosTabProps {
  apiBaseUrl: string;
  authHeaders: Record<string, string>;
  produtos: Array<{ id: string; nome: string; preco: number; categoria_id?: string }>;
  onShowNotification?: (msg: string, type?: 'success' | 'error') => void;
}

export default function ComplementosTab({
  apiBaseUrl,
  authHeaders,
  produtos,
  onShowNotification,
}: ComplementosTabProps) {
  const [grupos, setGrupos] = useState<GrupoModificador[]>([]);
  const [categorias, setCategorias] = useState<CategoriaHierarquia[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingGrupo, setEditingGrupo] = useState<GrupoModificador | null>(null);

  const [nome, setNome] = useState('');
  const [tipo, setTipo] = useState<'obrigatorio' | 'opcional' | 'meio_a_meio'>('opcional');
  const [minSelecoes, setMinSelecoes] = useState('0');
  const [maxSelecoes, setMaxSelecoes] = useState('1');
  const [opcoes, setOpcoes] = useState<OpcaoModificador[]>([
    { nome: '', preco_adicional: 0, ativo: true },
  ]);
  const [selectedProductIds, setSelectedProductIds] = useState<string[]>([]);
  const [selectedCategoryIds, setSelectedCategoryIds] = useState<string[]>([]);
  const [includeSubcategories, setIncludeSubcategories] = useState(true);
  const [saving, setSaving] = useState(false);

  const fetchCatalogBindings = async () => {
    try {
      setLoading(true);
      const [groupsRes, categoriesRes] = await Promise.all([
        fetch(`${apiBaseUrl}/cardapio/modificadores/grupos`, { headers: authHeaders }),
        fetch(`${apiBaseUrl}/cardapio/modificadores/categorias-hierarquia`, { headers: authHeaders }),
      ]);

      if (!groupsRes.ok) {
        throw new Error('Não foi possível carregar os grupos de complementos.');
      }
      const groupsData = await groupsRes.json();
      setGrupos(Array.isArray(groupsData) ? groupsData : []);

      if (categoriesRes.ok) {
        const categoriesData = await categoriesRes.json();
        setCategorias(Array.isArray(categoriesData) ? categoriesData : []);
      }
    } catch (err) {
      console.error('Erro ao buscar modificadores:', err);
      onShowNotification?.('Não foi possível carregar os complementos.', 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void fetchCatalogBindings();
  }, [apiBaseUrl]);

  const orderedCategories = useMemo(() => {
    const byId = new Map(categorias.map((category) => [category.id, category]));
    const depthOf = (category: CategoriaHierarquia) => {
      let depth = 0;
      let parentId = category.parent_id || null;
      const visited = new Set<string>([category.id]);
      while (parentId && byId.has(parentId) && !visited.has(parentId)) {
        visited.add(parentId);
        depth += 1;
        parentId = byId.get(parentId)?.parent_id || null;
      }
      return depth;
    };
    return [...categorias].sort((a, b) => {
      const depthDiff = depthOf(a) - depthOf(b);
      if (a.parent_id === b.parent_id && depthDiff === 0) {
        return a.nome.localeCompare(b.nome, 'pt-BR');
      }
      const aRoot = a.parent_id ? byId.get(a.parent_id)?.nome || a.nome : a.nome;
      const bRoot = b.parent_id ? byId.get(b.parent_id)?.nome || b.nome : b.nome;
      const rootDiff = aRoot.localeCompare(bRoot, 'pt-BR');
      return rootDiff || depthDiff || a.nome.localeCompare(b.nome, 'pt-BR');
    });
  }, [categorias]);

  const categoryDepth = (category: CategoriaHierarquia) => {
    const byId = new Map(categorias.map((item) => [item.id, item]));
    let depth = 0;
    let current = category.parent_id || null;
    const visited = new Set<string>([category.id]);
    while (current && byId.has(current) && !visited.has(current)) {
      visited.add(current);
      depth += 1;
      current = byId.get(current)?.parent_id || null;
    }
    return depth;
  };

  const handleOpenModal = (grupo?: GrupoModificador) => {
    if (grupo) {
      setEditingGrupo(grupo);
      setNome(grupo.nome);
      setTipo(grupo.tipo);
      setMinSelecoes(String(grupo.min_selecoes));
      setMaxSelecoes(String(grupo.max_selecoes));
      setOpcoes(
        grupo.opcoes.length > 0
          ? grupo.opcoes.map((option) => ({ ...option }))
          : [{ nome: '', preco_adicional: 0, ativo: true }],
      );
      setSelectedProductIds([...(grupo.produto_ids || [])]);
      setSelectedCategoryIds([...(grupo.categoria_ids || [])]);
      setIncludeSubcategories(grupo.incluir_subcategorias !== false);
    } else {
      setEditingGrupo(null);
      setNome('');
      setTipo('opcional');
      setMinSelecoes('0');
      setMaxSelecoes('1');
      setOpcoes([{ nome: '', preco_adicional: 0, ativo: true }]);
      setSelectedProductIds([]);
      setSelectedCategoryIds([]);
      setIncludeSubcategories(true);
    }
    setIsModalOpen(true);
  };

  const handleAddOpcao = () => {
    setOpcoes((prev) => [...prev, { nome: '', preco_adicional: 0, ativo: true }]);
  };

  const handleRemoveOpcao = (idx: number) => {
    setOpcoes((prev) => prev.filter((_, index) => index !== idx));
  };

  const handleOpcaoChange = (idx: number, field: keyof OpcaoModificador, value: unknown) => {
    setOpcoes((prev) => prev.map((option, index) => (
      index === idx ? { ...option, [field]: value } : option
    )));
  };

  const toggleProductSelection = (productId: string) => {
    setSelectedProductIds((prev) => (
      prev.includes(productId)
        ? prev.filter((id) => id !== productId)
        : [...prev, productId]
    ));
  };

  const toggleCategorySelection = (categoryId: string) => {
    setSelectedCategoryIds((prev) => (
      prev.includes(categoryId)
        ? prev.filter((id) => id !== categoryId)
        : [...prev, categoryId]
    ));
  };

  const handleSelectAllProducts = () => {
    setSelectedProductIds((prev) => (
      prev.length === produtos.length ? [] : produtos.map((product) => product.id)
    ));
  };

  const handleSaveGrupo = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!nome.trim()) {
      onShowNotification?.('Informe o nome do grupo de complementos.', 'error');
      return;
    }

    const validOptions = opcoes.filter((option) => option.nome.trim().length > 0);
    if (validOptions.length === 0) {
      onShowNotification?.('Adicione ao menos 1 opção de complemento.', 'error');
      return;
    }

    const min = Math.max(0, parseInt(minSelecoes, 10) || 0);
    const max = Math.max(1, parseInt(maxSelecoes, 10) || 1);
    if (min > max) {
      onShowNotification?.('O mínimo de opções não pode ser maior que o máximo.', 'error');
      return;
    }

    try {
      setSaving(true);
      const payload = {
        nome: nome.trim(),
        tipo,
        min_selecoes: min,
        max_selecoes: max,
        opcoes: validOptions.map((option) => ({
          ...option,
          nome: option.nome.trim(),
          preco_adicional: parseFloat(String(option.preco_adicional)) || 0,
        })),
        produto_ids: selectedProductIds,
        categoria_ids: selectedCategoryIds,
        incluir_subcategorias: includeSubcategories,
      };

      const url = editingGrupo
        ? `${apiBaseUrl}/cardapio/modificadores/grupos/${editingGrupo.id}`
        : `${apiBaseUrl}/cardapio/modificadores/grupos`;
      const response = await fetch(url, {
        method: editingGrupo ? 'PUT' : 'POST',
        headers: {
          ...authHeaders,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.detail || 'Erro ao salvar grupo de complementos');
      }

      onShowNotification?.(
        editingGrupo ? 'Grupo atualizado com sucesso!' : 'Grupo criado com sucesso!',
        'success',
      );
      setIsModalOpen(false);
      await fetchCatalogBindings();
    } catch (err) {
      onShowNotification?.(
        err instanceof Error ? err.message : 'Falha ao salvar grupo',
        'error',
      );
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteGrupo = async (id: string) => {
    if (!confirm('Deseja realmente excluir este grupo de complementos?')) return;
    try {
      const response = await fetch(`${apiBaseUrl}/cardapio/modificadores/grupos/${id}`, {
        method: 'DELETE',
        headers: authHeaders,
      });
      if (!response.ok) {
        throw new Error('Erro ao excluir grupo.');
      }
      onShowNotification?.('Grupo excluído com sucesso.', 'success');
      setGrupos((prev) => prev.filter((group) => group.id !== id));
    } catch (err) {
      onShowNotification?.(
        err instanceof Error ? err.message : 'Erro ao excluir grupo.',
        'error',
      );
    }
  };

  const filteredGrupos = useMemo(() => {
    const query = search.trim().toLocaleLowerCase('pt-BR');
    return grupos.filter((group) => group.nome.toLocaleLowerCase('pt-BR').includes(query));
  }, [grupos, search]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-4 bg-koma-card border border-koma-border p-5 rounded-2xl">
        <div>
          <div className="flex items-center gap-2 text-emerald-500 font-bold text-sm">
            <Layers className="w-5 h-5" />
            <span>Grupos de Complementos & Adicionais</span>
          </div>
          <p className="text-xs text-koma-muted mt-1 max-w-2xl">
            Vincule um grupo à categoria principal e ele será herdado pelas subcategorias. Produtos específicos continuam disponíveis para exceções.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-koma-muted" />
            <input
              type="text"
              placeholder="Buscar grupo..."
              value={search}
              onChange={(event) => setSearch(event.target.value)}
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

      {loading ? (
        <div className="py-12 text-center text-xs text-koma-muted">Carregando complementos...</div>
      ) : filteredGrupos.length === 0 ? (
        <div className="py-12 text-center bg-koma-card border border-koma-border rounded-2xl">
          <Layers className="w-10 h-10 mx-auto text-koma-muted opacity-40 mb-3" />
          <h3 className="text-sm font-bold text-koma-foreground">Nenhum grupo de adicionais criado</h3>
          <p className="text-xs text-koma-muted mt-1 max-w-md mx-auto">
            Cadastre os grupos e adicionais manualmente para manter o cardápio sob seu controle.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredGrupos.map((group) => (
            <div key={group.id} className="bg-koma-card border border-koma-border rounded-2xl p-4 flex flex-col justify-between">
              <div>
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <span className={clsx(
                      'inline-block px-2 py-0.5 rounded text-[10px] font-black uppercase tracking-wider',
                      group.tipo === 'obrigatorio'
                        ? 'bg-amber-500/15 text-amber-400'
                        : 'bg-emerald-500/15 text-emerald-400',
                    )}>
                      {group.tipo === 'obrigatorio' ? 'Obrigatório' : 'Opcional'}
                    </span>
                    <h4 className="mt-1.5 font-black text-sm text-koma-foreground">{group.nome}</h4>
                    <p className="text-[11px] text-koma-muted mt-0.5">
                      {group.min_selecoes === group.max_selecoes
                        ? `Escolha ${group.min_selecoes} opção`
                        : `De ${group.min_selecoes} a ${group.max_selecoes} opções`}
                    </p>
                  </div>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => handleOpenModal(group)}
                      className="p-1.5 text-koma-muted hover:text-koma-foreground rounded-lg hover:bg-koma-raised"
                      title="Editar"
                    >
                      <Edit3 className="w-4 h-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDeleteGrupo(group.id)}
                      className="p-1.5 text-koma-muted hover:text-rose-400 rounded-lg hover:bg-rose-500/10"
                      title="Excluir"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                <div className="mt-3 space-y-1.5 max-h-36 overflow-y-auto pr-1">
                  {group.opcoes.map((option) => (
                    <div key={option.id || option.nome} className="flex items-center justify-between text-xs bg-koma-raised/60 px-2.5 py-1.5 rounded-lg">
                      <span className="text-koma-foreground font-medium">{option.nome}</span>
                      <span className="text-koma-muted font-mono font-semibold">
                        {option.preco_adicional > 0 ? `+ R$ ${Number(option.preco_adicional).toFixed(2)}` : 'Grátis'}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="mt-4 pt-3 border-t border-koma-border/60 text-[11px] text-koma-muted space-y-1">
                <div className="flex justify-between gap-3">
                  <span>Categorias:</span>
                  <span className="font-bold text-koma-foreground">
                    {(group.categoria_ids || []).length}
                    {group.incluir_subcategorias !== false && (group.categoria_ids || []).length > 0 ? ' + subcategorias' : ''}
                  </span>
                </div>
                <div className="flex justify-between gap-3">
                  <span>Produtos específicos:</span>
                  <span className="font-bold text-koma-foreground">{group.produto_ids.length}</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 animate-fade-in overflow-y-auto">
          <div className="bg-koma-panel border border-koma-border rounded-2xl w-full max-w-2xl p-6 shadow-2xl space-y-5 my-8 max-h-[92vh] flex flex-col animate-scale-up">
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
                  placeholder="Ex: Queijos e Cremosos, Molhos, Ponto da Carne"
                  value={nome}
                  onChange={(event) => setNome(event.target.value)}
                  className="w-full px-3 py-2 bg-koma-card border border-koma-border rounded-xl text-xs text-koma-foreground focus:outline-none focus:border-emerald-500"
                  required
                />
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-bold text-koma-muted mb-1">Tipo</label>
                  <select
                    value={tipo}
                    onChange={(event) => setTipo(event.target.value as typeof tipo)}
                    className="w-full px-3 py-2 bg-koma-card border border-koma-border rounded-xl text-xs text-koma-foreground focus:outline-none focus:border-emerald-500"
                  >
                    <option value="opcional">Opcional</option>
                    <option value="obrigatorio">Obrigatório</option>
                    <option value="meio_a_meio">Meio a Meio</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-bold text-koma-muted mb-1">Mínimo</label>
                  <input
                    type="number"
                    min="0"
                    value={minSelecoes}
                    onChange={(event) => setMinSelecoes(event.target.value)}
                    className="w-full px-3 py-2 bg-koma-card border border-koma-border rounded-xl text-xs text-koma-foreground focus:outline-none focus:border-emerald-500 font-mono"
                    required
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-koma-muted mb-1">Máximo</label>
                  <input
                    type="number"
                    min="1"
                    value={maxSelecoes}
                    onChange={(event) => setMaxSelecoes(event.target.value)}
                    className="w-full px-3 py-2 bg-koma-card border border-koma-border rounded-xl text-xs text-koma-foreground focus:outline-none focus:border-emerald-500 font-mono"
                    required
                  />
                </div>
              </div>

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
                  {opcoes.map((option, index) => (
                    <div key={`${option.id || 'new'}-${index}`} className="flex items-center gap-2 bg-koma-card p-2 rounded-xl border border-koma-border">
                      <input
                        type="text"
                        placeholder="Nome da opção (ex: Bacon Crocante)"
                        value={option.nome}
                        onChange={(event) => handleOpcaoChange(index, 'nome', event.target.value)}
                        className="flex-1 px-2.5 py-1.5 bg-koma-raised border border-koma-border rounded-lg text-xs text-koma-foreground focus:outline-none focus:border-emerald-500"
                        required
                      />
                      <div className="w-28 relative">
                        <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[10px] text-koma-muted">R$</span>
                        <input
                          type="number"
                          step="0.01"
                          min="0"
                          value={option.preco_adicional}
                          onChange={(event) => handleOpcaoChange(index, 'preco_adicional', event.target.value)}
                          className="w-full pl-7 pr-2 py-1.5 bg-koma-raised border border-koma-border rounded-lg text-xs text-koma-foreground focus:outline-none focus:border-emerald-500 font-mono"
                        />
                      </div>
                      {opcoes.length > 1 && (
                        <button
                          type="button"
                          onClick={() => handleRemoveOpcao(index)}
                          className="p-1.5 text-koma-muted hover:text-rose-400 rounded-lg"
                          aria-label="Remover opção"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              <div className="space-y-2 pt-2 border-t border-koma-border">
                <div>
                  <label className="text-xs font-bold text-koma-muted">Vincular por Categoria</label>
                  <p className="text-[11px] text-koma-subtle mt-0.5">
                    É a opção recomendada: um vínculo em “Hambúrgueres” pode valer para Bovinos, Suínos e Frango.
                  </p>
                </div>

                {orderedCategories.length === 0 ? (
                  <div className="text-[11px] text-koma-muted bg-koma-card border border-koma-border rounded-xl p-3">
                    Nenhuma categoria disponível.
                  </div>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-44 overflow-y-auto p-1 bg-koma-card border border-koma-border rounded-xl">
                    {orderedCategories.map((category) => {
                      const selected = selectedCategoryIds.includes(category.id);
                      const depth = categoryDepth(category);
                      return (
                        <button
                          key={category.id}
                          type="button"
                          onClick={() => toggleCategorySelection(category.id)}
                          className={clsx(
                            'flex items-center gap-2 p-2 rounded-lg text-left text-xs transition border',
                            selected
                              ? 'bg-emerald-500/10 border-emerald-500/40 text-emerald-400 font-bold'
                              : 'bg-koma-raised/50 border-transparent text-koma-muted hover:text-koma-foreground',
                          )}
                          style={{ paddingLeft: `${8 + depth * 16}px` }}
                        >
                          <span className={clsx(
                            'w-4 h-4 rounded flex items-center justify-center border text-[10px] shrink-0',
                            selected ? 'bg-emerald-500 text-black border-emerald-500' : 'border-koma-border',
                          )}>
                            {selected && <Check className="w-3 h-3 stroke-[3]" />}
                          </span>
                          <span className="truncate">{depth > 0 ? '↳ ' : ''}{category.nome}</span>
                        </button>
                      );
                    })}
                  </div>
                )}

                <label className="flex items-center gap-2 text-[11px] text-koma-muted cursor-pointer bg-koma-raised/40 border border-koma-border rounded-xl px-3 py-2">
                  <input
                    type="checkbox"
                    checked={includeSubcategories}
                    onChange={(event) => setIncludeSubcategories(event.target.checked)}
                    disabled={selectedCategoryIds.length === 0}
                    className="rounded border-koma-border"
                  />
                  <span>Incluir automaticamente todas as subcategorias atuais e futuras</span>
                </label>
              </div>

              <div className="space-y-2 pt-2 border-t border-koma-border">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <label className="text-xs font-bold text-koma-muted">Produtos específicos</label>
                    <p className="text-[11px] text-koma-subtle mt-0.5">Use para exceções, sem substituir o vínculo por categoria.</p>
                  </div>
                  <button
                    type="button"
                    onClick={handleSelectAllProducts}
                    className="text-[11px] font-bold text-koma-muted hover:text-koma-foreground shrink-0"
                  >
                    {selectedProductIds.length === produtos.length && produtos.length > 0 ? 'Desmarcar todos' : 'Selecionar todos'}
                  </button>
                </div>

                <div className="grid grid-cols-2 gap-2 max-h-40 overflow-y-auto p-1 bg-koma-card border border-koma-border rounded-xl">
                  {produtos.map((product) => {
                    const selected = selectedProductIds.includes(product.id);
                    return (
                      <button
                        key={product.id}
                        type="button"
                        onClick={() => toggleProductSelection(product.id)}
                        className={clsx(
                          'flex items-center gap-2 p-2 rounded-lg text-left text-xs transition border',
                          selected
                            ? 'bg-emerald-500/10 border-emerald-500/40 text-emerald-400 font-bold'
                            : 'bg-koma-raised/50 border-transparent text-koma-muted hover:text-koma-foreground',
                        )}
                      >
                        <span className={clsx(
                          'w-4 h-4 rounded flex items-center justify-center border text-[10px] shrink-0',
                          selected ? 'bg-emerald-500 text-black border-emerald-500' : 'border-koma-border',
                        )}>
                          {selected && <Check className="w-3 h-3 stroke-[3]" />}
                        </span>
                        <span className="truncate">{product.nome}</span>
                      </button>
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
