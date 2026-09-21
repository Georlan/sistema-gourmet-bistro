import React, { useState } from 'react';
import clsx from 'clsx';
import { Check, Copy, Share2, Smartphone } from 'lucide-react';
import { buildWhatsAppOrderReceipt, shareDigitalReceipt } from './digitalReceipt';
import type { Order, OrderItem } from '../../../types';
import { formatWhatsAppPhone } from '../../../config/whatsappUtils';

interface Props {
  order: Partial<Order> & {
    itens?: readonly (OrderItem & { preco_unit?: number; quantidade?: number })[];
    identificador?: string;
    mesaId?: number;
    numeroPedido?: number | string;
    total?: number;
    valorPago?: number;
    clientePhone?: string | null;
    telefone?: string | null;
  };
  restaurantConfig?: Record<string, unknown> | null;
  taxaServicoAtiva?: boolean;
  serviceTaxRate?: number;
  compact?: boolean;
  label?: string;
  className?: string;
  onToast?: (msg: string, type: 'success' | 'error' | 'info') => void;
}

export const DigitalReceiptAction: React.FC<Props> = ({
  order,
  restaurantConfig,
  taxaServicoAtiva,
  serviceTaxRate,
  compact = false,
  label = 'Conta digital / WhatsApp',
  className,
  onToast,
}) => {
  const [copied, setCopied] = useState(false);

  const phone = order.clientePhone || order.telefone;
  const hasDirectPhone = Boolean(phone && formatWhatsAppPhone(phone));

  const handleShare = async (e?: React.MouseEvent) => {
    if (e) e.stopPropagation();

    const text = buildWhatsAppOrderReceipt(
      order,
      {
        nome: String(restaurantConfig?.nome || restaurantConfig?.restaurant_name || ''),
        telefone: String(restaurantConfig?.telefone || ''),
        chave_pix: String(restaurantConfig?.chave_pix || restaurantConfig?.pix_chave || ''),
      },
      { taxaServicoAtiva, serviceTaxRate }
    );

    const success = await shareDigitalReceipt({
      text,
      phone,
      onSuccess: (msg) => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2500);
        onToast?.(msg, 'success');
      },
      onError: () => {
        onToast?.('Não foi possível compartilhar a conta.', 'error');
      },
    });

    if (success && !hasDirectPhone) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    }
  };

  if (compact) {
    return (
      <button
        type="button"
        onClick={handleShare}
        className={clsx(
          'p-1.5 rounded-lg border transition-all cursor-pointer flex items-center justify-center',
          copied
            ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/40'
            : 'bg-koma-panel hover:bg-koma-raised text-koma-muted hover:text-koma-foreground border-koma-border',
          className
        )}
        title={hasDirectPhone ? 'Enviar conta para o WhatsApp do cliente' : 'Compartilhar ou copiar conta digital'}
        aria-label={`Compartilhar conta de ${order.identificador || order.mesaId || 'pedido'}`}
      >
        {copied ? <Check size={13} className="text-emerald-400" /> : hasDirectPhone ? <Smartphone size={13} className="text-emerald-500" /> : <Share2 size={13} />}
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={handleShare}
      className={clsx(
        'px-3 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center justify-center gap-1.5 border',
        copied
          ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/40'
          : 'bg-koma-panel hover:bg-koma-raised text-koma-secondary hover:text-koma-foreground border-koma-border shadow-xs',
        className
      )}
      title={hasDirectPhone ? 'Enviar conta para o WhatsApp do cliente' : 'Compartilhar ou copiar conta digital'}
    >
      {copied ? (
        <>
          <Check size={14} className="text-emerald-400" />
          <span>Copiado!</span>
        </>
      ) : hasDirectPhone ? (
        <>
          <Smartphone size={14} className="text-emerald-500" />
          <span>{label}</span>
        </>
      ) : (
        <>
          <Copy size={14} />
          <span>{label}</span>
        </>
      )}
    </button>
  );
};
