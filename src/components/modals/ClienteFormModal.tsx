import React from 'react';
import { X } from 'lucide-react';

export interface ClienteFormModalProps {
  showNewCrmModal: boolean;
  onClose: () => void;
  newCrmNome: string;
  setNewCrmNome: (v: string) => void;
  newCrmTelefone: string;
  setNewCrmTelefone: (v: string) => void;
  newCrmSaldo: string;
  setNewCrmSaldo: (v: string) => void;
  fidelidadeConfig: { tipo_recompensa: string };
  aplicarMascaraTelefoneInput: (v: string) => string;
  handleCreateClient: (nome: string, telefone: string, saldo: number) => Promise<boolean>;
}

export function ClienteFormModal({
  showNewCrmModal,
  onClose,
  newCrmNome,
  setNewCrmNome,
  newCrmTelefone,
  setNewCrmTelefone,
  newCrmSaldo,
  setNewCrmSaldo,
  fidelidadeConfig,
  aplicarMascaraTelefoneInput,
  handleCreateClient
}: ClienteFormModalProps) {
  if (!showNewCrmModal) return null;

  return (
    <div
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      className="fixed inset-0 bg-black/85 backdrop-blur-xs z-50 flex items-center justify-center p-4 overflow-y-auto cursor-pointer"
    >
      <div className="w-full max-w-md bg-[#121214] border border-[#27272A] rounded-3xl p-6 space-y-4 text-left shadow-2xl relative animate-scale-in my-8">
        <div className="flex justify-between items-center pb-2 border-b border-[#27272A]">
          <h3 className="font-serif text-sm font-bold text-white">
            Cadastrar Novo Cliente
          </h3>
          <button 
            type="button" 
            onClick={onClose} 
            className="p-1 text-gray-400 hover:text-white transition-colors cursor-pointer border border-transparent"
          >
            <X size={16} />
          </button>
        </div>

        <form
          onSubmit={async (e) => {
            e.preventDefault();
            if (!newCrmNome.trim() || !newCrmTelefone.trim()) {
              alert('Preencha todos os campos!');
              return;
            }
            const created = await handleCreateClient(newCrmNome, newCrmTelefone, Number(newCrmSaldo));
            if (created) onClose();
          }}
          className="space-y-4"
        >
          <div className="space-y-1">
            <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider block">Telefone / WhatsApp:</label>
            <input
              type="tel"
              inputMode="numeric"
              required
              autoFocus
              placeholder="(00) 00000-0000"
              value={newCrmTelefone}
              onChange={(e) => setNewCrmTelefone(aplicarMascaraTelefoneInput(e.target.value))}
              className="w-full px-3 py-2 bg-[#1C1C1F] border border-[#27272A] rounded-xl text-white focus:outline-none focus:border-[#10b981]"
            />
          </div>

          <div className="space-y-1">
            <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider block">Nome:</label>
            <input
              type="text"
              required
              value={newCrmNome}
              onChange={(e) => setNewCrmNome(e.target.value)}
              className="w-full px-3 py-2 bg-[#1C1C1F] border border-[#27272A] rounded-xl text-white focus:outline-none focus:border-[#10b981]"
            />
          </div>

          <div className="space-y-1">
            <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider block">
              {fidelidadeConfig.tipo_recompensa === 'PONTOS' ? 'Pontos Iniciais:' : 'Cashback Inicial R$:'}
            </label>
            <input
              type="number"
              step={fidelidadeConfig.tipo_recompensa === 'PONTOS' ? '1' : '0.01'}
              value={newCrmSaldo}
              onChange={(e) => setNewCrmSaldo(e.target.value)}
              className="w-full px-3 py-2 bg-[#1C1C1F] border border-[#27272A] rounded-xl text-white focus:outline-none focus:border-[#10b981] font-mono text-xs"
            />
          </div>

          <div className="flex gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 py-2 border border-zinc-800 hover:border-zinc-700 bg-zinc-950 text-gray-400 hover:text-white rounded-xl text-[10px] font-bold uppercase tracking-wider transition-colors cursor-pointer"
            >
              Cancelar
            </button>
            <button
              type="submit"
              className="flex-1 py-2 bg-[#10b981] hover:bg-[#059669] text-[#121214] rounded-xl text-[10px] font-bold uppercase tracking-wider transition-colors cursor-pointer"
            >
              Salvar
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
