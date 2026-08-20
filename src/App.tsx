/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { KomaLogo } from './components/KomaLogo';
import { LoginButton } from '../components/shadcnblocks/login-button';
import { Menu, X, User, Wifi, WifiOff, SlidersHorizontal, ArrowDownRight, ArrowUpRight, RefreshCw, Bell, Printer, TrendingUp, Utensils, CheckCircle2, UserCheck, UserX, ShoppingBag, Sun, Moon } from 'lucide-react';
import { Table, Order, DraftItem, AppSettings, AppRole, Product, CaixaTurnoResumo } from './types';
import { TABLES, WAITERS, RESTAURANT_CONFIG } from './data';
import { normalizeCatalogSnapshot, type CatalogCategory } from './catalog/catalog';
import { getTableTotal } from './domain';
import { MesaCard } from './components/MesaCard';
import { MesasView } from './components/mesas/MesasView';
import { MesaDetailsModal } from './components/MesaDetailsModal';
import clsx from 'clsx';
import CardapioPage from './cardapio/CardapioPage';
import SuperAdminPanel from './super-admin/SuperAdminPanel';
import { CaixaAtivarPage } from './components/CaixaAtivarPage';
import { MotoboyPwaPage } from './components/MotoboyPwaPage';
import { KitchenPanel } from './components/KitchenPanel';
import LandingPage from './landing/LandingPage';
import { API_BASE_URL } from './config/api';
import { KOMA_THEME_CHANGED_EVENT, nextKomaTheme, persistKomaTheme, readKomaTheme, type KomaTheme } from './config/theme';
import { saveOperatorSession, getOperatorSession, clearOperatorSession } from './utils/authSession';
import { parseBackendTimestamp } from './utils/dateTime';

const MemoizedCaixaPanel = React.lazy(() =>
  import('./components/CaixaPanel').then(module => ({
    default: module.MemoizedCaixaPanel
  }))
);

const CashierLoading = () => (
  <div className="w-full h-full bg-koma-page text-koma-accent flex items-center justify-center font-mono text-[10px] uppercase tracking-[0.18em]">
    Preparando operação…
  </div>
);

const LOCAL_STORAGE_DRAFTS_KEY = 'koma_drafts_vFinal_v3';
const LOCAL_STORAGE_SETTINGS_KEY = 'koma_settings_vFinal_v3';
const LOCAL_STORAGE_RESTAURANT_NAME_KEY = 'koma_restaurant_name_v3';
const LOCAL_STORAGE_HIST_CLIENTS_KEY = 'koma_historic_clients_v3';

const MANAGEMENT_ROLES = new Set<AppRole>(['admin', 'gerente', 'caixa']);
const isManagementRole = (role: AppRole) => MANAGEMENT_ROLES.has(role);

const parseBackendDateTime = (dateStr: any): number => {
  return parseBackendTimestamp(dateStr)?.getTime() ?? Date.now();
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

  // Detect motoboy PWA page (/entregador or ?view=entregador)
  const isEntregador = window.location.pathname.startsWith('/entregador') ||
                       window.location.search.includes('view=entregador');
  if (isEntregador) {
    return <MotoboyPwaPage />;
  }

  // Detect KÔMA Landing Page (/landing or ?view=landing)
  const isLanding = window.location.pathname.startsWith('/landing') ||
                    window.location.search.includes('view=landing');
  if (isLanding) {
    return <LandingPage />;
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
    const storedId = localStorage.getItem(key);
    if (storedId || portal !== 'caixa') return storedId || "";
    return String(getOperatorSession()?.user?.id || "");
  });
  const [activeWaiterNome, setActiveWaiterNome] = useState<string>(() => {
    const key = portal === 'caixa' ? "koma_caixa_name" : "koma_waiter_name";
    const storedName = localStorage.getItem(key);
    if (storedName || portal !== 'caixa') return storedName || "";
    return String(getOperatorSession()?.user?.nome || "");
  });
  const activeWaiter = { id: activeWaiterId, nome: activeWaiterNome };
  const [activeRole, setActiveRole] = useState<AppRole>(() => {
    if (portal === 'caixa') {
      return (localStorage.getItem("koma_caixa_role") as AppRole)
        || (getOperatorSession()?.user?.role as AppRole)
        || 'caixa';
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

  const [turnoResumo, setTurnoResumo] = useState<CaixaTurnoResumo | null>(null);
  const [isTurnoResumoLoading, setIsTurnoResumoLoading] = useState(false);
  const turnoResumoRequestRef = useRef(0);

  const fetchTurnoResumo = useCallback(async () => {
    const tokenKey = portal === 'caixa' ? "koma_caixa_token" : "koma_waiter_token";
    if (!isAuthenticated || !localStorage.getItem(tokenKey)) {
      setTurnoResumo(null);
      setIsTurnoResumoLoading(false);
      return;
    }

    // O resumo financeiro pertence ao caixa. Evita 403 no portal do garçom
    // sem enfraquecer a autorização do backend.
    if (!isManagementRole(activeRole)) {
      setTurnoResumo(null);
      setIsTurnoResumoLoading(false);
      return;
    }

    const requestId = ++turnoResumoRequestRef.current;
    setIsTurnoResumoLoading(true);
    try {
      const res = await fetch(`${API_BASE_URL}/caixa/turno-atual/resumo`, { headers: getAuthHeaders() }).catch(() => null);
      if (res && res.ok) {
        const data = await res.json().catch(() => null);
        if (data && requestId === turnoResumoRequestRef.current) {
          setTurnoResumo(data);
        }
      }
    } catch (e) {
      // Ignora silenciosamente erros 403 ou de permissão no modo garçom
    } finally {
      if (requestId === turnoResumoRequestRef.current) {
        setIsTurnoResumoLoading(false);
      }
    }
  }, [activeRole, getAuthHeaders, isAuthenticated, portal]);

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
      const operatorSession = newPortal === 'caixa' ? getOperatorSession() : null;
      setActiveWaiterId(
        localStorage.getItem(idKey)
        || String(operatorSession?.user?.id || "")
      );
      setActiveWaiterNome(
        localStorage.getItem(nameKey)
        || String(operatorSession?.user?.nome || "")
      );

      if (newPortal === 'caixa') {
        setActiveRole(
          (localStorage.getItem(roleKey) as AppRole)
          || (operatorSession?.user?.role as AppRole)
          || 'caixa'
        );
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

  const [theme, setTheme] = useState<KomaTheme>(() => readKomaTheme());

  const toggleTheme = () => {
    setTheme(persistKomaTheme(nextKomaTheme(theme)));
  };

  useEffect(() => {
    const handleThemeChange = () => setTheme(readKomaTheme());
    window.addEventListener('storage', handleThemeChange);
    window.addEventListener(KOMA_THEME_CHANGED_EVENT, handleThemeChange);
    return () => {
      window.removeEventListener('storage', handleThemeChange);
      window.removeEventListener(KOMA_THEME_CHANGED_EVENT, handleThemeChange);
    };
  }, []);

  // 1.5. Dynamic Salon Tables State and Fetcher
  const [salonTables, setSalonTables] = useState<Table[]>([]);
  const [fetchError, setFetchError] = useState<string | null>(null);

  const fetchTablesAbortControllerRef = useRef<AbortController | null>(null);
  const fetchOrdersAbortControllerRef = useRef<AbortController | null>(null);
  const targetedOrderRequestRef = useRef<Record<string, number>>({});
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
        const payload = await res.json().catch(() => null);
        throw new Error(payload?.detail || res.statusText || 'Não foi possível criar a mesa.');
      }
    } catch (err: any) {
      console.error(err);
      showToast(`Erro ao criar mesa: ${err.message || 'falha de conexão'}`, 'error');
      throw err;
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
        const payload = await res.json().catch(() => null);
        throw new Error(payload?.detail || res.statusText || 'Não foi possível atualizar a mesa.');
      }
    } catch (err: any) {
      console.error(err);
      showToast(`Erro ao atualizar mesa: ${err.message || 'falha de conexão'}`, 'error');
      throw err;
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
        const payload = await res.json().catch(() => null);
        throw new Error(payload?.detail || res.statusText || 'Não foi possível excluir a mesa.');
      }
    } catch (err: any) {
      console.error(err);
      showToast(`Erro ao excluir mesa: ${err.message || 'falha de conexão'}`, 'error');
      throw err;
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
  const [liveCategorias, setLiveCategorias] = useState<CatalogCategory[]>([]);
  const catalogRequestRef = useRef(0);

  const fetchLiveCatalog = useCallback(async () => {
    const requestId = ++catalogRequestRef.current;
    try {
      const tokenKey = portal === 'caixa' ? "koma_caixa_token" : "koma_waiter_token";
      const token = localStorage.getItem(tokenKey);
      const headers: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {};
      let payload: unknown;
      const catalogResponse = await fetch(`${API_BASE_URL}/produtos/catalogo`, {
        headers,
        cache: 'no-store',
      });

      if (catalogResponse.status === 401) {
        handleLogout();
        return;
      }

      if (catalogResponse.ok) {
        payload = await catalogResponse.json();
      } else if (catalogResponse.status === 404 || catalogResponse.status === 405) {
        // Compatibilidade durante deploy gradual: o endpoint atômico pode
        // chegar alguns segundos depois do frontend novo.
        const [productsResponse, categoriesResponse] = await Promise.all([
          fetch(`${API_BASE_URL}/produtos/`, { headers, cache: 'no-store' }),
          fetch(`${API_BASE_URL}/produtos/categorias`, { headers, cache: 'no-store' }),
        ]);
        if (productsResponse.status === 401 || categoriesResponse.status === 401) {
          handleLogout();
          return;
        }
        if (!productsResponse.ok || !categoriesResponse.ok) {
          throw new Error(`CATALOG_HTTP_${productsResponse.status}_${categoriesResponse.status}`);
        }
        payload = {
          produtos: await productsResponse.json(),
          categorias: await categoriesResponse.json(),
        };
      } else {
        throw new Error(`CATALOG_HTTP_${catalogResponse.status}`);
      }

      if (requestId !== catalogRequestRef.current) return;
      const catalog = normalizeCatalogSnapshot(payload);
      setLiveProdutos(catalog.produtos);
      setLiveCategorias(catalog.categorias);
      setIsProductsLoaded(true);
    } catch (err) {
      if (requestId === catalogRequestRef.current) {
        console.error("Error fetching live catalog", err);
      }
    }
  }, [portal]);

  const [isOnline, setIsOnline] = useState<boolean>(navigator.onLine);

  useEffect(() => {
    if (!isAuthenticated) return;
    fetchLiveCatalog();
    if (isWsConnected) return;
    const interval = setInterval(() => {
      fetchLiveCatalog();
    }, 40000); // refresh every 40s if not connected to WS
    return () => clearInterval(interval);
  }, [isAuthenticated, isWsConnected, fetchLiveCatalog]);

  useEffect(() => {
    const handleOnline = () => {
      setIsOnline(true);
      fetchLiveCatalog();
      window.dispatchEvent(new Event('koma_orders_updated'));
      window.dispatchEvent(new Event('koma_customers_updated'));
    };
    const handleOffline = () => {
      setIsOnline(false);
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [fetchLiveCatalog]);

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
    // O caixa mantém o próprio relógio de SLA. Evita renderizar novamente todo
    // o painel administrativo apenas para atualizar o relógio do salão.
    if (isManagementRole(activeRole)) return;
    const interval = setInterval(() => {
      setCurrentTime(Date.now());
    }, 30000);
    return () => clearInterval(interval);
  }, [activeRole]);

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

    let activeSocket: WebSocket | null = null;
    let reconnectTimeout: ReturnType<typeof setTimeout> | undefined;
    let wsUpdateTimeout: ReturnType<typeof setTimeout> | undefined;
    let stopped = false;
    let currentDelay = 2000;

    type RealtimeRefreshFlags = {
      orders?: boolean;
      tables?: boolean;
      catalog?: boolean;
      config?: boolean;
      summary?: boolean;
      payments?: boolean;
    };

    let pendingRefresh: RealtimeRefreshFlags = {};

    // Vários endpoints publicam eventos próximos entre si. Consolida a rajada
    // e busca somente os recursos realmente afetados pela mudança.
    const scheduleRealtimeRefresh = (flags: RealtimeRefreshFlags, delayMs = 90) => {
      pendingRefresh = { ...pendingRefresh, ...flags };
      if (wsUpdateTimeout) clearTimeout(wsUpdateTimeout);
      wsUpdateTimeout = setTimeout(() => {
        const refresh = pendingRefresh;
        pendingRefresh = {};

        if (refresh.orders) fetchOrdersFromAPI();
        if (refresh.tables) fetchTables();
        if (refresh.catalog) fetchLiveCatalog();
        if (refresh.config) fetchConfig();
        if (refresh.summary) fetchTurnoResumo();
        if (refresh.payments && isManagementRole(activeRole)) {
          fetchPagamentosPendentes();
        }
        if (refresh.orders || refresh.tables) {
          window.dispatchEvent(new Event('koma_orders_updated'));
        }
      }, delayMs);
    };

    const connectWS = () => {
      if (stopped || document.hidden) return;

      const existing = wsRef.current;
      if (
        existing
        && (existing.readyState === WebSocket.CONNECTING || existing.readyState === WebSocket.OPEN)
      ) {
        return;
      }

      if (reconnectTimeout) {
        clearTimeout(reconnectTimeout);
        reconnectTimeout = undefined;
      }

      const wsBase = API_BASE_URL.replace(/^http/, 'ws');
      const tokenKey = portal === 'caixa' ? "koma_caixa_token" : "koma_waiter_token";
      const token = localStorage.getItem(tokenKey) || "";
      const wsUrl = `${wsBase}/ws/${activeWaiterId}?token=${token}`;
      const socket = new WebSocket(wsUrl);
      activeSocket = socket;
      wsRef.current = socket;

      socket.onopen = () => {
        if (stopped || wsRef.current !== socket) return;
        console.log("WebSocket connection established");
        setIsWsConnected(true);
        currentDelay = 2000;
        fetchTables();
        fetchOrdersFromAPI();
        fetchTurnoResumo();
      };

      socket.onmessage = (event) => {
        if (stopped || wsRef.current !== socket) return;
        try {
          const data = JSON.parse(event.data);
          const eventName = data.event || data.type;

          if (
            eventName === "new_delivery_order"
            || eventName === "ORDER_UPDATED"
            || eventName === "NEW_ORDER"
            || eventName === "order_updated"
            || eventName === "order_status_updated"
          ) {
            scheduleRealtimeRefresh({ orders: true });
          }
          if (eventName === "print_monitor_updated") {
            // Atualização silenciosa: o painel refaz a consulta sem toast,
            // som ou interrupção do operador.
            window.dispatchEvent(
              new Event('koma_print_monitor_refresh')
            );
          }
          if (eventName === "customers_updated") {
            window.dispatchEvent(new Event('koma_customers_updated'));
          }
          if (eventName === "team_updated") {
            window.dispatchEvent(new Event('koma_team_updated'));
          }
          if (eventName === "catalog_updated") {
            scheduleRealtimeRefresh({ catalog: true });
          }
          if (eventName === "config_updated" || eventName === "CONFIG_UPDATE") {
            scheduleRealtimeRefresh({ config: true });
          }
          if (eventName === "cash_updated") {
            scheduleRealtimeRefresh({ summary: true });
            window.dispatchEvent(new Event('koma_cash_updated'));
          }
          if (eventName === "tables_updated" || eventName === "TABLE_UPDATED") {
            const detailType = String(data.detail?.type || '');
            const isLayoutChange = detailType === 'layout_mesa_atualizado';
            const isComandaOpened = detailType === 'comanda_aberta';
            const isLaunchCreated = detailType === 'lancamento_criado';

            if (isLayoutChange || isComandaOpened) {
              // Abrir a comanda ocupa a mesa, mas ainda não existe pedido para o Kanban.
              // Atualizar orders aqui causava um estado intermediário vazio e alerta duplicado.
              scheduleRealtimeRefresh({ tables: true });
            } else if (isLaunchCreated) {
              // O evento já informa qual comanda mudou. Evita reconstruir todo o salão
              // no caminho crítico de um novo pedido.
              const comandaId = String(data.detail?.comanda_id || '').trim();
              if (comandaId) {
                void fetchOrderByIdFromAPI(comandaId);
                scheduleRealtimeRefresh({ tables: true, summary: true }, 0);
              } else {
                // Compatibilidade defensiva com produtores antigos sem comanda_id.
                scheduleRealtimeRefresh({ orders: true, tables: true, summary: true }, 0);
              }
            } else {
              // Compatibilidade com eventos legados e demais mutações de mesa.
              scheduleRealtimeRefresh({
                orders: true,
                tables: true,
                summary: true,
                payments: true
              });
            }
            if (data.detail && data.detail.type === "pagamento_registrado" && data.detail.status === "pendente") {
              showToast(`Confirmar recebimento em dinheiro: R$ ${data.detail.valor.toFixed(2)} - Garçom ${data.detail.garcom_nome}`, 'info', 5000);
            }
          } else if (eventName === "MESA_ATUALIZADA" || eventName === "MESA_UPDATED") {
            scheduleRealtimeRefresh({ orders: true });
            const mesaUpdate = data.data || data;
            const mesaId = Number(mesaUpdate.mesa_id);
            const status = String(mesaUpdate.status || '').toLowerCase();
            const comandaId = mesaUpdate.comanda_id ?? null;
            if (!Number.isFinite(mesaId) || mesaId <= 0) return;
            if (status === 'livre') {
              setOrders(prevOrders => prevOrders.filter(o => o.mesaId !== mesaId));
            }
            setSalonTables(prevTables =>
              prevTables.map(t => t.id === mesaId ? { ...t, status, comanda_id: comandaId } : t)
            );
            if (status === 'livre' && portal === 'garcom' && navigator.vibrate) {
              navigator.vibrate(100);
            }
          } else if (eventName === "draft_status") {
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
          } else if (eventName === "waiter_connected" || eventName === "waiter_disconnected") {
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

      socket.onclose = () => {
        if (stopped || wsRef.current !== socket) return;
        setIsWsConnected(false);
        wsRef.current = null;
        if (!document.hidden) {
          console.log(`WebSocket disconnected, reconnecting in ${currentDelay}ms`);
          if (reconnectTimeout) clearTimeout(reconnectTimeout);
          reconnectTimeout = setTimeout(connectWS, currentDelay);
          currentDelay = Math.min(currentDelay * 1.5, 30000);
        }
      };

      socket.onerror = (err) => {
        console.error("WebSocket connection error:", err);
      };
    };

    const handleVisibilityChange = () => {
      if (document.hidden || stopped) return;
      const socket = wsRef.current;
      if (!socket || socket.readyState === WebSocket.CLOSED) {
        currentDelay = 2000;
        connectWS();
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    connectWS();

    return () => {
      stopped = true;
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      if (reconnectTimeout) clearTimeout(reconnectTimeout);
      if (wsUpdateTimeout) clearTimeout(wsUpdateTimeout);
      if (activeSocket) {
        activeSocket.onopen = null;
        activeSocket.onmessage = null;
        activeSocket.onclose = null;
        activeSocket.onerror = null;
        activeSocket.close();
      }
      if (wsRef.current === activeSocket) wsRef.current = null;
    };
  }, [isAuthenticated, activeWaiterId, activeRole, portal]);

  // Sync local draft changes to WebSocket
  useEffect(() => {
    if (!isAuthenticated || !activeWaiterId || !isWsConnected || activeRole !== 'garcom') return;

    const currentStatuses: { [mesaId: number]: boolean } = {};
    const mesaIds = new Set<number>([
      ...salonTables.map(table => table.id),
      ...Object.keys(drafts).map(Number),
      ...Object.keys(lastDraftStatusesRef.current).map(Number)
    ]);

    mesaIds.forEach((mId) => {
      if (!Number.isFinite(mId) || mId <= 0) return;
      const hasDraft = (drafts[mId] || []).length > 0;
      const isViewing = selectedTableId === mId;
      const isActive = hasDraft || isViewing;
      currentStatuses[mId] = isActive;

      const prev = lastDraftStatusesRef.current[mId] || false;
      if (isActive !== prev) {
        notifyDraftStatus(mId, isActive);
      }
    });
    lastDraftStatusesRef.current = currentStatuses;
  }, [drafts, selectedTableId, salonTables, isAuthenticated, activeWaiterId, isWsConnected, activeRole]);

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

  const mapBackendComandaToOrder = (comanda: any, now = Date.now()): Order => ({
    id: comanda.id,
    numeroPedido: Number.isFinite(Number(comanda.numero_pedido)) ? Number(comanda.numero_pedido) : undefined,
    origemOperacional: (() => {
      const origins = (Array.isArray(comanda.lancamentos) ? comanda.lancamentos : [])
        .map((launch: any) => String(launch?.origem || '').toLowerCase());
      if (origins.includes('smartpos')) return 'smartpos';
      if (origins.includes('cardapio')) return 'cardapio';
      if (origins.includes('caixa')) return 'caixa';
      if (origins.includes('garcom')) return 'garcom';
      return 'desconhecida';
    })(),
    clienteId: comanda.cliente_id || null,
    clientePhone: comanda.delivery_telefone || null,
    mesaId: comanda.mesa_id || 0,
    garcomId: comanda.garcom_id,
    garcomNome: comanda.criada_por?.nome || comanda.garcom?.nome || 'Garçom',
    timestamp: parseBackendDateTime(comanda.criado_em),
    tipo: comanda.tipo,
    valorPago: comanda.valor_pago || 0,
    identificador: comanda.identificador || null,
    statusComanda: comanda.status_comanda || null,
    deliveryStatus: comanda.delivery_status || null,
    mesaOrigemId: comanda.mesa_origem_id || null,
    mesaTransferidaDe: comanda.mesa_transferida_de || null,
    itens: (comanda.itens || [])
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
          nome: item.produto?.nome || liveProdutos.find(p => p.id === item.produto_id)?.nome || `Item #${item.produto_id}`,
          preco: item.preco_unit,
          observacao: item.observacao || '',
          clienteNome: item.cliente_nome || 'Consumo Geral',
          status: effectiveStatus,
          lancamentoId: item.lancamento_id
        };
      })
  });

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

      const mappedOrders = comandas.map((comanda: any) => mapBackendComandaToOrder(comanda, now));

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

  const fetchOrderByIdFromAPI = async (comandaId: string) => {
    const normalizedId = String(comandaId || '').trim();
    if (!normalizedId) {
      fetchOrdersFromAPI();
      return;
    }

    const requestVersion = (targetedOrderRequestRef.current[normalizedId] || 0) + 1;
    targetedOrderRequestRef.current[normalizedId] = requestVersion;

    try {
      const response = await fetch(`${API_BASE_URL}/comandas/${encodeURIComponent(normalizedId)}`, {
        headers: getAuthHeaders(),
        cache: 'no-store'
      });
      if (response.status === 401) {
        handleLogout();
        return;
      }
      if (response.status === 404) {
        if (targetedOrderRequestRef.current[normalizedId] === requestVersion) {
          setOrders(prevOrders => prevOrders.filter(order => String(order.id) !== normalizedId));
        }
        return;
      }
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const mappedOrder = mapBackendComandaToOrder(await response.json());
      if (targetedOrderRequestRef.current[normalizedId] !== requestVersion) return;

      setOrders(prevOrders => {
        const nextOrders = prevOrders.filter(order =>
          String(order.id) !== String(mappedOrder.id)
          && !(String(order.id).startsWith('temp-') && mappedOrder.mesaId > 0 && order.mesaId === mappedOrder.mesaId)
        );
        return [...nextOrders, mappedOrder].sort((a, b) => a.timestamp - b.timestamp);
      });
      setIsOrdersLoaded(true);
      setFetchError(null);
    } catch (err) {
      console.warn('Falha no refresh direcionado da comanda; reconciliando snapshot completo.', err);
      fetchOrdersFromAPI();
    }
  };

  useEffect(() => {
    if (!isAuthenticated) return;
    fetchOrdersFromAPI();
    fetchTables();
    if (isManagementRole(activeRole)) {
      fetchPagamentosPendentes();
    }

    const handleVisibilityChange = () => {
      if (!document.hidden && isAuthenticated) {
        fetchOrdersFromAPI();
        fetchTables();
        if (isManagementRole(activeRole)) {
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
      if (isManagementRole(activeRole)) {
        fetchPagamentosPendentes();
      }
    }, 8000);

    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      clearInterval(interval);
    };
  }, [isAuthenticated, isWsConnected, activeRole]);

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
      if (portal === 'caixa' && !isManagementRole(role)) {
        setLoginError("Acesso negado. Use uma conta de caixa, gerente ou administrador.");
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

      if (portal === 'caixa') {
        saveOperatorSession(data.access_token, { ...data.usuario, role });
      } else {
        localStorage.setItem(tokenKey, data.access_token);
        localStorage.setItem(idKey, data.usuario.id);
        localStorage.setItem(nameKey, data.usuario.nome);
        localStorage.setItem(roleKey, role);
      }

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

    // Exibe toast informativo inicial
    showToast('Enviando pedido para a cozinha...', 'info');

    const restoreDraftAndNotify = (errorMessage?: string) => {
      // Restaura o rascunho da mesa no estado e no localStorage
      setDrafts(prev => ({
        ...prev,
        [mesaId]: items
      }));
      // Reabre a mesa com o carrinho preservado para o garçom reenviar com 1 clique
      setSelectedTableId(mesaId);
      // Rollback dos itens otimistas na memória
      fetchOrdersFromAPI();
      // Notifica o garçom
      showToast(
        errorMessage
          ? `${errorMessage}. Pedido preservado na mesa.`
          : 'Falha de conexão. Pedido preservado na mesa para reenviar.',
        'error'
      );
    };

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
          const errData = await openRes.json().catch(() => null);
          restoreDraftAndNotify(errData?.detail || `Falha ao abrir comanda (${openRes.statusText})`);
          setIsSubmitting(false);
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
        const errData = await launchRes.json().catch(() => null);
        restoreDraftAndNotify(errData?.detail || `Falha ao lançar itens (${launchRes.statusText})`);
        setIsSubmitting(false);
        return;
      }

      const launchData = await launchRes.json();
      if (launchData.dispensado_impressao) {
        showToast('Pedido registrado (sem impressão física).', 'info');
      } else {
        showToast('Pedido lançado para a cozinha com sucesso.', 'success');
      }

      // Sync real com dados do servidor (substitui itens otimistas pelos reais com IDs corretos)
      fetchOrdersFromAPI();
    } catch (err) {
      console.error(err);
      restoreDraftAndNotify('Erro de conexão com o servidor.');
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
    showToast(`Mesa ${mesaId} encerrada e liberada.`, 'success');

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
      showToast(`Consumo de "${customerName}" liquidado com sucesso.`, 'success');
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
    showToast(`Item transferido para a Mesa ${targetTableId}.`, 'success');

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
    showToast(`${itemIds.length} itens transferidos para a Mesa ${targetTableId}.`, 'success');

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
    showToast('Item cancelado.', 'success');

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
    showToast('Item atualizado.', 'success');

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
      <div className="min-h-screen bg-koma-page relative flex items-center justify-center p-4">
        {/* Quick theme switcher button on login screen */}
        <div className="absolute top-4 right-4 sm:top-6 sm:right-6 z-20">
          <button
            type="button"
            onClick={toggleTheme}
            className="flex items-center gap-2 px-3 py-2 rounded-xl bg-koma-card border border-koma-border text-koma-secondary hover:text-koma-foreground hover:bg-koma-raised transition-all text-xs font-bold shadow-md cursor-pointer"
            title={theme === 'dark' ? 'Mudar para Modo Claro' : 'Mudar para Modo Escuro'}
            aria-label="Alternar tema claro e escuro"
          >
            {theme === 'dark' ? <Sun size={15} className="text-amber-400" /> : <Moon size={15} className="text-sky-500" />}
            <span className="hidden sm:inline">{theme === 'dark' ? 'Modo Claro' : 'Modo Escuro'}</span>
          </button>
        </div>

        <div className="w-full max-w-sm bg-koma-card border border-emerald-500/10 rounded-2xl p-6 sm:p-8 shadow-2xl animate-scale-in">
          {/* Logo / Header */}
          <div className="text-center space-y-3 mb-7">
            <div className="flex justify-center">
    <KomaLogo withText size="xl" />
  </div>
  <div className="space-y-1">
              <span className="text-[10px] font-sans font-semibold tracking-wide text-emerald-700 dark:text-emerald-400 block">
                Se você está com fome, Kôma
              </span>
            </div>
            <p className="text-[10px] text-emerald-700 dark:text-emerald-400 uppercase tracking-widest font-sans font-bold bg-emerald-500/10 px-3 py-1 rounded-full w-fit mx-auto border border-emerald-500/15">
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
              <label htmlFor="login-username" className="text-[10px] text-koma-subtle font-bold uppercase tracking-wider block">E-MAIL</label>
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
                className="w-full bg-koma-panel text-koma-foreground border border-koma-border/40 rounded-xl px-4 py-3 text-sm font-semibold focus:outline-none focus:ring-1 focus:ring-emerald-500 focus:border-emerald-500/50 placeholder-gray-600"
              />
            </div>

            <div className="space-y-1.5">
              <label htmlFor="login-password" className="text-[10px] text-koma-subtle font-bold uppercase tracking-wider block">Senha</label>
              <input
                id="login-password"
                type="password"
                name="password"
                autoComplete="current-password"
                required
                value={loginPassword}
                onChange={(e) => setLoginPassword(e.target.value)}
                placeholder="••••••"
                className="w-full bg-koma-panel text-koma-foreground border border-koma-border/40 rounded-xl px-4 py-3 text-sm font-semibold focus:outline-none focus:ring-1 focus:ring-emerald-500 focus:border-emerald-500/50 placeholder-gray-600"
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

  if (isManagementRole(activeRole)) {
    return (
      <div className={`w-full h-screen bg-koma-page text-koma-foreground flex flex-col font-sans overflow-hidden ${fontSize === 'grande' ? 'font-large' : fontSize === 'gigante' ? 'font-huge' : ''}`}>
        <React.Suspense fallback={<CashierLoading />}>
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
            turnoResumo={turnoResumo}
            isTurnoResumoLoading={isTurnoResumoLoading}
            onRefreshTurnoResumo={fetchTurnoResumo}
            liveProdutos={liveProdutos}
            liveCategorias={liveCategorias}
            catalogReady={isProductsLoaded}
            onRefreshCategorias={fetchLiveCatalog}
            restauranteConfig={restauranteConfig}
            fetchError={fetchError}
            onOptimisticUpdateItemStatus={handleOptimisticUpdateItemStatus}
            onOptimisticAddOrder={handleOptimisticAddOrder}
            onRemovePendingPaymentOptimistic={handleRemovePendingPaymentOptimistic}
          />
        </React.Suspense>
      </div>
    );
  }

  return (
    <div className={`waiter-shell min-h-screen bg-koma-page text-koma-foreground flex flex-col font-sans ${fontSize === 'grande' ? 'font-large' : fontSize === 'gigante' ? 'font-huge' : ''}`}>
      {/* GLOBAL TOP HEADER */}
      <header className="bg-koma-page/95 backdrop-blur-xl border-b border-koma-border-subtle text-koma-foreground shrink-0 sticky top-0 z-30">
        <div className="max-w-[1680px] mx-auto px-3 sm:px-6 lg:px-10 py-3.5">
          <div className="flex justify-between items-center">

            {/* Left: Settings Button + Logo + Title */}
            <div className="flex items-center gap-2 sm:gap-3">
              <button
                id="open-sidebar-btn"
                onClick={() => setIsSidebarOpen(true)}
                className="p-2.5 bg-white/[0.04] text-[#00b894] hover:bg-[#00b894] hover:text-black rounded-xl cursor-pointer border border-koma-border flex items-center justify-center transition-all"
                title="Operação & Configurações do Caixa"
              >
                <SlidersHorizontal size={18} />
              </button>

              <div className="flex items-center gap-2.5">
                <KomaLogo size="lg" />
                <div>
                  <h1 className="font-serif text-base sm:text-lg font-black tracking-[-0.03em] text-koma-foreground leading-tight">
                    {restaurantName}
                  </h1>
                  <p className="text-[9px] text-koma-muted font-sans leading-none mt-0.5 font-medium">
                    {activeWaiter.nome}
                  </p>
                </div>
              </div>
            </div>

            {/* Right: Network Status Badge */}
            <div className="flex items-center gap-2">
              <div className={clsx(
                'flex', 'items-center', 'gap-1.5', 'px-2.5', 'py-1', 'rounded-full', 'text-[10px]', 'font-semibold', 'transition-all',
                !isOnline 
                  ? 'bg-rose-500/10 text-rose-400 border border-rose-500/20' 
                  : isWsConnected 
                    ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' 
                    : 'bg-amber-500/10 text-amber-400 border border-amber-500/20'
              )}>
                {!isOnline ? <WifiOff size={12} /> : isWsConnected ? <Wifi size={12} /> : <RefreshCw size={12} className="animate-spin" />}
                <span className="hidden sm:inline">
                  {!isOnline ? 'Offline' : isWsConnected ? 'Online' : 'Reconectando...'}
                </span>
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
          <div className="relative w-72 sm:w-80 max-w-sm bg-koma-panel border-r border-koma-border h-full flex flex-col justify-between shadow-2xl z-10 p-4 sm:p-6 text-koma-foreground overflow-y-auto animate-slide-in-left">
            <div className="space-y-6">

              {/* Header inside drawer */}
              <div className={clsx('flex', 'items-center', 'justify-between', 'pb-4', 'border-b', 'border-koma-border')}>
                <div className={clsx('flex', 'items-center', 'gap-2.5')}>
                  <KomaLogo size="md" />
                  <div>
                    <span className={clsx('font-serif', 'font-bold', 'text-base', 'text-koma-foreground', 'leading-none', 'block')}>{restaurantName}</span>
                    <span className="text-[9px] text-emerald-700 dark:text-emerald-400 font-sans font-medium block mt-0.5">Se você está com fome, Kôma</span>
                  </div>
                </div>
                <button
                  id="close-sidebar-btn"
                  onClick={() => setIsSidebarOpen(false)}
                  className={clsx('p-1.5', 'rounded-lg', 'hover:bg-koma-card', 'text-koma-muted', 'hover:text-koma-foreground', 'transition-colors', 'cursor-pointer')}
                >
                  <X size={18} />
                </button>
              </div>

              {/* Calculate real-time metrics for drawer dashboards */}
              {(() => {
                const mesasOcupadasCount = tableCounts.ocupada + tableCounts.pronto;
                const mesasLivresCount = tableCounts.libre;
                const pratosProntosCount = orders.reduce((acc, o: any) => {
                  const prontos = (o.itens || o.items || []).filter((i: any) => i.status === 'pronto' || i.status === 'READY');
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
                      <div className="bg-koma-card border border-koma-border rounded-2xl p-3.5 space-y-3">
                        <div className="flex items-center gap-3">
                          <div className="h-10 w-10 bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 rounded-full flex items-center justify-center font-bold">
                            {activeWaiter.nome ? activeWaiter.nome[0] : 'G'}
                          </div>
                          <div>
                            <h4 className="text-sm font-bold text-koma-foreground">{activeWaiter.nome || 'Garçom'}</h4>
                            <p className="text-[10px] text-koma-subtle font-sans">Atendimento • Salão Principal</p>
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

                        <LoginButton
                          variant="default"
                          iconType="logout"
                          onClick={handleLogout}
                          className="w-full font-bold uppercase tracking-wider text-xs py-2.5"
                        >
                          LOGOUT / SAIR
                        </LoginButton>
                      </div>
                    </div>

                    {/* GARÇOM - RESUMO DO SALÃO EM TEMPO REAL */}
                    <div className="space-y-2.5">
                      <h3 className="text-[10px] uppercase tracking-wider font-bold text-emerald-400 font-sans">Status do Salão ao Vivo</h3>
                      <div className="bg-koma-card border border-koma-border rounded-2xl p-3 space-y-2">
                        <div className="flex items-center justify-between p-2.5 bg-koma-card border border-koma-border rounded-xl text-xs">
                          <div className="flex items-center gap-2">
                            <Utensils size={14} className="text-emerald-400" />
                            <span className="text-koma-secondary font-medium">Mesas Salão</span>
                          </div>
                          <span className="font-mono font-bold text-koma-foreground">
                            <strong className="text-emerald-400">{mesasOcupadasCount}</strong> ocupadas / {mesasLivresCount} livres
                          </span>
                        </div>

                        <div className="flex items-center justify-between p-2.5 bg-koma-card border border-koma-border rounded-xl text-xs">
                          <div className="flex items-center gap-2">
                            <CheckCircle2 size={14} className={pratosProntosCount > 0 ? "text-amber-400 animate-bounce" : "text-koma-muted"} />
                            <span className="text-koma-secondary font-medium">Pratos Prontos</span>
                          </div>
                          <span className={clsx('font-mono font-bold px-2 py-0.5 rounded-md text-[10px]', pratosProntosCount > 0 ? 'bg-amber-500/20 text-amber-600 dark:text-amber-300 border border-amber-500/30' : 'text-koma-subtle bg-koma-raised')}>
                            {pratosProntosCount} p/ servir
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* GARÇOM - ATALHOS DE ATENDIMENTO */}
                    <div className="space-y-2.5">
                      <h3 className="text-[10px] uppercase tracking-wider font-bold text-emerald-400 font-sans">Atalhos de Atendimento</h3>
                      <div className="bg-koma-card border border-koma-border rounded-2xl p-3 space-y-2">
                        <button
                          type="button"
                          onClick={() => {
                            setIsSidebarOpen(false);
                            fetchOrdersFromAPI();
                            fetchTables();
                          }}
                          className="w-full flex items-center justify-between p-2.5 bg-koma-card hover:bg-koma-raised border border-koma-border rounded-xl text-xs text-koma-foreground transition-all cursor-pointer group"
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
                      <div className="bg-koma-card border border-koma-border rounded-2xl p-3.5 space-y-3">
                        <div className="flex items-center gap-3">
                          <div className="h-10 w-10 bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 rounded-full flex items-center justify-center font-bold">
                            {activeWaiter.nome ? activeWaiter.nome[0] : 'C'}
                          </div>
                          <div>
                            <h4 className="text-sm font-bold text-koma-foreground">{activeWaiter.nome || 'Caixa'}</h4>
                            <div className="flex items-center gap-1.5 mt-0.5">
                              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
                              <span className="text-[10px] text-emerald-400 font-semibold">Caixa Operacional Ativo</span>
                            </div>
                          </div>
                        </div>

                        <LoginButton
                          variant="default"
                          iconType="logout"
                          onClick={handleLogout}
                          className="w-full font-bold uppercase tracking-wider text-xs py-2.5"
                        >
                          LOGOUT / SAIR
                        </LoginButton>
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
                        className="w-full flex items-center justify-between p-3 bg-koma-card hover:bg-koma-raised border border-koma-border rounded-2xl transition-all cursor-pointer group text-left"
                      >
                        <div className="flex items-center gap-2.5">
                          <div className="p-2 rounded-xl bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 group-hover:bg-emerald-500/20">
                            <Printer size={16} />
                          </div>
                          <div>
                            <h4 className="text-xs font-bold text-koma-foreground">Agente de Impressão</h4>
                            <p className="text-[9px] text-emerald-400 font-medium">Servidor Online • Pronto</p>
                          </div>
                        </div>
                        <span className="text-[9px] text-koma-subtle font-mono font-bold bg-koma-card px-2 py-1 rounded-lg border border-koma-border">0 Falhas</span>
                      </button>
                    </div>

                    {/* CAIXA - RESUMO DO TURNO EM TEMPO REAL (PRIORIDADE #2 - SINCRONIZADO COM BANCO DE DADOS) */}
                    <div className="space-y-2.5">
                      <h3 className="text-[10px] uppercase tracking-wider font-bold text-emerald-400 font-sans">Resumo do Turno ao Vivo</h3>
                      <div className="bg-koma-card border border-koma-border rounded-2xl p-3 space-y-2">
                        <div className="flex items-center justify-between p-2 bg-koma-card border border-koma-border rounded-xl text-xs">
                          <div className="flex items-center gap-2">
                            <TrendingUp size={13} className="text-emerald-400" />
                            <span className="text-koma-secondary font-medium text-[11px]">Vendas do Turno</span>
                          </div>
                          <span className="font-mono font-bold text-emerald-400">
                            R$ {(turnoResumo?.total_vendas ?? totalVendasTurno).toFixed(2)}
                          </span>
                        </div>

                        <div className="flex items-center justify-between p-2 bg-koma-card border border-koma-border rounded-xl text-xs">
                          <div className="flex items-center gap-2">
                            <Utensils size={13} className="text-blue-400" />
                            <span className="text-koma-secondary font-medium text-[11px]">Comandas Abertas</span>
                          </div>
                          <span className="font-mono font-bold text-koma-foreground">
                            {turnoResumo?.comandas_abertas_count ?? totalComandasAbertas} ativas
                          </span>
                        </div>

                        {deliveryPendentesCount > 0 && (
                          <div className="flex items-center justify-between p-2 bg-amber-950/20 border border-amber-800/30 rounded-xl text-xs">
                            <div className="flex items-center gap-2">
                              <ShoppingBag size={13} className="text-amber-400 animate-pulse" />
                              <span className="text-amber-600 dark:text-amber-300 font-medium text-[11px]">Delivery Pendente</span>
                            </div>
                            <span className="font-mono font-bold text-amber-600 dark:text-amber-300 bg-amber-500/20 px-2 py-0.5 rounded text-[10px]">
                              {deliveryPendentesCount} p/ aceitar
                            </span>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* CAIXA - ATALHOS RÁPIDOS DE TESOURARIA */}
                    <div className="space-y-2.5">
                      <h3 className="text-[10px] uppercase tracking-wider font-bold text-emerald-400 font-sans">Operações de Tesouraria</h3>
                      <div className="bg-koma-card border border-koma-border rounded-2xl p-3 space-y-2">
                        <button
                          type="button"
                          onClick={() => {
                            setIsSidebarOpen(false);
                            window.dispatchEvent(new CustomEvent('koma-open-suprimento'));
                          }}
                          className="w-full flex items-center justify-between p-2.5 bg-koma-card hover:bg-koma-raised border border-koma-border rounded-xl text-xs text-koma-foreground transition-all cursor-pointer group"
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
                          className="w-full flex items-center justify-between p-2.5 bg-koma-card hover:bg-koma-raised border border-koma-border rounded-xl text-xs text-koma-foreground transition-all cursor-pointer group"
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
                          className="w-full flex items-center justify-between p-2.5 bg-koma-card hover:bg-koma-raised border border-koma-border rounded-xl text-xs text-koma-foreground transition-all cursor-pointer group"
                        >
                          <div className="flex items-center gap-2.5">
                            <div className="p-1.5 rounded-lg bg-blue-500/10 text-blue-400 group-hover:bg-blue-500/20">
                              <RefreshCw size={14} />
                            </div>
                            <span className="font-semibold text-xs">Sincronizar Dados</span>
                          </div>
                          <span className="text-[9px] text-emerald-400 font-mono font-bold flex items-center gap-1">
                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
                            Ao Vivo
                          </span>
                        </button>
                      </div>
                    </div>
                  </>
                );
              })()}

              {/* SECTION 3: EXIBIÇÃO & PREFERÊNCIAS */}
              <div className="space-y-2.5">
                <h3 className={clsx('text-[10px]', 'uppercase', 'tracking-wider', 'font-bold', 'text-emerald-400', 'font-sans')}>Exibição e Preferências</h3>
                <div className={clsx('bg-koma-card', 'border', 'border-koma-border', 'rounded-2xl', 'p-3.5', 'space-y-2.5')}>
                  <div className="flex items-center justify-between p-1 rounded">
                    <span className="text-xs text-koma-foreground font-medium">Tema Visual</span>
                    <button
                      type="button"
                      onClick={toggleTheme}
                      className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-koma-panel border border-koma-border text-xs font-bold text-koma-foreground hover:bg-koma-raised transition-colors cursor-pointer"
                      title={theme === 'dark' ? 'Mudar para Modo Claro' : 'Mudar para Modo Escuro'}
                    >
                      {theme === 'dark' ? <Sun size={13} className="text-amber-400" /> : <Moon size={13} className="text-sky-500" />}
                      <span className="text-[10px] font-mono uppercase">{theme === 'dark' ? 'Escuro' : 'Claro'}</span>
                    </button>
                  </div>

                  <label className={clsx('flex', 'items-center', 'justify-between', 'text-xs', 'text-koma-foreground', 'cursor-pointer', 'p-1', 'rounded', 'hover:bg-koma-raised/40')}>
                    <span>Exibir Imagens dos Pratos</span>
                    <input
                      id="sidebar-toggle-images"
                      type="checkbox"
                      checked={settings.exibirImagens}
                      onChange={(e) => setSettings({ ...settings, exibirImagens: e.target.checked })}
                      className={clsx('rounded', 'border-koma-border', 'text-emerald-500', 'focus:ring-emerald-500', 'h-4', 'w-4', 'bg-koma-card')}
                    />
                  </label>

                  <label className={clsx('flex', 'items-center', 'justify-between', 'text-xs', 'text-koma-foreground', 'cursor-pointer', 'p-1', 'rounded', 'hover:bg-koma-raised/40')}>
                    <span>Exibir Descrição dos Pratos</span>
                    <input
                      id="sidebar-toggle-descriptions"
                      type="checkbox"
                      checked={settings.exibirDescricoes}
                      onChange={(e) => setSettings({ ...settings, exibirDescricoes: e.target.checked })}
                      className={clsx('rounded', 'border-koma-border', 'text-emerald-500', 'focus:ring-emerald-500', 'h-4', 'w-4', 'bg-koma-card')}
                    />
                  </label>
                </div>
              </div>

            </div>

            <div className={clsx('pt-4', 'border-t', 'border-koma-border', 'text-center', 'text-[10px]', 'text-koma-muted', 'font-sans')}>
              <p>{restaurantName}</p>
              <p className={clsx('mt-0.5', 'font-mono')}>v3.5 • Dark Engine</p>
            </div>
          </div>
        </div>
      )}

      {/* MAIN CONTAINER */}
      <main className="flex-1 max-w-[1680px] w-full mx-auto px-3 sm:px-6 lg:px-10 py-4 sm:py-7 space-y-4 sm:space-y-7">
        {activeRole === 'cozinha' ? (
          <KitchenPanel
            orders={orders}
            onFinishPreparation={() => {}}
            currentTime={currentTime}
          />
        ) : isManagementRole(activeRole) ? (
          <React.Suspense fallback={<CashierLoading />}>
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
              turnoResumo={turnoResumo}
              isTurnoResumoLoading={isTurnoResumoLoading}
              onRefreshTurnoResumo={fetchTurnoResumo}
              liveProdutos={liveProdutos}
              liveCategorias={liveCategorias}
              catalogReady={isProductsLoaded}
              onRefreshCategorias={fetchLiveCatalog}
              restauranteConfig={restauranteConfig}
              fetchError={fetchError}
              onOptimisticUpdateItemStatus={handleOptimisticUpdateItemStatus}
              onOptimisticAddOrder={handleOptimisticAddOrder}
              onRemovePendingPaymentOptimistic={handleRemovePendingPaymentOptimistic}
            />
          </React.Suspense>
        ) : (
          /* VIEW 2: SALÃO (WAITERS OR CASHIER DASHBOARD) */
          <MesasView
            salonTables={salonTables}
            orders={orders}
            draftItemsMap={drafts}
            activeDrafts={activeDrafts}
            pagamentosPendentes={pagamentosPendentes}
            activeWaiterId={activeWaiterId}
            currentTime={currentTime}
            onTableClick={handleTableClick}
            tableFilter={tableFilter}
            onFilterChange={setTableFilter}
            showOperationalStatus={restauranteConfig?.perm_garcom_status !== false}
          />
        )}

      </main>

      {/* FOOTER */}
      <footer className={clsx('bg-koma-page', 'text-koma-muted', 'border-t', 'border-white/[0.06]', 'py-4', 'text-center', 'text-xs', 'shrink-0', 'font-sans')}>
        <div className={clsx('max-w-[1680px]', 'mx-auto', 'px-4', 'flex', 'items-center', 'justify-center', 'gap-2')}>
          <p className={clsx('font-serif', 'text-sm', 'text-emerald-700 dark:text-emerald-400', 'font-medium')}>{restaurantName}</p>
          <span className="h-1 w-1 rounded-full bg-zinc-700" />
          <p className="text-[10px]">Operação do salão</p>
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
            catalogReady={isProductsLoaded}
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
