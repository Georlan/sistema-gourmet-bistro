import React from 'react';
import { Instagram, QrCode } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';

const LEAD_URL = 'https://komafood.com.br/cearatech?source=qr_tela';

export default function CearaTechQrPage() {
  return (
    <main className="min-h-dvh bg-[#08090b] px-5 py-8 text-white selection:bg-emerald-400 selection:text-black">
      <div className="mx-auto flex min-h-[calc(100dvh-4rem)] w-full max-w-5xl flex-col items-center justify-center text-center">
        <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-emerald-500/25 bg-emerald-500/10 px-4 py-2 text-sm font-bold text-emerald-300">
          <QrCode className="h-4 w-4" />
          Ceará Tech Summit 2026
        </div>

        <div className="mb-7">
          <p className="mb-2 text-sm font-black uppercase tracking-[0.28em] text-emerald-400">KÔMA</p>
          <h1 className="mx-auto max-w-4xl text-4xl font-black leading-tight tracking-tight sm:text-5xl lg:text-6xl">
            Quer conhecer o KÔMA no seu restaurante?
          </h1>
          <p className="mx-auto mt-4 max-w-2xl text-base leading-relaxed text-zinc-300 sm:text-xl">
            Aponte a câmera do celular para o QR Code, deixe seu WhatsApp e a gente fala com você depois do evento.
          </p>
        </div>

        <div className="rounded-[2rem] border border-zinc-700 bg-white p-5 shadow-2xl shadow-emerald-500/10 sm:p-7">
          <QRCodeSVG
            value={LEAD_URL}
            level="M"
            marginSize={4}
            className="h-[min(58vw,430px)] w-[min(58vw,430px)] min-h-64 min-w-64"
            title="QR Code para conhecer o KÔMA"
          />
        </div>

        <div className="mt-7 flex flex-col items-center gap-2">
          <p className="font-mono text-sm text-zinc-400">komafood.com.br/cearatech</p>
          <div className="flex items-center gap-2 text-base font-bold text-zinc-200">
            <Instagram className="h-5 w-5 text-emerald-400" />
            @komafood
          </div>
        </div>

        <p className="mt-7 max-w-xl text-xs leading-relaxed text-zinc-500">
          Cadastro rápido: nome e WhatsApp. O contato só é usado com consentimento para falar sobre o KÔMA.
        </p>
      </div>
    </main>
  );
}
