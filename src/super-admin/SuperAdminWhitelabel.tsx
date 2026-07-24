import React, { useState, useEffect } from "react";
import { 
  Sliders, 
  CheckCircle, 
  AlertTriangle, 
  RefreshCw, 
  Globe, 
  MapPin, 
  Share2, 
  CreditCard, 
  Instagram, 
  Phone,
  ArrowRight,
  Smartphone,
  Search,
  ExternalLink
} from "lucide-react";
import { Tenant } from "./SuperAdminTenantControl";

interface SuperAdminWhitelabelProps {
  tenants: Tenant[];
  selectedTenantId: string;
  setSelectedTenantId: (id: string) => void;
  onAddLog: (text: string, type: "info" | "success" | "warning" | "error" | "critical") => void;
  onTriggerTelegramAlert: (text: string) => void;
}

export default function SuperAdminWhitelabel({
  tenants,
  selectedTenantId,
  setSelectedTenantId,
  onAddLog,
  onTriggerTelegramAlert
}: SuperAdminWhitelabelProps) {
  const [subtitulo, setSubtitulo] = useState("");
  const [slug, setSlug] = useState("");
  const [latitude, setLatitude] = useState<string>("0");
  const [longitude, setLongitude] = useState<string>("0");
  const [googleMapsUrl, setGoogleMapsUrl] = useState("");
  const [instagram, setInstagram] = useState("");
  const [whatsapp, setWhatsapp] = useState("");
  const [formasPagamento, setFormasPagamento] = useState<Record<string, boolean>>({
    Pix: false,
    Crédito: false,
    Débito: false,
    Dinheiro: false,
  });

  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [validationError, setValidationError] = useState("");

  // Geocoding and Address Search states
  const [addressSearch, setAddressSearch] = useState("");
  const [isGeocoding, setIsGeocoding] = useState(false);
  const [geocodeResult, setGeocodeResult] = useState<string | null>(null);

  // Fetch current config when selected restaurant changes
  useEffect(() => {
    if (!selectedTenantId) return;

    const fetchConfig = async () => {
      setIsLoading(true);
      setSaveSuccess(false);
      setValidationError("");
      setGeocodeResult(null);
      setAddressSearch("");
      try {
        const res = await fetch(`/api/caixa/config-cardapio/${selectedTenantId}`);
        if (res.ok) {
          const data = await res.json();
          setSubtitulo(data.subtitulo || "");
          setSlug(data.slug || "");
          setLatitude(String(data.latitude || "0"));
          setLongitude(String(data.longitude || "0"));
          setGoogleMapsUrl(data.google_maps_url || "");
          setInstagram(data.socials?.instagram || "");
          setWhatsapp(data.socials?.whatsapp || "");
          
          // Rebuild checkboxes state
          const acceptedPayments = data.formas_pagamento_aceitas || [];
          setFormasPagamento({
            Pix: acceptedPayments.includes("Pix"),
            Crédito: acceptedPayments.includes("Crédito"),
            Débito: acceptedPayments.includes("Débito"),
            Dinheiro: acceptedPayments.includes("Dinheiro"),
          });
        }
      } catch (err) {
        console.error("[WHITELABEL] Error fetching config:", err);
      } finally {
        setIsLoading(false);
      }
    };

    fetchConfig();
  }, [selectedTenantId]);

  // Coordinates extractor from Google Maps URL
  const extractCoordsFromUrl = (url: string) => {
    if (!url) return null;
    
    // Try pattern like @-23.5505,-46.6333
    const atPattern = /@(-?\d+\.\d+),(-?\d+\.\d+)/;
    const atMatch = url.match(atPattern);
    if (atMatch) {
      return { lat: atMatch[1], lon: atMatch[2] };
    }

    // Try pattern like q=-23.5505,-46.6333
    const qPattern = /[?&]q=(-?\d+\.\d+),(-?\d+\.\d+)/;
    const qMatch = url.match(qPattern);
    if (qMatch) {
      return { lat: qMatch[1], lon: qMatch[2] };
    }

    // Try parsing from raw string coordinates inside URL
    const llPattern = /ll=(-?\d+\.\d+),(-?\d+\.\d+)/;
    const llMatch = url.match(llPattern);
    if (llMatch) {
      return { lat: llMatch[1], lon: llMatch[2] };
    }

    return null;
  };

  // Handler for Google Maps URL change with instant parser auto-fill
  const handleGoogleMapsUrlChange = (val: string) => {
    setGoogleMapsUrl(val);
    const coords = extractCoordsFromUrl(val);
    if (coords) {
      setLatitude(coords.lat);
      setLongitude(coords.lon);
      onAddLog(`📍 GEOCODING: Coordenadas extraídas da URL do Maps: ${coords.lat}, ${coords.lon}`, "info");
      setGeocodeResult(`Coordenadas extraídas automaticamente: ${coords.lat}, ${coords.lon}`);
    }
  };

  // Handler for manual click to extract coordinates
  const triggerManualExtraction = () => {
    const coords = extractCoordsFromUrl(googleMapsUrl);
    if (coords) {
      setLatitude(coords.lat);
      setLongitude(coords.lon);
      onAddLog(`📍 GEOCODING: Coordenadas extraídas com sucesso da URL: ${coords.lat}, ${coords.lon}`, "success");
      setGeocodeResult(`Sucesso! Coordenadas extraídas: ${coords.lat}, ${coords.lon}`);
    } else {
      setGeocodeResult("Aviso: Formato de URL não reconhecido para extração automática.");
    }
  };

  // Handler for address lookup using free OSM Nominatim API
  const handleGeocodeAddress = async () => {
    if (!addressSearch.trim()) return;
    setIsGeocoding(true);
    setGeocodeResult(null);
    try {
      const response = await fetch(
        `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(addressSearch)}&limit=1`
      );
      if (response.ok) {
        const data = await response.json();
        if (data && data.length > 0) {
          const first = data[0];
          const latRounded = parseFloat(first.lat).toFixed(6);
          const lonRounded = parseFloat(first.lon).toFixed(6);
          setLatitude(latRounded);
          setLongitude(lonRounded);
          setGoogleMapsUrl(`https://www.google.com/maps/?q=${first.lat},${first.lon}`);
          setGeocodeResult(`📍 Encontrado: ${first.display_name}`);
          onAddLog(`📍 GEOCODING: Coordenadas encontradas para "${addressSearch}"`, "success");
        } else {
          setGeocodeResult("Nenhum resultado encontrado para este endereço.");
        }
      } else {
        setGeocodeResult("Falha na resposta da API de geocodificação.");
      }
    } catch (err) {
      setGeocodeResult("Erro de conexão com o servidor de busca.");
    } finally {
      setIsGeocoding(false);
    }
  };

  // Handler for slug input validation
  const handleSlugChange = (val: string) => {
    // Force lowercase, remove spaces, and allow only alphanumeric and hyphens
    const cleaned = val.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");
    setSlug(cleaned);
  };

  // Submit handler
  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedTenantId) {
      setValidationError("Por favor, selecione um restaurante para configurar.");
      return;
    }

    if (!slug.trim()) {
      setValidationError("O campo Slug é obrigatório.");
      return;
    }

    // Double check slug formatting
    if (/[A-Z\s]/.test(slug)) {
      setValidationError("O slug deve conter apenas letras minúsculas e sem espaços.");
      return;
    }

    setIsSaving(true);
    setValidationError("");
    setSaveSuccess(false);

    // Compile variables
    const selectedPayments = Object.keys(formasPagamento).filter(key => formasPagamento[key]);
    const payload = {
      restaurantId: selectedTenantId,
      subtitulo,
      slug,
      latitude: Number(latitude) || 0,
      longitude: Number(longitude) || 0,
      google_maps_url: googleMapsUrl,
      socials: {
        instagram,
        whatsapp
      },
      formas_pagamento_aceitas: selectedPayments
    };

    const targetTenant = tenants.find(t => t.id === selectedTenantId);
    const tenantName = targetTenant ? targetTenant.name : "Restaurante";

    try {
      const token = localStorage.getItem("token") || localStorage.getItem("whitelabel_menu_token") || localStorage.getItem("koma_token");
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (token) headers["Authorization"] = `Bearer ${token}`;

      const response = await fetch(`/api/caixa/config-cardapio/${selectedTenantId}`, {
        method: "PUT",
        headers,
        body: JSON.stringify(payload)
      });

      if (response.ok) {
        setSaveSuccess(true);
        onAddLog(`⚙️ WHITELABEL: Configurações atualizadas para: ${tenantName}.`, "success");
        onTriggerTelegramAlert(`⚙️ Whitelabel Atualizado: ${tenantName} teve suas configurações de identidade, mapas e formas de pagamento sincronizadas via WebSocket.`);
        
        // Hide success banner after 4 seconds
        setTimeout(() => setSaveSuccess(false), 4000);
      } else {
        const errData = await response.json();
        setValidationError(errData.error || "Falha ao gravar configurações no backend.");
        onAddLog(`❌ WHITELABEL ERROR: Falha ao salvar configurações de ${tenantName}.`, "error");
      }
    } catch (err) {
      setValidationError("Erro de rede ao conectar ao servidor.");
      onAddLog(`❌ WHITELABEL ERROR: Falha de conexão ao salvar configurações de ${tenantName}.`, "error");
    } finally {
      setIsSaving(false);
    }
  };

  // Find currently loaded tenant info
  const activeTenant = tenants.find(t => t.id === selectedTenantId);
  const activeTenantName = activeTenant ? activeTenant.name : "Meu Estabelecimento";

  return (
    <div className="space-y-6" id="superadmin-whitelabel-panel">
      {/* Upper Status Banner */}
      <div className="bg-[#121420] border border-[#1e293b]/40 p-5 rounded flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h3 className="text-sm font-mono text-white font-bold flex items-center gap-2">
            <Sliders className="w-4 h-4 text-[#00b894]" />
            [07] CONFIGURADOR WHITELABEL
          </h3>
          <p className="text-[10px] text-slate-500 font-mono mt-0.5">
            PERSONALIZAÇÃO DE IDENTIDADE VISUAL, COORDENADAS E MEIOS DE PAGAMENTO DO CLIENTE
          </p>
        </div>
        <span className="text-[9px] font-mono text-[#00b894] bg-emerald-950/20 px-2.5 py-1 rounded border border-[#00b894]/30 font-bold animate-pulse tracking-widest">
          SYNC_WEB_SOCKET_ACTIVE
        </span>
      </div>

      {/* Select Tenant Dropdown */}
      <div className="bg-[#121420] border border-[#1e293b]/40 p-5 rounded flex flex-col md:flex-row items-center gap-4">
        <div className="w-full md:w-1/3">
          <label className="block text-xs font-mono text-slate-400 mb-1.5 uppercase tracking-wider font-bold">
            Selecione o Restaurante (Inquilino)
          </label>
          <select
            className="w-full bg-black/60 border border-[#1e293b]/40 rounded px-3 py-2 text-sm font-mono text-white focus:outline-none focus:border-[#00b894]"
            value={selectedTenantId}
            onChange={(e) => setSelectedTenantId(e.target.value)}
          >
            <option value="">-- Escolha um Inquilino --</option>
            {tenants.map(t => (
              <option key={t.id} value={t.id}>
                {t.name} (ID: {t.id})
              </option>
            ))}
          </select>
        </div>
        
        {selectedTenantId && (
          <div className="flex-1 bg-[#090a0f] border border-[#1e293b]/20 px-4 py-3 rounded text-[11px] font-mono text-slate-400 flex items-center justify-between">
            <div>
              <span className="text-slate-500">DOMÍNIO ATUAL: </span>
              <span className="text-white font-bold underline hover:text-[#00b894] cursor-pointer">
                https://{activeTenant?.subdomain}
              </span>
            </div>
            <div className="flex items-center gap-2 text-emerald-400 font-bold">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
              CARREGADO
            </div>
          </div>
        )}
      </div>

      {!selectedTenantId ? (
        <div className="bg-[#121420] border border-[#1e293b]/20 p-12 rounded-lg text-center font-mono">
          <Sliders className="w-12 h-12 text-slate-600 mx-auto mb-4 animate-pulse" />
          <h4 className="text-slate-400 font-bold text-sm">Selecione um Inquilino no painel acima</h4>
          <p className="text-[10px] text-slate-600 mt-1 max-w-md mx-auto">
            Escolha qualquer restaurante ativo no menu superior ou clique no botão "Configurar" na aba [01] para editar sua identidade whitelabel imediatamente.
          </p>
        </div>
      ) : isLoading ? (
        <div className="bg-[#121420] border border-[#1e293b]/20 p-16 rounded-lg text-center font-mono">
          <RefreshCw className="w-8 h-8 animate-spin mx-auto mb-3 text-[#00b894]" />
          <span className="text-xs text-slate-400">Puxando dados do cache distribuído e tabelas PostgreSQL...</span>
        </div>
      ) : (
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-6" id="whitelabel-layout-grid">
          
          {/* Columns 1 & 2: Forms (col-span-2) */}
          <form onSubmit={handleSave} className="xl:col-span-2 space-y-6">
            
            {/* Form Bento Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              
              {/* Seção A: Identidade */}
              <div className="bg-[#121420] border border-[#1e293b]/40 p-5 rounded flex flex-col space-y-4" id="section-identity">
                <div className="border-b border-[#1e293b]/40 pb-2 flex items-center justify-between">
                  <h4 className="text-xs font-mono text-white font-bold flex items-center gap-2">
                    <Globe className="w-4 h-4 text-[#00b894]" />
                    SEÇÃO A: IDENTIDADE WHITELABEL
                  </h4>
                  <span className="text-[8px] text-slate-500 font-mono">ID_DYNAMICS</span>
                </div>

                <div>
                  <label className="block text-[10px] font-mono text-slate-400 mb-1 uppercase">Subtítulo do Cardápio</label>
                  <input
                    type="text"
                    className="w-full bg-black/60 border border-[#1e293b]/40 rounded px-3 py-2 text-xs font-mono text-white focus:outline-none focus:border-[#00b894]"
                    placeholder="Ex: O melhor Smash Burger artesanal de SP"
                    value={subtitulo}
                    onChange={e => setSubtitulo(e.target.value)}
                  />
                </div>

                <div>
                  <label className="block text-[10px] font-mono text-slate-400 mb-1 uppercase">Slug da URL (Único)</label>
                  <input
                    type="text"
                    className="w-full bg-black/60 border border-[#1e293b]/40 rounded px-3 py-2 text-xs font-mono text-white focus:outline-none focus:border-[#00b894]"
                    placeholder="ex-pizzaria-napolitana"
                    value={slug}
                    onChange={e => handleSlugChange(e.target.value)}
                    required
                  />
                  <span className="text-[9px] text-slate-500 font-mono mt-1 block">
                    Formatado automaticamente: <span className="text-[#00b894] font-bold">{slug || "seu-slug"}</span>
                  </span>
                </div>
              </div>

              {/* Seção B: Geolocalização */}
              <div className="bg-[#121420] border border-[#1e293b]/40 p-5 rounded flex flex-col space-y-4" id="section-geoloc">
                <div className="border-b border-[#1e293b]/40 pb-2 flex items-center justify-between">
                  <h4 className="text-xs font-mono text-white font-bold flex items-center gap-2">
                    <MapPin className="w-4 h-4 text-[#00b894]" />
                    SEÇÃO B: GEOLOCALIZAÇÃO
                  </h4>
                  <span className="text-[8px] text-slate-500 font-mono">LAT_LON_MAPS</span>
                </div>

                {/* Google Maps URL with Extraction capability */}
                <div>
                  <label className="block text-[10px] font-mono text-slate-400 mb-1 uppercase">URL do Google Maps do Estabelecimento</label>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      className="flex-1 bg-black/60 border border-[#1e293b]/40 rounded px-3 py-2 text-xs font-mono text-white focus:outline-none focus:border-[#00b894]"
                      placeholder="Cole a URL para extrair coordenadas..."
                      value={googleMapsUrl}
                      onChange={e => handleGoogleMapsUrlChange(e.target.value)}
                    />
                    <button
                      type="button"
                      onClick={triggerManualExtraction}
                      disabled={!googleMapsUrl}
                      className="bg-black border border-[#1e293b]/40 hover:border-slate-700 hover:text-[#00b894] px-3.5 rounded text-[11px] font-mono font-bold text-slate-400 transition-all cursor-pointer disabled:opacity-40"
                      title="Extrair latitude e longitude da URL"
                    >
                      Extrair
                    </button>
                  </div>
                </div>

                {/* Manual Fields for Double Check */}
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-[10px] font-mono text-slate-400 mb-1 uppercase">Latitude</label>
                    <input
                      type="number"
                      step="any"
                      className="w-full bg-black/60 border border-[#1e293b]/40 rounded px-3 py-2 text-xs font-mono text-white focus:outline-none focus:border-[#00b894]"
                      placeholder="-23.5505"
                      value={latitude}
                      onChange={e => setLatitude(e.target.value)}
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-mono text-slate-400 mb-1 uppercase">Longitude</label>
                    <input
                      type="number"
                      step="any"
                      className="w-full bg-black/60 border border-[#1e293b]/40 rounded px-3 py-2 text-xs font-mono text-white focus:outline-none focus:border-[#00b894]"
                      placeholder="-46.6333"
                      value={longitude}
                      onChange={e => setLongitude(e.target.value)}
                    />
                  </div>
                </div>

                {/* Free Nominatim Address Geocoder Input */}
                <div className="pt-3 border-t border-[#1e293b]/20">
                  <label className="block text-[10px] font-mono text-slate-400 mb-1 uppercase flex items-center gap-1">
                    <Search className="w-3 h-3 text-[#00b894]" />
                    Ou Buscar Coordenadas por Endereço (Nominatim)
                  </label>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      className="flex-1 bg-black/60 border border-[#1e293b]/40 rounded px-3 py-1.5 text-xs font-mono text-white focus:outline-none focus:border-[#00b894]"
                      placeholder="Ex: Avenida Paulista, 1000, São Paulo"
                      value={addressSearch}
                      onChange={e => setAddressSearch(e.target.value)}
                      onKeyDown={e => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          handleGeocodeAddress();
                        }
                      }}
                    />
                    <button
                      type="button"
                      onClick={handleGeocodeAddress}
                      disabled={isGeocoding || !addressSearch.trim()}
                      className="bg-[#00b894]/10 text-[#00b894] border border-[#00b894]/30 hover:bg-[#00b894]/20 px-3 rounded text-[11px] font-mono font-bold transition-all cursor-pointer disabled:opacity-50"
                    >
                      {isGeocoding ? "Carregando..." : "Buscar"}
                    </button>
                  </div>
                  {geocodeResult && (
                    <p className={`text-[9px] font-mono mt-1 leading-relaxed ${geocodeResult.includes("Erro") || geocodeResult.includes("Nenhum") ? "text-amber-400" : "text-[#00b894]"}`}>
                      {geocodeResult}
                    </p>
                  )}
                </div>
              </div>

              {/* Seção C: Redes Sociais */}
              <div className="bg-[#121420] border border-[#1e293b]/40 p-5 rounded flex flex-col space-y-4" id="section-socials">
                <div className="border-b border-[#1e293b]/40 pb-2 flex items-center justify-between">
                  <h4 className="text-xs font-mono text-white font-bold flex items-center gap-2">
                    <Share2 className="w-4 h-4 text-[#00b894]" />
                    SEÇÃO C: REDES SOCIAIS (API DE ENGAJAMENTO)
                  </h4>
                  <span className="text-[8px] text-slate-500 font-mono">COMPILED_SOCIALS_JSON</span>
                </div>

                <div>
                  <label className="block text-[10px] font-mono text-slate-400 mb-1 uppercase flex items-center gap-1.5">
                    <Instagram className="w-3.5 h-3.5 text-pink-500" />
                    Instagram (Username/Handle)
                  </label>
                  <input
                    type="text"
                    className="w-full bg-black/60 border border-[#1e293b]/40 rounded px-3 py-2 text-xs font-mono text-white focus:outline-none focus:border-[#00b894]"
                    placeholder="Ex: koma.burgers"
                    value={instagram}
                    onChange={e => setInstagram(e.target.value)}
                  />
                </div>

                <div>
                  <label className="block text-[10px] font-mono text-slate-400 mb-1 uppercase flex items-center gap-1.5">
                    <Phone className="w-3.5 h-3.5 text-emerald-500" />
                    WhatsApp (Completo com DDI/DDD)
                  </label>
                  <input
                    type="text"
                    className="w-full bg-black/60 border border-[#1e293b]/40 rounded px-3 py-2 text-xs font-mono text-white focus:outline-none focus:border-[#00b894]"
                    placeholder="Ex: +5511999991111"
                    value={whatsapp}
                    onChange={e => setWhatsapp(e.target.value)}
                  />
                </div>
              </div>

              {/* Seção D: Formas de Pagamento */}
              <div className="bg-[#121420] border border-[#1e293b]/40 p-5 rounded flex flex-col space-y-4" id="section-payments">
                <div className="border-b border-[#1e293b]/40 pb-2 flex items-center justify-between">
                  <h4 className="text-xs font-mono text-white font-bold flex items-center gap-2">
                    <CreditCard className="w-4 h-4 text-[#00b894]" />
                    SEÇÃO D: FORMAS DE PAGAMENTO ACEITAS (CHECKOUT)
                  </h4>
                  <span className="text-[8px] text-slate-500 font-mono">GATEWAY_STRATEGY</span>
                </div>

                <div className="grid grid-cols-2 gap-3 mt-2">
                  {Object.keys(formasPagamento).map(method => (
                    <label 
                      key={method} 
                      className={`flex items-center gap-3 p-3 rounded border font-mono text-xs cursor-pointer transition-all ${
                        formasPagamento[method] 
                          ? "bg-[#090a0f]/80 border-[#00b894] text-white" 
                          : "bg-black/40 border-[#1e293b]/40 text-slate-400 hover:border-slate-700"
                      }`}
                    >
                      <input
                        type="checkbox"
                        className="hidden"
                        checked={formasPagamento[method]}
                        onChange={() => {
                          setFormasPagamento(prev => ({
                            ...prev,
                            [method]: !prev[method]
                          }));
                        }}
                      />
                      <div className={`w-4 h-4 rounded border flex items-center justify-center transition-all ${
                        formasPagamento[method] 
                          ? "bg-[#00b894] border-[#00b894] text-black" 
                          : "border-[#1e293b] bg-black"
                      }`}>
                        {formasPagamento[method] && <CheckCircle className="w-3 h-3 text-black stroke-[3]" />}
                      </div>
                      <span>{method}</span>
                    </label>
                  ))}
                </div>

                <span className="text-[9px] text-slate-500 font-mono italic">
                  * As formas marcadas serão habilitadas instantaneamente no carrinho digital do cliente após o salvamento.
                </span>
              </div>

            </div>

            {/* Validation or Success alerts */}
            {validationError && (
              <div className="bg-red-950/40 border border-red-500/30 text-red-400 text-xs font-mono p-4 rounded flex items-center gap-2">
                <AlertTriangle className="w-5 h-5 shrink-0" />
                <span>{validationError}</span>
              </div>
            )}

            {saveSuccess && (
              <div className="bg-emerald-950/40 border border-emerald-500/30 text-[#00b894] text-xs font-mono p-4 rounded flex items-center gap-2 animate-fade-in">
                <CheckCircle className="w-5 h-5 shrink-0 animate-bounce" />
                <span>Configurações atualizadas com sucesso! Os canais de WebSocket dispararam atualizações imediatas nos cardápios digitais dos clientes.</span>
              </div>
            )}

            {/* Save Action Area */}
            <div className="flex justify-end pt-2">
              <button
                type="submit"
                disabled={isSaving}
                className={`px-6 py-3 rounded font-mono text-xs font-bold transition-all flex items-center gap-2 cursor-pointer ${
                  isSaving 
                    ? "bg-zinc-800 text-zinc-500 border-transparent cursor-not-allowed" 
                    : "bg-[#00b894] hover:bg-[#059669] text-black font-extrabold shadow-[0_0_12px_rgba(0,184,148,0.25)] border-transparent"
                }`}
              >
                {isSaving ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin" />
                    GRAVANDO EM DISCO & NOTIFICANDO WEBSOCKETS...
                  </>
                ) : (
                  <>
                    <span>SALVAR CONFIGURAÇÕES</span>
                    <ArrowRight className="w-4 h-4" />
                  </>
                )}
              </button>
            </div>

          </form>

          {/* Column 3: Live Interactive Smartphone Preview (col-span-1) */}
          <div className="xl:col-span-1 flex flex-col items-center">
            
            <div className="bg-[#121420] border border-[#1e293b]/40 p-5 rounded flex flex-col items-center w-full h-full justify-between" id="live-preview-box">
              
              <div className="border-b border-[#1e293b]/40 pb-3 flex items-center justify-between w-full mb-4">
                <div>
                  <h3 className="text-xs font-mono text-white font-bold flex items-center gap-2">
                    <Smartphone className="w-4 h-4 text-[#00b894]" />
                    PREVIEW DO CARDÁPIO DIGITAL (MOCK)
                  </h3>
                  <p className="text-[9px] text-slate-500 font-mono mt-0.5 uppercase">Visualização de alterações em tempo real</p>
                </div>
                <span className="text-[8px] text-emerald-400 bg-emerald-950/40 px-1.5 py-0.5 rounded font-mono font-bold animate-pulse">
                  LIVE_CARD
                </span>
              </div>

              {/* Smartphone Outer Container */}
              <div className="relative w-full max-w-[280px] h-[480px] bg-black rounded-[36px] border-4 border-zinc-800 p-2.5 shadow-[0_15px_30px_rgba(0,0,0,0.8)] flex flex-col overflow-hidden">
                
                {/* Smartphone Speaker Notch */}
                <div className="absolute top-0 left-1/2 -translate-x-1/2 w-24 h-3 bg-zinc-800 rounded-b-lg z-20 flex items-center justify-center">
                  <div className="w-6 h-0.5 bg-zinc-900 rounded-full"></div>
                </div>

                {/* Smartphone Screen Internal */}
                <div className="flex-1 bg-zinc-950 rounded-[26px] overflow-y-auto overflow-x-hidden relative flex flex-col text-white pt-4 select-none pb-2 scrollbar-none" id="phone-screen-frame">
                  
                  {/* Banner Image / Cover Header */}
                  <div className="h-24 bg-gradient-to-br from-[#00b894]/20 via-slate-950 to-zinc-950 relative p-3 flex flex-col justify-end border-b border-zinc-900/40">
                    <div className="absolute top-1.5 right-2.5 bg-black/80 px-1.5 py-0.5 rounded text-[7px] text-slate-400 font-mono flex items-center gap-1 border border-slate-900">
                      <span>{slug ? `${slug}.koma.com` : "site.koma.com"}</span>
                    </div>
                    <h4 className="text-xs font-bold text-white drop-shadow-md tracking-tight">
                      {activeTenantName}
                    </h4>
                    <p className="text-[9px] text-emerald-400 font-mono line-clamp-1 mt-0.5 uppercase tracking-wide">
                      {subtitulo || "O melhor estabelecimento artesanal"}
                    </p>
                  </div>

                  {/* Smartphone Body Content */}
                  <div className="p-3 space-y-3.5 flex-1 flex flex-col justify-between">
                    
                    <div className="space-y-3">
                      {/* Box info */}
                      <div className="bg-zinc-900/90 rounded-xl p-2.5 border border-[#1e293b]/20 space-y-2">
                        
                        {/* Map coordinate preview info */}
                        <div className="flex items-start gap-1.5 text-[9px] text-slate-300">
                          <MapPin className="w-3 h-3 text-[#00b894] shrink-0 mt-0.5" />
                          <div className="flex-1 min-w-0">
                            <p className="font-bold text-slate-200">Localização Sincronizada</p>
                            <p className="text-[8px] text-slate-500 font-mono truncate">
                              Lat: {latitude || "0"} / Lon: {longitude || "0"}
                            </p>
                            {googleMapsUrl ? (
                              <a 
                                href={googleMapsUrl} 
                                target="_blank" 
                                rel="noreferrer" 
                                className="text-[8px] text-emerald-400 underline font-mono flex items-center gap-0.5 mt-0.5"
                              >
                                Google Maps Link <ExternalLink className="w-2 h-2" />
                              </a>
                            ) : (
                              <span className="text-[8px] text-amber-500 font-mono block mt-0.5">Sem link cadastrado</span>
                            )}
                          </div>
                        </div>

                        {/* Social Networks preview info */}
                        <div className="flex items-start gap-1.5 text-[9px] text-slate-300 pt-2 border-t border-zinc-800/60">
                          <Share2 className="w-3 h-3 text-[#00b894] shrink-0 mt-0.5" />
                          <div className="flex-1">
                            <p className="font-bold text-slate-200">Redes Sociais & Contato</p>
                            <div className="flex flex-wrap gap-1 mt-1">
                              {instagram ? (
                                <span className="flex items-center gap-0.5 text-[7px] bg-pink-950/20 text-pink-400 border border-pink-900/30 px-1 rounded font-mono">
                                  @{instagram}
                                </span>
                              ) : (
                                <span className="text-[7px] text-slate-600 font-mono">Nenhum Instagram</span>
                              )}
                              {whatsapp ? (
                                <span className="flex items-center gap-0.5 text-[7px] bg-emerald-950/20 text-emerald-400 border border-emerald-900/30 px-1 rounded font-mono">
                                  {whatsapp}
                                </span>
                              ) : (
                                <span className="text-[7px] text-slate-600 font-mono">Nenhum WhatsApp</span>
                              )}
                            </div>
                          </div>
                        </div>

                      </div>

                      {/* Mock Products list inside screen */}
                      <div className="space-y-1.5">
                        <p className="text-[8px] font-mono font-bold text-slate-500 uppercase tracking-wider">Produtos em Destaque</p>
                        
                        <div className="bg-zinc-900/40 border border-zinc-900 rounded-lg p-2 flex items-center justify-between">
                          <div className="min-w-0 flex-1 pr-1">
                            <p className="text-[9px] font-bold text-slate-200 truncate">Calabresa Premium</p>
                            <p className="text-[7px] text-slate-500 truncate">Queijo derretido, calabresa fina</p>
                          </div>
                          <span className="text-[9px] font-mono text-emerald-400 font-bold shrink-0">R$ 49,00</span>
                        </div>

                        <div className="bg-zinc-900/40 border border-zinc-900 rounded-lg p-2 flex items-center justify-between">
                          <div className="min-w-0 flex-1 pr-1">
                            <p className="text-[9px] font-bold text-slate-200 truncate">Artisanal Smash Burger</p>
                            <p className="text-[7px] text-slate-500 truncate">Molho especial, pão brioche</p>
                          </div>
                          <span className="text-[9px] font-mono text-emerald-400 font-bold shrink-0">R$ 35,00</span>
                        </div>
                      </div>

                    </div>

                    {/* Footer Payment visualizer */}
                    <div className="pt-2 border-t border-zinc-900 space-y-1.5">
                      <p className="text-[7px] font-mono text-slate-500 uppercase font-bold text-center">Formas de Pagamento</p>
                      
                      <div className="flex flex-wrap justify-center gap-1">
                        {Object.keys(formasPagamento).filter(key => formasPagamento[key]).length === 0 ? (
                          <span className="text-[7px] text-amber-500 font-mono italic">Nenhum selecionado</span>
                        ) : (
                          Object.keys(formasPagamento).map(method => formasPagamento[method] && (
                            <span key={method} className="text-[7px] font-mono bg-zinc-900 text-slate-300 border border-zinc-800 px-1 py-0.5 rounded flex items-center gap-0.5">
                              <span className="h-1 w-1 bg-[#00b894] rounded-full"></span>
                              {method}
                            </span>
                          ))
                        )}
                      </div>

                      <div className="bg-[#00b894] text-black font-mono font-bold text-[9px] text-center py-1.5 rounded-lg mt-1 select-none">
                        ENVIAR PEDIDO AO WHATSAPP
                      </div>
                    </div>

                  </div>

                </div>

              </div>

              {/* Informational Footer of preview */}
              <div className="text-[9px] text-slate-500 font-mono leading-relaxed mt-2 text-center border-t border-[#1e293b]/20 pt-2 w-full">
                💡 O preview acima é atualizado dinamicamente enquanto você digita e marca as caixas.
              </div>

            </div>

          </div>

        </div>
      )}
    </div>
  );
}
