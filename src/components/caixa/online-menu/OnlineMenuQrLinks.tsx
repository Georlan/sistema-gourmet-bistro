import { CheckCircle2, Copy, Download, ExternalLink, Link2, QrCode, Share2 } from 'lucide-react';
import React, { useMemo, useRef, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { OperationalBanner } from '../../shared/OperationalBanner';

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
      <OperationalBanner
        id="online-menu-qr-heading"
        eyebrow="CARDÁPIO ONLINE"
        title="QR e links"
        accent="do mesmo endereço oficial"
        description="Compartilhe uma única URL pública. O QR é apenas outra forma de abrir exatamente esse mesmo endereço."
        metrics={[
          { label: 'link oficial', value: publicUrl ? 'Pronto' : 'Indisponível' },
          { label: 'QR', value: publicUrl ? 'Pronto' : 'Indisponível' },
        ]}
      />

      {!publicUrl ? (
        <section className="rounded-2xl border border-amber-500/25 bg-amber-500/[0.08] p-5 text-[11px] leading-relaxed text-amber-700 dark:text-amber-300">
          Não foi possível resolver a URL pública deste restaurante. Reabra o painel autenticado para recuperar a identidade canônica do tenant.
        </section>
      ) : (
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
          <section className="rounded-2xl border border-koma-border bg-koma-panel p-4 sm:p-5">
            <div className="mb-5 flex items-start gap-3">
              <div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-koma-border bg-koma-raised text-emerald-600 dark:text-emerald-300">
                <Link2 size={17} />
              </div>
              <div>
                <h3 className="text-sm font-black text-koma-foreground">Link oficial do cardápio</h3>
                <p className="mt-1 text-[10px] leading-relaxed text-koma-muted">
                  Não existe link paralelo por campanha ou QR. Todos apontam para o mesmo restaurante e o mesmo cardápio público.
                </p>
              </div>
            </div>

            <div className="rounded-xl border border-koma-border bg-koma-input p-3.5">
              <span className="block text-[9px] font-black uppercase tracking-[0.12em] text-koma-muted">URL pública</span>
              <code className="mt-1.5 block break-all text-[11px] leading-relaxed text-koma-foreground">{publicUrl}</code>
            </div>

            <div className="mt-3 grid gap-2 sm:grid-cols-3">
              <button
                type="button"
                onClick={() => void copyLink()}
                className="inline-flex h-11 items-center justify-center gap-2 rounded-xl border border-emerald-500/35 bg-emerald-500/10 px-3 text-[10px] font-black text-emerald-700 transition hover:bg-emerald-500/15 dark:text-emerald-300"
              >
                {copied ? <CheckCircle2 size={14} /> : <Copy size={14} />}
                {copied ? 'Copiado' : 'Copiar link'}
              </button>
              <button
                type="button"
                onClick={() => void shareLink()}
                className="inline-flex h-11 items-center justify-center gap-2 rounded-xl border border-koma-border bg-koma-raised px-3 text-[10px] font-black text-koma-secondary transition hover:border-emerald-500/35 hover:text-emerald-600"
              >
                <Share2 size={14} /> Compartilhar
              </button>
              <a
                href={publicUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex h-11 items-center justify-center gap-2 rounded-xl border border-koma-border bg-koma-raised px-3 text-[10px] font-black text-koma-secondary transition hover:border-emerald-500/35 hover:text-emerald-600"
              >
                <ExternalLink size={14} /> Abrir cardápio
              </a>
            </div>

            <div className="mt-5 rounded-xl border border-koma-border bg-koma-card p-4 text-[10px] leading-relaxed text-koma-muted">
              <strong className="block text-koma-foreground">Onde usar</strong>
              <span className="mt-1 block">Bio do Instagram, Google Meu Negócio, mensagem automática, materiais impressos e qualquer canal que precise abrir a vitrine pública.</span>
            </div>
          </section>

          <section className="rounded-2xl border border-koma-border bg-koma-panel p-4 sm:p-5">
            <div className="mb-4 flex items-start gap-3">
              <div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-koma-border bg-koma-raised text-emerald-600 dark:text-emerald-300">
                <QrCode size={17} />
              </div>
              <div>
                <h3 className="text-sm font-black text-koma-foreground">QR do cardápio</h3>
                <p className="mt-1 text-[10px] leading-relaxed text-koma-muted">Gerado localmente no navegador. Nenhuma URL ou dado do restaurante é enviado a um serviço externo para criar o QR.</p>
              </div>
            </div>

            <div ref={qrRef} className="mx-auto grid w-fit place-items-center rounded-2xl bg-white p-5 shadow-sm">
              <QRCodeSVG value={publicUrl} size={220} level="M" marginSize={2} title="QR Code do cardápio Kôma" />
            </div>

            <button
              type="button"
              onClick={downloadQr}
              className="mt-4 inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl border border-koma-border bg-koma-raised px-4 text-[10px] font-black uppercase tracking-wider text-koma-secondary transition hover:border-emerald-500/35 hover:text-emerald-600"
            >
              <Download size={14} /> Baixar QR em SVG
            </button>
            <p className="mt-2 text-center text-[9px] leading-relaxed text-koma-muted">SVG mantém nitidez para balcão, mesa, embalagem e material gráfico.</p>
          </section>
        </div>
      )}
    </div>
  );
}
