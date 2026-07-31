import React from 'react';
import clsx from 'clsx';
import { Send, Star } from 'lucide-react';

interface ChatbotMessage {
  sender: 'user' | 'bot';
  timestamp: string;
  text: string;
}

interface SupportChat {
  id: number | string;
  cliente: string;
  canal: string;
  ultimaMsg: string;
  status?: string;
}

interface CustomerFeedback {
  id: number;
  cliente: string;
  estrelas: number;
  comentario: string;
}

interface AssistenteSimuladorTabProps {
  aiBotActive: boolean;
  chatbotMessages: ChatbotMessage[];
  isBotTyping: boolean;
  chatInputText: string;
  setChatInputText: (val: string) => void;
  handleSendChatbotMessage: (e: React.FormEvent) => void;
  supportChats: any[];
  setSupportChats: React.Dispatch<React.SetStateAction<any[]>>;
  customerFeedbacks: CustomerFeedback[];
}

export function AssistenteSimuladorTab({
  aiBotActive,
  chatbotMessages,
  isBotTyping,
  chatInputText,
  setChatInputText,
  handleSendChatbotMessage,
  supportChats,
  setSupportChats,
  customerFeedbacks,
}: AssistenteSimuladorTabProps) {
  return (
    <div className={clsx('grid', 'grid-cols-1', 'lg:grid-cols-3', 'gap-5', 'text-left', 'animate-fade-in')}>
      {/* Left Column: Interactive Chat Simulation */}
      <div className={clsx('lg:col-span-2', 'bg-[#121214]/60', 'border', 'border-[#27272A]', 'rounded-3xl', 'p-5', 'flex', 'flex-col', 'overflow-hidden', 'h-[72vh]')}>
        <div className={clsx('border-b', 'border-[#27272A]', 'pb-3', 'flex', 'justify-between', 'items-center', 'shrink-0')}>
          <span className={clsx('font-serif', 'font-bold', 'text-gray-300')}>Simulador de Chat Kôma IA</span>
          <span className={clsx('text-[8px]', 'text-emerald-400', 'font-mono', 'flex', 'items-center', 'gap-1')}>
            <span className={clsx('h-1.5', 'w-1.5', 'bg-emerald-500', 'rounded-full', 'animate-ping')} />
            Robô Ativo
          </span>
        </div>

        <div className={clsx('flex-1', 'bg-[#09090B]', 'border', 'border-[#27272A]', 'rounded-2xl', 'p-4', 'flex', 'flex-col', 'justify-between', 'space-y-4')}>
          <textarea
            readOnly
            value={chatbotMessages.map(msg => `[${msg.sender === 'user' ? 'CLIENTE' : 'IA'} - ${msg.timestamp}]: ${msg.text}`).join('\n') + (isBotTyping ? '\n[IA - Digitando...]' : '')}
            className={clsx('w-full', 'flex-1', 'p-3', 'bg-[#000000]', 'border', 'border-[#27272A]', 'rounded-xl', 'text-emerald-500', 'font-mono', 'text-[9px]', 'leading-relaxed', 'focus:outline-none', 'resize-none', 'overflow-y-auto')}
            ref={(el) => {
              if (el) el.scrollTop = el.scrollHeight;
            }}
          />

          <form onSubmit={handleSendChatbotMessage} className={clsx('flex', 'gap-2', 'pt-2', 'border-t', 'border-[#27272A]', 'shrink-0')}>
            <input
              type="text"
              placeholder="Simule uma conversa com o bot..."
              value={chatInputText}
              disabled={!aiBotActive}
              onChange={(e) => setChatInputText(e.target.value)}
              className={clsx('flex-1', 'px-4', 'py-2', 'bg-[#121214]', 'border', 'border-[#27272A]', 'rounded-xl', 'focus:outline-none', 'focus:border-[#10b981]', 'text-white', 'disabled:opacity-50', 'text-[10px]')}
            />
            <button
              type="submit"
              disabled={!aiBotActive}
              className={clsx('p-2', 'bg-[#10b981]', 'hover:bg-[#059669]', 'disabled:bg-[#1C1C1F]', 'text-[#121214]', 'disabled:text-gray-500', 'rounded-xl', 'transition-all', 'cursor-pointer', 'flex', 'items-center', 'justify-center', 'shrink-0')}
            >
              <Send size={14} />
            </button>
          </form>
        </div>
      </div>

      {/* Right Column: Support Tickets and Feedbacks */}
      <div className="space-y-4">
        {/* Pending Chats */}
        <div className={clsx('bg-[#121214]/60', 'border', 'border-[#27272A]', 'rounded-3xl', 'p-5', 'space-y-3', 'text-left')}>
          <span className={clsx('font-serif', 'font-bold', 'text-gray-300', 'block', 'pb-1', 'border-b', 'border-[#27272A]')}>Chamados de Clientes (IA Pendente)</span>
          <div className="space-y-2">
            {supportChats.length === 0 ? (
              <span className={clsx('text-[10px]', 'text-gray-500', 'italic', 'block', 'text-center', 'py-5')}>Nenhum chamado pendente</span>
            ) : (
              supportChats.map(chat => (
                <div key={chat.id} className={clsx('bg-[#1C1C1F]', 'p-3', 'rounded-xl', 'border', 'border-[#27272A]', 'space-y-2', 'text-left')}>
                  <div className={clsx('flex', 'justify-between', 'items-center', 'text-[10px]')}>
                    <strong className={clsx('text-white', 'block', 'truncate', 'w-32', 'font-bold')}>{chat.cliente}</strong>
                    <span className={clsx('text-[8px]', 'uppercase', 'tracking-wider', 'font-mono', 'font-bold', 'text-rose-500')}>{chat.canal}</span>
                  </div>
                  <p className={clsx('text-[10px]', 'text-gray-400', 'line-clamp-2', 'leading-relaxed')}>{chat.ultimaMsg}</p>
                  <button
                    onClick={() => {
                      alert(`Transferindo conversa com ${chat.cliente} para o chat do Caixa...`);
                      setSupportChats(prev => prev.filter(c => c.id !== chat.id));
                    }}
                    className={clsx('w-full', 'py-1', 'bg-[#10b981]', 'hover:bg-[#059669]', 'text-[#121214]', 'font-bold', 'rounded-lg', 'text-[8px]', 'uppercase', 'tracking-wider', 'cursor-pointer')}
                  >
                    Conversar
                  </button>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Feedbacks list */}
        <div className={clsx('bg-[#121214]/60', 'border', 'border-[#27272A]', 'rounded-3xl', 'p-5', 'space-y-3', 'text-left')}>
          <span className={clsx('font-serif', 'font-bold', 'text-gray-300', 'block', 'pb-1', 'border-b', 'border-[#27272A]')}>Últimos Feedbacks / Avaliações</span>
          <div className={clsx('space-y-2.5', 'max-h-[30vh]', 'overflow-y-auto', 'pr-1')}>
            {customerFeedbacks.map(fb => (
              <div key={fb.id} className={clsx('bg-[#1C1C1F]', 'p-2.5', 'rounded-xl', 'border', 'border-[#27272A]', 'space-y-1.5', 'text-left')}>
                <div className={clsx('flex', 'justify-between', 'items-center')}>
                  <strong className={clsx('text-white', 'block', 'text-[10px]', 'font-bold')}>{fb.cliente}</strong>
                  <div className={clsx('flex', 'gap-0.5', 'text-amber-500')}>
                    {Array.from({ length: fb.estrelas }, (_, i) => (
                      <Star key={i} size={8} fill="currentColor" />
                    ))}
                  </div>
                </div>
                <p className={clsx('text-[10px]', 'text-gray-400', 'italic', 'leading-relaxed')}>"{fb.comentario}"</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
