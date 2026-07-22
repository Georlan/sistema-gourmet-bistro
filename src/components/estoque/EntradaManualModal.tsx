import React, { useState } from 'react';
import { X, Plus, Trash2 } from 'lucide-react';
import { Distribuidor, Insumo } from '../../types';

interface ItemFormState {
  insumo_id: string;
  insumo_nome: string;
  is_novo_insumo: boolean;
  quantidade: number;
  unidade_medida: string;
  custo_unitario: number;
}

interface EntradaManualModalProps {
  distribuidores: Distribuidor[];
  insumos: Insumo[];
  onClose: () => void;
  onSubmit: (payload: any) => Promise<void>;
}

export const EntradaManualModal: React.FC<EntradaManualModalProps> = ({
  distribuidores,
  insumos,
  onClose,
  onSubmit
}) => {
  const [distribuidorId, setDistribuidorId] = useState<string>('');
  const [isNovoDistribuidor, setIsNovoDistribuidor] = useState<boolean>(false);
  const [distribuidorNome, setDistribuidorNome] = useState<string>('');
  const [distribuidorCnpj, setDistribuidorCnpj] = useState<string>('');
  const [numeroDocumento, setNumeroDocumento] = useState<string>('');
  const [dataEmissao, setDataEmissao] = useState<string>(new Date().toISOString().split('T')[0]);
  const [observacao, setObservacao] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const [itens, setItens] = useState<ItemFormState[]>([
    { insumo_id: '', insumo_nome: '', is_novo_insumo: false, quantidade: 1, unidade_medida: 'un', custo_unitario: 0 }
  ]);

  const handleAddItem = () => {
    setItens(prev => [
      ...prev,
      { insumo_id: '', insumo_nome: '', is_novo_insumo: false, quantidade: 1, unidade_medida: 'un', custo_unitario: 0 }
    ]);
  };

  const handleRemoveItem = (index: number) => {
    if (itens.length === 1) return;
    setItens(prev => prev.filter((_, idx) => idx !== index));
  };

  const handleItemChange = (index: number, field: keyof ItemFormState, value: any) => {
    setItens(prev => {
      const updated = [...prev];
      const current = { ...updated[index], [field]: value };

      if (field === 'insumo_id' && value !== 'novo') {
        const found = insumos.find(i => i.id === value);
        if (found) {
          current.insumo_nome = found.nome;
          current.unidade_medida = found.unidade_medida || 'un';
          current.custo_unitario = found.preco_medio_custo || 0;
          current.is_novo_insumo = false;
        }
      } else if (field === 'insumo_id' && value === 'novo') {
        current.is_novo_insumo = true;
        current.insumo_nome = '';
      }

      updated[index] = current;
      return updated;
    });
  };

  const valorTotal = itens.reduce((acc, i) => acc + ((Number(i.quantidade) || 0) * (Number(i.custo_unitario) || 0)), 0);

  const handleSubmitForm = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);

    if (itens.length === 0) {
      setErrorMsg('Adicione ao menos um item à entrada.');
      return;
    }

    for (let idx = 0; idx < itens.length; idx++) {
      const item = itens[idx];
      if (!item.insumo_id || (item.is_novo_insumo && !item.insumo_nome.trim())) {
        setErrorMsg(`Selecione ou informe o nome do insumo no item ${idx + 1}.`);
        return;
      }
      if (item.quantidade <= 0) {
        setErrorMsg(`A quantidade no item ${idx + 1} deve ser maior que zero.`);
        return;
      }
      if (item.custo_unitario < 0) {
        setErrorMsg(`O custo unitário no item ${idx + 1} não pode ser negativo.`);
        return;
      }
    }

    const payload = {
      distribuidor_id: isNovoDistribuidor ? null : (distribuidorId || null),
      distribuidor_nome_fantasia: isNovoDistribuidor ? distribuidorNome : null,
      distribuidor_cnpj: isNovoDistribuidor ? distribuidorCnpj : null,
      numero_documento: numeroDocumento,
      data_emissao: dataEmissao,
      observacao: observacao,
      itens: itens.map(i => ({
        insumo_id: i.is_novo_insumo ? `ins-${i.insumo_nome.toLowerCase().trim().replace(/\s+/g, '-')}` : i.insumo_id,
        insumo_nome: i.is_novo_insumo ? i.insumo_nome : null,
        quantidade: Number(i.quantidade),
        unidade_medida: i.unidade_medida,
        custo_unitario: Number(i.custo_unitario)
      }))
    };

    try {
      setIsSubmitting(true);
      await onSubmit(payload);
      onClose();
    } catch (err: any) {
      setErrorMsg(err.message || 'Erro ao registrar entrada manual.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      className="fixed inset-0 bg-black/85 backdrop-blur-xs z-50 flex items-center justify-center p-4 overflow-y-auto cursor-pointer"
    >
      <div className="w-full max-w-3xl bg-[#121214] border border-[#27272A] rounded-3xl p-6 space-y-4 text-left shadow-2xl relative animate-scale-in my-8 max-h-[90vh] flex flex-col">
        {/* Modal Header */}
        <div className="flex justify-between items-center pb-2 border-b border-[#27272A] shrink-0">
          <div>
            <h3 className="font-serif text-sm font-bold text-white">Nova Entrada Manual de Estoque</h3>
            <p className="text-[9px] text-gray-400">Registre recebimento de insumos com recálculo de custo médio ponderado.</p>
          </div>
          <button type="button" onClick={onClose} className="p-1 text-gray-400 hover:text-white transition-colors cursor-pointer">
            <X size={16} />
          </button>
        </div>

        {errorMsg && (
          <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-xl text-red-400 text-xs shrink-0">
            {errorMsg}
          </div>
        )}

        <form onSubmit={handleSubmitForm} className="space-y-4 flex-1 overflow-y-auto pr-1">
          {/* Header Info: Fornecedor, Doc, Data */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 bg-[#1C1C1F]/40 p-4 rounded-2xl border border-[#27272A]/60">
            <div className="space-y-1 md:col-span-1">
              <div className="flex justify-between items-center">
                <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Fornecedor:</label>
                <button
                  type="button"
                  onClick={() => { setIsNovoDistribuidor(!isNovoDistribuidor); setDistribuidorId(''); }}
                  className="text-[9px] text-emerald-400 hover:underline"
                >
                  {isNovoDistribuidor ? 'Selecionar Existente' : '+ Criar Fornecedor'}
                </button>
              </div>

              {!isNovoDistribuidor ? (
                <select
                  value={distribuidorId}
                  onChange={(e) => setDistribuidorId(e.target.value)}
                  className="w-full px-3 py-2 bg-[#121214] border border-[#27272A] rounded-xl text-white text-xs focus:outline-none focus:border-emerald-500"
                >
                  <option value="">-- Selecione (Opcional) --</option>
                  {distribuidores.map(d => (
                    <option key={d.id} value={d.id}>{d.nome_fantasia} {d.cnpj ? `(${d.cnpj})` : ''}</option>
                  ))}
                </select>
              ) : (
                <div className="space-y-1.5">
                  <input
                    type="text"
                    required
                    placeholder="Nome Fantasia do Fornecedor"
                    value={distribuidorNome}
                    onChange={(e) => setDistribuidorNome(e.target.value)}
                    className="w-full px-3 py-1.5 bg-[#121214] border border-[#27272A] rounded-xl text-white text-xs focus:outline-none focus:border-emerald-500"
                  />
                  <input
                    type="text"
                    placeholder="CNPJ (opcional)"
                    value={distribuidorCnpj}
                    onChange={(e) => setDistribuidorCnpj(e.target.value)}
                    className="w-full px-3 py-1.5 bg-[#121214] border border-[#27272A] rounded-xl text-white text-xs focus:outline-none focus:border-emerald-500 font-mono"
                  />
                </div>
              )}
            </div>

            <div className="space-y-1">
              <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider block">Nº Documento / Nota:</label>
              <input
                type="text"
                placeholder="ex: NF-12345"
                value={numeroDocumento}
                onChange={(e) => setNumeroDocumento(e.target.value)}
                className="w-full px-3 py-2 bg-[#121214] border border-[#27272A] rounded-xl text-white text-xs focus:outline-none focus:border-emerald-500 font-mono"
              />
            </div>

            <div className="space-y-1">
              <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider block">Data de Emissão:</label>
              <input
                type="date"
                value={dataEmissao}
                onChange={(e) => setDataEmissao(e.target.value)}
                className="w-full px-3 py-2 bg-[#121214] border border-[#27272A] rounded-xl text-white text-xs focus:outline-none focus:border-emerald-500 font-mono"
              />
            </div>
          </div>

          {/* Dynamic Items Table */}
          <div className="space-y-2">
            <div className="flex justify-between items-center">
              <span className="text-[10px] font-bold text-gray-300 uppercase tracking-wider">Itens da Entrada</span>
              <button
                type="button"
                onClick={handleAddItem}
                className="px-2.5 py-1 bg-emerald-600/20 hover:bg-emerald-600/30 border border-emerald-500/30 text-emerald-400 rounded-lg text-[9px] font-bold uppercase tracking-wider transition-all cursor-pointer flex items-center gap-1"
              >
                <Plus size={12} />
                <span>Adicionar Item</span>
              </button>
            </div>

            <div className="space-y-2">
              {itens.map((item, idx) => (
                <div key={idx} className="grid grid-cols-12 gap-2 items-center bg-[#1C1C1F]/60 border border-[#27272A] p-2.5 rounded-2xl">
                  {/* Insumo selector / inline text */}
                  <div className="col-span-5 space-y-1">
                    {!item.is_novo_insumo ? (
                      <select
                        value={item.insumo_id}
                        onChange={(e) => handleItemChange(idx, 'insumo_id', e.target.value)}
                        className="w-full px-2.5 py-1.5 bg-[#121214] border border-[#27272A] rounded-xl text-white text-xs focus:outline-none focus:border-emerald-500"
                      >
                        <option value="">-- Selecione o Insumo --</option>
                        {insumos.map(ins => (
                          <option key={ins.id} value={ins.id}>{ins.nome} ({ins.unidade_medida}) - Atual: {ins.estoque_atual}</option>
                        ))}
                        <option value="novo">+ Cadastrar Novo Insumo Inline</option>
                      </select>
                    ) : (
                      <div className="flex items-center gap-1">
                        <input
                          type="text"
                          required
                          placeholder="Nome do Novo Insumo"
                          value={item.insumo_nome}
                          onChange={(e) => handleItemChange(idx, 'insumo_nome', e.target.value)}
                          className="w-full px-2.5 py-1.5 bg-[#121214] border border-[#27272A] rounded-xl text-white text-xs focus:outline-none focus:border-emerald-500"
                        />
                        <button
                          type="button"
                          onClick={() => handleItemChange(idx, 'insumo_id', '')}
                          className="text-[8px] text-gray-400 hover:text-white whitespace-nowrap"
                        >
                          Voltar
                        </button>
                      </div>
                    )}
                  </div>

                  {/* Quantity */}
                  <div className="col-span-2">
                    <input
                      type="number"
                      step="0.01"
                      min="0.01"
                      required
                      placeholder="Qtd"
                      value={item.quantidade}
                      onChange={(e) => handleItemChange(idx, 'quantidade', parseFloat(e.target.value) || 0)}
                      className="w-full px-2.5 py-1.5 bg-[#121214] border border-[#27272A] rounded-xl text-white text-xs text-center focus:outline-none focus:border-emerald-500 font-mono"
                    />
                  </div>

                  {/* Unit */}
                  <div className="col-span-2">
                    <select
                      value={item.unidade_medida}
                      onChange={(e) => handleItemChange(idx, 'unidade_medida', e.target.value)}
                      className="w-full px-2 py-1.5 bg-[#121214] border border-[#27272A] rounded-xl text-white text-xs text-center focus:outline-none focus:border-emerald-500"
                    >
                      <option value="un">un</option>
                      <option value="kg">kg</option>
                      <option value="g">g</option>
                      <option value="l">l</option>
                      <option value="ml">ml</option>
                    </select>
                  </div>

                  {/* Unit Cost */}
                  <div className="col-span-2">
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      required
                      placeholder="R$ Unit"
                      value={item.custo_unitario}
                      onChange={(e) => handleItemChange(idx, 'custo_unitario', parseFloat(e.target.value) || 0)}
                      className="w-full px-2.5 py-1.5 bg-[#121214] border border-[#27272A] rounded-xl text-white text-xs text-right focus:outline-none focus:border-emerald-500 font-mono"
                    />
                  </div>

                  {/* Remove Button */}
                  <div className="col-span-1 text-center">
                    <button
                      type="button"
                      disabled={itens.length === 1}
                      onClick={() => handleRemoveItem(idx)}
                      className="p-1 text-gray-500 hover:text-red-400 disabled:opacity-30 transition-colors cursor-pointer"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Note & Grand Total Footer */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 items-end pt-2 border-t border-[#27272A]">
            <div className="md:col-span-2 space-y-1">
              <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider block">Observação:</label>
              <input
                type="text"
                placeholder="ex: Entrega recebida sem avarias pelo estoquista João"
                value={observacao}
                onChange={(e) => setObservacao(e.target.value)}
                className="w-full px-3 py-1.5 bg-[#1C1C1F] border border-[#27272A] rounded-xl text-white text-xs focus:outline-none focus:border-emerald-500"
              />
            </div>

            <div className="text-right bg-[#1C1C1F]/60 p-3 rounded-2xl border border-[#27272A]">
              <span className="text-[9px] uppercase tracking-wider text-gray-400 font-bold block">Valor Total Automático</span>
              <strong className="text-sm font-mono text-emerald-400">R$ {valorTotal.toFixed(2)}</strong>
            </div>
          </div>

          {/* Modal Actions */}
          <div className="flex gap-2 pt-2 border-t border-[#27272A] shrink-0">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 py-2.5 border border-zinc-800 hover:border-zinc-700 bg-zinc-900 text-gray-400 hover:text-white rounded-xl text-[10px] font-bold uppercase tracking-wider transition-colors cursor-pointer"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="flex-1 py-2.5 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white rounded-xl text-[10px] font-bold uppercase tracking-wider transition-colors cursor-pointer shadow-sm"
            >
              {isSubmitting ? 'Gravando Entrada...' : 'Confirmar Entrada'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
