import React from 'react';
import clsx from 'clsx';
import { FileText, Plus, RefreshCw } from 'lucide-react';
import { EntradaEstoque, Distribuidor, Insumo } from '../../types';
import { formatBackendDateTime } from '../../utils/dateTime';

interface EstoqueEntradasTabProps {
  entradas: EntradaEstoque[];
  notasEntradaXml: any[];
  distribuidores: Distribuidor[];
  insumos: Insumo[];
  isLoading: boolean;
  onOpenNovaEntradaModal: () => void;
  onUploadXmlFile: (file: File) => void;
  xmlUploadState: { loading: boolean; error: string | null; result: any | null; isDragging: boolean };
  onResetXmlState: () => void;
  xmlFileInputRef: React.RefObject<HTMLInputElement>;
}

export const EstoqueEntradasTab: React.FC<EstoqueEntradasTabProps> = ({
  entradas,
  notasEntradaXml,
  isLoading,
  onOpenNovaEntradaModal,
  onUploadXmlFile,
  xmlUploadState,
  onResetXmlState,
  xmlFileInputRef
}) => {
  return (
    <div className="space-y-5 text-left animate-fade-in">
      {/* Action Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 bg-koma-panel/60 border border-koma-border p-4 rounded-3xl">
        <div>
          <h3 className="font-serif text-sm font-bold text-koma-foreground">Histórico de Entradas de Estoque</h3>
          <p className="text-[10px] text-koma-subtle">Registre entradas manuais com nota/documento ou importe arquivos XML de NF-e.</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => xmlFileInputRef.current?.click()}
            className="px-3.5 py-2 bg-sky-600/20 hover:bg-sky-600/30 border border-sky-500/30 text-sky-300 rounded-xl text-[10px] font-bold uppercase tracking-wider transition-all cursor-pointer flex items-center gap-1.5"
          >
            <FileText size={14} />
            <span>Importar XML</span>
          </button>
          <button
            type="button"
            onClick={onOpenNovaEntradaModal}
            className="px-3.5 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-[10px] font-bold uppercase tracking-wider transition-all cursor-pointer flex items-center gap-1.5 shadow-sm"
          >
            <Plus size={14} />
            <span>Nova Entrada Manual</span>
          </button>
        </div>
      </div>

      {/* Hidden file input for XML */}
      <input
        ref={xmlFileInputRef}
        type="file"
        accept=".xml"
        className="hidden"
        onChange={(e) => {
          if (e.target.files?.[0]) onUploadXmlFile(e.target.files[0]);
          e.target.value = '';
        }}
      />

      {/* XML Upload State Alert */}
      {xmlUploadState.loading && (
        <div className="bg-sky-500/10 border border-sky-500/20 rounded-2xl p-4 flex items-center gap-3 text-sky-400">
          <RefreshCw size={18} className="animate-spin" />
          <span className="text-xs font-semibold">Processando arquivo XML de NF-e...</span>
        </div>
      )}

      {xmlUploadState.result && (
        <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-2xl p-4 space-y-2 text-left">
          <div className="flex justify-between items-center">
            <span className="text-xs font-bold text-emerald-400 uppercase tracking-wider">✓ NF-e Importada com Sucesso</span>
            <button onClick={onResetXmlState} className="text-[10px] text-koma-subtle hover:text-white cursor-pointer">Fechar</button>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-[10px] text-koma-secondary pt-1 font-mono">
            <div>Fornecedor: <strong className="text-koma-foreground">{xmlUploadState.result.fornecedor}</strong></div>
            <div>Criados: <strong className="text-emerald-400">{xmlUploadState.result.insumos_criados}</strong></div>
            <div>Atualizados: <strong className="text-sky-400">{xmlUploadState.result.insumos_atualizados}</strong></div>
            <div>Total: <strong className="text-koma-foreground">R$ {Number(xmlUploadState.result.valor_total || 0).toFixed(2)}</strong></div>
          </div>
        </div>
      )}

      {xmlUploadState.error && (
        <div className="bg-red-500/10 border border-red-500/20 rounded-2xl p-4 flex justify-between items-center text-red-400 text-xs">
          <span>✗ Erro na importação: {xmlUploadState.error}</span>
          <button onClick={onResetXmlState} className="text-[10px] text-koma-subtle hover:text-white cursor-pointer">Fechar</button>
        </div>
      )}

      {/* Unified Entradas Table */}
      <div className="bg-koma-panel/60 border border-koma-border rounded-3xl p-5 space-y-3">
        <div className="overflow-x-auto border border-koma-border rounded-2xl">
          <table className="w-full text-left text-[10px]">
            <thead>
              <tr className="bg-koma-raised border-b border-koma-border text-koma-subtle uppercase tracking-wider font-bold">
                <th className="p-3">Data</th>
                <th className="p-3">Doc / Nota</th>
                <th className="p-3">Fornecedor</th>
                <th className="p-3">Tipo</th>
                <th className="p-3 font-mono">Valor Total</th>
                <th className="p-3">Itens</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-koma-border">
              {entradas.length === 0 && notasEntradaXml.length === 0 ? (
                <tr>
                  <td colSpan={6} className="p-8 text-center text-koma-muted italic">
                    Nenhuma entrada registrada ainda. Clique em Nova Entrada Manual ou Importar XML.
                  </td>
                </tr>
              ) : (
                <>
                  {entradas.map((ent) => (
                    <tr key={ent.id} className="hover:bg-koma-raised/50 transition-colors">
                      <td className="p-3 text-koma-subtle whitespace-nowrap font-mono">
                        {formatBackendDateTime(ent.created_at)}
                      </td>
                      <td className="p-3 font-bold text-koma-foreground font-mono">{ent.numero_documento || 'S/N'}</td>
                      <td className="p-3 text-koma-secondary font-medium">{ent.distribuidor?.nome_fantasia || '—'}</td>
                      <td className="p-3">
                        <span className={clsx(
                          'px-2 py-0.5 rounded-full text-[8px] font-bold uppercase',
                          ent.tipo_entrada === 'XML' ? 'bg-sky-500/10 text-sky-400' : 'bg-emerald-500/10 text-emerald-400'
                        )}>
                          {ent.tipo_entrada || 'MANUAL'}
                        </span>
                      </td>
                      <td className="p-3 font-mono font-bold text-emerald-400">R$ {Number(ent.valor_total).toFixed(2)}</td>
                      <td className="p-3 text-koma-subtle text-[9px]">
                        {ent.itens?.map(i => `${i.quantidade}x ${i.insumo?.nome || i.insumo_id}`).join(', ') || 'Sem detalhes'}
                      </td>
                    </tr>
                  ))}

                  {/* Existing XML entries fallback list if not in entradas */}
                  {notasEntradaXml.filter(n => !entradas.some(e => e.numero_documento === n.numero_nota)).map((nota) => (
                    <tr key={nota.id} className="hover:bg-koma-raised/50 transition-colors opacity-90">
                      <td className="p-3 text-koma-subtle whitespace-nowrap font-mono">
                        {nota.data_emissao ? formatBackendDateTime(nota.data_emissao, { dateStyle: 'short' }) : '—'}
                      </td>
                      <td className="p-3 font-bold text-koma-foreground font-mono">NF-{nota.numero_nota}</td>
                      <td className="p-3 text-koma-secondary font-medium">{nota.distribuidor?.nome_fantasia || '—'}</td>
                      <td className="p-3">
                        <span className="px-2 py-0.5 rounded-full text-[8px] font-bold uppercase bg-sky-500/10 text-sky-400">
                          XML
                        </span>
                      </td>
                      <td className="p-3 font-mono font-bold text-emerald-400">R$ {Number(nota.valor_total).toFixed(2)}</td>
                      <td className="p-3 text-koma-subtle text-[9px]">
                        {nota.itens?.map((i: any) => `${i.quantidade}x ${i.insumo?.nome || i.insumo_id}`).join(', ') || 'Importação XML'}
                      </td>
                    </tr>
                  ))}
                </>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
