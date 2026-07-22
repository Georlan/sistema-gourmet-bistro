import React, { useState, useEffect } from 'react';
import clsx from 'clsx';
import { X, CheckCircle2, Save, Search, CheckSquare, Square } from 'lucide-react';
import { Insumo, SessaoContagemEstoque } from '../../types';

interface ItemCountState {
  insumo_id: string;
  insumo_nome: string;
  unidade_medida: string;
  quantidade_sistema: number;
  quantidade_contada: number;
  selected: boolean;
}

interface ContagemEstoqueModalProps {
  insumos: Insumo[];
  existingSessao?: SessaoContagemEstoque | null;
  onClose: () => void;
  onSaveDraft: (payload: { observacao: string; status: 'rascunho' | 'confirmada'; itens: { insumo_id: string; quantidade_contada: number }[] }) => Promise<void>;
  onConfirm: (payload: { observacao: string; status: 'rascunho' | 'confirmada'; itens: { insumo_id: string; quantidade_contada: number }[] }) => Promise<void>;
}

export const ContagemEstoqueModal: React.FC<ContagemEstoqueModalProps> = ({
  insumos,
  existingSessao,
  onClose,
  onSaveDraft,
  onConfirm
}) => {
  const [observacao, setObservacao] = useState<string>(existingSessao?.observacao || '');
  const [searchTerm, setSearchTerm] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const [countItems, setCountItems] = useState<ItemCountState[]>([]);

  useEffect(() => {
    const existingMap = new Map<string, number>();
    const existingSelected = new Set<string>();

    if (existingSessao && existingSessao.itens) {
      existingSessao.itens.forEach(item => {
        existingMap.set(item.insumo_id, item.quantidade_contada);
        existingSelected.add(item.insumo_id);
      });
    }

    const initial = insumos.map(ins => {
      const isSelected = existingSessao ? existingSelected.has(ins.id) : true;
      const countedQty = existingMap.has(ins.id) ? (existingMap.get(ins.id) ?? ins.estoque_atual) : ins.estoque_atual;
      return {
        insumo_id: ins.id,
        insumo_nome: ins.nome,
        unidade_medida: ins.unidade_medida || 'un',
        quantidade_sistema: ins.estoque_atual,
        quantidade_contada: countedQty,
        selected: isSelected
      };
    });

    setCountItems(initial);
  }, [insumos, existingSessao]);

  const handleToggleSelectAll = (select: boolean) => {
    setCountItems(prev => prev.map(i => ({ ...i, selected: select })));
  };

  const handleToggleItemSelect = (insumoId: string) => {
    setCountItems(prev => prev.map(i => i.insumo_id === insumoId ? { ...i, selected: !i.selected } : i));
  };

  const handleQtyChange = (insumoId: string, val: number) => {
    setCountItems(prev => prev.map(i => i.insumo_id === insumoId ? { ...i, quantidade_contada: val } : i));
  };

  const selectedItems = countItems.filter(i => i.selected);
  const totalDivergencias = selectedItems.filter(i => (i.quantidade_contada - i.quantidade_sistema) !== 0).length;

  const isAlreadyConfirmed = existingSessao?.status === 'confirmada';

  const handleSave = async (status: 'rascunho' | 'confirmada') => {
    setErrorMsg(null);
    if (selectedItems.length === 0) {
      setErrorMsg('Selecione ao menos um insumo para a contagem.');
      return;
    }

    const payload = {
      observacao,
      status,
      itens: selectedItems.map(i => ({
        insumo_id: i.insumo_id,
        quantidade_contada: Number(i.quantidade_contada)
      }))
    };

    try {
      setIsSubmitting(true);
      if (status === 'confirmada') {
        await onConfirm(payload);
      } else {
        await onSaveDraft(payload);
      }
      onClose();
    } catch (err: any) {
      setErrorMsg(err.message || 'Erro ao processar contagem.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const filteredItems = countItems.filter(i => i.insumo_nome.toLowerCase().includes(searchTerm.toLowerCase()));

  return (
    <div
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      className="fixed inset-0 bg-black/85 backdrop-blur-xs z-50 flex items-center justify-center p-4 overflow-y-auto cursor-pointer"
    >
      <div className="w-full max-w-4xl bg-[#121214] border border-[#27272A] rounded-3xl p-6 space-y-4 text-left shadow-2xl relative animate-scale-in my-8 max-h-[90vh] flex flex-col">
        {/* Modal Header */}
        <div className="flex justify-between items-center pb-2 border-b border-[#27272A] shrink-0">
          <div>
            <h3 className="font-serif text-sm font-bold text-white">
              {isAlreadyConfirmed ? 'Visualizar Contagem Confirmada' : existingSessao ? 'Editar Rascunho de Contagem' : 'Nova Contagem Física de Inventário'}
            </h3>
            <p className="text-[9px] text-gray-400">Informe os valores contados fisicamente. Ao confirmar, divergências gerarão ajustes automáticos.</p>
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

        {/* Toolbar: Search & Select All */}
        {!isAlreadyConfirmed && (
          <div className="flex flex-wrap items-center justify-between gap-3 bg-[#1C1C1F]/40 p-3 rounded-2xl border border-[#27272A]/60 shrink-0">
            <div className="flex items-center gap-2 flex-1 max-w-xs">
              <div className="relative w-full">
                <Search size={14} className="absolute left-3 top-2.5 text-gray-400" />
                <input
                  type="text"
                  placeholder="Buscar insumo..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="w-full pl-9 pr-3 py-1.5 bg-[#121214] border border-[#27272A] rounded-xl text-white text-xs focus:outline-none focus:border-emerald-500"
                />
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => handleToggleSelectAll(true)}
                className="px-2.5 py-1 bg-zinc-800 hover:bg-zinc-700 text-gray-300 rounded-lg text-[9px] font-bold uppercase transition-all cursor-pointer flex items-center gap-1"
              >
                <CheckSquare size={12} /> Selecionar Todos
              </button>
              <button
                type="button"
                onClick={() => handleToggleSelectAll(false)}
                className="px-2.5 py-1 bg-zinc-800 hover:bg-zinc-700 text-gray-300 rounded-lg text-[9px] font-bold uppercase transition-all cursor-pointer flex items-center gap-1"
              >
                <Square size={12} /> Desmarcar Todos
              </button>
            </div>
          </div>
        )}

        {/* Inventory Items Table */}
        <div className="flex-1 overflow-y-auto border border-[#27272A]/40 rounded-2xl">
          <table className="w-full text-left text-[10px]">
            <thead className="sticky top-0 bg-[#1C1C1F] border-b border-[#27272A] text-gray-400 uppercase tracking-wider font-bold z-10">
              <tr>
                {!isAlreadyConfirmed && <th className="p-3 w-10 text-center">Incluir</th>}
                <th className="p-3">Insumo</th>
                <th className="p-3 font-mono">Qtd Sistema</th>
                <th className="p-3 font-mono">Qtd Contada</th>
                <th className="p-3 font-mono">Divergência</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#27272A]/40">
              {filteredItems.map((item) => {
                const diff = item.quantidade_contada - item.quantidade_sistema;
                return (
                  <tr
                    key={item.insumo_id}
                    className={clsx(
                      'transition-colors',
                      !item.selected ? 'opacity-40 bg-[#121214]' : diff !== 0 ? 'bg-amber-500/5 hover:bg-amber-500/10' : 'hover:bg-[#1C1C1F]/20'
                    )}
                  >
                    {!isAlreadyConfirmed && (
                      <td className="p-3 text-center">
                        <input
                          type="checkbox"
                          checked={item.selected}
                          onChange={() => handleToggleItemSelect(item.insumo_id)}
                          className="accent-emerald-500 cursor-pointer h-4 w-4 rounded"
                        />
                      </td>
                    )}
                    <td className="p-3 font-semibold text-white">
                      {item.insumo_nome}
                      <span className="text-[8px] text-gray-500 block font-mono">ID: {item.insumo_id}</span>
                    </td>
                    <td className="p-3 font-mono text-gray-300">
                      {item.quantidade_sistema.toFixed(2)} <span className="text-gray-500">{item.unidade_medida}</span>
                    </td>
                    <td className="p-3 font-mono">
                      {!isAlreadyConfirmed && item.selected ? (
                        <input
                          type="number"
                          step="0.01"
                          min="0"
                          value={item.quantidade_contada}
                          onChange={(e) => handleQtyChange(item.insumo_id, parseFloat(e.target.value) || 0)}
                          className="w-24 px-2 py-1 bg-[#121214] border border-[#27272A] rounded-lg text-white font-mono text-xs text-center focus:outline-none focus:border-emerald-500"
                        />
                      ) : (
                        <span className="font-bold text-white">{item.quantidade_contada.toFixed(2)} {item.unidade_medida}</span>
                      )}
                    </td>
                    <td className="p-3 font-mono font-bold">
                      {diff === 0 ? (
                        <span className="text-gray-500">0.00 (Sem diferença)</span>
                      ) : diff > 0 ? (
                        <span className="text-emerald-400">+{diff.toFixed(2)} {item.unidade_medida}</span>
                      ) : (
                        <span className="text-red-400">{diff.toFixed(2)} {item.unidade_medida}</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Footer Summary & Note */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 items-end pt-2 border-t border-[#27272A] shrink-0">
          <div className="md:col-span-2 space-y-1">
            <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider block">Observação / Justificativa do Inventário:</label>
            <input
              type="text"
              disabled={isAlreadyConfirmed}
              placeholder="ex: Contagem física mensal realizada pelo gerente de turno"
              value={observacao}
              onChange={(e) => setObservacao(e.target.value)}
              className="w-full px-3 py-1.5 bg-[#1C1C1F] border border-[#27272A] rounded-xl text-white text-xs focus:outline-none focus:border-emerald-500"
            />
          </div>

          <div className="text-right bg-[#1C1C1F]/60 p-3 rounded-2xl border border-[#27272A]">
            <span className="text-[9px] uppercase tracking-wider text-gray-400 font-bold block">Resumo do Inventário</span>
            <div className="text-[10px] text-gray-300 font-mono">
              Itens selecionados: <strong className="text-white">{selectedItems.length}</strong> | Divergências: <strong className="text-amber-400">{totalDivergencias}</strong>
            </div>
          </div>
        </div>

        {/* Modal Actions */}
        <div className="flex gap-2 pt-2 border-t border-[#27272A] shrink-0">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 py-2.5 border border-zinc-800 hover:border-zinc-700 bg-zinc-900 text-gray-400 hover:text-white rounded-xl text-[10px] font-bold uppercase tracking-wider transition-colors cursor-pointer"
          >
            {isAlreadyConfirmed ? 'Fechar' : 'Cancelar'}
          </button>

          {!isAlreadyConfirmed && (
            <>
              <button
                type="button"
                disabled={isSubmitting}
                onClick={() => handleSave('rascunho')}
                className="flex-1 py-2.5 bg-zinc-800 hover:bg-zinc-700 text-amber-300 rounded-xl text-[10px] font-bold uppercase tracking-wider transition-colors cursor-pointer flex items-center justify-center gap-1.5"
              >
                <Save size={14} />
                <span>{isSubmitting ? 'Salvando...' : 'Salvar Rascunho'}</span>
              </button>
              <button
                type="button"
                disabled={isSubmitting}
                onClick={() => handleSave('confirmada')}
                className="flex-1 py-2.5 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white rounded-xl text-[10px] font-bold uppercase tracking-wider transition-colors cursor-pointer shadow-sm flex items-center justify-center gap-1.5"
              >
                <CheckCircle2 size={14} />
                <span>{isSubmitting ? 'Confirmando...' : 'Confirmar e Ajustar Saldo'}</span>
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
};
