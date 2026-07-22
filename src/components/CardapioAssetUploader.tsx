import React, { useState, useRef } from 'react';
import { Upload, Trash2, Image as ImageIcon, Loader2 } from 'lucide-react';
import clsx from 'clsx';

interface CardapioAssetUploaderProps {
  label: string;
  type: 'logo' | 'banner';
  currentUrl: string;
  apiBaseUrl: string;
  authHeaders: Record<string, string>;
  onSuccess: (newUrl: string | null) => void;
}

export const CardapioAssetUploader: React.FC<CardapioAssetUploaderProps> = ({
  label,
  type,
  currentUrl,
  apiBaseUrl,
  authHeaders,
  onSuccess
}) => {
  const [isUploading, setIsUploading] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const handleFileUpload = async (file: File) => {
    if (!file) return;

    // Frontend validation: MIME type check
    const validMimeTypes = ['image/png', 'image/jpeg', 'image/jpg', 'image/webp'];
    if (!validMimeTypes.includes(file.type.toLowerCase())) {
      alert('Formato de arquivo inválido! Por favor, selecione uma imagem PNG, JPG, JPEG ou WEBP.');
      return;
    }

    // Frontend validation: Size limit 5 MB
    if (file.size > 5 * 1024 * 1024) {
      alert('O arquivo selecionado excede o limite máximo permitido de 5 MB.');
      return;
    }

    try {
      setIsUploading(true);

      const formData = new FormData();
      formData.append('file', file);

      // Auth headers without Content-Type so browser sets multipart boundary automatically
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
        onSuccess(updatedUrl);
      } else {
        const errData = await response.json().catch(() => ({}));
        alert(`Erro no upload: ${errData.detail || 'Falha ao enviar imagem para o servidor.'}`);
      }
    } catch (err: any) {
      console.error(`Erro ao fazer upload da imagem (${type}):`, err);
      alert('Erro de conexão ao enviar a imagem. A imagem anterior foi mantida.');
    } finally {
      setIsUploading(false);
      setIsDragging(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  const handleRemoveAsset = async () => {
    if (!confirm(`Deseja realmente remover o ${label.toLowerCase()}?`)) return;

    try {
      setIsUploading(true);
      const response = await fetch(`${apiBaseUrl}/api/cardapio-digital/assets/${type}`, {
        method: 'DELETE',
        headers: authHeaders
      });

      if (response.ok) {
        onSuccess(null);
      } else {
        const errData = await response.json().catch(() => ({}));
        alert(`Erro ao remover: ${errData.detail || 'Falha ao remover imagem no servidor.'}`);
      }
    } catch (err: any) {
      console.error(`Erro ao remover imagem (${type}):`, err);
      alert('Erro de conexão ao remover a imagem.');
    } finally {
      setIsUploading(false);
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
    // Only reset if leaving container
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

  return (
    <div className="space-y-1.5 text-left">
      <label className="text-[10px] font-bold text-gray-300 uppercase tracking-wider block">
        {label}:
      </label>

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
        <div className="bg-[#09090B] border border-[#27272A] rounded-xl p-3 flex flex-col gap-2">
          <div className="flex items-center justify-center bg-[#121214] border border-[#27272A]/50 rounded-lg p-2 overflow-hidden">
            <img
              src={currentUrl}
              alt={label}
              className={type === 'logo' ? 'h-16 max-w-[200px] object-contain rounded-md' : 'w-full h-24 object-cover rounded-md'}
            />
          </div>

          <div className="flex justify-end gap-2 pt-1">
            <button
              type="button"
              disabled={isUploading}
              onClick={() => fileInputRef.current?.click()}
              className="px-3 py-1.5 bg-[#1C1C1F] hover:bg-[#27272A] border border-[#27272A] text-gray-200 rounded-lg text-[9px] font-bold uppercase tracking-wider transition-all cursor-pointer flex items-center gap-1.5 disabled:opacity-50"
            >
              {isUploading ? <Loader2 size={12} className="animate-spin text-[#10b981]" /> : <Upload size={12} />}
              {isUploading ? 'Enviando...' : 'Substituir'}
            </button>

            <button
              type="button"
              disabled={isUploading}
              onClick={handleRemoveAsset}
              className="px-3 py-1.5 bg-rose-950/20 hover:bg-rose-900/30 border border-rose-900/40 text-rose-400 rounded-lg text-[9px] font-bold uppercase tracking-wider transition-all cursor-pointer flex items-center gap-1.5 disabled:opacity-50"
            >
              <Trash2 size={12} />
              Remover
            </button>
          </div>
        </div>
      ) : (
        <div
          onDragOver={handleDragOver}
          onDragEnter={handleDragEnter}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          onClick={() => !isUploading && fileInputRef.current?.click()}
          className={clsx(
            'border-2', 'border-dashed', 'rounded-xl', 'p-5', 'text-center', 'cursor-pointer', 'transition-all',
            'flex', 'flex-col', 'items-center', 'justify-center', 'gap-1.5', 'group',
            isDragging
              ? 'border-[#10b981] bg-[#10b981]/15 text-[#10b981] scale-[1.01]'
              : 'border-[#27272A] hover:border-[#10b981]/50 bg-[#09090B] hover:bg-[#121214] text-gray-400 hover:text-gray-200',
            isUploading && 'opacity-60 cursor-not-allowed'
          )}
        >
          {isUploading ? (
            <Loader2 size={20} className="animate-spin text-[#10b981]" />
          ) : (
            <ImageIcon size={20} className={isDragging ? 'text-[#10b981]' : 'text-gray-400 group-hover:text-[#10b981]'} />
          )}

          <div className="space-y-0.5">
            <span className="text-xs font-semibold block text-gray-200">
              {isUploading ? 'Fazendo upload...' : isDragging ? 'Solte a imagem aqui para enviar' : `Clique para escolher ou arraste o ${label} aqui`}
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
