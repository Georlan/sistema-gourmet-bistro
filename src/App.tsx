/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Menu, X, User, Wifi, WifiOff, SlidersHorizontal, ArrowDownRight, ArrowUpRight, RefreshCw, Bell, Printer, TrendingUp, Utensils, CheckCircle2, UserCheck, UserX, ShoppingBag } from 'lucide-react';
import { Table, Order, DraftItem, AppSettings, AppRole, Product } from './types';
import { TABLES, WAITERS, RESTAURANT_CONFIG, PRODUCTS } from './data';
import { getTableTotal } from './domain';
import { supabase } from './cardapio/SupabaseClient';
import { MesaCard } from './components/MesaCard';
import { MesaDetailsModal } from './components/MesaDetailsModal';
import { CaixaPanel, MemoizedCaixaPanel } from './components/CaixaPanel';
import clsx from 'clsx';
import CardapioPage from './cardapio/CardapioPage';
import SuperAdminPanel from './super-admin/SuperAdminPanel';
import { CaixaAtivarPage } from './components/CaixaAtivarPage';

import { API_BASE_URL } from './config/api';

const LOCAL_STORAGE_DRAFTS_KEY = 'koma_drafts_vFinal_v3';
const LOCAL_STORAGE_SETTINGS_KEY = 'koma_settings_vFinal_v3';
const LOCAL_STORAGE_RESTAURANT_NAME_KEY = 'koma_restaurant_name_v3';
const LOCAL_STORAGE_HIST_CLIENTS_KEY = 'koma_historic_clients_v3';

const parseBackendDateTime = (dateStr: string): number => {
  if (!dateStr) return Date.now();
  if (!dateStr.endsWith('Z') && !dateStr.includes('+') && !/-\d{2}:\d{2}$/.test(dateStr)) {
    return new Date(dateStr + 'Z').getTime();
  }
  return new Date(dateStr).getTime();
};

const aplicarMascaraTelefoneInput = (valor: string) => {
  const apenasNumeros = valor.replace(/\D/g, '').slice(0, 11);
  if (apenasNumeros.length === 0) return '';
  if (apenasNumeros.length <= 2) return `(${apenasNumeros}`;
  if (apenasNumeros.length <= 6) return `(${apenasNumeros.slice(0, 2)}) ${apenasNumeros.slice(2)}`;
  if (apenasNumeros.length <= 10) return `(${apenasNumeros.slice(0, 2)}) ${apenasNumeros.slice(2, 6)}-${apenasNumeros.slice(6)}`;
  return `(${apenasNumeros.slice(0, 2)}) ${apenasNumeros.slice(2, 7)}-${apenasNumeros.slice(7)}`;
};

export default function App() {
  const isSuperAdmin = window.location.pathname.startsWith('/super-admin');

  if (isSuperAdmin) {
    return <SuperAdminPanel />;
  }

  // Detect activation page (?view=ativar or /ativar)
  const isAtivar = window.location.pathname.startsWith('/ativar') ||
                   window.location.search.includes('view=ativar');
  if (isAtivar) {
    const tokenFromUrl = new URLSearchParams(window.location.search).get('token');
    return <CaixaAtivarPage token={tokenFromUrl} />;
  }

  // Detect if access is client cardapio (online menu)
  const isCardapio = window.location.pathname.startsWith('/cardapio') ||
                     window.location.search.includes('view=cardapio') ||
                     (window.location.hostname !== 'localhost' &&
                      window.location.hostname !== '127.0.0.1' &&
                      !window.location.hostname.includes('sistema-gourmet-bistro') &&
                      !window.location.hostname.includes('pages.dev') &&
                      window.location.hostname.split('.').length > 2 &&
                      window.location.hostname.split('.')[0] !== 'www');

  if (isCardapio) {
    return <CardapioPage />;
  }

  // 1. Roles & Active user state (Strictly 'garcom')
  // 1. Detect portal (garcom or caixa/management) from URL query parameters or hashes
  const [portal, setPortal] = useState<'garcom' | 'caixa'>(() => {
    const searchParams = new URLSearchParams(window.location.search);
    const viewParam = searchParams.get('view');
    const hash = window.location.hash;

    if (viewParam === 'caixa' || viewParam === 'gerencia' || hash === '#caixa' || hash === '#gerencia') {
      return 'caixa';
    }
    return 'garcom';
  });

  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(() => {
    const key = portal === 'caixa' ? "koma_caixa_token" : "koma_waiter_token";
    return !!localStorage.getItem(key);
  });
  const [activeWaiterId, setActiveWaiterId] = useState<string>(() => {
    const key = portal === 'caixa' ? "koma_caixa_id" : "koma_waiter_id";
    return localStorage.getItem(key) || "";
  });
  const [activeWaiterNome, setActiveWaiterNome] = useState<string>(() => {
    const key = portal === 'caixa' ? "koma_caixa_name" : "koma_waiter_name";
    return localStorage.getItem(key) || "";
  });
  const activeWaiter = { id: activeWaiterId, nome: activeWaiterNome };
  const [activeRole, setActiveRole] = useState<AppRole>(() => {
    if (portal === 'caixa') {
      return (localStorage.getItem("koma_caixa_role") as AppRole) || 'caixa';
    }
    return 'garcom';
  });

  // Listen to URL changes to switch portal dynamically
  const [restauranteConfig, setRestauranteConfig] = useState<any>(null);
  const [pagamentosPendentes, setPagamentosPendentes] = useState<any[]>([]);
  const [isWsConnected, setIsWsConnected] = useState<boolean>(false);
  const [waiterAvailable, setWaiterAvailable] = useState<boolean>(true);

  // Helper to get headers for API calls including JWT
  const getAuthHeaders = useCallback((contentType = "application/json") => {
    const headers: any = {};
    if (contentType) {
      headers["Content-Type"] = contentType;
    }
    const tokenKey = portal === 'caixa' ? "koma_caixa_token" : "koma_waiter_token";
    const token = localStorage.getItem(tokenKey);
    if (token) {
      headers["Authorization"] = `Bearer ${token}`;
    }
    return headers;
  }, [portal]);

  const printPairingStartedRef = useRef(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const nonce = params.get('pair_print_agent');
    const portText = params.get('agent_port');
    if (!nonce || !portText || !isAuthenticated || printPairingStartedRef.current) return;

    const port = Number(portText);
    if (!Number.isInteger(port) || port < 17654 || port > 17664) return;

    printPairingStartedRef.current = true;

    const authorizePrintAgent = async () => {
      const jwt = localStorage.getItem('koma_caixa_token');
      if (!jwt) {
        printPairingStartedRef.current = false;
        return;
      }

      try {
        const registerResponse = await fetch(`${API_BASE_URL}/api/print-agents/register`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${jwt}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            agent_id: `desktop-${nonce.slice(0, 12)}`
          })
        });
        const registration = await registerResponse.json().catch(() => null);
        if (!registerResponse.ok || !registration?.agent_token) {
          throw new Error('Não foi possível configurar a impressão neste computador.');
        }

        const localResponse = await fetch(`http://127.0.0.1:${port}/pair`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            nonce,
            token: registration.agent_token
          })
        });
        if (!localResponse.ok) {
          throw new Error('Não foi possível concluir a configuração da impressão.');
        }

        params.delete('pair_print_agent');
        params.delete('agent_port');
        const query = params.toString();
        window.history.replaceState(
          null,
          '',
          `${window.location.pathname}${query ? `?${query}` : ''}${window.location.hash}`
        );
        window.alert('Impressão configurada. O teste já pode ser enviado.');
      } catch (error) {
        printPairingStartedRef.current = false;
        const message = error instanceof Error
          ? error.message
          : 'Não foi possível configurar a impressão.';
        window.alert(message);
      }
    };

    void authorizePrintAgent();
  }, [isAuthenticated]);

  const fetchPagamentosPendentes = async () => {
    try {
      const tokenKey = portal === 'caixa' ? "koma_caixa_token" : "koma_waiter_token";
      const token = localStorage.getItem(tokenKey);
      if (!token) return;

      const res = await fetch(`${API_BASE_URL}/caixa/pagamentos/pendentes`, {
        headers: getAuthHeaders()
      });
      if (res.status === 401) {
        handleLogout();
        return;
      }
      if (res.ok) {
        const data = await res.json();
        setPagamentosPendentes(data);
      }
    } catch (err) {
      console.error("Error fetching pending payments:", err);
    }
  };

  const fetchConfig = async () => {
    try {
      const tokenKey = portal === 'caixa' ? "koma_caixa_token" : "koma_waiter_token";
      const token = localStorage.getItem(tokenKey);
      if (!token) return;

      const res = await fetch(`${API_BASE_URL}/caixa/configuracoes`, {
        headers: getAuthHeaders()
      });
      if (res.ok) {
        const data = await res.json();
        setRestauranteConfig(data);
        setIsConfigLoaded(true);
      }
    } catch (err) {
      console.error("Error fetching configs in App:", err);
    }
  };

  const [turnoResumo, setTurnoResumo] = useState<{
    total_vendas?: number;
    comandas_abertas_count?: number;
    total_sangrias?: number;
    total_suprimentos?: number;
  } | null>(null);

  const fetchTurnoResumo = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/caixa/turno-atual/resumo`, { headers: getAuthHeaders() });
      if (res.ok) {
        const data = await res.json();
        setTurnoResumo(data);
      }
    } catch (e) {
      console.error("Erro ao buscar resumo do turno no App:", e);
    }
  }, [API_BASE_URL, getAuthHeaders]);

  useEffect(() => {
    fetchConfig();
    fetchTurnoResumo();
    if (isWsConnected) return;
    const interval = setInterval(() => {
      fetchConfig();
      fetchTurnoResumo();
    }, 15000);
    return () => clearInterval(interval);
  }, [isWsConnected, fetchTurnoResumo]);

  useEffect(() => {
    const handleUrlChange = () => {
      const searchParams = new URLSearchParams(window.location.search);
      const viewParam = searchParams.get('view');
      const hash = window.location.hash;
      let newPortal: 'caixa' | 'garcom' = (viewParam === 'caixa' || viewParam === 'gerencia' || hash === '#caixa' || hash === '#gerencia') ? 'caixa' : 'garcom';

      setPortal(newPortal);

      const tokenKey = newPortal === 'caixa' ? "koma_caixa_token" : "koma_waiter_token";
      const idKey = newPortal === 'caixa' ? "koma_caixa_id" : "koma_waiter_id";
      const nameKey = newPortal === 'caixa' ? "koma_caixa_name" : "koma_waiter_name";
      const roleKey = newPortal === 'caixa' ? "koma_caixa_role" : "koma_user_role";

      setIsAuthenticated(!!localStorage.getItem(tokenKey));
      setActiveWaiterId(localStorage.getItem(idKey) || "");
      setActiveWaiterNome(localStorage.getItem(nameKey) || "");

      if (newPortal === 'caixa') {
        setActiveRole((localStorage.getItem(roleKey) as AppRole) || 'caixa');
      } else {
        setActiveRole('garcom');
      }

      const tableKey = `koma_${newPortal}_selected_table_v3`;
      const savedTable = localStorage.getItem(tableKey);
      setSelectedTableId(savedTable ? parseInt(savedTable, 10) : null);
    };

    window.addEventListener('popstate', handleUrlChange);
    window.addEventListener('hashchange', handleUrlChange);
    return () => {
      window.removeEventListener('popstate', handleUrlChange);
      window.removeEventListener('hashchange', handleUrlChange);
    };
  }, [portal]);

  // Toast notification system
  interface Toast { id: number; message: string; type: 'success' | 'error' | 'info'; }
  const [toasts, setToasts] = useState<Toast[]>([]);
  const toastIdRef = useRef(0);

  const showToast = useCallback((message: string, type: Toast['type'] = 'success', duration = 3000) => {
    const id = ++toastIdRef.current;
    setToasts(prev => [...prev, { id, message, type }]);
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), duration);
  }, []);

  // Login Form States
  const [loginUsername, setLoginUsername] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [loginError, setLoginError] = useState("");
  const [isLoggingIn, setIsLoggingIn] = useState(false);

  // Logout handler
  const handleLogout = useCallback(() => {
    const tokenKey = portal === 'caixa' ? "koma_caixa_token" : "koma_waiter_token";
    const idKey = portal === 'caixa' ? "koma_caixa_id" : "koma_waiter_id";
    const nameKey = portal === 'caixa' ? "koma_caixa_name" : "koma_waiter_name";
    const roleKey = portal === 'caixa' ? "koma_caixa_role" : "koma_user_role";

    localStorage.removeItem(tokenKey);
    localStorage.removeItem(idKey);
    localStorage.removeItem(nameKey);
    localStorage.removeItem(roleKey);

    setIsAuthenticated(false);
    setActiveWaiterId("");
    setActiveWaiterNome("");
    setActiveRole(portal === 'caixa' ? "caixa" : "garcom");
    setIsSidebarOpen(false);
  }, [portal]);

  // Sidebar Open State
  const [isSidebarOpen, setIsSidebarOpen] = useState<boolean>(false);

  const [fontSize, setFontSize] = useState<'padrao' | 'grande' | 'gigante'>(() => {
    return (localStorage.getItem('koma_font_size') as any) || 'padrao';
  });

  const changeFontSize = (size: 'padrao' | 'grande' | 'gigante') => {
    localStorage.setItem('koma_font_size', size);
    setFontSize(size);
    window.dispatchEvent(new Event('koma_font_size_changed'));
  };

  useEffect(() => {
    const handleStorageChange = () => {
      const stored = localStorage.getItem('koma_font_size') as any;
      if (stored && ['padrao', 'grande', 'gigante'].includes(stored)) {
        setFontSize(stored);
      }
    };
    window.addEventListener('storage', handleStorageChange);
    window.addEventListener('koma_font_size_changed', handleStorageChange);
    return () => {
      window.removeEventListener('storage', handleStorageChange);
      window.removeEventListener('koma_font_size_changed', handleStorageChange);
    };
  }, []);

  // 1.5. Dynamic Salon Tables State and Fetcher
  const [salonTables, setSalonTables] = useState<Table[]>([]);
  const [fetchError, setFetchError] = useState<string | null>(null);

  const fetchTablesAbortControllerRef = useRef<AbortController | null>(null);
  const fetchOrdersAbortControllerRef = useRef<AbortController | null>(null);
  const optimisticItemStatusRef = useRef<Record<string, { status: 'preparando' | 'pronto' | 'entregue'; ts: number }>>({});
  // Prevents duplicate API calls when clicking Pronto/Entregar rapidly
  const inflightItemIdsRef = useRef<Set<string>>(new Set());
  // Prevents duplicate API calls for critical table operations (close, transfer, merge)
  const inflightTableOpsRef = useRef<Set<string>>(new Set());


  const fetchTables = async () => {
    if (fetchTablesAbortControllerRef.current) {
      fetchTablesAbortControllerRef.current.abort();
    }
    const controller = new AbortController();
    fetchTablesAbortControllerRef.current = controller;

    try {
      setFetchError(null);
      const res = await fetch(`${API_BASE_URL}/mesas/`, { 
        headers: getAuthHeaders(),
        signal: controller.signal
      });
      if (res.status === 401) {
        handleLogout();
        return;
      }
      if (res.ok) {
        const data = await res.json();
        setSalonTables(data);
        setIsTablesLoaded(true);
      } else {
        setFetchError(`Erro HTTP mesas ${res.status}: ${res.statusText}`);
      }
    } catch (err: any) {
      if (err.name !== 'AbortError') {
        console.error("Error fetching tables", err);
        setFetchError(err.message || String(err));
      }
    }
  };

  // Create Mesa
  const handleCreateMesa = async (id: number, capacidade: number, nome?: string) => {
    try {
      const res = await fetch(`${API_BASE_URL}/mesas/`, {
        method: "POST",
        headers: getAuthHeaders(),
        body: JSON.stringify({ id, capacidade, nome })
      });
      if (res.ok) {
        await fetchTables();
      } else {
        const err = await res.json();
        showToast(`Erro ao criar mesa: ${err.detail}`, 'error');
      }
    } catch (err) {
      console.error(err);
    }
  };

  // Update Mesa
  const handleUpdateMesa = async (id: number, capacidade?: number, nome?: string) => {
    try {
      const res = await fetch(`${API_BASE_URL}/mesas/${id}`, {
        method: "PUT",
        headers: getAuthHeaders(),
        body: JSON.stringify({ capacidade, nome })
      });
      if (res.ok) {
        await fetchTables();
      } else {
        const err = await res.json();
        showToast(`Erro ao atualizar mesa: ${err.detail}`, 'error');
      }
    } catch (err) {
      console.error(err);
    }
  };

  // Delete Mesa
  const handleDeleteMesa = async (id: number) => {
    try {
      const res = await fetch(`${API_BASE_URL}/mesas/${id}`, {
        method: "DELETE",
        headers: getAuthHeaders()
      });
      if (res.ok) {
        await fetchTables();
      } else {
        let errMsg = 'Erro desconhecido';
        try {
          const err = await res.json();
          errMsg = err.detail || errMsg;
        } catch (_) {
          errMsg = res.statusText || errMsg;
        }
        showToast(`Erro ao excluir mesa: ${errMsg}`, 'error');
      }
    } catch (err: any) {
      console.error(err);
      showToast(`Erro de conexão ao excluir mesa: ${err.message}`, 'error');
    }
  };

  // Editable Restaurant Name State
  const [restaurantName, setRestaurantName] = useState<string>(() => {
    return localStorage.getItem(LOCAL_STORAGE_RESTAURANT_NAME_KEY) || RESTAURANT_CONFIG.nomePadrao;
  });

  // Table filter state
  const [tableFilter, setTableFilter] = useState<'todos' | 'livres' | 'ocupadas' | 'prontas'>('todos');

  // Pre-loading states for smooth intro transition
  const [isConfigLoaded, setIsConfigLoaded] = useState(false);
  const [isProductsLoaded, setIsProductsLoaded] = useState(false);
  const [isOrdersLoaded, setIsOrdersLoaded] = useState(false);
  const [isTablesLoaded, setIsTablesLoaded] = useState(false);

  // 2. Live products loaded from backend (includes ativo field for availability blocking)
  const [liveProdutos, setLiveProdutos] = useState<Product[]>([]);
  const [liveCategorias, setLiveCategorias] = useState<any[]>([]);

  const fetchLiveProdutos = useCallback(async () => {
    try {
      const tokenKey = portal === 'caixa' ? "koma_caixa_token" : "koma_waiter_token";
      const token = localStorage.getItem(tokenKey);
      const headers: any = token ? { Authorization: `Bearer ${token}` } : {};
      const res = await fetch(`${API_BASE_URL}/produtos/`, { headers });
      if (res.status === 401) {
        handleLogout();
        return;
      }
      if (res.ok) {
        const data = await res.json();
        const sorted = Array.isArray(data)
          ? [...data].sort((a: any, b: any) =>
              String(a.id).localeCompare(String(b.id), undefined, { numeric: true, sensitivity: 'base' })
            )
          : [];
        setLiveProdutos(sorted);
        setIsProductsLoaded(true);
      }
    } catch (err) {
      console.error("Error fetching live products", err);
    }
  }, [portal]);

  const fetchLiveCategorias = useCallback(async () => {
    try {
      const tokenKey = portal === 'caixa' ? "koma_caixa_token" : "koma_waiter_token";
      const token = localStorage.getItem(tokenKey);
      const headers: any = token ? { Authorization: `Bearer ${token}` } : {};
      const res = await fetch(`${API_BASE_URL}/produtos/categorias`, { headers });
      if (res.ok) {
        const data = await res.json();
        setLiveCategorias(data);
      }
    } catch (err) {
      console.error("Error fetching live categories", err);
    }
  }, [portal]);

  useEffect(() => {
    if (!isAuthenticated) return;
    fetchLiveProdutos();
    fetchLiveCategorias();
    if (isWsConnected) return;
    const interval = setInterval(() => {
      fetchLiveProdutos();
      fetchLiveCategorias();
    }, 40000); // refresh every 40s if not connected to WS
    return () => clearInterval(interval);
  }, [isAuthenticated, isWsConnected, fetchLiveProdutos, fetchLiveCategorias]);

  // 2b. Orders loaded from API
  const [orders, setOrders] = useState<Order[]>([]);
  const ordersRef = useRef<Order[]>(orders);
  useEffect(() => {
    ordersRef.current = orders;
  }, [orders]);

  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const isSubmittingRef = useRef<boolean>(false); // Synchronous guard against double-click race condition

  const [drafts, setDrafts] = useState<{ [mesaId: number]: DraftItem[] }>(() => {
    const saved = localStorage.getItem(LOCAL_STORAGE_DRAFTS_KEY);
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch (e) {
        console.error('Error loading drafts from localStorage', e);
      }
    }
    return {};
  });

  // 3. App View Settings
  const [settings, setSettings] = useState<AppSettings>(() => {
    const saved = localStorage.getItem(LOCAL_STORAGE_SETTINGS_KEY);
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch (e) {
        console.error('Error loading settings from localStorage', e);
      }
    }
    const searchParams = new URLSearchParams(window.location.search);
    const viewParam = searchParams.get('view');
    const hash = window.location.hash;
    const isCaixa = viewParam === 'caixa' || viewParam === 'gerencia' || hash === '#caixa' || hash === '#gerencia';
    return { exibirImagens: isCaixa, exibirDescricoes: isCaixa };
  });

  // 4. Modal focus state
  const [selectedTableId, setSelectedTableId] = useState<number | null>(() => {
    const searchParams = new URLSearchParams(window.location.search);
    const viewParam = searchParams.get('view');
    const hash = window.location.hash;
    const initialPortal = (viewParam === 'caixa' || viewParam === 'gerencia' || hash === '#caixa' || hash === '#gerencia') ? 'caixa' : 'garcom';
    const saved = localStorage.getItem(`koma_${initialPortal}_selected_table_v3`);
    return saved ? parseInt(saved, 10) : null;
  });

  const handleTableClick = useCallback((tableId: number) => {
    const targetMesaId = ordersRef.current.find(o => o.mesaOrigemId === tableId)?.mesaId;
    if (targetMesaId) {
      setSelectedTableId(targetMesaId);
    } else {
      setSelectedTableId(tableId);
    }
  }, []);

  useEffect(() => {
    const key = `koma_${portal}_selected_table_v3`;
    if (selectedTableId !== null) {
      localStorage.setItem(key, selectedTableId.toString());
    } else {
      localStorage.removeItem(key);
    }
  }, [selectedTableId, portal]);

  // 5. Live clock tracker to update permanency timers automatically every 30 seconds (reduces re-renders)
  const [currentTime, setCurrentTime] = useState<number>(Date.now());

  useEffect(() => {
    const interval = setInterval(() => {
      setCurrentTime(Date.now());
    }, 30000);
    return () => clearInterval(interval);
  }, []);

  // WebSocket Live Real-Time & Draft Sincronização
  interface ActiveDraftInfo {
    garcomNome: string;
    timestamp: number;
  }
  const [activeDrafts, setActiveDrafts] = useState<{ [mesaId: number]: { [garcomId: string]: ActiveDraftInfo } }>({});
  const wsRef = useRef<WebSocket | null>(null);
  const lastDraftStatusesRef = useRef<{ [mesaId: number]: boolean }>({});

  const notifyDraftStatus = (mesaId: number, hasDraft: boolean) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      try {
        wsRef.current.send(JSON.stringify({
          action: "draft_status",
          mesa_id: mesaId,
          garcom_nome: activeWaiterNome,
          ativo: hasDraft
        }));
      } catch (err) {
        console.error("Error sending draft status via WebSocket:", err);
      }
    }
  };

  useEffect(() => {
    if (!isAuthenticated || !activeWaiterId) {
      if (wsRef.current) {
        wsRef.current.close();
      }
      return;
    }

    let ws: WebSocket;
    let reconnectTimeout: any;
    let wsUpdateTimeout: any;
    let currentDelay = 2000;

    const playNotificationSound = () => {
      try {
        const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
        const playTone = (freq: number, start: number, duration: number) => {
          const osc = audioCtx.createOscillator();
          const gain = audioCtx.createGain();
          osc.type = "sine";
          osc.frequency.setValueAtTime(freq, start);
          gain.gain.setValueAtTime(0.15, start);
          gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
          osc.connect(gain);
          gain.connect(audioCtx.destination);
          osc.start(start);
          osc.stop(start + duration);
        };
        playTone(587.33, audioCtx.currentTime, 0.15); // D5
        playTone(880.00, audioCtx.currentTime + 0.15, 0.25); // A5
      } catch (e) {
        console.warn("Could not play notification sound:", e);
      }
    };

    const connectWS = () => {
      if (document.hidden) return;
      const wsBase = API_BASE_URL.replace(/^http/, 'ws');
      const tokenKey = portal === 'caixa' ? "koma_caixa_token" : "koma_waiter_token";
      const token = localStorage.getItem(tokenKey) || "";
      const wsUrl = `${wsBase}/ws/${activeWaiterId}?token=${token}`;
      ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        console.log("WebSocket connection established");
        setIsWsConnected(true);
        currentDelay = 2000; // Reset backoff delay on successful connection
        fetchTables();
        fetchOrdersFromAPI();
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.event === "new_delivery_order") {
            window.dispatchEvent(new Event('koma_orders_updated'));
          }
          if (data.event === "print_monitor_updated") {
            // Atualização silenciosa: o painel refaz a consulta sem toast,
            // som ou interrupção do operador.
            window.dispatchEvent(
              new Event('koma_print_monitor_refresh')
            );
          }
          if (data.event === "tables_updated") {
            if (wsUpdateTimeout) {
              clearTimeout(wsUpdateTimeout);
            }
            wsUpdateTimeout = setTimeout(() => {
              fetchOrdersFromAPI();
              fetchTables();
              fetchLiveProdutos();
              fetchLiveCategorias();
              fetchConfig();
              fetchTurnoResumo();
              if (activeRole === 'caixa' || activeRole === 'admin') {
                fetchPagamentosPendentes();
              }
              window.dispatchEvent(new Event('koma_orders_updated'));
            }, 50);
            if (data.detail && data.detail.type === "pagamento_registrado" && data.detail.status === "pendente") {
              showToast(`💵 CONFIRMAR DINHEIRO: R$ ${data.detail.valor.toFixed(2)} - Garçom ${data.detail.garcom_nome}`, 'info', 5000);
            }
          } else if (data.event === "MESA_ATUALIZADA") {
            const { mesa_id, status, comanda_id } = data.data;
            if (status === 'livre') {
              setOrders(prevOrders => prevOrders.filter(o => o.mesaId !== mesa_id));
            }
            setSalonTables(prevTables =>
              prevTables.map(t => t.id === mesa_id ? { ...t, status: status, comanda_id: comanda_id } : t)
            );
            if (status === 'livre' && portal === 'garcom' && navigator.vibrate) {
              navigator.vibrate(100);
            }
          } else if (data.event === "draft_status") {
            const { mesa_id, garcom_id, garcom_nome, ativo } = data;
            setActiveDrafts(prev => {
              const updated = { ...prev };
              if (!updated[mesa_id]) {
                updated[mesa_id] = {};
              } else {
                updated[mesa_id] = { ...updated[mesa_id] };
              }
              if (ativo) {
                updated[mesa_id][garcom_id] = {
                  garcomNome: garcom_nome,
                  timestamp: Date.now()
                };
              } else {
                delete updated[mesa_id][garcom_id];
                if (Object.keys(updated[mesa_id]).length === 0) {
                  delete updated[mesa_id];
                }
              }
              return updated;
            });
          } else if (data.event === "waiter_connected" || data.event === "waiter_disconnected") {
            const { garcom_id } = data;
            setActiveDrafts(prev => {
              const updated = { ...prev };
              let changed = false;
              Object.keys(updated).forEach(mId => {
                const mesaId = Number(mId);
                if (updated[mesaId][garcom_id]) {
                  updated[mesaId] = { ...updated[mesaId] };
                  delete updated[mesaId][garcom_id];
                  changed = true;
                  if (Object.keys(updated[mesaId]).length === 0) {
                    delete updated[mesaId];
                  }
                }
              });
              return changed ? updated : prev;
            });
          }
        } catch (err) {
          console.error("Error handling WebSocket message:", err);
        }
      };

      ws.onclose = () => {
        setIsWsConnected(false);
        wsRef.current = null;
        if (!document.hidden) {
          console.log(`WebSocket disconnected, reconnecting in ${currentDelay}ms`);
          reconnectTimeout = setTimeout(connectWS, currentDelay);
          currentDelay = Math.min(currentDelay * 1.5, 30000); // Exponential backoff max 30s
        }
      };

      ws.onerror = (err) => {
        console.error("WebSocket connection error:", err);
      };
    };

    const handleVisibilityChange = () => {
      if (!document.hidden) {
        if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
          currentDelay = 2000;
          connectWS();
        }
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    connectWS();

    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      clearTimeout(reconnectTimeout);
      clearTimeout(wsUpdateTimeout);
      if (ws) {
        ws.onopen = null;
        ws.onmessage = null;
        ws.onclose = null;
        ws.onerror = null;
        ws.close();
      }
      // Nullify the ref so reconnect timers don't operate on a closed socket
      wsRef.current = null;
    };
  }, [isAuthenticated, activeWaiterId]);

  // Sync local draft changes to WebSocket
  useEffect(() => {
    if (!isAuthenticated || !activeWaiterId || !isWsConnected || activeRole !== 'garcom') return;

    const currentStatuses: { [mesaId: number]: boolean } = {};
    for (let mId = 1; mId <= RESTAURANT_CONFIG.totalMesas; mId++) {
      const hasDraft = (drafts[mId] || []).length > 0;
      const isViewing = selectedTableId === mId;
      const isActive = hasDraft || isViewing;
      currentStatuses[mId] = isActive;

      const prev = lastDraftStatusesRef.current[mId] || false;
      if (isActive !== prev) {
        notifyDraftStatus(mId, isActive);
      }
    }
    lastDraftStatusesRef.current = currentStatuses;
  }, [drafts, selectedTableId, isAuthenticated, activeWaiterId, isWsConnected, activeRole]);

  // Reset statuses ref on disconnect to trigger fresh sync upon reconnect
  useEffect(() => {
    if (!isWsConnected) {
      lastDraftStatusesRef.current = {};
    }
  }, [isWsConnected]);

  // 6. Persistence effects
  // Synchronized via polling instead of localStorage

  useEffect(() => {
    localStorage.setItem(LOCAL_STORAGE_DRAFTS_KEY, JSON.stringify(drafts));
  }, [drafts]);

  useEffect(() => {
    localStorage.setItem(LOCAL_STORAGE_SETTINGS_KEY, JSON.stringify(settings));
  }, [settings]);

  useEffect(() => {
    localStorage.setItem(LOCAL_STORAGE_RESTAURANT_NAME_KEY, restaurantName);
  }, [restaurantName]);

  // Lock body scroll when sidebar/drawer is open
  useEffect(() => {
    if (isSidebarOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [isSidebarOpen]);

  // Physical back button / swipe back closes the active modal
  useEffect(() => {
    const handlePopState = () => {
      if (selectedTableId !== null) {
        setSelectedTableId(null);
      }
    };

    if (selectedTableId !== null) {
      window.history.pushState({ modalOpen: true }, "");
    }

    window.addEventListener("popstate", handlePopState);
    return () => {
      window.removeEventListener("popstate", handlePopState);
    };
  }, [selectedTableId]);


  // Waiter persistence managed by login state

  // Get draft items for a waiter at a specific table
  const getDraftItems = (mesaId: number) => {
    return drafts[mesaId] || [];
  };

  // 7. Core Order Actions
  const handleAddToDraft = (mesaId: number, product: Product, quantity = 1, observacao = '', clienteNome = '') => {
    setDrafts(prev => {
      const existing = prev[mesaId] || [];
      const defaultClientName = clienteNome || (existing.length > 0 ? existing[0].clienteNome : '');

      const newItem: DraftItem = {
        id: `draft-${Date.now()}-${Math.floor(Math.random() * 100000)}`,
        produtoId: product.id,
        nome: product.nome,
        preco: product.preco,
        observacao: observacao,
        clienteNome: defaultClientName,
        quantidade: quantity
      };

      return {
        ...prev,
        [mesaId]: [...existing, newItem]
      };
    });
  };

  const handleRemoveFromDraft = (mesaId: number, draftItemId: string) => {
    setDrafts(prev => {
      const existing = prev[mesaId] || [];
      return {
        ...prev,
        [mesaId]: existing.filter(item => item.id !== draftItemId)
      };
    });
  };

  const handleUpdateDraftItem = (mesaId: number, draftItemId: string, fields: Partial<DraftItem>) => {
    setDrafts(prev => {
      const existing = prev[mesaId] || [];
      return {
        ...prev,
        [mesaId]: existing.map(item => item.id === draftItemId ? { ...item, ...fields } : item)
      };
    });
  };

  // Load active orders from backend API
  const fetchOrdersFromAPI = async () => {
    if (fetchOrdersAbortControllerRef.current) {
      fetchOrdersAbortControllerRef.current.abort();
    }
    const controller = new AbortController();
    fetchOrdersAbortControllerRef.current = controller;

    try {
      const response = await fetch(`${API_BASE_URL}/comandas/detalhes/todos?fechada=false`, { 
        headers: getAuthHeaders(),
        signal: controller.signal
      });
      if (response.status === 401) {
        handleLogout();
        return;
      }
      if (!response.ok) {
        console.error("Failed to fetch comandas from backend");
        setFetchError(`Erro HTTP comandas ${response.status}: ${response.statusText}`);
        return;
      }
      const comandas = await response.json();
      const now = Date.now();

      const mappedOrders = comandas.map((comanda: any) => {
        return {
          id: comanda.id,
          mesaId: comanda.mesa_id || 0,
          garcomId: comanda.garcom_id,
          // Use name from API response (criada_por populated by SQLAlchemy relationship)
          garcomNome: comanda.criada_por?.nome || comanda.garcom?.nome || 'Garçom',
          timestamp: parseBackendDateTime(comanda.criado_em),
          tipo: comanda.tipo,
          valorPago: comanda.valor_pago || 0,
          identificador: comanda.identificador || null,
          statusComanda: comanda.status_comanda || null,       // aguardando_pagamento | null
          deliveryStatus: comanda.delivery_status || null,    // pendente | producao | pronto | transito | finalizado
          mesaOrigemId: comanda.mesa_origem_id || null,
          mesaTransferidaDe: comanda.mesa_transferida_de || null,
          itens: comanda.itens
            .filter((item: any) => item.status !== 'cancelado')
            .map((item: any) => {
              const opt = optimisticItemStatusRef.current[item.id];
              let effectiveStatus = item.status;
              if (opt && (now - opt.ts < 8000)) {
                if (opt.status === item.status) {
                  delete optimisticItemStatusRef.current[item.id];
                } else {
                  effectiveStatus = opt.status;
                }
              }
              return {
                id: item.id,
                produtoId: item.produto_id,
                // Use name from API (produto populated by SQLAlchemy relationship)
                nome: item.produto?.nome || PRODUCTS.find(p => p.id === item.produto_id)?.nome || `Item #${item.produto_id}`,
                preco: item.preco_unit,
                observacao: item.observacao || '',
                clienteNome: item.cliente_nome || 'Consumo Geral',
                status: effectiveStatus,
                lancamentoId: item.lancamento_id
              };
            })
        };
      });

      setOrders(prevOrders => {
        const tempOrders = prevOrders.filter(p =>
          String(p.id).startsWith('temp-') && !mappedOrders.some(m => m.mesaId > 0 && m.mesaId === p.mesaId)
        );
        return [...mappedOrders, ...tempOrders];
      });
      setIsOrdersLoaded(true);

    } catch (err: any) {
      if (err.name !== 'AbortError') {
        console.error("Connection error to backend:", err);
        setFetchError(`Erro de conexão comandas: ${err.message || String(err)}`);
      }
    }
  };

  useEffect(() => {
    if (!isAuthenticated) return;
    fetchOrdersFromAPI();
    fetchTables();
    if (activeRole === 'caixa' || activeRole === 'admin') {
      fetchPagamentosPendentes();
    }

    const handleVisibilityChange = () => {
      if (!document.hidden && isAuthenticated) {
        fetchOrdersFromAPI();
        fetchTables();
        if (activeRole === 'caixa' || activeRole === 'admin') {
          fetchPagamentosPendentes();
        }
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);

    if (isWsConnected) {
      return () => document.removeEventListener("visibilitychange", handleVisibilityChange);
    }

    const interval = setInterval(() => {
      if (document.hidden) return; // Skip polling when tab is in background
      fetchOrdersFromAPI();
      fetchTables();
      if (activeRole === 'caixa' || activeRole === 'admin') {
        fetchPagamentosPendentes();
      }
    }, 8000);

    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      clearInterval(interval);
    };
  }, [isAuthenticated, isWsConnected, activeRole]);

  // Supabase Realtime: sincroniza mesas em tempo real com o banco de dados
  useEffect(() => {
    if (!isAuthenticated) return;

    const channel = supabase
      .channel('realtime-mesas')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'mesas' },
        () => {
          fetchTables();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [isAuthenticated]);

  // Login handler
  const handleLoginSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoginError("");
    setIsLoggingIn(true);
    const usernameClean = loginUsername.trim().toLowerCase();
    try {
      const response = await fetch(`${API_BASE_URL}/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: usernameClean, password: loginPassword })
      });
      if (!response.ok) {
        const err = await response.json();
        setLoginError(err.detail || "Usuário ou senha incorretos.");
        setIsLoggingIn(false);
        return;
      }
      const data = await response.json();

      // Enforce portal-specific permissions
      const role = data.usuario.role;
      if (portal === 'caixa' && role !== 'caixa' && role !== 'admin') {
        setLoginError("Acesso negado. Apenas operadores de caixa ou administradores.");
        setIsLoggingIn(false);
        return;
      }
      if (portal === 'garcom' && role !== 'garcom' && role !== 'admin') {
        setLoginError("Acesso negado. Apenas garçons.");
        setIsLoggingIn(false);
        return;
      }

      const tokenKey = portal === 'caixa' ? "koma_caixa_token" : "koma_waiter_token";
      const idKey = portal === 'caixa' ? "koma_caixa_id" : "koma_waiter_id";
      const nameKey = portal === 'caixa' ? "koma_caixa_name" : "koma_waiter_name";
      const roleKey = portal === 'caixa' ? "koma_caixa_role" : "koma_user_role";

      localStorage.setItem(tokenKey, data.access_token);
      localStorage.setItem(idKey, data.usuario.id);
      localStorage.setItem(nameKey, data.usuario.nome);
      localStorage.setItem(roleKey, role);

      setActiveWaiterId(data.usuario.id);
      setActiveWaiterNome(data.usuario.nome);
      setActiveRole(role);
      setIsAuthenticated(true);
      setLoginUsername("");
      setLoginPassword("");
    } catch (err) {
      console.error(err);
      setLoginError("Erro ao conectar ao servidor do backend.");
    } finally {
      setIsLoggingIn(false);
    }
  };



  const handleSubmitDraft = async (mesaId: number, orderType: 'Consumo no Local' | 'Retirada' | 'Entrega' = 'Consumo no Local') => {
    if (isSubmittingRef.current) return; // Synchronous ref guard (faster than useState)
    const items = drafts[mesaId] || [];
    if (items.length === 0) return;

    isSubmittingRef.current = true;
    setIsSubmitting(true);

    // ─────────────────────────────────────────────────────────────────
    // 0ms OPTIMISTIC UPDATE: Limpar o carrinho e adicionar itens localmente
    // ─────────────────────────────────────────────────────────────────
    const optimisticItems: any[] = items.flatMap(item => {
      const qty = item.quantidade || 1;
      return Array.from({ length: qty }, (_, i) => ({
        id: `opt_${Date.now()}_${i}_${item.produtoId}`,
        produtoId: item.produtoId,
        nome: item.nome,
        preco: item.preco,
        observacao: item.observacao,
        clienteNome: item.clienteNome.trim() || 'Consumo Geral',
        status: 'preparando' as const,
        pago: false,
        garcomNome: activeWaiterNome,
      }));
    });

    const existingComanda = orders.find(o => o.mesaId === mesaId);
    let optimisticComandaId = existingComanda?.id;

    if (existingComanda) {
      // Adiciona itens na comanda existente
      setOrders(prev => prev.map(o =>
        o.mesaId === mesaId
          ? { ...o, itens: [...o.itens, ...optimisticItems] }
          : o
      ));
    } else {
      // Cria comanda nova otimista
      optimisticComandaId = `opt_comanda_${Date.now()}`;
      const optimisticOrder: Order = {
        id: optimisticComandaId,
        mesaId,
        garcomId: activeWaiterId,
        garcomNome: activeWaiterNome,
        timestamp: Date.now(),
        itens: optimisticItems,
        tipo: orderType,
        valorPago: 0,
      };
      setOrders(prev => [...prev, optimisticOrder]);
    }

    // Limpa carrinho e fecha modal da mesa imediatamente (0ms) para voltar ao mapa de mesas
    setDrafts(prev => {
      const copy = { ...prev };
      delete copy[mesaId];
      return copy;
    });
    setSelectedTableId(null);

    // Exibe toast imediatamente
    showToast('✅ Pedido enviado para a cozinha!', 'success');

    try {
      const activeComanda = orders.find(o => o.mesaId === mesaId);
      let comandaId = activeComanda?.id;

      if (!comandaId) {
        const openRes = await fetch(`${API_BASE_URL}/comandas/`, {
          method: "POST",
          headers: getAuthHeaders(),
          body: JSON.stringify({
            mesa_id: mesaId,
            garcom_id: activeWaiterId,
            tipo: orderType
          })
        });
        if (!openRes.ok) {
          const errData = await openRes.json();
          showToast(`Erro ao abrir comanda: ${errData.detail || openRes.statusText}`, 'error');
          setIsSubmitting(false);
          fetchOrdersFromAPI(); // Rollback
          return;
        }
        const newComanda = await openRes.json();
        comandaId = newComanda.id;
      }

      const launchRes = await fetch(`${API_BASE_URL}/comandas/${comandaId}/lancamentos`, {
        method: "POST",
        headers: getAuthHeaders(),
        body: JSON.stringify({
          garcom_id: activeWaiterId,
          itens: items.flatMap(item => {
            const expanded = [];
            const qty = item.quantidade || 1;
            for (let i = 0; i < qty; i++) {
              expanded.push({
                produto_id: item.produtoId,
                observacao: item.observacao,
                cliente_nome: item.clienteNome.trim() || 'Consumo Geral'
              });
            }
            return expanded;
          })
        })
      });
      if (!launchRes.ok) {
        const errData = await launchRes.json();
        showToast(`Erro ao lançar itens: ${errData.detail || launchRes.statusText}`, 'error');
        fetchOrdersFromAPI(); // Rollback
        setIsSubmitting(false);
        return;
      }

      const launchData = await launchRes.json();
      if (launchData.dispensado_impressao) {
        showToast('✅ Pedido registrado! (Itens sem impressão física)', 'info');
      }

      // Sync real com dados do servidor (substitui itens otimistas pelos reais com IDs corretos)
      fetchOrdersFromAPI();
    } catch (err) {
      console.error(err);
      showToast("Erro ao conectar ao servidor para enviar o pedido.", 'error');
      fetchOrdersFromAPI(); // Rollback
    } finally {
      isSubmittingRef.current = false;
      setIsSubmitting(false);
    }
  };

  // 8. Table Transfer (Transfers all active comandas of sourceTableId to targetTableId)
  const handleTransferTable = async (sourceTableId: number, targetTableId: number) => {
    const opKey = `transfer-${sourceTableId}`;
    if (inflightTableOpsRef.current.has(opKey)) return;
    inflightTableOpsRef.current.add(opKey);
    const sourceComandas = orders.filter(o => o.mesaId === sourceTableId);
    if (sourceComandas.length === 0) { inflightTableOpsRef.current.delete(opKey); return; }

    // 0ms Optimistic UI update
    handleTransferTableOptimistic(sourceTableId, targetTableId);
    setSelectedTableId(null);

    try {
      for (const comanda of sourceComandas) {
        const res = await fetch(`${API_BASE_URL}/comandas/${comanda.id}/transferir/${targetTableId}`, {
          method: "POST",
          headers: getAuthHeaders()
        });
        if (!res.ok) {
          const errData = await res.json();
          showToast(`Erro ao transferir comanda: ${errData.detail}`, 'error');
          fetchOrdersFromAPI();
          return;
        }
      }
    } catch (err) {
      console.error(err);
      showToast("Erro de conexão ao transferir mesas.", 'error');
      fetchOrdersFromAPI();
    } finally {
      inflightTableOpsRef.current.delete(opKey);
    }
  };

  // 8.5. Unify/Split (Merge and Unmerge) Tables
  const handleMergeTables = async (sourceMesaId: number, targetMesaId: number) => {
    const opKey = `merge-${sourceMesaId}-${targetMesaId}`;
    if (inflightTableOpsRef.current.has(opKey)) return;
    inflightTableOpsRef.current.add(opKey);
    // 0ms Optimistic UI update: merge itens da mesa origem na mesa destino
    handleTransferTableOptimistic(sourceMesaId, targetMesaId);
    setSelectedTableId(null);
    try {
      const res = await fetch(`${API_BASE_URL}/comandas/mesclar?mesa_origem_id=${sourceMesaId}&mesa_destino_id=${targetMesaId}`, {
        method: "POST",
        headers: getAuthHeaders()
      });
      if (res.ok) {
        showToast(`Mesa ${sourceMesaId} mesclada na Mesa ${targetMesaId} com sucesso!`);
        fetchOrdersFromAPI();
      } else {
        const errData = await res.json();
        showToast(`Erro ao mesclar mesas: ${errData.detail}`, 'error');
        fetchOrdersFromAPI();
      }
    } catch (err) {
      console.error(err);
      showToast("Erro de conexão ao mesclar mesas.", 'error');
      fetchOrdersFromAPI();
    } finally {
      inflightTableOpsRef.current.delete(opKey);
    }
  };

  const handleUnmergeTable = async (comandaId: string) => {
    try {
      const res = await fetch(`${API_BASE_URL}/comandas/desmesclar?comanda_id=${comandaId}`, {
        method: "POST",
        headers: getAuthHeaders()
      });
      if (res.ok) {
        showToast("Mesa desmembrada com sucesso!");
        setSelectedTableId(null);
        fetchOrdersFromAPI();
      } else {
        const errData = await res.json();
        showToast(`Erro ao desmembrar mesa: ${errData.detail}`, 'error');
      }
    } catch (err) {
      console.error(err);
      showToast("Erro de conexão ao desmembrar mesa.", 'error');
    }
  };

  // 9. Close Table (Settle whole balance) - Restricted to Cashier
  const handleCloseTable = async (mesaId: number) => {
    if (activeRole !== 'caixa') {
      showToast('Apenas o operador de Caixa possui autorização para encerrar contas.', 'error');
      return;
    }

    const tableComandas = orders.filter(o => o.mesaId === mesaId);
    if (tableComandas.length === 0) return;

    // 0ms: remove a mesa do estado local imediatamente
    setOrders(prev => prev.filter(o => o.mesaId !== mesaId));
    setSelectedTableId(null);
    showToast(`✅ Mesa ${mesaId} encerrada e liberada!`, 'success');

    try {
      for (const comanda of tableComandas) {
        const res = await fetch(`${API_BASE_URL}/comandas/${comanda.id}/fechar`, {
          method: "PUT",
          headers: getAuthHeaders()
        });
        if (!res.ok) {
          const errData = await res.json();
          showToast(`Erro ao fechar comanda: ${errData.detail}`, 'error');
          fetchOrdersFromAPI(); // Rollback
          return;
        }
      }
      fetchOrdersFromAPI();
    } catch (err) {
      console.error(err);
      showToast("Erro de conexão ao encerrar mesa.", 'error');
      fetchOrdersFromAPI(); // Rollback
    }
  };

  // 9.5. Clear Table Orders (Direct reset - Testing only)
  const handleClearTableOrders = async (mesaId: number) => {
    const tableComandas = orders.filter(o => o.mesaId === mesaId);
    try {
      for (const comanda of tableComandas) {
        await fetch(`${API_BASE_URL}/comandas/${comanda.id}/fechar`, {
          method: "PUT",
          headers: getAuthHeaders()
        });
      }
      setSelectedTableId(null);
      fetchOrdersFromAPI();
    } catch (err) {
      console.error(err);
    }
  };

  // 10. Settle single customer consumption (Partial payment) - Restricted to Cashier
  const handleSettleCustomer = async (mesaId: number, customerName: string) => {
    if (activeRole !== 'caixa') {
      showToast('Apenas o Caixa pode liquidar o consumo de um cliente específico.', 'error');
      return;
    }

    try {
      const response = await fetch(`${API_BASE_URL}/comandas/?mesa_id=${mesaId}&fechada=false`, {
        headers: getAuthHeaders()
      });
      if (!response.ok) return;
      const comandas = await response.json();

      const targetComanda = comandas.find((c: any) => {
        const normIdent = c.identificador || "Consumo Geral";
        return normIdent === customerName;
      });

      if (!targetComanda) {
        showToast("Comanda do cliente não encontrada para liquidar.", 'error');
        return;
      }

      const res = await fetch(`${API_BASE_URL}/comandas/${targetComanda.id}/fechar`, {
        method: "PUT",
        headers: getAuthHeaders()
      });
      if (!res.ok) {
        const errData = await res.json();
        showToast(`Erro ao liquidar comanda do cliente: ${errData.detail}`, 'error');
        return;
      }
      showToast(`✅ Consumo de "${customerName}" liquidado!`, 'success');
      fetchOrdersFromAPI();
    } catch (err) {
      console.error(err);
      showToast("Erro de conexão ao liquidar cliente.", 'error');
    }
  };

  // Optimistic Item Status Update (Instant 0ms UI response)
  const handleOptimisticUpdateItemStatus = (itemId: string | string[], newStatus: 'preparando' | 'pronto' | 'entregue') => {
    const itemIds = Array.isArray(itemId) ? itemId : [itemId];
    const now = Date.now();
    itemIds.forEach(id => {
      optimisticItemStatusRef.current[id] = { status: newStatus, ts: now };
    });
    setOrders(prevOrders =>
      prevOrders.map(order => ({
        ...order,
        itens: order.itens.map(item =>
          itemIds.includes(item.id) ? { ...item, status: newStatus } : item
        )
      }))
    );
  };

  // Optimistic Add Order (Instant 0ms UI response for PDV)
  const handleOptimisticAddOrder = (newOrder: Order) => {
    setOrders(prev => [newOrder, ...prev]);
  };


  // Optimistic Payment Removal (Instant 0ms UI response)
  const handleRemovePendingPaymentOptimistic = (pagamentoId: string) => {
    setPagamentosPendentes(prev => prev.filter(p => p.id !== pagamentoId));
  };

  // Optimistic Table Transfer (Instant 0ms UI response)
  const handleTransferTableOptimistic = (sourceTableId: number, targetTableId: number) => {
    setOrders(prev =>
      prev.map(o => o.mesaId === sourceTableId ? { ...o, mesaId: targetTableId } : o)
    );
  };

  // 11. Delivery (Waiter serves a ready dish)
  const handleDeliverItem = async (orderId: string, itemId: string) => {
    if (inflightItemIdsRef.current.has(itemId)) return; // Ignore rapid duplicate clicks
    inflightItemIdsRef.current.add(itemId);
    handleOptimisticUpdateItemStatus(itemId, 'entregue');
    try {
      const res = await fetch(`${API_BASE_URL}/comandas/itens/${itemId}/status?status=entregue`, {
        method: "PUT",
        headers: getAuthHeaders()
      });
      if (!res.ok) {
        showToast("Erro ao entregar item no backend.", 'error');
        fetchOrdersFromAPI();
      }
    } catch (err) {
      console.error(err);
      showToast("Erro de conexão ao marcar item como entregue.", 'error');
      fetchOrdersFromAPI();
    } finally {
      inflightItemIdsRef.current.delete(itemId);
    }
  };

  const handlePrintReceipt = async (mesaId: number, apenasValores: boolean = false) => {
    const url = `${API_BASE_URL}/mesas/${mesaId}/imprimir-recibo?apenas_valores=${apenasValores}`;
    const response = await fetch(url, {
      method: 'POST',
      headers: getAuthHeaders()
    });
    if (!response.ok) {
      const err = await response.json();
      throw new Error(err.detail || "Erro ao imprimir recibo");
    }
  };

  const handlePrintKitchenLaunch = async (lancamentoId: string) => {
    const response = await fetch(`${API_BASE_URL}/comandas/lancamentos/${lancamentoId}/reimprimir`, {
      method: 'POST',
      headers: getAuthHeaders()
    });
    if (!response.ok) {
      const err = await response.json();
      throw new Error(err.detail || "Erro ao reimprimir lote");
    }
  };

  // 12. Kitchen - Chef completes cooking a plate
  const handleFinishPreparation = async (orderId: string, itemId: string) => {
    if (inflightItemIdsRef.current.has(itemId)) return; // Ignore rapid duplicate clicks
    inflightItemIdsRef.current.add(itemId);
    handleOptimisticUpdateItemStatus(itemId, 'pronto');
    try {
      const res = await fetch(`${API_BASE_URL}/comandas/itens/${itemId}/status?status=pronto`, {
        method: "PUT",
        headers: getAuthHeaders()
      });
      if (!res.ok) {
        showToast("Erro ao finalizar preparação no backend.", 'error');
        fetchOrdersFromAPI();
      }
    } catch (err) {
      console.error(err);
      showToast("Erro de conexão ao finalizar preparação.", 'error');
      fetchOrdersFromAPI();
    } finally {
      inflightItemIdsRef.current.delete(itemId);
    }
  };

  // 13. Transfer single item to a different table
  const handleTransferItem = async (itemId: string, targetTableId: number) => {
    // 0ms: remove item da mesa origem imediatamente
    setOrders(prev => prev.map(o => ({ ...o, itens: o.itens.filter(it => it.id !== itemId) })));
    showToast(`✅ Item transferido para a Mesa ${targetTableId}!`, 'success');

    try {
      const res = await fetch(`${API_BASE_URL}/comandas/itens/${itemId}/transferir/${targetTableId}`, {
        method: "POST",
        headers: getAuthHeaders()
      });
      if (!res.ok) {
        const errData = await res.json();
        showToast(`Erro ao transferir item: ${errData.detail}`, 'error');
        fetchOrdersFromAPI(); // Rollback
        return;
      }
      fetchOrdersFromAPI();
    } catch (err) {
      console.error(err);
      showToast("Erro de conexão ao transferir item.", 'error');
      fetchOrdersFromAPI(); // Rollback
    }
  };

  const handleTransferItems = async (itemIds: string[], targetTableId: number) => {
    // 0ms: remove itens da mesa origem imediatamente
    const idSet = new Set(itemIds);
    setOrders(prev => prev.map(o => ({ ...o, itens: o.itens.filter(it => !idSet.has(it.id)) })));
    showToast(`✅ ${itemIds.length} item(ns) transferido(s) para a Mesa ${targetTableId}!`, 'success');

    try {
      let failMessage = "";
      for (const itemId of itemIds) {
        const res = await fetch(`${API_BASE_URL}/comandas/itens/${itemId}/transferir/${targetTableId}`, {
          method: "POST",
          headers: getAuthHeaders()
        });
        if (!res.ok) {
          const errData = await res.json();
          failMessage = errData.detail || "Erro desconhecido";
        }
      }
      if (failMessage) {
        showToast(`Falha ao transferir alguns itens: ${failMessage}`, 'error');
      }
      fetchOrdersFromAPI();
    } catch (err) {
      console.error(err);
      showToast("Erro de conexão ao transferir itens.", 'error');
      fetchOrdersFromAPI(); // Rollback
    }
  };

  // 14. Cancel single item
  const handleCancelItem = async (itemId: string) => {
    // 0ms: remove item do estado local imediatamente
    setOrders(prev => prev.map(o => ({ ...o, itens: o.itens.filter(it => it.id !== itemId) })));
    showToast('✅ Item cancelado!', 'success');

    try {
      const res = await fetch(`${API_BASE_URL}/comandas/itens/${itemId}/cancelar`, {
        method: "PUT",
        headers: getAuthHeaders()
      });
      if (!res.ok) {
        const errData = await res.json();
        showToast(`Erro ao cancelar item: ${errData.detail}`, 'error');
        fetchOrdersFromAPI(); // Rollback
        return;
      }
      fetchOrdersFromAPI();
    } catch (err) {
      console.error(err);
      showToast("Erro de conexão ao cancelar item.", 'error');
      fetchOrdersFromAPI(); // Rollback
    }
  };

  const handleUpdateItemDetails = async (itemId: string, observacao: string, clienteNome: string, quantidadeAdicional?: number) => {
    // 0ms: atualiza observação e nome do cliente localmente
    setOrders(prev => prev.map(o => ({
      ...o,
      itens: o.itens.map(it =>
        it.id === itemId ? { ...it, observacao, clienteNome } : it
      )
    })));
    showToast('✅ Item atualizado!', 'success');

    try {
      const res = await fetch(`${API_BASE_URL}/comandas/itens/${itemId}`, {
        method: "PUT",
        headers: {
          ...getAuthHeaders(),
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          observacao,
          cliente_nome: clienteNome,
          quantidade_adicional: quantidadeAdicional || undefined
        })
      });
      if (!res.ok) {
        const errData = await res.json();
        showToast(`Erro ao editar item: ${errData.detail}`, 'error');
        fetchOrdersFromAPI(); // Rollback
        return;
      }
      fetchOrdersFromAPI();
    } catch (err) {
      console.error(err);
      showToast("Erro de conexão ao atualizar item.", 'error');
      fetchOrdersFromAPI(); // Rollback
    }
  };

  // Count active tables by state
  const tableCounts = React.useMemo(() => {
    let libre = 0;
    let ocupada = 0;
    let pronto = 0;

    (salonTables || []).forEach(table => {
      const tableOrders = (orders || []).filter(o => o.mesaId === table.id);
      if (tableOrders.length === 0) {
        libre++;
      } else {
        const hasPronto = tableOrders.some(o => {
          const arr = Array.isArray(o?.itens) ? o.itens : Array.isArray(o?.items) ? o.items : [];
          return arr.some((i: any) => i?.status === 'pronto');
        });
        if (hasPronto) {
          pronto++;
        } else {
          ocupada++;
        }
      }
    });

    return { libre, ocupada, pronto };
  }, [orders, salonTables]);

  const filteredTables = React.useMemo(() => {
    return (salonTables || []).filter(table => {
      const tableOrders = (orders || []).filter(o => o.mesaId === table.id);
      const hasPronto = tableOrders.some(o => {
        const arr = Array.isArray(o?.itens) ? o.itens : Array.isArray(o?.items) ? o.items : [];
        return arr.some((i: any) => i?.status === 'pronto');
      });
      const status = tableOrders.length === 0
        ? 'livre'
        : hasPronto
          ? 'pronto'
          : 'ocupada';

      if (tableFilter === 'todos') return true;
      if (tableFilter === 'livres') return status === 'livre';
      if (tableFilter === 'ocupadas') return status === 'ocupada';
      if (tableFilter === 'prontas') return status === 'pronto';
      return true;
    });
  }, [salonTables, orders, tableFilter]);

  const selectedTable = salonTables.find(t => t.id === selectedTableId);
  const selectedTableOrders = selectedTable ? orders.filter(o => o.mesaId === selectedTable.id) : [];



  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-[#0B0F19] flex items-center justify-center p-4">
        <div className="w-full max-w-sm bg-[#111726] border border-emerald-500/10 rounded-2xl p-6 sm:p-8 shadow-2xl animate-scale-in">
          {/* Logo / Header */}
          <div className="text-center space-y-3 mb-7">
            <div className="flex justify-center">
              <div className="h-20 px-4 bg-[#2f3d4a] rounded-2xl flex items-center justify-center border border-[#2f3d4a] shadow-md shrink-0">
                <img src="/logo.png" alt="Kôma Logo" className="h-14 object-contain" />
              </div>
            </div>
            <p className="text-[10px] text-emerald-400 uppercase tracking-widest font-sans font-bold bg-emerald-500/10 px-3 py-1 rounded-full w-fit mx-auto border border-emerald-500/15">
              {portal === 'caixa' ? "Painel de Gerenciamento & Caixa" : "Portal do Garçom"}
            </p>
          </div>

          {/* Form */}
          <form onSubmit={handleLoginSubmit} className="space-y-4">
            {loginError && (
              <div className="p-3 bg-red-950/40 border border-red-900/50 rounded-xl text-xs text-red-300 text-center animate-shake">
                {loginError}
              </div>
            )}

            <div className="space-y-1.5">
              <label htmlFor="login-username" className="text-[10px] text-gray-400 font-bold uppercase tracking-wider block">E-MAIL</label>
              <input
                id="login-username"
                type="email"
                name="email"
                autoComplete="username"
                inputMode="email"
                required
                value={loginUsername}
                onChange={(e) => setLoginUsername(e.target.value)}
                placeholder="seu@email.com"
                className="w-full bg-[#090D16] text-white border border-[#27272A]/40 rounded-xl px-4 py-3 text-sm font-semibold focus:outline-none focus:ring-1 focus:ring-emerald-500 focus:border-emerald-500/50 placeholder-gray-600"
              />
            </div>

            <div className="space-y-1.5">
              <label htmlFor="login-password" className="text-[10px] text-gray-400 font-bold uppercase tracking-wider block">Senha</label>
              <input
                id="login-password"
                type="password"
                name="password"
                autoComplete="current-password"
                required
                value={loginPassword}
                onChange={(e) => setLoginPassword(e.target.value)}
                placeholder="••••••"
                className="w-full bg-[#090D16] text-white border border-[#27272A]/40 rounded-xl px-4 py-3 text-sm font-semibold focus:outline-none focus:ring-1 focus:ring-emerald-500 focus:border-emerald-500/50 placeholder-gray-600"
              />
            </div>

            <button
              type="submit"
              disabled={isLoggingIn}
              className="w-full py-3.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-sm font-bold uppercase tracking-wider shadow-lg cursor-pointer disabled:opacity-50 flex items-center justify-center gap-2 border border-emerald-500/20"
            >
              {isLoggingIn ? "Autenticando..." : "Entrar"}
            </button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className={`min-h-screen bg-[#09090B] text-white flex flex-col font-sans ${fontSize === 'grande' ? 'font-large' : fontSize === 'gigante' ? 'font-huge' : ''}`}>
      {/* GLOBAL TOP HEADER */}
      <header className="bg-[#121214] border-b border-[#27272A]/50 text-white shrink-0 sticky top-0 z-30">
        <div className="max-w-7xl mx-auto px-3 sm:px-6 lg:px-8 py-3">
          <div className="flex justify-between items-center">

            {/* Left: Settings Button + Logo + Title */}
            <div className="flex items-center gap-2 sm:gap-3">
              <button
                id="open-sidebar-btn"
                onClick={() => setIsSidebarOpen(true)}
                className="p-2 bg-[#1C1C1F] text-emerald-400 hover:bg-[#27272A] hover:text-white rounded-xl cursor-pointer border border-[#27272A] flex items-center justify-center transition-colors"
                title="Operação & Configurações do Caixa"
              >
                <SlidersHorizontal size={18} />
              </button>

              <div className="flex items-center gap-2">
                <div className="h-9 px-2 bg-[#2f3d4a] rounded-xl flex items-center justify-center border border-[#2f3d4a] shrink-0">
                  <img src="/logo.png" alt="Kôma Logo" className="h-6 object-contain" />
                </div>
                <div>
                  <h1 className="font-serif text-base sm:text-lg font-bold tracking-tight text-white leading-tight">
                    {restaurantName}
                  </h1>
                  <p className="text-[9px] text-[#A1A1AA] font-sans leading-none mt-0.5">
                    {activeWaiter.nome}
                  </p>
                </div>
              </div>
            </div>

            {/* Right: Status Badges */}
            <div className="flex items-center gap-2">
              <div className={clsx('flex', 'items-center', 'gap-1.5', 'px-2.5', 'py-1', 'rounded-full', 'text-[10px]', 'font-semibold', isWsConnected ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' : 'bg-amber-500/10 text-amber-400 border border-amber-500/20')}>
                {isWsConnected ? <Wifi size={12} /> : <WifiOff size={12} />}
                <span className="hidden sm:inline">{isWsConnected ? 'Conectado' : 'Reconectando...'}</span>
              </div>
            </div>

          </div>
        </div>
      </header>

      {/* LATERAL DRAWER MENU */}
      {isSidebarOpen && (
        <div className="fixed inset-0 z-50 flex animate-fade-in">
          <div
            id="sidebar-backdrop"
            onClick={() => setIsSidebarOpen(false)}
            className="fixed inset-0 bg-black/80"
          />

          {/* Drawer content */}
          <div className="relative w-72 sm:w-80 max-w-sm bg-[#0E0E10] border-r border-emerald-500/10 h-full flex flex-col justify-between shadow-2xl z-10 p-4 sm:p-6 text-[#FAF7F2] overflow-y-auto animate-slide-in-left">
            <div className="space-y-6">

              {/* Header inside drawer */}
              <div className={clsx('flex', 'items-center', 'justify-between', 'pb-4', 'border-b', 'border-[#27272A]')}>
                <div className={clsx('flex', 'items-center', 'gap-2')}>
                  <div className={clsx('h-8', 'px-1.5', 'bg-[#2f3d4a]', 'rounded-lg', 'flex', 'items-center', 'justify-center', 'border', 'border-[#2f3d4a]', 'shadow-sm', 'shrink-0')}>
                    <img src="/logo.png" alt="Kôma Logo" className={clsx('h-5', 'object-contain')} />
                  </div>
                  <span className={clsx('font-serif', 'font-bold', 'text-base', 'text-[#FAF7F2]')}>{restaurantName}</span>
                </div>
                <button
                  id="close-sidebar-btn"
                  onClick={() => setIsSidebarOpen(false)}
                  className={clsx('p-1.5', 'rounded-lg', 'hover:bg-[#1C1C1F]', 'text-[#A1A1AA]', 'hover:text-white', 'transition-colors', 'cursor-pointer')}
                >
                  <X size={18} />
                </button>
              </div>

              {/* Calculate real-time metrics for drawer dashboards */}
              {(() => {
                const mesasOcupadasCount = salonTables.filter((t: any) => t.status === 'ocupada' || t.status === 'occupied').length;
                const mesasLivresCount = salonTables.filter((t: any) => t.status === 'livre' || t.status === 'free' || !t.status).length;
                const pratosProntosCount = orders.reduce((acc, o: any) => {
                  const prontos = (o.items || []).filter((i: any) => i.status === 'pronto' || i.status === 'READY');
                  return acc + prontos.length;
                }, 0);

                const deliveryPendentesCount = orders.filter((o: any) =>
                  (o.tipo === 'DELIVERY' || o.tipo === 'BALCAO') &&
                  (o.status === 'NOVO' || o.status === 'PENDENTE' || o.status === 'AGUARDANDO_ACEITE')
                ).length;

                const totalVendasTurno = orders.reduce((acc: number, o: any) => {
                  return acc + (parseFloat(o.total) || parseFloat(o.valor_total) || 0);
                }, 0);

                const totalComandasAbertas = orders.filter((o: any) => o.status === 'ABERTA' || o.status === 'EM_ANDAMENTO' || o.status === 'OPEN').length;

                return portal === 'garcom' ? (
                  <>
                    {/* GARÇOM - MINHA CONTA & DISPONIBILIDADE */}
                    <div className="space-y-2.5">
                      <h3 className="text-[10px] uppercase tracking-wider font-bold text-emerald-400 font-sans">Garçom em Atendimento</h3>
                      <div className="bg-[#1C1C1F] border border-[#27272A] rounded-2xl p-3.5 space-y-3">
                        <div className="flex items-center gap-3">
                          <div className="h-10 w-10 bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 rounded-full flex items-center justify-center font-bold">
                            {activeWaiter.nome ? activeWaiter.nome[0] : 'G'}
                          </div>
                          <div>
                            <h4 className="text-sm font-bold text-white">{activeWaiter.nome || 'Garçom'}</h4>
                            <p className="text-[10px] text-gray-400 font-sans">Atendimento • Salão Principal</p>
                          </div>
                        </div>

                        {/* Disponibilidade Toggle */}
                        <button
                          type="button"
                          onClick={() => setWaiterAvailable(!waiterAvailable)}
                          className={clsx(
                            'w-full py-2 px-3 rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center justify-between border',
                            waiterAvailable
                              ? 'bg-emerald-950/30 border-emerald-800/40 text-emerald-400'
                              : 'bg-amber-950/30 border-amber-800/40 text-amber-400'
                          )}
                        >
                          <div className="flex items-center gap-2">
                            {waiterAvailable ? <UserCheck size={14} /> : <UserX size={14} />}
                            <span>{waiterAvailable ? 'Disponível no Salão' : 'Ocupado / Em Atendimento'}</span>
                          </div>
                          <span className={clsx('w-2 h-2 rounded-full animate-pulse', waiterAvailable ? 'bg-emerald-400' : 'bg-amber-400')} />
                        </button>

                        <button
                          onClick={handleLogout}
                          className="w-full py-2 bg-red-950/15 hover:bg-red-950/30 text-rose-400 hover:text-rose-300 border border-red-900/40 rounded-xl text-xs font-bold uppercase tracking-wider transition-all cursor-pointer flex items-center justify-center gap-1.5"
                        >
                          Logout / Sair
                        </button>
                      </div>
                    </div>

                    {/* GARÇOM - RESUMO DO SALÃO EM TEMPO REAL */}
                    <div className="space-y-2.5">
                      <h3 className="text-[10px] uppercase tracking-wider font-bold text-emerald-400 font-sans">Status do Salão ao Vivo</h3>
                      <div className="bg-[#1C1C1F] border border-[#27272A] rounded-2xl p-3 space-y-2">
                        <div className="flex items-center justify-between p-2.5 bg-[#121214] border border-[#27272A] rounded-xl text-xs">
                          <div className="flex items-center gap-2">
                            <Utensils size={14} className="text-emerald-400" />
                            <span className="text-gray-300 font-medium">Mesas Salão</span>
                          </div>
                          <span className="font-mono font-bold text-white">
                            <strong className="text-emerald-400">{mesasOcupadasCount}</strong> ocupadas / {mesasLivresCount} livres
                          </span>
                        </div>

                        <div className="flex items-center justify-between p-2.5 bg-[#121214] border border-[#27272A] rounded-xl text-xs">
                          <div className="flex items-center gap-2">
                            <CheckCircle2 size={14} className={pratosProntosCount > 0 ? "text-amber-400 animate-bounce" : "text-gray-500"} />
                            <span className="text-gray-300 font-medium">Pratos Prontos</span>
                          </div>
                          <span className={clsx('font-mono font-bold px-2 py-0.5 rounded-md text-[10px]', pratosProntosCount > 0 ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30' : 'text-gray-400 bg-zinc-800')}>
                            {pratosProntosCount} p/ servir
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* GARÇOM - ATALHOS DE ATENDIMENTO */}
                    <div className="space-y-2.5">
                      <h3 className="text-[10px] uppercase tracking-wider font-bold text-emerald-400 font-sans">Atalhos de Atendimento</h3>
                      <div className="bg-[#1C1C1F] border border-[#27272A] rounded-2xl p-3 space-y-2">
                        <button
                          type="button"
                          onClick={() => {
                            setIsSidebarOpen(false);
                            fetchOrdersFromAPI();
                            fetchTables();
                          }}
                          className="w-full flex items-center justify-between p-2.5 bg-[#121214] hover:bg-[#27272A] border border-[#27272A] rounded-xl text-xs text-white transition-all cursor-pointer group"
                        >
                          <div className="flex items-center gap-2.5">
                            <div className="p-1.5 rounded-lg bg-blue-500/10 text-blue-400 group-hover:bg-blue-500/20">
                              <RefreshCw size={14} />
                            </div>
                            <span className="font-semibold text-xs">Sincronizar Salão</span>
                          </div>
                          <span className="text-[9px] text-blue-400 font-mono font-bold">Ao Vivo</span>
                        </button>
                      </div>
                    </div>
                  </>
                ) : (
                  <>
                    {/* CAIXA - OPERADOR & TURNO */}
                    <div className="space-y-2.5">
                      <h3 className="text-[10px] uppercase tracking-wider font-bold text-emerald-400 font-sans">Operador do Caixa</h3>
                      <div className="bg-[#1C1C1F] border border-[#27272A] rounded-2xl p-3.5 space-y-3">
                        <div className="flex items-center gap-3">
                          <div className="h-10 w-10 bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 rounded-full flex items-center justify-center font-bold">
                            {activeWaiter.nome ? activeWaiter.nome[0] : 'C'}
                          </div>
                          <div>
                            <h4 className="text-sm font-bold text-white">{activeWaiter.nome || 'Caixa'}</h4>
                            <div className="flex items-center gap-1.5 mt-0.5">
                              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
                              <span className="text-[10px] text-emerald-400 font-semibold">Caixa Operacional Ativo</span>
                            </div>
                          </div>
                        </div>

                        <button
                          onClick={handleLogout}
                          className="w-full py-2.5 bg-red-950/10 hover:bg-red-950/20 text-rose-400 hover:text-rose-300 border border-red-900/35 hover:border-red-900/50 rounded-xl text-xs font-bold uppercase tracking-wider transition-all cursor-pointer flex items-center justify-center gap-2"
                        >
                          Logout / Sair
                        </button>
                      </div>
                    </div>

                    {/* CAIXA - AGENTE DE IMPRESSÃO & MONITOR (PRIORIDADE #1) */}
                    <div className="space-y-2.5">
                      <h3 className="text-[10px] uppercase tracking-wider font-bold text-emerald-400 font-sans">Sistema de Impressão</h3>
                      <button
                        type="button"
                        onClick={() => {
                          setIsSidebarOpen(false);
                          window.dispatchEvent(new CustomEvent('koma-open-impressoras'));
                        }}
                        className="w-full flex items-center justify-between p-3 bg-[#1C1C1F] hover:bg-[#27272A] border border-[#27272A] rounded-2xl transition-all cursor-pointer group text-left"
                      >
                        <div className="flex items-center gap-2.5">
                          <div className="p-2 rounded-xl bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 group-hover:bg-emerald-500/20">
                            <Printer size={16} />
                          </div>
                          <div>
                            <h4 className="text-xs font-bold text-white">Agente de Impressão</h4>
                            <p className="text-[9px] text-emerald-400 font-medium">Servidor Online • Pronto</p>
                          </div>
                        </div>
                        <span className="text-[9px] text-gray-400 font-mono font-bold bg-[#121214] px-2 py-1 rounded-lg border border-[#27272A]">0 Falhas</span>
                      </button>
                    </div>

                    {/* CAIXA - RESUMO DO TURNO EM TEMPO REAL (PRIORIDADE #2 - SINCRONIZADO COM BANCO DE DADOS) */}
                    <div className="space-y-2.5">
                      <h3 className="text-[10px] uppercase tracking-wider font-bold text-emerald-400 font-sans">Resumo do Turno ao Vivo</h3>
                      <div className="bg-[#1C1C1F] border border-[#27272A] rounded-2xl p-3 space-y-2">
                        <div className="flex items-center justify-between p-2 bg-[#121214] border border-[#27272A] rounded-xl text-xs">
                          <div className="flex items-center gap-2">
                            <TrendingUp size={13} className="text-emerald-400" />
                            <span className="text-gray-300 font-medium text-[11px]">Vendas do Turno</span>
                          </div>
                          <span className="font-mono font-bold text-emerald-400">
                            R$ {(turnoResumo?.total_vendas ?? totalVendasTurno).toFixed(2)}
                          </span>
                        </div>

                        <div className="flex items-center justify-between p-2 bg-[#121214] border border-[#27272A] rounded-xl text-xs">
                          <div className="flex items-center gap-2">
                            <Utensils size={13} className="text-blue-400" />
                            <span className="text-gray-300 font-medium text-[11px]">Comandas Abertas</span>
                          </div>
                          <span className="font-mono font-bold text-white">
                            {turnoResumo?.comandas_abertas_count ?? totalComandasAbertas} ativas
                          </span>
                        </div>

                        {deliveryPendentesCount > 0 && (
                          <div className="flex items-center justify-between p-2 bg-amber-950/20 border border-amber-800/30 rounded-xl text-xs">
                            <div className="flex items-center gap-2">
                              <ShoppingBag size={13} className="text-amber-400 animate-pulse" />
                              <span className="text-amber-300 font-medium text-[11px]">Delivery Pendente</span>
                            </div>
                            <span className="font-mono font-bold text-amber-300 bg-amber-500/20 px-2 py-0.5 rounded text-[10px]">
                              {deliveryPendentesCount} p/ aceitar
                            </span>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* CAIXA - ATALHOS RÁPIDOS DE TESOURARIA */}
                    <div className="space-y-2.5">
                      <h3 className="text-[10px] uppercase tracking-wider font-bold text-emerald-400 font-sans">Operações de Tesouraria</h3>
                      <div className="bg-[#1C1C1F] border border-[#27272A] rounded-2xl p-3 space-y-2">
                        <button
                          type="button"
                          onClick={() => {
                            setIsSidebarOpen(false);
                            window.dispatchEvent(new CustomEvent('koma-open-suprimento'));
                          }}
                          className="w-full flex items-center justify-between p-2.5 bg-[#121214] hover:bg-[#27272A] border border-[#27272A] rounded-xl text-xs text-white transition-all cursor-pointer group"
                        >
                          <div className="flex items-center gap-2.5">
                            <div className="p-1.5 rounded-lg bg-emerald-500/10 text-emerald-400 group-hover:bg-emerald-500/20">
                              <ArrowDownRight size={14} />
                            </div>
                            <span className="font-semibold text-xs">Suprimento de Caixa</span>
                          </div>
                          <span className="text-[9px] text-emerald-400 font-mono font-bold">+ Troco</span>
                        </button>

                        <button
                          type="button"
                          onClick={() => {
                            setIsSidebarOpen(false);
                            window.dispatchEvent(new CustomEvent('koma-open-sangria'));
                          }}
                          className="w-full flex items-center justify-between p-2.5 bg-[#121214] hover:bg-[#27272A] border border-[#27272A] rounded-xl text-xs text-white transition-all cursor-pointer group"
                        >
                          <div className="flex items-center gap-2.5">
                            <div className="p-1.5 rounded-lg bg-rose-500/10 text-rose-400 group-hover:bg-rose-500/20">
                              <ArrowUpRight size={14} />
                            </div>
                            <span className="font-semibold text-xs">Sangria de Segurança</span>
                          </div>
                          <span className="text-[9px] text-rose-400 font-mono font-bold">- Retirada</span>
                        </button>

                        <button
                          type="button"
                          onClick={() => {
                            setIsSidebarOpen(false);
                            window.dispatchEvent(new CustomEvent('koma-sync-all'));
                          }}
                          className="w-full flex items-center justify-between p-2.5 bg-[#121214] hover:bg-[#27272A] border border-[#27272A] rounded-xl text-xs text-white transition-all cursor-pointer group"
                        >
                          <div className="flex items-center gap-2.5">
                            <div className="p-1.5 rounded-lg bg-blue-500/10 text-blue-400 group-hover:bg-blue-500/20">
                              <RefreshCw size={14} />
                            </div>
                            <span className="font-semibold text-xs">Sincronizar Dados</span>
                          </div>
                          <span className="text-[9px] text-blue-400 font-mono font-bold">Atualizar</span>
                        </button>
                      </div>
                    </div>
                  </>
                );
              })()}

              {/* SECTION 3: EXIBIÇÃO & PREFERÊNCIAS */}
              <div className="space-y-2.5">
                <h3 className={clsx('text-[10px]', 'uppercase', 'tracking-wider', 'font-bold', 'text-emerald-400', 'font-sans')}>Exibição e Preferências</h3>
                <div className={clsx('bg-[#1C1C1F]', 'border', 'border-[#27272A]', 'rounded-2xl', 'p-3.5', 'space-y-2.5')}>
                  <label className={clsx('flex', 'items-center', 'justify-between', 'text-xs', 'text-[#FAF7F2]', 'cursor-pointer', 'p-1', 'rounded', 'hover:bg-[#27272A]/40')}>
                    <span>Exibir Imagens dos Pratos</span>
                    <input
                      id="sidebar-toggle-images"
                      type="checkbox"
                      checked={settings.exibirImagens}
                      onChange={(e) => setSettings({ ...settings, exibirImagens: e.target.checked })}
                      className={clsx('rounded', 'border-[#27272A]', 'text-emerald-500', 'focus:ring-emerald-500', 'h-4', 'w-4', 'bg-[#121214]')}
                    />
                  </label>

                  <label className={clsx('flex', 'items-center', 'justify-between', 'text-xs', 'text-[#FAF7F2]', 'cursor-pointer', 'p-1', 'rounded', 'hover:bg-[#27272A]/40')}>
                    <span>Exibir Descrição dos Pratos</span>
                    <input
                      id="sidebar-toggle-descriptions"
                      type="checkbox"
                      checked={settings.exibirDescricoes}
                      onChange={(e) => setSettings({ ...settings, exibirDescricoes: e.target.checked })}
                      className={clsx('rounded', 'border-[#27272A]', 'text-emerald-500', 'focus:ring-emerald-500', 'h-4', 'w-4', 'bg-[#121214]')}
                    />
                  </label>
                </div>
              </div>

            </div>

            <div className={clsx('pt-4', 'border-t', 'border-[#27272A]', 'text-center', 'text-[10px]', 'text-[#71717A]', 'font-sans')}>
              <p>{restaurantName}</p>
              <p className={clsx('mt-0.5', 'font-mono')}>v3.5 • Dark Engine</p>
            </div>
          </div>
        </div>
      )}

      {/* MAIN CONTAINER */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-3 sm:px-6 lg:px-8 py-4 sm:py-8 space-y-4 sm:space-y-7">
        {activeRole === 'cozinha' ? (
          <KitchenPanel
            orders={orders}
            onFinishPreparation={() => {}}
            currentTime={currentTime}
          />
        ) : activeRole === 'caixa' ? (
          <MemoizedCaixaPanel
            orders={orders}
            onRefreshOrders={fetchOrdersFromAPI}
            apiBaseUrl={API_BASE_URL}
            authHeaders={getAuthHeaders()}
            activeWaiterNome={activeWaiterNome}
            salonTables={salonTables}
            onCreateMesa={handleCreateMesa}
            onUpdateMesa={handleUpdateMesa}
            onDeleteMesa={handleDeleteMesa}
            pagamentosPendentes={pagamentosPendentes}
            onRefreshPagamentosPendentes={fetchPagamentosPendentes}
            isWsConnected={isWsConnected}
            liveProdutos={liveProdutos}
            liveCategorias={liveCategorias}
            onRefreshCategorias={fetchLiveCategorias}
            restauranteConfig={restauranteConfig}
            fetchError={fetchError}
            onOptimisticUpdateItemStatus={handleOptimisticUpdateItemStatus}
            onOptimisticAddOrder={handleOptimisticAddOrder}
            onRemovePendingPaymentOptimistic={handleRemovePendingPaymentOptimistic}
          />
        ) : (
          /* VIEW 2: SALÃO (WAITERS OR CASHIER DASHBOARD) */
          <div className="space-y-6">

            {/* Table layout grid */}
            <div className="space-y-3">
              {/* Title + Filters Row */}
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 pb-3 border-b border-[#27272A]">
                <h3 className="font-serif text-xl sm:text-2xl font-bold tracking-tight text-white shrink-0">Mesas</h3>

                {/* Filters */}
                <div
                  role="group"
                  aria-label="Filtrar mesas por status"
                  className="grid grid-cols-2 gap-2 sm:flex sm:items-center sm:gap-1.5 w-full sm:w-auto"
                >
                  {(['todos', 'livres', 'ocupadas', 'prontas'] as const).map((filter) => {
                    const label = {
                      todos: 'Todas',
                      livres: 'Livres',
                      ocupadas: 'Ocupadas',
                      prontas: 'Prontas'
                    }[filter];

                    return (
                      <button
                        key={filter}
                        type="button"
                        onClick={() => setTableFilter(filter)}
                        aria-pressed={tableFilter === filter}
                        className={`w-full sm:w-auto min-h-11 sm:min-h-0 flex items-center justify-center px-3 py-2 text-xs font-semibold rounded-lg cursor-pointer whitespace-nowrap border ${tableFilter === filter
                          ? 'bg-rose-900/40 border-rose-800/50 text-white'
                          : 'bg-[#1C1C1F] text-gray-300 border-[#27272A]'
                        }`}
                      >
                        {label}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-2 sm:gap-4">
                {filteredTables.length === 0 ? (
                  <div className={clsx('col-span-full', 'py-10', 'text-center', 'text-gray-500', 'text-sm', 'italic', 'font-sans')}>
                    Nenhuma mesa encontrada neste status.
                  </div>
                ) : (
                  filteredTables.map((table) => {
                    const tableOrders = orders.filter(o => o.mesaId === table.id);
                    const waiterDrafts = getDraftItems(table.id);
                    const draftQtyCount = waiterDrafts.reduce((sum, item) => sum + (item.quantidade || 1), 0);

                    // Concurrency: Waiters other than active editing drafts on this table (synced via WebSockets)
                    const otherWaitersServing = Object.keys(activeDrafts[table.id] || {})
                      .filter(gId => gId !== activeWaiterId)
                      .map(gId => activeDrafts[table.id][gId].garcomNome);

                    const tableComandas = orders.filter(o => o.mesaId === table.id);
                    const hasPendingPayment = pagamentosPendentes.some(pag =>
                      tableComandas.some(o => o.id === pag.comanda_id)
                    );

                    const mergedSources = tableComandas
                      .map(o => o.mesaOrigemId)
                      .filter((id): id is number => id !== null && id !== undefined && id !== table.id);
                    
                    const mergedIntoMesaId = orders.find(o => o.mesaOrigemId === table.id)?.mesaId || null;

                    return (
                      <MesaCard
                        key={table.id}
                        table={table}
                        orders={tableOrders}
                        draftCount={draftQtyCount}
                        otherWaitersServing={otherWaitersServing}
                        currentTime={tableOrders.length > 0 ? currentTime : 0}
                        activeWaiterId={activeWaiterId}
                        onClick={handleTableClick}
                        hasPendingPayment={hasPendingPayment}
                        mergedSources={mergedSources}
                        mergedIntoMesaId={mergedIntoMesaId}
                      />
                    );
                  })
                )}
              </div>
            </div>

          </div>
        )}

      </main>

      {/* FOOTER */}
      <footer className={clsx('bg-[#121214]', 'text-[#71717A]', 'border-t', 'border-[#27272A]', 'py-7', 'text-center', 'text-xs', 'shrink-0', 'font-sans')}>
        <div className={clsx('max-w-7xl', 'mx-auto', 'px-4', 'space-y-1')}>
          <p className={clsx('font-serif', 'text-sm', 'text-[#10b981]', 'font-medium')}>{restaurantName}</p>
          <p className="text-[10px]">© {new Date().getFullYear()} {restaurantName}. Todos os direitos reservados.</p>
        </div>
      </footer>

      {/* MODAL CONTROLLER */}
      {selectedTable && (() => {
        const selectedTableActiveClients = Array.from(new Set(
          selectedTableOrders.flatMap(order => {
            const arr = Array.isArray(order?.itens) ? order.itens : Array.isArray(order?.items) ? order.items : [];
            return arr
              .map(item => (item?.clienteNome || item?.cliente_nome || '').trim())
              .filter(name => name !== '' && name !== 'Consumo Geral');
          })
        ));

        // Concurrency: Waiters other than active editing drafts on this table (synced via WebSockets)
        const otherWaitersServing = Object.keys(activeDrafts[selectedTable.id] || {})
          .filter(gId => gId !== activeWaiterId)
          .map(gId => activeDrafts[selectedTable.id][gId].garcomNome);

        return (
          <MesaDetailsModal
            table={selectedTable}
            orders={selectedTableOrders}
            allOrders={orders}
            draftItems={getDraftItems(selectedTable.id)}
            isSubmitting={isSubmitting}
            otherWaitersServing={otherWaitersServing}
            salonTables={salonTables}
            settings={settings}
            activeRole={activeRole}
            activeWaiterId={activeWaiterId}
            activeWaiterNome={activeWaiter.nome}
            currentTime={currentTime}
            onClose={() => setSelectedTableId(null)}
            onUpdateSettings={setSettings}
            onAddToDraft={(product, qty, obs, client) => handleAddToDraft(selectedTable.id, product, qty, obs, client)}
            onRemoveFromDraft={(draftItemId) => handleRemoveFromDraft(selectedTable.id, draftItemId)}
            onUpdateDraftItem={(draftItemId, fields) => handleUpdateDraftItem(selectedTable.id, draftItemId, fields)}
            onSubmitDraft={(orderType) => handleSubmitDraft(selectedTable.id, orderType)}
            onTransferTable={(targetTableId) => handleTransferTable(selectedTable.id, targetTableId)}
            onTransferItem={handleTransferItem}
            onTransferItems={handleTransferItems}
            onCancelItem={handleCancelItem}
            onCloseTable={() => handleCloseTable(selectedTable.id)}
            onSettleCustomer={(customerName) => handleSettleCustomer(selectedTable.id, customerName)}
            onDeliverItem={handleDeliverItem}
            historicClients={selectedTableActiveClients}
            restaurantName={restaurantName}
            onClearTableOrders={() => handleClearTableOrders(selectedTable.id)}
            onPrintReceipt={(apenasValores) => handlePrintReceipt(selectedTable.id, apenasValores)}
            onPrintKitchenLaunch={handlePrintKitchenLaunch}
            liveProdutos={liveProdutos}
            liveCategorias={liveCategorias}
            restauranteConfig={restauranteConfig}
            onUpdateItemDetails={handleUpdateItemDetails}
            onMergeTables={handleMergeTables}
            onUnmergeTable={handleUnmergeTable}
          />
        );
      })()}

    </div>
  );
}
