/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  Clock,
  ExternalLink,
  MessageSquare,
  Package,
  RefreshCw,
  Send,
  User,
  X,
} from 'lucide-react';
import clsx from 'clsx';
import { API_BASE_URL } from '../../../config/api';

export interface CaixaConversationItem {
  id: string; // conversation_id
  pedido_id: string; // comanda_id
  numero_pedido: number | null;
  cliente_nome: string;
  tipo_pedido: string;
  status_pedido: string;
  total_pedido: number;
  unread_count: number;
  closed_at: string | null;
  updated_at: string | null;
  last_message: {
    id: string;
    sender_type: 'system' | 'customer' | 'staff';
    body: string;
    created_at: string | null;
  } | null;
}

export interface CaixaChatMessage {
  id: string;
  conversation_id: string;
  pedido_id: string;
  sender_type: 'system' | 'customer' | 'staff';
  sender_user_id?: number | null;
  body: string;
  event_key?: string | null;
  created_at?: string | null;
}

interface CashierConversationsDrawerProps {
  isOpen: boolean;
  authorization: string;
  onClose: () => void;
  onInspectOrder?: (pedidoId: string) => void;
  onUnreadCountChange?: (count: number) => void;
}

export function CashierConversationsDrawer({
  isOpen,
  authorization,
  onClose,
  onInspectOrder,
  onUnreadCountChange,
}: CashierConversationsDrawerProps) {
  const getAuthHeaders = () => ({ Authorization: authorization });
  const [conversations, setConversations] = useState<CaixaConversationItem[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [messages, setMessages] = useState<CaixaChatMessage[]>([]);
  const [loadingList, setLoadingList] = useState<boolean>(false);
  const [loadingMessages, setLoadingMessages] = useState<boolean>(false);

  const [replyText, setReplyText] = useState<string>('');
  const [sending, setSending] = useState<boolean>(false);
  const [errorText, setErrorText] = useState<string | null>(null);

  const chatScrollRef = useRef<HTMLDivElement>(null);
  const eventSourceRef = useRef<EventSource | null>(null);

  const selectedConv = useMemo(
    () => conversations.find((c) => c.id === selectedId) || null,
    [conversations, selectedId],
  );

  const totalUnread = useMemo(
    () => conversations.reduce((acc, c) => acc + (c.unread_count || 0), 0),
    [conversations],
  );

  useEffect(() => {
    if (isOpen && !loadingList) onUnreadCountChange?.(totalUnread);
  }, [isOpen, loadingList, totalUnread, onUnreadCountChange]);

  const scrollToBottom = useCallback((smooth = true) => {
    if (chatScrollRef.current) {
      chatScrollRef.current.scrollTo({
        top: chatScrollRef.current.scrollHeight,
        behavior: smooth ? 'smooth' : 'auto',
      });
    }
  }, []);

  // Busca lista de conversas
  const fetchConversations = useCallback(async () => {
    try {
      setLoadingList(true);
      const res = await fetch(`${API_BASE_URL}/api/caixa/conversas`, {
        headers: getAuthHeaders(),
      });
      if (res.ok) {
        const data: CaixaConversationItem[] = await res.json();
        setConversations(data);
      }
    } catch (err) {
      console.warn('Erro ao listar conversas do Caixa:', err);
    } finally {
      setLoadingList(false);
    }
  }, []);

  // Busca mensagens da conversa selecionada e marca como lida
  const loadMessages = useCallback(
    async (convId: string) => {
      try {
        setLoadingMessages(true);
        const [msgsRes] = await Promise.all([
          fetch(`${API_BASE_URL}/api/caixa/conversas/${convId}/messages`, {
            headers: getAuthHeaders(),
          }),
          fetch(`${API_BASE_URL}/api/caixa/conversas/${convId}/read`, {
            method: 'POST',
            headers: getAuthHeaders(),
          }).catch(() => {}),
        ]);

        if (msgsRes.ok) {
          const msgs: CaixaChatMessage[] = await msgsRes.json();
          setMessages(msgs);
          // Zera unread na lista local
          setConversations((prev) =>
            prev.map((c) => (c.id === convId ? { ...c, unread_count: 0 } : c)),
          );
          setTimeout(() => scrollToBottom(false), 50);
        }
      } catch (err) {
        console.warn('Erro ao carregar mensagens da conversa:', err);
      } finally {
        setLoadingMessages(false);
      }
    },
    [scrollToBottom],
  );

  // Inicialização ao abrir gaveta
  useEffect(() => {
    if (!isOpen) return;
    fetchConversations();
  }, [isOpen, fetchConversations]);

  // Carrega mensagens ao mudar conversa selecionada
  useEffect(() => {
    if (!isOpen || !selectedId) return;
    loadMessages(selectedId);
  }, [isOpen, selectedId, loadMessages]);

  // Se abrir e houver conversas mas nenhuma selecionada no desktop, seleciona a primeira
  useEffect(() => {
    if (isOpen && !selectedId && conversations.length > 0) {
      if (typeof window !== 'undefined' && window.innerWidth >= 640) {
        setSelectedId(conversations[0].id);
      }
    }
  }, [isOpen, selectedId, conversations]);

  // Polling e SSE quando aberto
  useEffect(() => {
    if (!isOpen) return;

    const interval = setInterval(() => {
      fetchConversations();
      if (selectedId) {
        fetch(`${API_BASE_URL}/api/caixa/conversas/${selectedId}/messages`, {
          headers: getAuthHeaders(),
        })
          .then((r) => (r.ok ? r.json() : []))
          .then((data: CaixaChatMessage[]) => {
            if (Array.isArray(data) && data.length > 0) {
              setMessages(data);
            }
          })
          .catch(() => {});
      }
    }, 6000);

    return () => clearInterval(interval);
  }, [isOpen, selectedId, fetchConversations]);

  // Envio de resposta pelo Caixa
  const handleSendReply = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedId || !replyText.trim() || sending) return;

    setSending(true);
    setErrorText(null);
    const bodyToSend = replyText.trim();

    try {
      const res = await fetch(
        `${API_BASE_URL}/api/caixa/conversas/${selectedId}/messages`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...getAuthHeaders(),
          },
          body: JSON.stringify({ body: bodyToSend }),
        },
      );

      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(errorData.detail || 'Erro ao enviar resposta.');
      }

      const sentMsg: CaixaChatMessage = await res.json();
      setMessages((prev) => {
        if (prev.some((m) => m.id === sentMsg.id)) return prev;
        return [...prev, sentMsg];
      });
      setReplyText('');
      // Atualiza preview na lista de conversas
      setConversations((prev) =>
        prev.map((c) =>
          c.id === selectedId
            ? {
                ...c,
                last_message: {
                  id: sentMsg.id,
                  sender_type: sentMsg.sender_type,
                  body: sentMsg.body,
                  created_at: sentMsg.created_at || null,
                },
              }
            : c,
        ),
      );
      setTimeout(() => scrollToBottom(true), 50);
    } catch (err: any) {
      setErrorText(err?.message || 'Falha ao enviar resposta.');
    } finally {
      setSending(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end bg-black/60 backdrop-blur-sm animate-fade-in"
      id="cashier-chat-overlay"
      onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}
    >
      <div
        className="flex h-full w-full max-w-3xl flex-col bg-zinc-950 text-zinc-100 border-l border-zinc-800 shadow-2xl animate-scale-up"
        role="dialog"
        aria-label="Central de Mensagens dos Pedidos"
        id="cashier-chat-panel"
      >
        {/* Drawer Header */}
        <div className="flex items-center justify-between border-b border-zinc-800 px-5 py-4 bg-zinc-900/60">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-emerald-500/15 text-emerald-400 flex items-center justify-center font-bold">
              <MessageSquare size={20} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-bold text-white">
                  Conversas dos Pedidos
                </h2>
                {totalUnread > 0 && (
                  <span className="px-2 py-0.5 rounded-full bg-emerald-500 text-black text-[10px] font-black">
                    {totalUnread} novas
                  </span>
                )}
              </div>
              <p className="text-xs text-zinc-400">
                Atendimento direto cliente ↔ restaurante sem intermediários
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={fetchConversations}
              disabled={loadingList}
              className="p-2 rounded-xl border border-zinc-800 bg-zinc-900 text-zinc-400 hover:text-white transition disabled:opacity-50"
              title="Atualizar conversas"
            >
              <RefreshCw
                size={16}
                className={clsx(loadingList && 'animate-spin text-emerald-400')}
              />
            </button>
            <button
              type="button"
              onClick={onClose}
              className="p-2 rounded-xl border border-zinc-800 bg-zinc-900 text-zinc-400 hover:text-white transition"
              title="Fechar gaveta"
            >
              <X size={18} />
            </button>
          </div>
        </div>

        {/* Content Body: Two Columns */}
        <div className="flex-1 flex overflow-hidden">
          {/* Coluna Esquerda: Lista de Conversas (w-72 ou full se mobile sem seleção) */}
          <div
            className={clsx(
              'w-full sm:w-80 border-r border-zinc-800 flex flex-col bg-zinc-900/40 overflow-y-auto',
              selectedId ? 'hidden sm:flex' : 'flex',
            )}
          >
            {conversations.length === 0 ? (
              <div className="flex-1 flex flex-col items-center justify-center p-6 text-center text-zinc-500 text-xs">
                <MessageSquare size={32} className="opacity-20 mb-3" />
                <p>Nenhuma conversa ativa no momento.</p>
              </div>
            ) : (
              <div className="divide-y divide-zinc-800/60">
                {conversations.map((conv) => {
                  const isSelected = conv.id === selectedId;
                  return (
                    <button
                      key={conv.id}
                      type="button"
                      onClick={() => setSelectedId(conv.id)}
                      className={clsx(
                        'w-full text-left p-3.5 transition flex flex-col gap-1.5',
                        isSelected
                          ? 'bg-emerald-500/10 border-l-4 border-emerald-500'
                          : 'hover:bg-zinc-800/50',
                      )}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-bold text-white">
                            Pedido #{conv.numero_pedido || '—'}
                          </span>
                          <span className="text-[10px] px-1.5 py-0.2 rounded bg-zinc-800 text-zinc-400 font-medium">
                            {conv.tipo_pedido}
                          </span>
                        </div>
                        {conv.unread_count > 0 && (
                          <span className="w-5 h-5 rounded-full bg-emerald-500 text-black text-[10px] font-black flex items-center justify-center animate-pulse">
                            {conv.unread_count}
                          </span>
                        )}
                      </div>

                      <div className="flex items-center justify-between text-xs">
                        <span className="text-zinc-300 font-medium truncate max-w-[140px]">
                          {conv.cliente_nome}
                        </span>
                        <span className="text-[10px] text-zinc-500 capitalize">
                          {conv.status_pedido}
                        </span>
                      </div>

                      {conv.last_message && (
                        <p className="text-[11px] text-zinc-400 line-clamp-1 break-words">
                          {conv.last_message.sender_type === 'staff' ? (
                            <span className="text-zinc-500">Você: </span>
                          ) : conv.last_message.sender_type === 'customer' ? (
                            <span className="text-emerald-400 font-medium">Cliente: </span>
                          ) : null}
                          {conv.last_message.body}
                        </p>
                      )}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Coluna Direita: Conversa Ativa */}
          <div
            className={clsx(
              'flex-1 flex flex-col bg-zinc-950',
              !selectedId ? 'hidden sm:flex items-center justify-center' : 'flex',
            )}
          >
            {selectedConv ? (
              <>
                {/* Header da conversa ativa */}
                <div className="px-5 py-3 border-b border-zinc-800 flex items-center justify-between bg-zinc-900/40">
                  <div className="flex items-center gap-3">
                    <button
                      type="button"
                      onClick={() => setSelectedId(null)}
                      className="sm:hidden p-1 text-zinc-400 hover:text-white"
                    >
                      ←
                    </button>
                    <div>
                      <div className="flex items-center gap-2">
                        <h3 className="text-sm font-bold text-white">
                          Pedido #{selectedConv.numero_pedido || '—'}
                        </h3>
                        <span className="text-[10px] px-2 py-0.5 rounded-full bg-zinc-800 text-zinc-300 capitalize">
                          {selectedConv.status_pedido}
                        </span>
                      </div>
                      <span className="text-xs text-zinc-400">
                        {selectedConv.cliente_nome} · R$ {selectedConv.total_pedido.toFixed(2)}
                      </span>
                    </div>
                  </div>

                  {onInspectOrder && (
                    <button
                      type="button"
                      onClick={() => {
                        onInspectOrder(selectedConv.pedido_id);
                        onClose();
                      }}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-zinc-700 bg-zinc-800 hover:bg-zinc-700 text-xs font-semibold text-zinc-200 transition"
                    >
                      <span>Ver Pedido</span>
                      <ExternalLink size={13} />
                    </button>
                  )}
                </div>

                {/* Feed de mensagens */}
                <div
                  ref={chatScrollRef}
                  className="flex-1 p-4 overflow-y-auto space-y-3"
                >
                  {loadingMessages ? (
                    <div className="h-full flex items-center justify-center">
                      <div className="w-8 h-8 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
                    </div>
                  ) : messages.length === 0 ? (
                    <div className="h-full flex flex-col items-center justify-center text-zinc-500 text-xs text-center p-4">
                      <MessageSquare size={24} className="opacity-30 mb-2" />
                      <p>Nenhuma mensagem registrada para este pedido.</p>
                    </div>
                  ) : (
                    messages.map((msg) => {
                      if (msg.sender_type === 'system') {
                        return (
                          <div key={msg.id} className="flex justify-center my-2">
                            <span className="px-3 py-1 rounded-full bg-zinc-900 border border-zinc-800 text-[10px] text-zinc-400 font-medium">
                              {msg.body}
                            </span>
                          </div>
                        );
                      }

                      const isStaff = msg.sender_type === 'staff';
                      return (
                        <div
                          key={msg.id}
                          className={clsx(
                            'flex flex-col max-w-[80%]',
                            isStaff ? 'ml-auto items-end' : 'mr-auto items-start',
                          )}
                        >
                          <span className="text-[10px] text-zinc-500 mb-0.5 px-1">
                            {isStaff ? 'Equipe Caixa' : selectedConv.cliente_nome}
                          </span>
                          <div
                            className={clsx(
                              'rounded-2xl px-3.5 py-2 text-xs leading-relaxed break-words',
                              isStaff
                                ? 'bg-emerald-600 text-white rounded-tr-none'
                                : 'bg-zinc-800 border border-zinc-700 text-zinc-200 rounded-tl-none',
                            )}
                            dangerouslySetInnerHTML={{ __html: msg.body }}
                          />
                          {msg.created_at && (
                            <span className="text-[9px] text-zinc-600 mt-0.5 px-1 font-mono">
                              {new Date(msg.created_at).toLocaleTimeString([], {
                                hour: '2-digit',
                                minute: '2-digit',
                              })}
                            </span>
                          )}
                        </div>
                      );
                    })
                  )}
                </div>

                {/* Input de resposta */}
                <div className="p-3 border-t border-zinc-800 bg-zinc-900/60">
                  {errorText && (
                    <div className="text-[11px] text-rose-400 mb-1.5 px-1 flex items-center gap-1">
                      <AlertCircle size={12} />
                      <span>{errorText}</span>
                    </div>
                  )}
                  <form onSubmit={handleSendReply} className="flex items-center gap-2">
                    <input
                      type="text"
                      value={replyText}
                      onChange={(e) => setReplyText(e.target.value)}
                      placeholder="Responder ao cliente..."
                      maxLength={1000}
                      disabled={sending}
                      className="flex-1 bg-zinc-900 border border-zinc-700 rounded-xl px-3.5 py-2 text-xs text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 disabled:opacity-50 transition"
                    />
                    <button
                      type="submit"
                      disabled={sending || !replyText.trim()}
                      className="w-9 h-9 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white flex items-center justify-center disabled:opacity-40 disabled:hover:bg-emerald-600 transition shrink-0"
                      title="Enviar resposta"
                    >
                      <Send size={15} />
                    </button>
                  </form>
                </div>
              </>
            ) : (
              <div className="text-zinc-500 text-xs flex flex-col items-center">
                <MessageSquare size={32} className="opacity-20 mb-2" />
                <p>Selecione um pedido para visualizar o chat.</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default CashierConversationsDrawer;
