import { useRef, useState } from 'react';
import { AlertCircle, CheckCircle2, Image as ImageIcon, Loader2, RefreshCw, Trash2, Upload } from 'lucide-react';
import clsx from 'clsx';

type AssetType = 'logo' | 'banner';
const ACCEPTED_TYPES = ['image/png', 'image/jpeg', 'image/jpg', 'image/webp'];
const MAX_SIZE = 5 * 1024 * 1024;

/** Uploads one asset; page composition and restaurant configuration belong to its caller. */
export function CardapioAssetUploader({
  type,
  label,
  currentUrl,
  apiBaseUrl,
  authHeaders,
  onChange,
}: {
  type: AssetType;
  label: string;
  currentUrl: string;
  apiBaseUrl: string;
  authHeaders: Record<string, string>;
  onChange: (url: string) => void;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [status, setStatus] = useState<'idle' | 'busy' | 'success' | 'error'>('idle');
  const [message, setMessage] = useState('');
  const [dragging, setDragging] = useState(false);

  const upload = async (file: File) => {
    if (!ACCEPTED_TYPES.includes(file.type.toLowerCase())) {
      setStatus('error');
      setMessage('Use PNG, JPG ou WEBP.');
      return;
    }
    if (file.size > MAX_SIZE) {
      setStatus('error');
      setMessage('A imagem deve ter no máximo 5 MB.');
      return;
    }

    setStatus('busy');
    setMessage('Enviando imagem…');
    try {
      const formData = new FormData();
      formData.append('file', file);
      const headers = { ...authHeaders };
      delete headers['Content-Type'];
      const response = await fetch(`${apiBaseUrl}/api/cardapio-digital/assets/${type}`, {
        method: 'POST',
        headers,
        body: formData,
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.detail || 'Não foi possível enviar a imagem.');
      onChange(String(type === 'logo' ? data.logo_url || '' : data.banner_url || ''));
      setStatus('success');
      setMessage('Imagem atualizada e publicada.');
    } catch (error) {
      setStatus('error');
      setMessage(error instanceof Error ? error.message : 'Erro de conexão ao enviar a imagem.');
    } finally {
      setDragging(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  const remove = async () => {
    setStatus('busy');
    setMessage('Removendo imagem…');
    try {
      const response = await fetch(`${apiBaseUrl}/api/cardapio-digital/assets/${type}`, {
        method: 'DELETE',
        headers: authHeaders,
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.detail || 'Não foi possível remover a imagem.');
      onChange('');
      setStatus('success');
      setMessage('Imagem removida.');
    } catch (error) {
      setStatus('error');
      setMessage(error instanceof Error ? error.message : 'Erro de conexão ao remover a imagem.');
    }
  };

  const isBusy = status === 'busy';

  return (
    <div className="rounded-2xl border border-koma-border bg-koma-card p-3.5 sm:p-4">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
        <button
          type="button"
          disabled={isBusy}
          onClick={() => inputRef.current?.click()}
          onDragOver={(event) => {
            event.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(event) => {
            event.preventDefault();
            setDragging(false);
            const file = event.dataTransfer.files?.[0];
            if (file) void upload(file);
          }}
          className={clsx(
            'relative flex shrink-0 items-center justify-center overflow-hidden rounded-2xl border bg-koma-raised transition',
            type === 'logo' ? 'h-28 w-28' : 'h-28 w-full sm:w-48',
            dragging ? 'border-emerald-500 ring-2 ring-emerald-500/20' : 'border-koma-border hover:border-emerald-500/45',
            isBusy && 'cursor-wait opacity-70',
          )}
        >
          {isBusy ? (
            <Loader2 size={22} className="animate-spin text-emerald-600 dark:text-emerald-300" />
          ) : currentUrl ? (
            <img
              src={currentUrl}
              alt={label}
              className={clsx('h-full w-full', type === 'logo' ? 'object-contain p-2' : 'object-cover')}
            />
          ) : (
            <div className="flex flex-col items-center gap-1.5 text-koma-muted">
              <ImageIcon size={22} />
              <span className="text-[9px] font-bold">Adicionar</span>
            </div>
          )}
          {dragging && (
            <div className="absolute inset-0 grid place-items-center bg-koma-page/90 text-[10px] font-black text-emerald-600">
              Solte aqui
            </div>
          )}
        </button>

        <div className="min-w-0 flex-1">
          <h4 className="text-xs font-black text-koma-foreground">{label}</h4>
          <p className="mt-1 text-[10px] leading-relaxed text-koma-muted">
            {type === 'logo'
              ? 'Use uma versão legível em fundo escuro. Formato quadrado funciona melhor.'
              : 'Use uma foto horizontal que represente bem o restaurante ou seus produtos.'}
          </p>
          <p className="mt-1.5 text-[9px] text-koma-subtle">PNG, JPG ou WEBP · até 5 MB</p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={isBusy}
              onClick={() => inputRef.current?.click()}
              className="inline-flex min-h-9 items-center gap-1.5 rounded-xl border border-koma-border bg-koma-panel px-3 py-2 text-[9px] font-bold text-koma-secondary transition hover:bg-koma-raised disabled:opacity-50"
            >
              {currentUrl ? <RefreshCw size={11} /> : <Upload size={11} />}
              {currentUrl ? 'Trocar imagem' : 'Escolher imagem'}
            </button>
            {currentUrl && (
              <button
                type="button"
                disabled={isBusy}
                onClick={() => void remove()}
                className="inline-flex min-h-9 items-center gap-1.5 rounded-xl px-3 py-2 text-[9px] font-bold text-rose-600 transition hover:bg-rose-500/10 dark:text-rose-300 disabled:opacity-50"
              >
                <Trash2 size={11} /> Remover
              </button>
            )}
          </div>
          {message && (
            <div
              className={clsx(
                'mt-2 inline-flex items-center gap-1.5 rounded-lg border px-2 py-1 text-[9px] font-semibold',
                status === 'success' && 'border-emerald-500/25 bg-emerald-500/10 text-emerald-600 dark:text-emerald-300',
                status === 'error' && 'border-rose-500/25 bg-rose-500/10 text-rose-600 dark:text-rose-300',
                status === 'busy' && 'border-amber-500/25 bg-amber-500/10 text-amber-600 dark:text-amber-300',
              )}
            >
              {status === 'busy' && <Loader2 size={10} className="animate-spin" />}
              {status === 'success' && <CheckCircle2 size={10} />}
              {status === 'error' && <AlertCircle size={10} />}
              {message}
            </div>
          )}
        </div>
      </div>
      <input
        ref={inputRef}
        type="file"
        accept="image/png,image/jpeg,image/jpg,image/webp"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void upload(file);
        }}
      />
    </div>
  );
}
