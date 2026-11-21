import { CheckCircle2, Copy, Download, ExternalLink, Link2, QrCode, Share2 } from 'lucide-react';
import React, { useMemo, useRef, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';

interface Props {
  publicMenuUrl: string | null;
}

function absolutePublicUrl(publicMenuUrl: string | null): string | null {
  if (!publicMenuUrl) return null;
  try {
    return new URL(publicMenuUrl, window.location.origin).toString();
  } catch {
    return null;
  }
}

export function OnlineMenuQrLinks({ publicMenuUrl }: Props) {
  const qrRef = useRef<HTMLDivElement>(null);
  const [copied, setCopied] = useState(false);
  const publicUrl = useMemo(() => absolutePublicUrl(publicMenuUrl), [publicMenuUrl]);

  const copyLink = async () => {
    if (!publicUrl) return;
    await navigator.clipboard.writeText(publicUrl);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  };

  const shareLink = async () => {
    if (!publicUrl) return;
    if (navigator.share) {
      await navigator.share({
        title: 'Cardápio Kôma',
        text: 'Acesse nosso cardápio online:',
        url: publicUrl,
      });
      return;
    }
    await copyLink();
  };

  const downloadQr = () => {
    const svg = qrRef.current?.querySelector('svg');
    if (!svg || !publicUrl) return;
    const serialized = new XMLSerializer().serializeToString(svg);
    const blob = new Blob([serialized], { type: 'image/svg+xml;charset=utf-8' });
    const href = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = href;
    anchor.download = 'koma-cardapio-qr.svg';
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(href);
  };

  return (
    <div className="space-y-4 animate-fade-in">
      <header className="rounded-2xl border border-koma-border bg-koma-panel px-4 py-4 sm:px-5">
        <div className="min-w-0">
          <h2
            className="text-base font-bold text-koma-foreground"
            style={{ fontFamily: 'var(--koma-font-display)' }}
          >
            Link e QR Code
          </h2>
          <p className="mt-1 max-w-2xl text-xs leading-relaxed text-koma-muted">
            Use o mesmo endereço do cardápio em todos os canais.
          </p>
        </div>
      </header>

      {!publicUrl ? (
        <section
          className="rounded-2xl border p-5 text-xs leading-relaxed"
          style={{
            background: 'var(--koma-warning-bg)',
            borderColor: 'var(--koma-warning-border)',
            color: 'var(--koma-warning-text)',
          }}
        >
          Não foi possível resolver a URL pública deste restaurante. Reabra o painel autenticado para recuperar a identidade canônica do tenant.
        </section>
      ) : (
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
          <section className="rounded-2xl border border-koma-border bg-koma-panel p-4 sm:p-5">
            <div className="mb-5 flex items-start gap-3">
              <div
                className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border"
                style={{
                  background: 'var(--koma-success-bg)',
                  borderColor: 'var(--koma-success-border)',
                  color: 'var(--koma-success-text)',
                }}
              >
                <Link2 size={18} aria-hidden="true" />
              </div>
              <div>
                <h3
                  className="text-sm font-bold text-koma-foreground"
                  style={{ fontFamily: 'var(--koma-font-display)' }}
                >
                  Link oficial do cardápio
                </h3>
                <p className="mt-1 text-xs leading-relaxed text-koma-muted">
                  Não existe link paralelo por campanha ou QR. Todos apontam para o mesmo restaurante e o mesmo cardápio público.
                </p>
              </div>
            </div>

            <div className="rounded-xl border border-koma-border bg-koma-input p-3.5">
              <span className="block text-xs font-semibold text-koma-muted">URL pública</span>
              <code
                className="mt-1.5 block truncate text-xs leading-relaxed text-koma-foreground"
                style={{ fontFamily: 'var(--font-mono)' }}
                title={publicUrl}
              >
                {publicUrl.replace(/^https?:\/\//, '')}
              </code>
            </div>

            <div className="mt-3 grid gap-2 sm:grid-cols-3">
              <button
                type="button"
                onClick={() => void copyLink()}
                className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl px-3.5 text-xs font-semibold transition"
                style={{
                  background: 'var(--koma-action-bg)',
                  color: 'var(--koma-action-text)',
                }}
              >
                {copied ? <CheckCircle2 size={14} /> : <Copy size={14} />}
                <span>{copied ? 'Copiado' : 'Copiar link'}</span>
              </button>
              <button
                type="button"
                onClick={() => void shareLink()}
                className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-koma-border bg-koma-raised px-3.5 text-xs font-semibold text-koma-foreground transition hover:bg-koma-card"
              >
                <Share2 size={14} aria-hidden="true" />
                <span>Compartilhar</span>
              </button>
              <a
                href={publicUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-koma-border bg-koma-raised px-3.5 text-xs font-semibold text-koma-foreground transition hover:bg-koma-card"
              >
                <ExternalLink size={14} aria-hidden="true" />
                <span>Abrir cardápio</span>
              </a>
            </div>

            <div className="mt-5 hidden rounded-xl border border-koma-border bg-koma-card p-4 text-xs leading-relaxed text-koma-muted lg:block">
              <strong className="block font-semibold text-koma-foreground">Onde usar</strong>
              <span className="mt-1 block">
                Bio do Instagram, Google Meu Negócio, mensagem automática, materiais impressos e qualquer canal que precise abrir a vitrine pública.
              </span>
            </div>
          </section>

          <section className="rounded-2xl border border-koma-border bg-koma-panel p-4 sm:p-5">
            <div className="mb-4 flex items-start gap-3">
              <div
                className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border"
                style={{
                  background: 'var(--koma-success-bg)',
                  borderColor: 'var(--koma-success-border)',
                  color: 'var(--koma-success-text)',
                }}
              >
                <QrCode size={18} aria-hidden="true" />
              </div>
              <div>
                <h3
                  className="text-sm font-bold text-koma-foreground"
                  style={{ fontFamily: 'var(--koma-font-display)' }}
                >
                  QR do cardápio
                </h3>
                <p className="mt-1 text-xs leading-relaxed text-koma-muted">
                  Pronto para balcão, mesa, embalagem ou material impresso.
                </p>
              </div>
            </div>

            <div
              ref={qrRef}
              className="mx-auto grid w-fit place-items-center overflow-hidden rounded-2xl border border-koma-border bg-koma-card p-3"
            >
              <QRCodeSVG
                value={publicUrl}
                size={196}
                level="M"
                marginSize={3}
                bgColor="#ffffff"
                fgColor="#090a0f"
                title="QR Code do cardápio Kôma"
              />
            </div>

            <button
              type="button"
              onClick={downloadQr}
              className="mt-4 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-koma-border bg-koma-raised px-4 text-xs font-semibold text-koma-foreground transition hover:bg-koma-card"
            >
              <Download size={14} aria-hidden="true" />
              <span>Baixar QR em SVG</span>
            </button>
            <p className="mt-2 text-center text-xs leading-relaxed text-koma-muted">
              SVG mantém nitidez para balcão, mesa, embalagem e material gráfico.
            </p>
          </section>
        </div>
      )}
    </div>
  );
}
