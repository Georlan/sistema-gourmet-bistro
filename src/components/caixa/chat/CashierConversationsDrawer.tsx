/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  ExternalLink,
  MessageSquare,
  RefreshCw,
  Send,
  X,
} from 'lucide-react';
import clsx from 'clsx';
import { API_BASE_URL } from '../../../config/api';
import { consumeCashierChatEvents } from './cashierChatRealtime';

export interface CaixaConversationItem {
  id: string;
  pedido_id: string;
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

interface MessageState {
  conversationId: string | null;
  items: CaixaChatMessage[];
}

interface FetchConversationsOptions {
  background?: boolean;
}

interface LoadMessagesOptions {
  background?: boolean;
  markRead?: boolean;
}

export function CashierConversationsDrawer({
  isOpen,
  authorization,
  onClose,
  onInspectOrder,
  onUnreadCountChange,
}: CashierConversationsDrawerProps) {
  const [conversations, setConversations] = useState<CaixaConversationItem[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [messageState, setMessageState] = useState<MessageState>({ conversationId: null, items: [] });
  const [loadingList, setLoadingList] = useState<boolean>(false);
  const [loadingMessages, setLoadingMessages] = useState<boolean>(false);
  const [replyText, setReplyText] = useState<string>('');
  const [sending, setSending] = useState<boolean>(false);
  const [errorText, setErrorText] = useState<string | null>(null);

  const chatScrollRef = useRef<HTMLDivElement>(null);
  const selectedIdRef = useRef<string | null>(null);
  const messageGenerationRef = useRef(0);
  const messageAbortRef = useRef<AbortController | null>(null);
  const visibleMessageLoadRef = useRef(false);
  const markReadInFlightRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    selectedIdRef.current = selectedId;
  }, [selectedId]);

  const selectedConv = useMemo(
    () => conversations.find((conversation) => conversation.id === selectedId) || null,
    [conversations, selectedId],
  );

  const messages = messageState.conversationId === selectedId ? messageState.items : [];

  const totalUnread = useMemo(
    () => conversations.reduce((acc, conversation) => acc + (conversation.unread_count || 0), 0),
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

  const fetchConversations = useCallback(async ({ background = false }: FetchConversationsOptions = {}) => {
    if (!authorization) return;
    try {
      if (!background) setLoadingList(true);
      const response = await fetch(`${API_BASE_URL}/api/caixa/conversas`, {
        headers: { Authorization: authorization },
        cache: 'no-store',
      });
      if (!response.ok) {
        throw new Error(`Falha ao listar conversas (${response.status}).`);
      }
      const data: CaixaConversationItem[] = await response.json();
      setConversations(data);
      const currentSelection = selectedIdRef.current;
      if (currentSelection && !data.some((conversation) => conversation.id === currentSelection)) {
        selectedIdRef.current = null;
        setSelectedId(null);
        setMessageState({ conversationId: null, items: [] });
      }
    } catch (error) {
      console.warn('Erro ao listar conversas do Caixa:', error);
    } finally {
      if (!background) setLoadingList(false);
    }
  }, [authorization]);

  const markConversationRead = useCallback(async (conversationId: string) => {
    if (!authorization || markReadInFlightRef.current.has(conversationId)) return;

    markReadInFlightRef.current.add(conversationId);
    setConversations((current) => current.map((conversation) => (
      conversation.id === conversationId ? { ...conversation, unread_count: 0 } : conversation
    )));

    try {
      await fetch(`${API_BASE_URL}/api/caixa/conversas/${conversationId}/read`, {
        method: 'POST',
        headers: { Authorization: authorization },
      });
    } catch {
      // O próximo snapshot autoritativo da lista restaura o badge se a marcação falhar.
    } finally {
      markReadInFlightRef.current.delete(conversationId);
    }
  }, [authorization]);

  const loadMessages = useCallback(async (
    conversationId: string,
    { background = false, markRead = true }: LoadMessagesOptions = {},
  ) => {
    if (!authorization) return;
    if (background && visibleMessageLoadRef.current) return;

    const generation = ++messageGenerationRef.current;
    messageAbortRef.current?.abort();
    const controller = new AbortController();
    messageAbortRef.current = controller;

    if (!background && selectedIdRef.current === conversationId) {
      visibleMessageLoadRef.current = true;
      setLoadingMessages(true);
      setMessageState((current) => current.conversationId === conversationId
        ? current
        : { conversationId, items: [] });
    }

    try {
      const response = await fetch(
        `${API_BASE_URL}/api/caixa/conversas/${conversationId}/messages`,
        {
          headers: { Authorization: authorization },
          cache: 'no-store',
          signal: controller.signal,
        },
      );
      if (!response.ok) {
        throw new Error(`Falha ao carregar conversa (${response.status}).`);
      }
      const items: CaixaChatMessage[] = await response.json();

      if (
        controller.signal.aborted
        || generation !== messageGenerationRef.current
        || selectedIdRef.current !== conversationId
      ) {
        return;
      }

      setMessageState({ conversationId, items: Array.isArray(items) ? items : [] });
      if (markRead) void markConversationRead(conversationId);

      if (!background) {
        window.setTimeout(() => scrollToBottom(false), 50);
      }
    } catch (error) {
      if (!(error instanceof DOMException && error.name === 'AbortError')) {
        console.warn('Erro ao carregar mensagens da conversa:', error);
      }
    } finally {
      if (!background && generation === messageGenerationRef.current) {
        visibleMessageLoadRef.current = false;
        setLoadingMessages(false);
      }
    }
  }, [authorization, markConversationRead, scrollToBottom]);

  useEffect(() => {
    if (!isOpen) return;
    void fetchConversations();
  }, [isOpen, fetchConversations]);

  useEffect(() => {
    if (!isOpen || !selectedId) return;
    void loadMessages(selectedId);
  }, [isOpen, selectedId, loadMessages]);

  useEffect(() => {
    if (isOpen && !selectedId && conversations.length > 0) {
      if (typeof window !== 'undefined' && window.innerWidth >= 640) {
        selectedIdRef.current = conversations[0].id;
        setSelectedId(conversations[0].id);
      }
    }
  }, [isOpen, selectedId, conversations]);

  useEffect(() => {
    if (!isOpen || !authorization) return;

    const controller = new AbortController();
    let fallbackInterval: number | null = null;
    let reconnectTimer: number | null = null;
    let stopped = false;

    const stopFallback = () => {
      if (fallbackInterval !== null) {
        window.clearInterval(fallbackInterval);
        fallbackInterval = null;
      }
    };

    const refreshSelectedInBackground = () => {
      const current = selectedIdRef.current;
      if (current) {
        void loadMessages(current, { background: true, markRead: false });
      }
    };

    const startFallback = () => {
      if (fallbackInterval !== null) return;
      fallbackInterval = window.setInterval(() => {
        if (document.hidden) return;
        void fetchConversations({ background: true });
        refreshSelectedInBackground();
      }, 15000);
    };

    const appendRealtimeMessage = (data: Record<string, unknown> | null) => {
      const eventConversationId = typeof data?.conversation_id === 'string'
        ? data.conversation_id
        : null;
      const messageId = typeof data?.id === 'string' ? data.id : null;
      const pedidoId = typeof data?.pedido_id === 'string' ? data.pedido_id : null;
      const senderType = data?.sender_type;
      const body = typeof data?.body === 'string' ? data.body : null;

      if (
        !eventConversationId
        || !messageId
        || !pedidoId
        || !body
        || (senderType !== 'system' && senderType !== 'customer' && senderType !== 'staff')
      ) {
        return;
      }

      const message: CaixaChatMessage = {
        id: messageId,
        conversation_id: eventConversationId,
        pedido_id: pedidoId,
        sender_type: senderType,
        sender_user_id: typeof data?.sender_user_id === 'number' ? data.sender_user_id : null,
        body,
        event_key: typeof data?.event_key === 'string' ? data.event_key : null,
        created_at: typeof data?.created_at === 'string' ? data.created_at : null,
      };

      if (selectedIdRef.current === eventConversationId) {
        setMessageState((current) => {
          const items = current.conversationId === eventConversationId ? current.items : [];
          if (items.some((item) => item.id === message.id)) return current;
          return { conversationId: eventConversationId, items: [...items, message] };
        });
        window.setTimeout(() => scrollToBottom(true), 50);

        if (senderType === 'customer' && document.visibilityState === 'visible') {
          void markConversationRead(eventConversationId);
        }
      }
    };

    const connect = () => {
      if (stopped || controller.signal.aborted) return;
      void consumeCashierChatEvents({
        url: `${API_BASE_URL}/api/caixa/conversas/events`,
        authorization,
        signal: controller.signal,
        onOpen: stopFallback,
        onEvent: ({ event, data }) => {
          if (event === 'connected') return;

          const eventConversationId = typeof data?.conversation_id === 'string'
            ? data.conversation_id
            : null;

          switch (event) {
            case 'new_message':
              appendRealtimeMessage(data);
              void fetchConversations({ background: true });
              return;

            case 'status_changed':
              void fetchConversations({ background: true });
              return;

            case 'read_update':
              if (eventConversationId && data?.reader === 'staff') {
                setConversations((current) => current.map((conversation) => (
                  conversation.id === eventConversationId
                    ? { ...conversation, unread_count: 0 }
                    : conversation
                )));
              }
              return;

            default:
              void fetchConversations({ background: true });
          }
        },
      }).catch((error) => {
        if (stopped || controller.signal.aborted) return;
        console.warn('Realtime do chat do Caixa degradado; usando polling de fallback:', error);
        startFallback();
        reconnectTimer = window.setTimeout(connect, 5000);
      });
    };

    connect();
    return () => {
      stopped = true;
      controller.abort();
      stopFallback();
      if (reconnectTimer !== null) window.clearTimeout(reconnectTimer);
    };
  }, [isOpen, authorization, fetchConversations, loadMessages, markConversationRead, scrollToBottom]);

  useEffect(() => () => {
    messageGenerationRef.current += 1;
    messageAbortRef.current?.abort();
  }, []);

  const handleSendReply = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!selectedId || !replyText.trim() || sending) return;

    const targetConversationId = selectedId;
    setSending(true);
    setErrorText(null);
    const bodyToSend = replyText.trim();

    try {
      const response = await fetch(
        `${API_BASE_URL}/api/caixa/conversas/${targetConversationId}/messages`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: authorization,
          },
          body: JSON.stringify({ body: bodyToSend }),
        },
      );

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.detail || 'Erro ao enviar resposta.');
      }

      const sentMessage: CaixaChatMessage = await response.json();
      if (selectedIdRef.current === targetConversationId) {
        setMessageState((current) => {
          const items = current.conversationId === targetConversationId ? current.items : [];
          if (items.some((message) => message.id === sentMessage.id)) return current;
          return { conversationId: targetConversationId, items: [...items, sentMessage] };
        });
        setReplyText('');
        window.setTimeout(() => scrollToBottom(true), 50);
      }
      setConversations((current) => current.map((conversation) => (
        conversation.id === targetConversationId
          ? {
              ...conversation,
              last_message: {
                id: sentMessage.id,
                sender_type: sentMessage.sender_type,
                body: sentMessage.body,
                created_at: sentMessage.created_at || null,
              },
            }
          : conversation
      )));
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : 'Falha ao enviar resposta.');
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
        <div className="flex items-center justify-between border-b border-zinc-800 px-5 py-4 bg-zinc-900/60">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-emerald-500/15 text-emerald-400 flex items-center justify-center font-bold">
              <MessageSquare size={20} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-bold text-white">Conversas dos Pedidos</h2>
                {totalUnread > 0 && (
                  <span className="px-2 py-0.5 rounded-full bg-emerald-500 text-black text-[10px] font-black">
                    {totalUnread} novas
                  </span>
                )}
              </div>
              <p className="text-xs text-zinc-400">Atendimento direto cliente ↔ restaurante sem intermediários</p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => void fetchConversations()}
              disabled={loadingList}
              className="p-2 rounded-xl border border-zinc-800 bg-zinc-900 text-zinc-400 hover:text-white transition disabled:opacity-50"
              title="Atualizar conversas"
            >
              <RefreshCw size={16} className={clsx(loadingList && 'animate-spin text-emerald-400')} />
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

        <div className="flex-1 flex overflow-hidden">
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
                {conversations.map((conversation) => {
                  const isSelected = conversation.id === selectedId;
                  return (
                    <button
                      key={conversation.id}
                      type="button"
                      onClick={() => {
                        selectedIdRef.current = conversation.id;
                        setSelectedId(conversation.id);
                      }}
                      className={clsx(
                        'w-full text-left p-3.5 transition flex flex-col gap-1.5',
                        isSelected
                          ? 'bg-emerald-500/10 border-l-4 border-emerald-500'
                          : 'hover:bg-zinc-800/50',
                      )}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-bold text-white">Pedido #{conversation.numero_pedido || '—'}</span>
                          <span className="text-[10px] px-1.5 py-0.2 rounded bg-zinc-800 text-zinc-400 font-medium">
                            {conversation.tipo_pedido}
                          </span>
                        </div>
                        {conversation.unread_count > 0 && (
                          <span className="w-5 h-5 rounded-full bg-emerald-500 text-black text-[10px] font-black flex items-center justify-center animate-pulse">
                            {conversation.unread_count}
                          </span>
                        )}
                      </div>

                      <div className="flex items-center justify-between text-xs">
                        <span className="text-zinc-300 font-medium truncate max-w-[140px]">{conversation.cliente_nome}</span>
                        <span className="text-[10px] text-zinc-500 capitalize">{conversation.status_pedido}</span>
                      </div>

                      {conversation.last_message && (
                        <p className="text-[11px] text-zinc-400 line-clamp-1 break-words">
                          {conversation.last_message.sender_type === 'staff' ? (
                            <span className="text-zinc-500">Você: </span>
                          ) : conversation.last_message.sender_type === 'customer' ? (
                            <span className="text-emerald-400 font-medium">Cliente: </span>
                          ) : null}
                          {conversation.last_message.body}
                        </p>
                      )}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          <div
            className={clsx(
              'flex-1 flex flex-col bg-zinc-950',
              !selectedId ? 'hidden sm:flex items-center justify-center' : 'flex',
            )}
          >
            {selectedConv ? (
              <>
                <div className="px-5 py-3 border-b border-zinc-800 flex items-center justify-between bg-zinc-900/40">
                  <div className="flex items-center gap-3">
                    <button
                      type="button"
                      onClick={() => {
                        selectedIdRef.current = null;
                        messageGenerationRef.current += 1;
                        messageAbortRef.current?.abort();
                        setSelectedId(null);
                      }}
                      className="sm:hidden p-1 text-zinc-400 hover:text-white"
                    >
                      ←
                    </button>
                    <div>
                      <div className="flex items-center gap-2">
                        <h3 className="text-sm font-bold text-white">Pedido #{selectedConv.numero_pedido || '—'}</h3>
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

                <div ref={chatScrollRef} className="flex-1 p-4 overflow-y-auto space-y-3">
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
                    messages.map((message) => {
                      if (message.sender_type === 'system') {
                        return (
                          <div key={message.id} className="flex justify-center my-2">
                            <span className="px-3 py-1 rounded-full bg-zinc-900 border border-zinc-800 text-[10px] text-zinc-400 font-medium whitespace-pre-wrap break-words">
                              {message.body}
                            </span>
                          </div>
                        );
                      }

                      const isStaff = message.sender_type === 'staff';
                      return (
                        <div
                          key={message.id}
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
                              'rounded-2xl px-3.5 py-2 text-xs leading-relaxed break-words whitespace-pre-wrap',
                              isStaff
                                ? 'bg-emerald-600 text-white rounded-tr-none'
                                : 'bg-zinc-800 border border-zinc-700 text-zinc-200 rounded-tl-none',
                            )}
                          >
                            {message.body}
                          </div>
                          {message.created_at && (
                            <span className="text-[9px] text-zinc-600 mt-0.5 px-1 font-mono">
                              {new Date(message.created_at).toLocaleTimeString([], {
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
                      onChange={(event) => setReplyText(event.target.value)}
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