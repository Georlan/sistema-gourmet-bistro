import React, { useState, useRef, useEffect } from 'react';
import { Upload, Trash2, Image as ImageIcon, Loader2, CheckCircle2, AlertCircle, RefreshCw } from 'lucide-react';
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

export const CardapioAssetUploader: React.FC<CardapioAssetUploaderProps> = ({
  label,
  type,
  currentUrl,
  apiBaseUrl,
  authHeaders,
  onSuccess
}) => {
  const [status, setStatus] = useState<StatusType>('idle');
  const [feedbackText, setFeedbackText] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [hasImageError, setHasImageError] = useState(false);
  const [isConfirmingDelete, setIsConfirmingDelete] = useState(false);

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Reset image error state whenever currentUrl changes
  useEffect(() => {
    setHasImageError(false);
  }, [currentUrl]);

  // Clear temporary status messages after 4 seconds
  useEffect(() => {
    if (status === 'success' || status === 'error') {
      const timer = setTimeout(() => {
        setStatus('idle');
        setFeedbackText(null);
      }, 4000);
      return () => clearTimeout(timer);
    }
  }, [status]);

  const handleFileUpload = async (file: File) => {
    if (!file) return;

    // Frontend validation: MIME type check
    const validMimeTypes = ['image/png', 'image/jpeg', 'image/jpg', 'image/webp'];
    if (!validMimeTypes.includes(file.type.toLowerCase())) {
      setStatus('error');
      setFeedbackText('Formato inválido. Use apenas PNG, JPG, JPEG ou WEBP.');
      return;
    }

    // Frontend validation: Size limit 5 MB
    if (file.size > 5 * 1024 * 1024) {
      setStatus('error');
      setFeedbackText('Tamanho excedido. O limite máximo permitido é 5 MB.');
      return;
    }

    try {
      setStatus('uploading');
      setFeedbackText('Enviando...');

      const formData = new FormData();
      formData.append('file', file);

      const headersToSend = { ...authHeaders };
      delete headersToSend['Content-Type'];

      const response = await fetch(`${apiBaseUrl}/api/cardapio-digital/assets/${type}`, {
        method: 'POST',
        headers: headersToSend,
        body: formData
      });

      if (response.ok) {
        const data = await response.json();
        const updatedUrl = type === 'logo' ? data.logo_url : data.banner_url;
        setStatus('success');
        setFeedbackText('Imagem atualizada com sucesso!');
        onSuccess(updatedUrl);
      } else {
        const errData = await response.json().catch(() => ({}));
        setStatus('error');
        setFeedbackText(errData.detail || 'Falha ao enviar imagem para o servidor.');
      }
    } catch (err: any) {
      console.error(`Erro ao fazer upload da imagem (${type}):`, err);
      setStatus('error');
      setFeedbackText('Erro de conexão ao enviar a imagem.');
    } finally {
      setIsDragging(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  const handleRemoveAsset = async () => {
    try {
      setStatus('removing');
      setFeedbackText('Removendo...');
      setIsConfirmingDelete(false);

      const response = await fetch(`${apiBaseUrl}/api/cardapio-digital/assets/${type}`, {
        method: 'DELETE',
        headers: authHeaders
      });

      if (response.ok) {
        setStatus('success');
        setFeedbackText('Imagem removida com sucesso!');
        onSuccess(null);
      } else {
        const errData = await response.json().catch(() => ({}));
        setStatus('error');
        setFeedbackText(errData.detail || 'Falha ao remover a imagem.');
      }
    } catch (err: any) {
      console.error(`Erro ao remover imagem (${type}):`, err);
      setStatus('error');
      setFeedbackText('Erro de conexão ao remover a imagem.');
    }
  };

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    if (!isDragging) setIsDragging(true);
  };

  const handleDragEnter = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.currentTarget.contains(e.relatedTarget as Node)) return;
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);

    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      const file = e.dataTransfer.files[0];
      handleFileUpload(file);
    }
  };

  const isBusy = status === 'uploading' || status === 'removing';

  return (
    <div className="space-y-1.5 text-left">
      <div className="flex items-center justify-between">
        <label className="text-[10px] font-bold text-gray-300 uppercase tracking-wider block">
          {label}:
        </label>

        {/* Inline Feedback Badge */}
        {feedbackText && (
          <span
            className={clsx(
              'text-[9px] font-semibold flex items-center gap-1 px-2 py-0.5 rounded-md transition-all',
              status === 'uploading' || status === 'removing' ? 'bg-amber-950/40 text-amber-400 border border-amber-800/40' :
              status === 'success' ? 'bg-emerald-950/40 text-emerald-400 border border-emerald-800/40' :
              'bg-rose-950/40 text-rose-400 border border-rose-800/40'
            )}
          >
            {isBusy && <Loader2 size={10} className="animate-spin" />}
            {status === 'success' && <CheckCircle2 size={10} />}
            {status === 'error' && <AlertCircle size={10} />}
            {feedbackText}
          </span>
        )}
      </div>

      <input
        type="file"
        ref={fileInputRef}
        onChange={(e) => {
          if (e.target.files && e.target.files[0]) {
            handleFileUpload(e.target.files[0]);
          }
        }}
        accept="image/png,image/jpeg,image/jpg,image/webp"
        className="hidden"
      />

      {currentUrl ? (
        <div
          onDragOver={handleDragOver}
          onDragEnter={handleDragEnter}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          className={clsx(
            'bg-[#09090B] border rounded-xl p-3 flex flex-col gap-2 transition-all relative',
            isDragging ? 'border-[#10b981] bg-[#10b981]/10 scale-[1.01]' : 'border-[#27272A]',
            isBusy && 'opacity-70 pointer-events-none'
          )}
        >
          {/* Image Preview Window */}
          <div className="flex items-center justify-center bg-[#121214] border border-[#27272A]/50 rounded-lg p-2 overflow-hidden min-h-[80px]">
            {hasImageError ? (
              <div className="flex flex-col items-center justify-center p-3 text-center text-gray-500 gap-1">
                <AlertCircle size={20} className="text-amber-500/80" />
                <span className="text-[10px] font-medium text-gray-400">Imagem indisponível ou em carregamento</span>
              </div>
            ) : (
              <img
                src={currentUrl}
                alt={label}
                onError={() => setHasImageError(true)}
                className={clsx(
                  'transition-all',
                  type === 'logo'
                    ? 'h-20 max-w-[220px] object-contain rounded-md'
                    : 'w-full h-28 object-cover rounded-md'
                )}
              />
            )}
          </div>

          {/* Action Bar */}
          <div className="flex items-center justify-between pt-1">
            <span className="text-[9px] text-gray-500 flex items-center gap-1">
              <Upload size={10} className="text-gray-400" />
              Arraste para substituir
            </span>

            {isConfirmingDelete ? (
              <div className="flex items-center gap-1.5 animate-fadeIn">
                <span className="text-[9px] font-bold text-rose-400">Confirmar exclusão?</span>
                <button
                  type="button"
                  disabled={isBusy}
                  onClick={handleRemoveAsset}
                  className="px-2.5 py-1 bg-rose-600 hover:bg-rose-700 text-white rounded-md text-[9px] font-bold uppercase transition-all cursor-pointer"
                >
                  Sim
                </button>
                <button
                  type="button"
                  disabled={isBusy}
                  onClick={() => setIsConfirmingDelete(false)}
                  className="px-2.5 py-1 bg-[#27272A] hover:bg-[#3F3F46] text-gray-300 rounded-md text-[9px] font-bold uppercase transition-all cursor-pointer"
                >
                  Não
                </button>
              </div>
            ) : (
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  disabled={isBusy}
                  onClick={() => fileInputRef.current?.click()}
                  className="px-3 py-1.5 bg-[#1C1C1F] hover:bg-[#27272A] border border-[#27272A] text-gray-200 rounded-lg text-[9px] font-bold uppercase tracking-wider transition-all cursor-pointer flex items-center gap-1.5 disabled:opacity-50"
                >
                  {status === 'uploading' ? (
                    <Loader2 size={12} className="animate-spin text-[#10b981]" />
                  ) : (
                    <RefreshCw size={12} />
                  )}
                  {status === 'uploading' ? 'Enviando...' : 'Substituir'}
                </button>

                <button
                  type="button"
                  disabled={isBusy}
                  onClick={() => setIsConfirmingDelete(true)}
                  className="px-3 py-1.5 bg-rose-950/20 hover:bg-rose-900/30 border border-rose-900/40 text-rose-400 rounded-lg text-[9px] font-bold uppercase tracking-wider transition-all cursor-pointer flex items-center gap-1.5 disabled:opacity-50"
                >
                  {status === 'removing' ? (
                    <Loader2 size={12} className="animate-spin text-rose-400" />
                  ) : (
                    <Trash2 size={12} />
                  )}
                  {status === 'removing' ? 'Removendo...' : 'Remover'}
                </button>
              </div>
            )}
          </div>
        </div>
      ) : (
        <div
          onDragOver={handleDragOver}
          onDragEnter={handleDragEnter}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          onClick={() => !isBusy && fileInputRef.current?.click()}
          className={clsx(
            'border-2 border-dashed rounded-xl p-5 text-center cursor-pointer transition-all flex flex-col items-center justify-center gap-1.5 group',
            isDragging
              ? 'border-[#10b981] bg-[#10b981]/15 text-[#10b981] scale-[1.01]'
              : 'border-[#27272A] hover:border-[#10b981]/50 bg-[#09090B] hover:bg-[#121214] text-gray-400 hover:text-gray-200',
            isBusy && 'opacity-60 cursor-not-allowed pointer-events-none'
          )}
        >
          {isBusy ? (
            <Loader2 size={20} className="animate-spin text-[#10b981]" />
          ) : (
            <ImageIcon size={20} className={isDragging ? 'text-[#10b981]' : 'text-gray-400 group-hover:text-[#10b981]'} />
          )}

          <div className="space-y-0.5">
            <span className="text-xs font-semibold block text-gray-200">
              {isBusy ? 'Fazendo upload...' : isDragging ? 'Solte a imagem aqui para enviar' : `Clique para escolher ou arraste o ${label} aqui`}
            </span>
            <span className="text-[9px] text-gray-500 block">
              Formatos aceitos: PNG, JPG, JPEG ou WEBP (máx. 5 MB)
            </span>
          </div>
        </div>
      )}
    </div>
  );
};
