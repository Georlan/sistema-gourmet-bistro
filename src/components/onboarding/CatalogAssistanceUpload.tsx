import React, { useId, useState } from 'react';
import { CheckCircle2, FileUp, Loader2 } from 'lucide-react';
import { API_BASE_URL } from '../../config/api';

export type CatalogAssistanceSnapshot = {
  id: string;
  filename: string;
  contentType: string;
  fileSize: number;
  status: 'pending' | 'processing' | 'completed' | 'cancelled' | 'superseded' | string;
  createdAt: string | null;
  updatedAt: string | null;
} | null;

const MAX_FILE_SIZE = 10 * 1024 * 1024;

const assistanceLabel = (status?: string) => {
  if (status === 'processing') return 'Em preparação pela equipe KÔMA';
  if (status === 'completed') return 'Implantação assistida concluída';
  if (status === 'cancelled') return 'Envio cancelado';
  return 'Cardápio recebido ✓';
};

const formatReceivedAt = (value: string | null) => {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString('pt-BR');
};

export function CatalogAssistanceUpload({
  accessToken,
  assistance,
  onSubmitted,
}: {
  accessToken: string;
  assistance: CatalogAssistanceSnapshot;
  onSubmitted: () => void;
}) {
  const inputId = useId();
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [replacing, setReplacing] = useState(false);
  const [notice, setNotice] = useState('');
  const [noticeKind, setNoticeKind] = useState<'success' | 'error' | ''>('');

  const chooseFile = (file?: File) => {
    setNotice('');
    setNoticeKind('');
    if (!file) {
      setSelectedFile(null);
      return;
    }
    if (file.size > MAX_FILE_SIZE) {
      setSelectedFile(null);
      setNotice('O arquivo deve ter no máximo 10 MB.');
      setNoticeKind('error');
      return;
    }
    setSelectedFile(file);
  };

  const submit = async () => {
    if (!selectedFile || busy) return;
    setBusy(true);
    setNotice('');
    setNoticeKind('');
    try {
      const body = new FormData();
      body.append('file', selectedFile);
      const response = await fetch(`${API_BASE_URL}/api/onboarding/catalog-assistance`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}` },
        body,
      });
      const payload = await response.json().catch(() => null) as { detail?: string; message?: string } | null;
      if (!response.ok) {
        throw new Error(payload?.detail || 'Não foi possível enviar o cardápio.');
      }
      setSelectedFile(null);
      setReplacing(false);
      setNotice(payload?.message || 'Cardápio recebido ✓ A equipe KÔMA já pode acessar o arquivo.');
      setNoticeKind('success');
      onSubmitted();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Falha ao enviar o cardápio.');
      setNoticeKind('error');
    } finally {
      setBusy(false);
    }
  };

  const activeAssistance = assistance && !['cancelled', 'superseded'].includes(assistance.status)
    ? assistance
    : null;

  return (
    <section className="mt-6 rounded-2xl border border-koma-border bg-koma-raised/20 p-4">
      <div className="flex items-start gap-3">
        <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-emerald-500/20 bg-emerald-500/10 text-emerald-400">
          <FileUp size={18} />
        </div>
        <div className="min-w-0">
          <h2 className="font-black">{activeAssistance ? 'Cardápio recebido' : 'Já possui um cardápio?'}</h2>
          {!activeAssistance && <p className="mt-1 text-sm leading-relaxed text-koma-muted">
            Envie um PDF ou uma foto. Você não precisa preparar JSON: a equipe KÔMA organiza categorias, produtos e preços para revisão antes da publicação.
          </p>}
        </div>
      </div>

      {activeAssistance && (
        <div className="mt-4 rounded-xl border border-emerald-500/20 bg-emerald-500/[0.06] p-3">
          <div className="flex items-center gap-2 text-xs font-black text-emerald-400">
            <CheckCircle2 size={15} /> {assistanceLabel(activeAssistance.status)}
          </div>
          <p className="mt-1 break-all text-xs text-koma-muted">{activeAssistance.filename}</p>
          {activeAssistance.createdAt && (
            <p className="mt-1 text-[10px] text-koma-subtle">
              Recebido em {formatReceivedAt(activeAssistance.createdAt)}
            </p>
          )}
          {activeAssistance.status !== 'completed' && (
            <p className="mt-2 text-[11px] leading-relaxed text-koma-subtle">
              {activeAssistance.status === 'processing' ? 'A equipe KÔMA está preparando o catálogo.' : 'Aguardando preparação KÔMA.'} Você pode completar dados e horários enquanto a equipe prepara o catálogo.
            </p>
          )}
        </div>
      )}

      {activeAssistance && activeAssistance.status !== 'completed' && <button type="button" onClick={() => setReplacing(!replacing)} className="mt-3 text-xs font-bold text-koma-muted">{replacing ? 'Cancelar substituição' : 'Substituir arquivo'}</button>}
      {activeAssistance?.status !== 'completed' && (!activeAssistance || replacing) && (
        <div className="mt-4 rounded-xl border border-koma-border bg-koma-page p-3">
          <input
            id={inputId}
            aria-label="Arquivo do cardápio para implantação assistida"
            className="sr-only"
            type="file"
            accept=".pdf,.png,.jpg,.jpeg,.webp,.gif,.bmp,.avif,.heic,.heif,application/pdf,image/png,image/jpeg,image/webp,image/gif,image/bmp,image/avif,image/heic,image/heif"
            disabled={busy}
            onChange={event => chooseFile(event.target.files?.[0])}
          />
          <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center">
            <label
              htmlFor={inputId}
              className="inline-flex w-fit cursor-pointer items-center justify-center rounded-xl border border-koma-border bg-koma-raised px-4 py-2 text-xs font-black transition hover:border-emerald-500/35 hover:text-emerald-400"
            >
              Escolher PDF ou foto
            </label>
            <span className="min-w-0 break-all text-xs text-koma-muted">
              {selectedFile?.name || 'PDF ou imagem (JPG, PNG, WEBP, GIF, BMP, AVIF, HEIC) · até 10 MB'}
            </span>
          </div>
          <button
            type="button"
            disabled={!selectedFile || busy}
            onClick={() => void submit()}
            className="mt-3 inline-flex items-center gap-2 rounded-xl bg-emerald-500 px-4 py-2 text-xs font-black text-zinc-950 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy ? <Loader2 size={14} className="animate-spin" /> : <FileUp size={14} />}
            {busy ? 'Enviando…' : 'Enviar para implantação'}
          </button>
        </div>
      )}

      <p className="mt-3 text-[11px] leading-relaxed text-koma-subtle">
        O envio do arquivo não marca o cardápio como concluído. O passo só fica pronto quando os produtos forem realmente publicados no restaurante após conferência.
      </p>
      {notice && (
        <p
          role={noticeKind === 'error' ? 'alert' : 'status'}
          aria-live="polite"
          className={`mt-3 rounded-xl border p-3 text-xs font-semibold ${
            noticeKind === 'error'
              ? 'border-rose-500/25 bg-rose-500/10 text-rose-300'
              : 'border-emerald-500/25 bg-emerald-500/10 text-emerald-300'
          }`}
        >
          {notice}
        </p>
      )}
    </section>
  );
}
