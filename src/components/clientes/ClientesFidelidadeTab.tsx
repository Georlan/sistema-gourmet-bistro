import React from 'react';
import clsx from 'clsx';

export interface LoyaltyUser {
  id: string;
  cliente: string;
  telefone: string;
  pontos: number;
  saldoCashback: number;
}

export interface ClientesFidelidadeTabProps {
  loyaltyUsers: LoyaltyUser[];
  fidelidadeConfig: { tipo_recompensa: string };
  formatarTelefoneTabela: (tel?: string) => string;
  aplicarMascaraTelefoneInput: (valor: string) => string;
  onOpenNewModal: () => void;
  onOpenEditModal: (user: LoyaltyUser) => void;
}

export function ClientesFidelidadeTab({
  loyaltyUsers,
  fidelidadeConfig,
  formatarTelefoneTabela,
  aplicarMascaraTelefoneInput,
  onOpenNewModal,
  onOpenEditModal
}: ClientesFidelidadeTabProps) {
  return (
    <div className={clsx('bg-[#121214]/60', 'border', 'border-[#27272A]', 'rounded-3xl', 'p-5', 'space-y-4', 'text-left', 'animate-fade-in', 'max-w-3xl')}>
      <div className="flex justify-between items-center border-b border-[#27272A] pb-2">
        <span className={clsx('font-serif', 'font-bold', 'text-gray-300')}>CRM — Cadastro de Clientes</span>
        <button
          type="button"
          onClick={onOpenNewModal}
          className="px-3 py-1 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-[9px] font-bold uppercase tracking-wider transition-all cursor-pointer shadow-sm"
        >
          + Novo Cliente
        </button>
      </div>
      <div className={clsx('overflow-hidden', 'border', 'border-[#27272A]/40', 'rounded-2xl')}>
        <table className={clsx('w-full', 'text-left', 'text-[10px]')}>
          <thead>
            <tr className={clsx('bg-[#1C1C1F]', 'border-b', 'border-[#27272A]', 'text-gray-400', 'uppercase', 'tracking-wider', 'font-bold')}>
              <th className="p-3.5">WhatsApp</th>
              <th className="p-3.5">Nome</th>
              <th className={clsx('p-3.5', 'font-mono')}>Saldo</th>
              <th className={clsx('p-3.5', 'text-right')}>Ações</th>
            </tr>
          </thead>
          <tbody className={clsx('divide-y', 'divide-[#27272A]/40')}>
            {loyaltyUsers.map((user) => (
              <tr key={user.id} className={clsx('hover:bg-[#1C1C1F]/20', 'transition-colors')}>
                <td className={clsx('p-3.5', 'font-mono', 'text-gray-300')}>{formatarTelefoneTabela(user.telefone)}</td>
                <td className={clsx('p-3.5', 'font-bold', 'text-white')}>{user.cliente}</td>
                <td className={clsx('p-3.5', 'font-mono', 'text-emerald-400')}>
                  {fidelidadeConfig.tipo_recompensa === 'PONTOS' ? `${user.pontos} pts` : `R$ ${user.saldoCashback.toFixed(2)}`}
                </td>
                <td className={clsx('p-3.5', 'text-right')}>
                  <button
                    onClick={() => onOpenEditModal(user)}
                    className="px-2.5 py-1 border border-zinc-800 hover:border-zinc-700 bg-zinc-900/50 hover:bg-zinc-800 text-gray-300 hover:text-white rounded-lg transition-all cursor-pointer font-bold"
                  >
                    Editar
                  </button>
                </td>
              </tr>
            ))}
            {loyaltyUsers.length === 0 && (
              <tr>
                <td colSpan={4} className="p-8 text-center text-gray-500">
                  Nenhum cliente cadastrado. O primeiro cadastro feito aqui, no balcão ou no cardápio aparecerá automaticamente.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
