import React, { useEffect, useRef, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  Image as ImageIcon,
  Loader2,
  RefreshCw,
  Trash2,
  Upload,
} from 'lucide-react';
import clsx from 'clsx';

interface CardapioAssetUploaderProps {
  label: string;
  type: 'logo' | 'banner';
  currentUrl: string;
  apiBaseUrl: string;
  authHeaders: Record<string, string>;
  onSuccess: (newUrl: string | null) => void;
}

type StatusType = 'idle' | 'uploading' | 'removing' | 'success' | 'error';

const ACCEPTED_TYPES = ['image/png', 'image/jpeg', 'image/jpg', 'image/webp'];
const MAX_SIZE = 5 * 1024 * 1024;

export const CardapioAssetUploader: React.FC<CardapioAssetUploaderProps> = ({
  label,
  type,
  currentUrl,
  apiBaseUrl,
  authHeaders,
  onSuccess,
}) => {
  const [status, setStatus] = useState<StatusType>('idle');
  const [feedbackText, setFeedbackText] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [hasImageError, setHasImageError] = useState(false);
  const [isConfirmingDelete, setIsConfirmingDelete] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    setHasImageError(false);
  }, [currentUrl]);

  useEffect(() => {
    if (status !== 'success' && status !== 'error') return;
    const timer = window.setTimeout(() => {
      setStatus('idle');
      setFeedbackText(null);
    }, 4000);
    return () => window.clearTimeout(timer);
  }, [status]);

  const handleFileUpload = async (file: File) => {
    if (!file) return;
    if (!ACCEPTED_TYPES.includes(file.type.toLowerCase())) {
      setStatus('error');
      setFeedbackText('Use PNG, JPG ou WEBP.');
      return;
    }
    if (file.size > MAX_SIZE) {
      setStatus('error');
      setFeedbackText('A imagem deve ter no máximo 5 MB.');
      return;
    }

    try {
      setStatus('uploading');
      setFeedbackText('Enviando imagem…');
      const formData = new FormData();
      formData.append('file', file);
      const headersToSend = { ...authHeaders };
      delete headersToSend['Content-Type'];

      const response = await fetch(`${apiBaseUrl}/api/cardapio-digital/assets/${type}`, {
        method: 'POST',
        headers: headersToSend,
        body: formData,
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data.detail || 'Falha ao enviar imagem.');
      }

      const updatedUrl = type === 'logo' ? data.logo_url : data.banner_url;
      setStatus('success');
      setFeedbackText('Imagem atualizada.');
      onSuccess(updatedUrl || null);
    } catch (error) {
      console.error(`Erro ao fazer upload da imagem (${type}):`, error);
      setStatus('error');
      setFeedbackText(error instanceof Error ? error.message : 'Erro de conexão ao enviar a imagem.');
    } finally {
      setIsDragging(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleRemoveAsset = async () => {
    try {
      setStatus('removing');
      setFeedbackText('Removendo imagem…');
      setIsConfirmingDelete(false);
      const response = await fetch(`${apiBaseUrl}/api/cardapio-digital/assets/${type}`, {
        method: 'DELETE',
        headers: authHeaders,
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data.detail || 'Falha ao remover a imagem.');
      }
      setStatus('success');
      setFeedbackText('Imagem removida.');
      onSuccess(null);
    } catch (error) {
      console.error(`Erro ao remover imagem (${type}):`, error);
      setStatus('error');
      setFeedbackText(error instanceof Error ? error.message : 'Erro de conexão ao remover a imagem.');
    }
  };

  const handleDrop = (event: React.DragEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setIsDragging(false);
    const file = event.dataTransfer.files?.[0];
    if (file) void handleFileUpload(file);
  };

  const isBusy = status === 'uploading' || status === 'removing';
  const helper = type === 'logo'
    ? 'Marca exibida no topo do cardápio.'
    : 'Capa horizontal exibida no cabeçalho.';

  return (
    <section className="rounded-2xl border border-koma-border bg-koma-card/45 p-3.5 text-left">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <button
          type="button"
          disabled={isBusy}
          onClick={() => fileInputRef.current?.click()}
          onDragOver={(event) => {
            event.preventDefault();
            setIsDragging(true);
          }}
          onDragEnter={(event) => {
            event.preventDefault();
            setIsDragging(true);
          }}
          onDragLeave={(event) => {
            event.preventDefault();
            if (!event.currentTarget.contains(event.relatedTarget as Node)) setIsDragging(false);
          }}
          onDrop={handleDrop}
          className={clsx(
            'relative flex shrink-0 items-center justify-center overflow-hidden rounded-xl border transition-all',
            type === 'logo' ? 'h-20 w-24' : 'h-20 w-full sm:w-36',
            isDragging
              ? 'border-emerald-500 bg-emerald-500/15 ring-2 ring-emerald-500/15'
              : 'border-koma-border bg-koma-raised hover:border-emerald-500/45',
            isBusy ? 'cursor-wait opacity-70' : 'cursor-pointer',
          )}
          aria-label={`Selecionar ${label}`}
        >
          {isBusy ? (
            <Loader2 size={22} className="animate-spin text-emerald-600 dark:text-emerald-300" />
          ) : currentUrl && !hasImageError ? (
            <img
              src={currentUrl}
              alt={label}
              onError={() => setHasImageError(true)}
              className={clsx(
                'h-full w-full',
                type === 'logo' ? 'object-contain p-2' : 'object-cover',
              )}
            />
          ) : (
            <div className="flex flex-col items-center gap-1 text-koma-muted">
              <ImageIcon size={20} />
              <span className="text-[9px] font-bold">Adicionar</span>
            </div>
          )}
          {isDragging && (
            <div className="absolute inset-0 flex items-center justify-center bg-koma-page/90 text-[9px] font-bold text-emerald-600 dark:text-emerald-300">
              Solte aqui
            </div>
          )}
        </button>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <h4 className="text-[11px] font-bold text-koma-foreground">{label}</h4>
              <p className="mt-0.5 text-[9px] leading-relaxed text-koma-muted">{helper}</p>
            </div>
            {feedbackText && (
              <span
                className={clsx(
                  'inline-flex items-center gap-1 rounded-lg border px-2 py-1 text-[9px] font-semibold',
                  status === 'success' && 'border-emerald-500/25 bg-emerald-500/10 text-emerald-600 dark:text-emerald-300',
                  status === 'error' && 'border-rose-500/25 bg-rose-500/10 text-rose-600 dark:text-rose-300',
                  isBusy && 'border-amber-500/25 bg-amber-500/10 text-amber-600 dark:text-amber-300',
                )}
              >
                {isBusy && <Loader2 size={10} className="animate-spin" />}
                {status === 'success' && <CheckCircle2 size={10} />}
                {status === 'error' && <AlertCircle size={10} />}
                {feedbackText}
              </span>
            )}
          </div>

          <p className="mt-2 text-[9px] text-koma-subtle">PNG, JPG ou WEBP · até 5 MB · clique ou arraste para substituir</p>

          <div className="mt-2.5 flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={isBusy}
              onClick={() => fileInputRef.current?.click()}
              className="inline-flex min-h-8 items-center gap-1.5 rounded-lg border border-koma-border bg-koma-panel px-2.5 py-1.5 text-[9px] font-bold text-koma-secondary transition hover:bg-koma-raised disabled:opacity-50"
            >
              {status === 'uploading' ? <Loader2 size={11} className="animate-spin" /> : currentUrl ? <RefreshCw size={11} /> : <Upload size={11} />}
              {currentUrl ? 'Trocar imagem' : 'Escolher imagem'}
            </button>

            {currentUrl && !isConfirmingDelete && (
              <button
                type="button"
                disabled={isBusy}
                onClick={() => setIsConfirmingDelete(true)}
                className="inline-flex min-h-8 items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[9px] font-bold text-rose-600 transition hover:bg-rose-500/10 dark:text-rose-300 disabled:opacity-50"
              >
                <Trash2 size={11} /> Remover
              </button>
            )}

            {isConfirmingDelete && (
              <div className="flex items-center gap-1.5 rounded-lg border border-rose-500/20 bg-rose-500/5 p-1">
                <span className="pl-1 text-[9px] font-semibold text-rose-600 dark:text-rose-300">Remover?</span>
                <button
                  type="button"
                  disabled={isBusy}
                  onClick={() => void handleRemoveAsset()}
                  className="rounded-md bg-rose-600 px-2 py-1 text-[9px] font-bold text-white"
                >
                  Sim
                </button>
                <button
                  type="button"
                  disabled={isBusy}
                  onClick={() => setIsConfirmingDelete(false)}
                  className="rounded-md px-2 py-1 text-[9px] font-bold text-koma-secondary"
                >
                  Não
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      <input
        type="file"
        ref={fileInputRef}
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void handleFileUpload(file);
        }}
        accept="image/png,image/jpeg,image/jpg,image/webp"
        className="hidden"
      />
    </section>
  );
};
