import React from "react";
import { Instagram, Smartphone } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";

const LEAD_URL = "https://komafood.com.br/cearatech";

export default function CearaTechQrPage() {
  return (
    <main className="min-h-screen bg-[#070b0d] text-white flex items-center justify-center p-6">
      <section className="w-full max-w-5xl text-center">
        <p className="text-sm md:text-lg font-black uppercase tracking-[0.28em] text-[#00d6ad]">
          KÔMA • Ceará Tech Summit 2026
        </p>
        <h1 className="mt-5 text-4xl md:text-7xl font-black tracking-tight">
          Quer conhecer o KÔMA no seu restaurante?
        </h1>
        <p className="mx-auto mt-4 max-w-3xl text-lg md:text-2xl text-zinc-300">
          Aponte a câmera, deixe seu WhatsApp e a gente conversa depois do evento.
        </p>

        <div className="mx-auto mt-8 md:mt-10 w-fit rounded-[2rem] bg-white p-5 md:p-8 shadow-2xl shadow-emerald-500/10">
          <QRCodeSVG
            value={LEAD_URL}
            size={420}
            level="M"
            marginSize={4}
            bgColor="#ffffff"
            fgColor="#000000"
            title="QR Code para conhecer o KÔMA"
          />
        </div>

        <div className="mt-6 flex flex-wrap items-center justify-center gap-4 text-base md:text-xl font-bold text-zinc-200">
          <span className="inline-flex items-center gap-2"><Smartphone className="h-5 w-5 text-[#00d6ad]" /> komafood.com.br/cearatech</span>
          <span className="hidden md:inline text-zinc-600">•</span>
          <span className="inline-flex items-center gap-2"><Instagram className="h-5 w-5 text-[#00d6ad]" /> @komafood</span>
        </div>
        <p className="mt-4 text-sm text-zinc-500">Sem papel. Sem cadastro longo. Leva menos de 20 segundos.</p>
      </section>
    </main>
  );
}
