/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  ArrowLeft,
  ExternalLink,
  MessageSquare,
  RefreshCw,
  Send,
  X,
} from 'lucide-react';
import clsx from 'clsx';
import { API_BASE_URL } from '../../../config/api';
import { getCashierDeliveryStatusLabel } from '../../../domain/cashierOrderProjection';
import type { CashierChatStreamSnapshot } from './cashierChatRealtime';
import type { CashierChatHealth } from './useCashierChat';

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
  seq?: number;
}

interface CashierConversationsDrawerProps {
  isOpen: boolean;
  authorization: string;
  onClose: () => void;
  onInspectOrder?: (pedidoId: string) => void;
  onUnreadCountChange?: (count: number) => void;
  realtimeEvent?: CashierChatStreamSnapshot | null;
  realtimeHealth?: CashierChatHealth;
  draftScope?: string;
}

interface MessageState {
  conversationId: string | null;
  items: CaixaChatMessage[];
  hasMore?: boolean;
}

interface CaixaFeedPage {
  items: CaixaChatMessage[];
  has_more: boolean;
  oldest_seq: number | null;
  latest_seq: number | null;
}

interface FetchConversationsOptions {
  background?: boolean;
}

interface LoadMessagesOptions {
  background?: boolean;
  markRead?: boolean;
}

const QUICK_REPLIES = [
  'Certo, vamos verificar.',
  'Obrigado pela informação.',
  'Já repassamos sua observação para a equipe.',
  'Um instante, por favor.',
] as const;

const CASHIER_CHAT_DRAFT_TTL_MS = 24 * 60 * 60 * 1000;

const cashierDraftKey = (scope: string, conversationId: string) =>
  `koma:cashier-chat-draft:v1:${scope}:${conversationId}`;

function loadCashierDraft(scope: string, conversationId: string): string {
  try {
    const raw = localStorage.getItem(cashierDraftKey(scope, conversationId));
    if (!raw) return '';
    const parsed = JSON.parse(raw) as { body?: unknown; expiresAt?: unknown };
    if (
      typeof parsed.body !== 'string'
      || typeof parsed.expiresAt !== 'number'
      || parsed.expiresAt <= Date.now()
    ) {
      localStorage.removeItem(cashierDraftKey(scope, conversationId));
      return '';
    }
    return parsed.body;
  } catch {
    return '';
  }
}

function removeCashierDraft(scope: string, conversationId: string): void {
  try { localStorage.removeItem(cashierDraftKey(scope, conversationId)); } catch {}
}

function pruneCashierDrafts(activeScope: string): void {
  try {
    const prefix = 'koma:cashier-chat-draft:v1:';
    const activePrefix = `${prefix}${activeScope}:`;
    const activeTenant = activeScope.split(':', 1)[0] || '';
    const tenantPrefix = activeTenant ? `${prefix}${activeTenant}:` : '';
    const now = Date.now();

    for (let index = localStorage.length - 1; index >= 0; index -= 1) {
      const key = localStorage.key(index);
      if (!key?.startsWith(prefix)) continue;

      const raw = localStorage.getItem(key);
      let expiredOrInvalid = false;
      try {
        const parsed = raw ? JSON.parse(raw) as { expiresAt?: unknown } : null;
        expiredOrInvalid = !parsed
          || typeof parsed.expiresAt !== 'number'
          || parsed.expiresAt <= now;
      } catch {
        expiredOrInvalid = true;
      }

      const belongsToPreviousShift = Boolean(
        tenantPrefix
        && key.startsWith(tenantPrefix)
        && !key.startsWith(activePrefix),
      );
      if (expiredOrInvalid || belongsToPreviousShift) {
        localStorage.removeItem(key);
      }
    }
  } catch {
    // Storage restrito não pode bloquear o chat.
  }
}

const TERMINAL_CHAT_STATUSES = new Set([
  'finalizado',
  'finalizada',
  'concluido',
  'concluida',
  'completed',
  'recusado',
  'recusada',
  'rejected',
  'cancelado',
  'cancelada',
  'cancelled',
]);

const normalizeStatus = (value: string) => value
  .trim()
  .toLocaleLowerCase('pt-BR')
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '');

const conversationStatusLabel = (conversation: CaixaConversationItem) => {
  const normalizedStatus = normalizeStatus(conversation.status_pedido || '');
  const rawFulfillment = normalizeStatus(conversation.tipo_pedido || '');
  const fulfillment = ['delivery', 'entrega'].includes(rawFulfillment) ? 'delivery' : rawFulfillment;

  if (['finalizado', 'finalizada', 'concluido', 'concluida', 'completed'].includes(normalizedStatus)) {
    return 'Concluído';
  }
  if (['recusado', 'recusada', 'rejected'].includes(normalizedStatus)) return 'Recusado';
  if (['cancelado', 'cancelada', 'cancelled'].includes(normalizedStatus)) return 'Cancelado';

  const projectionStatus = normalizedStatus === 'saiu_para_entrega' ? 'transito' : normalizedStatus;
  const projected = getCashierDeliveryStatusLabel(projectionStatus, fulfillment);
  if (projected !== 'Em atendimento') return projected;

  const rawLabel = String(conversation.status_pedido || '').replace(/[_-]+/g, ' ').trim();
  return rawLabel
    ? rawLabel.charAt(0).toLocaleUpperCase('pt-BR') + rawLabel.slice(1)
    : 'Em atendimento';
};

const conversationTimestamp = (conversation: CaixaConversationItem) => {
  const source = conversation.last_message?.created_at || conversation.updated_at;
  const parsed = source ? Date.parse(source) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : 0;
};

const isWaitingForStaff = (conversation: CaixaConversationItem) =>
  conversation.last_message?.sender_type === 'customer';

export const isTerminalConversation = (conversation: CaixaConversationItem) =>
  Boolean(conversation.closed_at) || TERMINAL_CHAT_STATUSES.has(normalizeStatus(conversation.status_pedido || ''));

/**
 * Defesa visual para snapshots atrasados: pedido terminal nunca volta para a
 * fila operacional e a escrita continua bloqueada pelo backend.
 */
export const isArchivedConversation = (conversation: CaixaConversationItem) =>
  isTerminalConversation(conversation)
  && conversation.unread_count <= 0
  && !isWaitingForStaff(conversation);

const matchesConversationSearch = (conversation: CaixaConversationItem, rawQuery: string) => {
  const query = rawQuery.trim().toLocaleLowerCase('pt-BR');
  if (!query) return true;
  return [
    conversation.numero_pedido ? String(conversation.numero_pedido) : '',
    conversation.cliente_nome,
    conversation.tipo_pedido,
    conversation.status_pedido,
    conversationStatusLabel(conversation),
    conversation.last_message?.body || '',
  ].some((value) => String(value || '').toLocaleLowerCase('pt-BR').includes(query));
};

export function CashierConversationsDrawer({
  isOpen,
  authorization,
  onClose,
  onInspectOrder,
  onUnreadCountChange,
  realtimeEvent = null,
  realtimeHealth = 'idle',
  draftScope = 'default',
}: CashierConversationsDrawerProps) {
  const [conversations, setConversations] = useState<CaixaConversationItem[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [messageState, setMessageState] = useState<MessageState>({ conversationId: null, items: [] });
  const [loadingList, setLoadingList] = useState(false);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [replyText, setReplyText] = useState('');
  const [sending, setSending] = useState(false);
  const [errorText, setErrorText] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');

  const chatScrollRef = useRef<HTMLDivElement>(null);
  const selectedIdRef = useRef<string | null>(null);
  const messageStateRef = useRef<MessageState>(messageState);
  const messageGenerationRef = useRef(0);
  const messageAbortRef = useRef<AbortController | null>(null);
  const visibleMessageLoadRef = useRef(false);
  const markReadInFlightRef = useRef<Set<string>>(new Set());
  const unreadByConversationRef = useRef<Map<string, number>>(new Map());
  const pendingSendRef = useRef<{ conversationId: string; body: string; id: string } | null>(null);

  useEffect(() => {
    selectedIdRef.current = selectedId;
  }, [selectedId]);

  useEffect(() => { messageStateRef.current = messageState; }, [messageState]);

  useEffect(() => {
    unreadByConversationRef.current = new Map(
      conversations.map((conversation) => [conversation.id, Math.max(0, conversation.unread_count || 0)]),
    );
  }, [conversations]);

  useEffect(() => {
    pruneCashierDrafts(draftScope);
  }, [draftScope]);

  const activeCount = conversations.length;

  const sortedConversations = useMemo(() => conversations
    .filter((conversation) => matchesConversationSearch(conversation, searchQuery))
    .sort((a, b) => {
      const unreadPriority = Number(b.unread_count > 0) - Number(a.unread_count > 0);
      if (unreadPriority !== 0) return unreadPriority;
      const waitingPriority = Number(isWaitingForStaff(b)) - Number(isWaitingForStaff(a));
      if (waitingPriority !== 0) return waitingPriority;
      return conversationTimestamp(b) - conversationTimestamp(a);
    }), [conversations, searchQuery]);

  const selectedConv = useMemo(
    () => conversations.find((conversation) => conversation.id === selectedId) || null,
    [conversations, selectedId],
  );
  const selectedArchived = selectedConv ? isArchivedConversation(selectedConv) : false;

  const messages = messageState.conversationId === selectedId ? messageState.items : [];

  const totalUnread = useMemo(
    () => conversations
      .filter((conversation) => !isArchivedConversation(conversation))
      .reduce((acc, conversation) => acc + (conversation.unread_count || 0), 0),
    [conversations],
  );

  const waitingForStaffCount = useMemo(
    () => conversations.filter((conversation) => !isArchivedConversation(conversation) && isWaitingForStaff(conversation)).length,
    [conversations],
  );

  const clearSelection = useCallback(() => {
    selectedIdRef.current = null;
    messageGenerationRef.current += 1;
    messageAbortRef.current?.abort();
    setSelectedId(null);
    setMessageState({ conversationId: null, items: [] });
    setReplyText('');
    setErrorText(null);
  }, []);

  useEffect(() => {
    if (isOpen && !loadingList) onUnreadCountChange?.(totalUnread);
  }, [isOpen, loadingList, totalUnread, onUnreadCountChange]);

  useEffect(() => {
    if (!isOpen) return;
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [isOpen, onClose]);

  useEffect(() => {
    if (!selectedId) return;
    if (!sortedConversations.some((conversation) => conversation.id === selectedId)) {
      clearSelection();
    }
  }, [clearSelection, selectedId, sortedConversations]);

  const scrollToBottom = useCallback((smooth = true) => {
    if (!chatScrollRef.current) return;
    chatScrollRef.current.scrollTo({
      top: chatScrollRef.current.scrollHeight,
      behavior: smooth ? 'smooth' : 'auto',
    });
  }, []);

  const fetchConversations = useCallback(async ({ background = false }: FetchConversationsOptions = {}) => {
    if (!authorization) return;
    try {
      if (!background) setLoadingList(true);
      const response = await fetch(`${API_BASE_URL}/api/caixa/conversas`, {
        headers: { Authorization: authorization },
        cache: 'no-store',
      });
      if (!response.ok) throw new Error(`Falha ao listar conversas (${response.status}).`);
      const data: CaixaConversationItem[] = await response.json();
      setConversations(Array.isArray(data) ? data : []);
      const currentSelection = selectedIdRef.current;
      if (currentSelection && !data.some((conversation) => conversation.id === currentSelection)) {
        clearSelection();
      }
    } catch (error) {
      console.warn('Erro ao listar conversas do Caixa:', error);
    } finally {
      if (!background) setLoadingList(false);
    }
  }, [authorization, clearSelection]);

  const markConversationRead = useCallback(async (
    conversationId: string,
    { force = false }: { force?: boolean } = {},
  ) => {
    if (!authorization || markReadInFlightRef.current.has(conversationId)) return;
    if (!force && (unreadByConversationRef.current.get(conversationId) || 0) <= 0) return;

    markReadInFlightRef.current.add(conversationId);
    unreadByConversationRef.current.set(conversationId, 0);
    setConversations((current) => current.map((conversation) => (
      conversation.id === conversationId ? { ...conversation, unread_count: 0 } : conversation
    )));
    try {
      const response = await fetch(`${API_BASE_URL}/api/caixa/conversas/${conversationId}/read`, {
        method: 'POST',
        headers: { Authorization: authorization },
      });
      if (!response.ok) throw new Error(`Falha ao marcar conversa como lida (${response.status}).`);
    } catch {
      // O próximo snapshot autoritativo restaura a contagem se a marcação falhar.
      void fetchConversations({ background: true });
    } finally {
      markReadInFlightRef.current.delete(conversationId);
    }
  }, [authorization, fetchConversations]);

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
      const snapshot = messageStateRef.current;
      const currentItems = snapshot.conversationId === conversationId ? snapshot.items : [];
      const latestSeq = background ? currentItems.at(-1)?.seq : undefined;
      const suffix = latestSeq ? `?after_seq=${latestSeq}` : '';
      let response = await fetch(`${API_BASE_URL}/api/caixa/conversas/${conversationId}/feed${suffix}`, {
        headers: { Authorization: authorization },
        cache: 'no-store',
        signal: controller.signal,
      });
      let page: CaixaFeedPage | null = null;
      if (response.ok) {
        const parsed = await response.json() as Partial<CaixaFeedPage>;
        if (Array.isArray(parsed.items)) page = parsed as CaixaFeedPage;
      }
      if (!response.ok || !page) {
        response = await fetch(`${API_BASE_URL}/api/caixa/conversas/${conversationId}/messages`, {
          headers: { Authorization: authorization }, cache: 'no-store', signal: controller.signal,
        });
        if (!response.ok) throw new Error(`Falha ao carregar conversa (${response.status}).`);
        const items: CaixaChatMessage[] = await response.json();
        page = { items, has_more: false, oldest_seq: null, latest_seq: null };
      }
      if (
        controller.signal.aborted
        || generation !== messageGenerationRef.current
        || selectedIdRef.current !== conversationId
      ) return;

      setMessageState((current) => {
        const existing = background && current.conversationId === conversationId ? current.items : [];
        const byId = new Map(existing.map((item) => [item.id, item]));
        page.items.forEach((item) => byId.set(item.id, item));
        return {
          conversationId,
          items: [...byId.values()].sort((a, b) => (a.seq || 0) - (b.seq || 0)),
          hasMore: background ? current.hasMore : page.has_more,
        };
      });
      if (markRead) void markConversationRead(conversationId);
      if (!background) window.setTimeout(() => scrollToBottom(false), 50);
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

  const loadOlderMessages = useCallback(async () => {
    if (!authorization || !selectedId || !messages[0]?.seq) return;
    const response = await fetch(
      `${API_BASE_URL}/api/caixa/conversas/${selectedId}/feed?before_seq=${messages[0].seq}&limit=50`,
      { headers: { Authorization: authorization }, cache: 'no-store' },
    );
    if (!response.ok) return;
    const page: CaixaFeedPage = await response.json();
    setMessageState((current) => current.conversationId === selectedId
      ? { ...current, items: [...page.items, ...current.items], hasMore: page.has_more }
      : current);
  }, [authorization, messages, selectedId]);

  const openConversation = useCallback((conversationId: string) => {
    selectedIdRef.current = conversationId;
    setSelectedId(conversationId);
    setErrorText(null);
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    void fetchConversations();
  }, [isOpen, fetchConversations]);

  useEffect(() => {
    if (!isOpen || !selectedId) return;
    setReplyText(loadCashierDraft(draftScope, selectedId));
    void loadMessages(selectedId);
  }, [draftScope, isOpen, selectedId, loadMessages]);

  useEffect(() => {
    if (!selectedId) return;
    const timer = window.setTimeout(() => {
      const body = replyText;
      if (!body.trim()) {
        removeCashierDraft(draftScope, selectedId);
        return;
      }
      try {
        localStorage.setItem(
          cashierDraftKey(draftScope, selectedId),
          JSON.stringify({
            body,
            expiresAt: Date.now() + CASHIER_CHAT_DRAFT_TTL_MS,
          }),
        );
      } catch {}
    }, 400);
    return () => window.clearTimeout(timer);
  }, [draftScope, replyText, selectedId]);

  useEffect(() => {
    if (isOpen && !selectedId && sortedConversations.length > 0 && window.innerWidth >= 640) {
      openConversation(sortedConversations[0].id);
    }
  }, [isOpen, openConversation, selectedId, sortedConversations]);

  const appendRealtimeMessage = useCallback((data: Record<string, unknown> | null) => {
    const eventConversationId = typeof data?.conversation_id === 'string' ? data.conversation_id : null;
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
    ) return;

    const message: CaixaChatMessage = {
      id: messageId,
      conversation_id: eventConversationId,
      pedido_id: pedidoId,
      sender_type: senderType,
      sender_user_id: typeof data?.sender_user_id === 'number' ? data.sender_user_id : null,
      body,
      event_key: typeof data?.event_key === 'string' ? data.event_key : null,
      created_at: typeof data?.created_at === 'string' ? data.created_at : null,
      seq: typeof data?.seq === 'number' ? data.seq : undefined,
    };

    if (selectedIdRef.current === eventConversationId) {
      setMessageState((current) => {
        const items = current.conversationId === eventConversationId ? current.items : [];
        if (items.some((item) => item.id === message.id)) return current;
        return { ...current, conversationId: eventConversationId,
          items: [...items, message].sort((a, b) => (a.seq || 0) - (b.seq || 0)) };
      });
      window.setTimeout(() => scrollToBottom(true), 50);
      if (senderType === 'customer' && document.visibilityState === 'visible') {
        void markConversationRead(eventConversationId, { force: true });
      }
    }
  }, [markConversationRead, scrollToBottom]);

  useEffect(() => {
    if (!isOpen || !realtimeEvent) return;
    const { event, data } = realtimeEvent;
    const eventConversationId = typeof data?.conversation_id === 'string' ? data.conversation_id : null;
    switch (event) {
      case 'reconnected': {
        void fetchConversations({ background: true });
        const current = selectedIdRef.current;
        if (current) void loadMessages(current, { background: true, markRead: false });
        return;
      }
      case 'new_message':
        appendRealtimeMessage(data);
        void fetchConversations({ background: true });
        return;
      case 'status_changed':
        if (data?.feed_event && typeof data.feed_event === 'object') {
          appendRealtimeMessage(data.feed_event as Record<string, unknown>);
        }
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
        return;
    }
  }, [appendRealtimeMessage, fetchConversations, isOpen, loadMessages, realtimeEvent]);

  useEffect(() => {
    if (!isOpen || realtimeHealth !== 'degraded') return;
    const interval = window.setInterval(() => {
      if (document.hidden) return;
      void fetchConversations({ background: true });
      const current = selectedIdRef.current;
      if (current) void loadMessages(current, { background: true, markRead: false });
    }, 15000);
    return () => window.clearInterval(interval);
  }, [fetchConversations, isOpen, loadMessages, realtimeHealth]);

  useEffect(() => () => {
    messageGenerationRef.current += 1;
    messageAbortRef.current?.abort();
  }, []);

  const sendReply = useCallback(async () => {
    if (!selectedId || !replyText.trim() || sending || selectedArchived) return;
    const targetConversationId = selectedId;
    const bodyToSend = replyText.trim();
    const pending = pendingSendRef.current;
    const clientMessageId = (
      pending
      && pending.conversationId === targetConversationId
      && pending.body === bodyToSend
    )
      ? pending.id
      : crypto.randomUUID();
    pendingSendRef.current = {
      conversationId: targetConversationId,
      body: bodyToSend,
      id: clientMessageId,
    };
    setSending(true);
    setErrorText(null);
    try {
      const response = await fetch(`${API_BASE_URL}/api/caixa/conversas/${targetConversationId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: authorization },
        body: JSON.stringify({ body: bodyToSend, client_message_id: clientMessageId }),
      });
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.detail || 'Erro ao enviar resposta.');
      }
      const sentMessage: CaixaChatMessage = await response.json();
      if (selectedIdRef.current === targetConversationId) {
        setMessageState((current) => {
          const items = current.conversationId === targetConversationId ? current.items : [];
          if (items.some((message) => message.id === sentMessage.id)) return current;
          return { ...current, conversationId: targetConversationId,
            items: [...items, sentMessage].sort((a, b) => (a.seq || 0) - (b.seq || 0)) };
        });
        pendingSendRef.current = null;
        removeCashierDraft(draftScope, targetConversationId)
        setReplyText('');
        window.setTimeout(() => scrollToBottom(true), 50);
      }
      setConversations((current) => current.map((conversation) => (
        conversation.id === targetConversationId
          ? {
              ...conversation,
              unread_count: 0,
              last_message: {
                id: sentMessage.id,
                sender_type: sentMessage.sender_type,
                body: sentMessage.body,
                created_at: sentMessage.created_at || null,
              },
            }
          : conversation
      )));
      void fetchConversations({ background: true });
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : 'Falha ao enviar resposta.');
    } finally {
      setSending(false);
    }
  }, [authorization, draftScope, fetchConversations, replyText, selectedArchived, selectedId, sending, scrollToBottom]);

  const handleSendReply = (event: React.FormEvent) => {
    event.preventDefault();
    void sendReply();
  };
  const handleReplyKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      void sendReply();
    }
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end bg-black/65 backdrop-blur-sm animate-fade-in"
      id="cashier-chat-overlay"
      onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}
    >
      <div
        className="flex h-full w-full max-w-5xl flex-col bg-zinc-950 text-zinc-100 border-l border-zinc-800 shadow-2xl animate-scale-up"
        role="dialog"
        aria-modal="true"
        aria-label="Central de Mensagens dos Pedidos"
        id="cashier-chat-panel"
      >
        <div className="flex items-center justify-between border-b border-zinc-800 px-4 sm:px-5 py-3.5 bg-zinc-900/70">
          <div className="flex min-w-0 items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-emerald-500/15 text-emerald-400 flex items-center justify-center shrink-0">
              <MessageSquare size={20} />
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-base font-bold text-white">Central de Conversas</h2>
                {totalUnread > 0 && (
                  <span className="px-2 py-0.5 rounded-full bg-emerald-400 text-emerald-950 text-[10px] font-black" aria-live="polite">
                    {totalUnread} não lidas
                  </span>
                )}
                {waitingForStaffCount > 0 && (
                  <span className="px-2 py-0.5 rounded-full border border-amber-400/30 bg-amber-400/10 text-amber-300 text-[10px] font-bold">
                    {waitingForStaffCount} aguardando resposta
                  </span>
                )}
              </div>
              <p className="truncate text-xs text-zinc-400">Somente pedidos ativos · histórico não ocupa a fila operacional</p>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => void fetchConversations()}
              disabled={loadingList}
              className="p-2 rounded-xl border border-zinc-800 bg-zinc-900 text-zinc-400 hover:text-white transition disabled:opacity-50"
              title="Atualizar conversas"
              aria-label="Atualizar conversas"
            >
              <RefreshCw size={16} className={clsx(loadingList && 'animate-spin text-emerald-400')} />
            </button>
            <button
              type="button"
              onClick={onClose}
              className="p-2 rounded-xl border border-zinc-800 bg-zinc-900 text-zinc-400 hover:text-white transition"
              title="Fechar conversas"
              aria-label="Fechar conversas"
            >
              <X size={18} />
            </button>
          </div>
        </div>

        <div className="flex-1 flex overflow-hidden">
          <div
            className={clsx(
              'w-full sm:w-96 border-r border-zinc-800 flex flex-col bg-zinc-900/45 overflow-hidden',
              selectedId ? 'hidden sm:flex' : 'flex',
            )}
          >
            <div className="shrink-0 border-b border-zinc-800/80 bg-zinc-950/95 px-3 py-2 backdrop-blur space-y-2">
              <div className="flex items-center justify-between rounded-xl border border-zinc-800 bg-zinc-900 px-3 py-2 text-[10px] font-bold text-zinc-300">
                <span>Pedidos ativos</span>
                <span className="text-emerald-300">{activeCount}</span>
              </div>
              <input
                type="search"
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder="Buscar pedido, cliente ou mensagem"
                className="w-full rounded-xl border border-zinc-800 bg-zinc-900 px-3 py-2 text-xs text-zinc-100 placeholder-zinc-600 outline-none transition focus:border-emerald-500"
                aria-label="Buscar conversas"
              />
              <p className="hidden text-[10px] font-bold uppercase tracking-[0.14em] text-zinc-500 sm:block">
                Não lidas primeiro · depois aguardando resposta
              </p>
            </div>

            <div
              className="min-h-0 flex-1 overflow-y-auto overscroll-contain touch-pan-y [-webkit-overflow-scrolling:touch]"
              aria-label="Lista de conversas"
            >
              {sortedConversations.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center p-6 text-center text-zinc-500 text-xs">
                  <MessageSquare size={32} className="opacity-20 mb-3" />
                  <p>Nenhuma conversa ativa no momento.</p>
                </div>
              ) : (
                <div className="divide-y divide-zinc-800/70">
                  {sortedConversations.map((conversation) => {
                    const isSelected = conversation.id === selectedId;
                    const awaitingReply = isWaitingForStaff(conversation);
                    const archived = isArchivedConversation(conversation);
                    return (
                      <button
                        key={conversation.id}
                        type="button"
                        onClick={() => openConversation(conversation.id)}
                        className={clsx(
                          'relative w-full text-left p-3.5 transition flex flex-col gap-1.5 border-l-4',
                          isSelected
                            ? 'bg-emerald-500/10 border-emerald-400'
                            : conversation.unread_count > 0
                              ? 'bg-emerald-500/[0.06] border-emerald-500/50 hover:bg-emerald-500/10'
                              : 'border-transparent hover:bg-zinc-800/50',
                        )}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex min-w-0 items-center gap-2">
                            <span className="text-xs font-bold text-white">Pedido #{conversation.numero_pedido || '—'}</span>
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-400 font-medium capitalize">
                              {conversation.tipo_pedido}
                            </span>
                            {archived && <span className="text-[9px] font-bold text-zinc-500">Arquivada</span>}
                          </div>
                          {conversation.unread_count > 0 && (
                            <span className="min-w-5 h-5 px-1 rounded-full bg-emerald-400 text-emerald-950 text-[10px] font-black flex items-center justify-center">
                              {conversation.unread_count}
                            </span>
                          )}
                        </div>
                        <div className="flex items-center justify-between gap-2 text-xs">
                          <span className="text-zinc-200 font-semibold truncate">{conversation.cliente_nome}</span>
                          <span className="text-[10px] text-zinc-500 shrink-0">{conversationStatusLabel(conversation)}</span>
                        </div>
                        {awaitingReply && (
                          <span className="w-fit rounded-full bg-amber-400/10 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide text-amber-300">
                            Cliente aguardando resposta
                          </span>
                        )}
                        {conversation.last_message && (
                          <p className={clsx(
                            'text-[11px] line-clamp-2 break-words leading-relaxed',
                            awaitingReply ? 'text-zinc-200' : 'text-zinc-400',
                          )}>
                            {conversation.last_message.sender_type === 'staff' ? (
                              <span className="text-zinc-500">Você: </span>
                            ) : conversation.last_message.sender_type === 'customer' ? (
                              <span className="text-emerald-400 font-semibold">Cliente: </span>
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
          </div>

          <div className={clsx('flex-1 flex flex-col bg-zinc-950 min-w-0', !selectedId ? 'hidden sm:flex items-center justify-center' : 'flex')}>
            {selectedConv ? (
              <>
                <div className="px-4 sm:px-5 py-3 border-b border-zinc-800 flex items-center justify-between gap-3 bg-zinc-900/45">
                  <div className="flex min-w-0 items-center gap-3">
                    <button
                      type="button"
                      onClick={clearSelection}
                      className="sm:hidden flex size-11 shrink-0 items-center justify-center rounded-xl border border-zinc-800 bg-zinc-900 text-zinc-400 transition hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60"
                      aria-label="Voltar para conversas"
                      title="Voltar para conversas"
                    >
                      <ArrowLeft size={18} />
                    </button>
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="text-sm font-bold text-white">Pedido #{selectedConv.numero_pedido || '—'}</h3>
                        <span className="text-[10px] px-2 py-0.5 rounded-full bg-zinc-800 text-zinc-300">{conversationStatusLabel(selectedConv)}</span>
                        {selectedArchived && <span className="text-[10px] font-bold text-zinc-500">arquivada</span>}
                        {isWaitingForStaff(selectedConv) && <span className="text-[10px] font-bold text-amber-300">aguardando sua resposta</span>}
                      </div>
                      <span className="block truncate text-xs text-zinc-400">
                        {selectedConv.cliente_nome} · {selectedConv.tipo_pedido} · R$ {selectedConv.total_pedido.toFixed(2)}
                      </span>
                    </div>
                  </div>
                  {onInspectOrder && (
                    <button
                      type="button"
                      onClick={() => { onInspectOrder(selectedConv.pedido_id); onClose(); }}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-zinc-700 bg-zinc-800 hover:bg-zinc-700 text-xs font-semibold text-zinc-200 transition shrink-0"
                    >
                      <span className="hidden sm:inline">Ver pedido</span>
                      <ExternalLink size={13} />
                    </button>
                  )}
                </div>

                <div ref={chatScrollRef} className="flex-1 p-4 overflow-y-auto space-y-3 scroll-smooth">
                  {messageState.conversationId === selectedId && messageState.hasMore && (
                    <button type="button" onClick={() => void loadOlderMessages()}
                      className="mx-auto block rounded-lg border border-zinc-700 px-3 py-1.5 text-[10px] font-semibold text-zinc-300 hover:border-emerald-500/60">
                      Carregar mensagens anteriores
                    </button>
                  )}
                  {loadingMessages ? (
                    <div className="h-full flex items-center justify-center"><div className="w-8 h-8 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" /></div>
                  ) : messages.length === 0 ? (
                    <div className="h-full flex flex-col items-center justify-center text-zinc-500 text-xs text-center p-4">
                      <MessageSquare size={24} className="opacity-30 mb-2" />
                      <p>Nenhuma mensagem registrada para este pedido.</p>
                    </div>
                  ) : messages.map((message) => {
                    if (message.sender_type === 'system') {
                      return (
                        <div key={message.id} className="flex justify-center my-2">
                          <span className="max-w-[90%] px-3 py-1 rounded-full bg-zinc-900 border border-zinc-800 text-[10px] text-zinc-400 font-medium whitespace-pre-wrap break-words text-center">{message.body}</span>
                        </div>
                      );
                    }
                    const isStaff = message.sender_type === 'staff';
                    return (
                      <div key={message.id} className={clsx('flex flex-col max-w-[86%] sm:max-w-[76%]', isStaff ? 'ml-auto items-end' : 'mr-auto items-start')}>
                        <span className="text-[10px] text-zinc-500 mb-0.5 px-1">{isStaff ? 'Equipe Caixa' : selectedConv.cliente_nome}</span>
                        <div className={clsx(
                          'rounded-2xl px-3.5 py-2.5 text-xs leading-relaxed break-words whitespace-pre-wrap shadow-sm',
                          isStaff ? 'bg-emerald-600 text-white rounded-tr-sm' : 'bg-zinc-800 border border-zinc-700 text-zinc-100 rounded-tl-sm',
                        )}>{message.body}</div>
                        {message.created_at && (
                          <span className="text-[9px] text-zinc-600 mt-0.5 px-1 font-mono">
                            {new Date(message.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>

                <div className="border-t border-zinc-800 bg-zinc-900/75 p-3">
                  {selectedArchived ? (
                    <div className="rounded-xl border border-zinc-800 bg-zinc-950 px-3.5 py-3 text-xs text-zinc-400">
                      Pedido encerrado. O histórico permanece somente para leitura e não volta para a fila operacional.
                    </div>
                  ) : (
                    <>
                      <div className="relative">
                        <div className="mb-2 flex gap-1.5 overflow-x-auto pb-1 pr-7 sm:pr-0" aria-label="Respostas rápidas">
                          {QUICK_REPLIES.map((reply) => (
                            <button
                              key={reply}
                              type="button"
                              onClick={() => setReplyText(reply)}
                              disabled={sending}
                              className="shrink-0 rounded-full border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-[10px] font-semibold text-zinc-300 transition hover:border-emerald-500/60 hover:bg-emerald-500/10 hover:text-emerald-300 disabled:opacity-50"
                              title={`Usar resposta: ${reply}`}
                            >
                              {reply}
                            </button>
                          ))}
                        </div>
                        <span
                          aria-hidden="true"
                          className="pointer-events-none absolute inset-y-0 right-0 w-8 bg-gradient-to-l from-zinc-900 via-zinc-900/80 to-transparent sm:hidden"
                        />
                      </div>
                      {errorText && (
                        <div className="text-[11px] text-rose-400 mb-1.5 px-1 flex items-center gap-1">
                          <AlertCircle size={12} /><span>{errorText}</span>
                        </div>
                      )}
                      <form onSubmit={handleSendReply} className="flex items-end gap-2">
                        <div className="min-w-0 flex-1">
                          <textarea
                            value={replyText}
                            onChange={(event) => setReplyText(event.target.value)}
                            onKeyDown={handleReplyKeyDown}
                            placeholder="Responder ao cliente..."
                            maxLength={1000}
                            rows={2}
                            disabled={sending}
                            className="min-h-[46px] max-h-32 w-full resize-y bg-zinc-950 border border-zinc-700 rounded-xl px-3.5 py-2.5 text-xs text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 disabled:opacity-50 transition"
                          />
                          <div className="mt-1 flex items-center justify-between px-1 text-[9px] text-zinc-600">
                            <span className="hidden sm:inline">Enter envia · Shift+Enter quebra linha</span>
                            <span className="ml-auto">{replyText.length}/1000</span>
                          </div>
                        </div>
                        <button
                          type="submit"
                          disabled={sending || !replyText.trim()}
                          className="mb-4 w-10 h-10 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-emerald-950 flex items-center justify-center disabled:opacity-40 disabled:hover:bg-emerald-500 transition shrink-0"
                          title="Enviar resposta"
                          aria-label="Enviar resposta"
                        >
                          <Send size={16} />
                        </button>
                      </form>
                    </>
                  )}
                </div>
              </>
            ) : (
              <div className="text-zinc-500 text-xs flex flex-col items-center text-center px-6">
                <MessageSquare size={32} className="opacity-20 mb-2" />
                <p className="font-semibold text-zinc-400">Selecione uma conversa</p>
                <p className="mt-1 text-[10px]">A fila mostra apenas pedidos em andamento.</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default CashierConversationsDrawer;
