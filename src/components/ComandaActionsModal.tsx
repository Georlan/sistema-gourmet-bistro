import React from 'react';
import { Order } from '../types';

/**
 * Compatibilidade temporária para uma superfície legada de CaixaPanel.
 *
 * O estado que alimentava este modal não é mais ativado no painel atual. A
 * implementação antiga calculava desconto/total no frontend e poderia voltar
 * a introduzir uma autoridade financeira paralela caso fosse reutilizada.
 * Enquanto o esqueleto JSX residual não for removido do CaixaPanel, este shim
 * mantém a interface compilável sem executar impressão, pagamento ou checkout.
 */
export interface ComandaActionsModalProps {
  isOpen: boolean;
  onClose: () => void;
  comanda: Order | null;
  onPrintKitchen: (comandaId: string) => Promise<void>;
  onPrintBill: (comandaId: string) => Promise<void>;
  onFinalizeOrder: (comandaId: string, totalFinal: number, metodoPagamento: string) => Promise<void>;
}

export const ComandaActionsModal: React.FC<ComandaActionsModalProps> = () => null;

export default ComandaActionsModal;
