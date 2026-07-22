import React, { useState } from 'react';
import clsx from 'clsx';
import { X, Search, Download, ShoppingBag } from 'lucide-react';

export interface VendaDetalheItem {
  id: number;
  data_hora: string;
  numero_pedido: number;
  valor_total: number;
  forma_pagamento: string;
  operador: string;
  status: string;
}

interface VendasDetalhesDrawerProps {
  onClose: () => void;
  vendas: VendaDetalheItem[];
  isLoading: boolean;
  dataInicio: string;
  dataFim: string;
}

export const VendasDetalhesDrawer: React.FC<VendasDetalhesDrawerProps> = ({
  onClose,
  vendas,
  isLoading,
  dataInicio,
  dataFim,
}) => {
  const [searchTerm, setSearchTerm] = useState('');

  const filteredVendas = vendas.filter(v => {
    const search = searchTerm.toLowerCase();
    return (
      String(v.numero_pedido).includes(search) ||
      v.operador.toLowerCase().includes(search) ||
      v.forma_pagamento.toLowerCase().includes(search)
    );
  });

  const handleExportCsv = () => {
    if (!vendas.length) return;
    let csv = 'Data/Hora;Número Pedido;Valor Total (R$);Forma de Pagamento;Operador;Status\n';
    filteredVendas.forEach(v => {
      csv += `"${v.data_hora}";${v.numero_pedido};${v.valor_total.toFixed(2)};"${v.forma_pagamento}";"${v.operador}";"${v.status}"\n`;
    });
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `vendas_detalhadas_${dataInicio}_a_${dataFim}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div
      className={clsx('fixed', 'inset-0', 'z-50', 'bg-black/80', 'backdrop-blur-sm', 'flex', 'justify-end', 'animate-fade-in')}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className={clsx('bg-[#121214]', 'border-l', 'border-[#27272A]', 'w-full', 'max-w-2xl', 'h-full', 'flex', 'flex-col', 'p-6', 'space-y-4', 'text-left')}>
        {/* Header */}
        <div className="flex justify-between items-center border-b border-[#27272A] pb-4">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-[#10b981]/15 border border-[#10b981]/30 flex items-center justify-center text-[#10b981]">
              <ShoppingBag size={18} />
            </div>
            <div>
              <h3 className="font-serif font-bold text-base text-white">Detalhamento de Vendas</h3>
              <p className="text-[10px] text-gray-400">
                Período: {dataInicio} até {dataFim} ({filteredVendas.length} pedidos)
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 hover:bg-[#27272A] rounded-full text-gray-400 hover:text-white transition-colors cursor-pointer"
          >
            <X size={18} />
          </button>
        </div>

        {/* Toolbar */}
        <div className="flex justify-between items-center gap-3">
          <div className="relative flex-1">
            <Search size={14} className="absolute left-3 top-2.5 text-gray-500" />
            <input
              type="text"
              placeholder="Buscar por n° pedido, operador ou pagamento..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-9 pr-3 py-1.5 bg-[#09090B] border border-[#27272A] rounded-xl text-white text-[10px]"
            />
          </div>

          <button
            type="button"
            onClick={handleExportCsv}
            disabled={!filteredVendas.length}
            className="px-3 py-1.5 bg-[#1C1C1F] hover:bg-[#27272A] border border-[#27272A] text-white rounded-xl text-[10px] font-bold transition-all cursor-pointer flex items-center gap-1.5 disabled:opacity-50"
          >
            <Download size={12} className="text-[#10b981]" />
            Exportar CSV
          </button>
        </div>

        {/* Table */}
        <div className="flex-1 overflow-y-auto border border-[#27272A]/60 rounded-2xl">
          {isLoading ? (
            <div className="p-8 text-center text-gray-400 text-xs animate-pulse">
              Carregando detalhamento de vendas...
            </div>
          ) : filteredVendas.length === 0 ? (
            <div className="p-8 text-center text-gray-500 text-xs">
              Nenhuma venda encontrada para o período selecionado.
            </div>
          ) : (
            <table className="w-full text-left text-[10px]">
              <thead className="bg-[#1C1C1F] border-b border-[#27272A] text-gray-400 uppercase tracking-wider font-bold sticky top-0">
                <tr>
                  <th className="p-3">Data / Hora</th>
                  <th className="p-3 font-mono">Pedido</th>
                  <th className="p-3 font-mono">Valor Total</th>
                  <th className="p-3">Pagamento</th>
                  <th className="p-3">Operador</th>
                  <th className="p-3 text-right">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#27272A]/40">
                {filteredVendas.map((v) => (
                  <tr key={v.id} className="hover:bg-[#1C1C1F]/40 transition-colors">
                    <td className="p-3 font-mono text-gray-300">
                      {new Date(v.data_hora).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}
                    </td>
                    <td className="p-3 font-mono font-bold text-white">#{v.numero_pedido}</td>
                    <td className="p-3 font-mono font-extrabold text-[#10b981]">
                      R$ {v.valor_total.toFixed(2)}
                    </td>
                    <td className="p-3 text-gray-300">{v.forma_pagamento}</td>
                    <td className="p-3 text-gray-300">{v.operador}</td>
                    <td className="p-3 text-right">
                      <span className="bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 text-[8px] font-bold px-2 py-0.5 rounded-full uppercase">
                        {v.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
};
