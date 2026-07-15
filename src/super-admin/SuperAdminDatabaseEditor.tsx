import React, { useState, useEffect, useRef } from "react";
import { 
  Database, 
  RefreshCw, 
  Save, 
  Search, 
  ShieldAlert, 
  CheckCircle, 
  Plus, 
  Table2, 
  Server,
  Download,
  AlertCircle,
  Trash2,
  History
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";

interface DatabaseEditorProps {
  onAddLog: (text: string, type: "info" | "success" | "warning" | "error" | "critical") => void;
  refreshTenantsList?: () => void;
}

export default function SuperAdminDatabaseEditor({ onAddLog, refreshTenantsList }: DatabaseEditorProps) {
  const [tables, setTables] = useState<string[]>([]);
  const [selectedTable, setSelectedTable] = useState<string>("restaurantes");
  const [rows, setRows] = useState<any[]>([]);
  const [searchTerm, setSearchTerm] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isBackingUp, setIsBackingUp] = useState(false);
  const [backupResult, setBackupResult] = useState<{ filename: string; size: string } | null>(null);
  
  // Inline edit state
  const [editingCell, setEditingCell] = useState<{ rowId: string; colKey: string } | null>(null);
  const [editValue, setEditValue] = useState("");
  const [saveStatus, setSaveStatus] = useState<{ rowId: string; colKey: string; success: boolean } | null>(null);
  const [dbEditError, setDbEditError] = useState<string | null>(null);
  const [deletingRowId, setDeletingRowId] = useState<string | null>(null);
  const isCancelingRef = useRef(false);

  // New Row & Column Modal States
  const [isAddRowOpen, setIsAddRowOpen] = useState(false);
  const [newRowPayload, setNewRowPayload] = useState<any>({});
  const [isAddColumnOpen, setIsAddColumnOpen] = useState(false);
  const [newColumnData, setNewColumnData] = useState({ name: "", type: "text" });
  const [sqlSuggestion, setSqlSuggestion] = useState<{ query: string; message: string } | null>(null);
  const [toast, setToast] = useState<{ message: string; type: "success" | "error" } | null>(null);

  // Audit and Confirmations States
  const [activeTab, setActiveTab] = useState<"spreadsheet" | "audit">("spreadsheet");
  const [auditLogs, setAuditLogs] = useState<any[]>([]);
  const [isFetchingAudit, setIsFetchingAudit] = useState(false);
  const [pendingCellEdit, setPendingCellEdit] = useState<{
    rowId: string;
    colKey: string;
    oldValue: any;
    newValue: any;
  } | null>(null);
  const [showColumnConfirm, setShowColumnConfirm] = useState(false);

  // Dynamic table column models from PostgreSQL / memory fallback
  const [tableColumns, setTableColumns] = useState<{ name: string; type: string }[]>([]);

  // Fetch list of available tables
  const fetchTables = async () => {
    const ALLOWED_TABLES = [
      "restaurantes",
      "configuracoes_restaurante",
      "configuracoes_ia",
      "comandas",
      "failed_webhooks"
    ];
    try {
      const res = await fetch("/api/super-admin/db/tables");
      if (res.ok) {
        const data = await res.json();
        // Filter tables to only allow the requested 6 tables
        const filtered = data.filter((t: string) => ALLOWED_TABLES.includes(t.toLowerCase()));
        setTables(filtered.length > 0 ? filtered : ALLOWED_TABLES);
      } else {
        setTables(ALLOWED_TABLES);
      }
    } catch {
      setTables(ALLOWED_TABLES);
    }
  };

  // Fetch rows and schema for a selected table
  const fetchTableData = async (tableName: string) => {
    setIsLoading(true);
    setBackupResult(null);
    setDeletingRowId(null);
    try {
      // 1. Fetch exact physical table schema/columns first
      const schemaRes = await fetch(`/api/super-admin/db/${tableName}/schema`);
      let columnsData: { name: string; type: string }[] = [];
      if (schemaRes.ok) {
        const schemaJson = await schemaRes.json();
        columnsData = schemaJson.columns || [];
        setTableColumns(columnsData);
      }

      // 2. Fetch table rows
      const res = await fetch(`/api/super-admin/db/${tableName}`);
      if (res.ok) {
        const data = await res.json();
        setRows(data);

        // Fallback schema discovery in case schema endpoint failed or returned empty
        if (columnsData.length === 0 && data.length > 0) {
          const keys = Object.keys(data[0]);
          const idCol = keys.includes("id") ? { name: "id", type: "text" } : null;
          const otherCols = keys.filter(k => k !== "id" && k !== "created_at" && k !== "criado_em").map(key => ({
            name: key,
            type: typeof data[0][key] === "boolean" ? "boolean" : typeof data[0][key] === "number" ? "numeric" : "text"
          }));
          const fallbackCols = idCol ? [idCol, ...otherCols] : otherCols;
          setTableColumns(fallbackCols);
        }
      }
    } catch (err) {
      console.error("Error fetching table data:", err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchTables();
  }, []);

  useEffect(() => {
    fetchTableData(selectedTable);
  }, [selectedTable]);

  // Handle cell edit save - Wrap with Confirmation Modal
  const handleSaveCell = async (rowId: string, colKey: string, finalValue: any) => {
    setEditingCell(null);
    
    // Find item to compare and do simple local validation
    const item = rows.find(r => r.id === rowId);
    if (!item) return;

    if (item[colKey] === finalValue) return; // No change

    // Intercept to show confirmation modal before physical API write
    setPendingCellEdit({
      rowId,
      colKey,
      oldValue: item[colKey],
      newValue: finalValue
    });
  };

  const executeSaveCell = async (rowId: string, colKey: string, finalValue: any) => {
    try {
      const res = await fetch(`/api/super-admin/db/${selectedTable}/${rowId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [colKey]: finalValue })
      });

      if (res.ok) {
        const data = await res.json();
        // Update local rows
        setRows(prev => prev.map(r => r.id === rowId ? { ...r, ...data.item } : r));
        setSaveStatus({ rowId, colKey, success: true });
        setDbEditError(null);
        onAddLog(`Tabela '${selectedTable}' alterada: id ${rowId} -> ${colKey} = ${finalValue}`, "success");
        setToast({ message: "🎉 Gravado com sucesso no Supabase!", type: "success" });
        
        // If we edited the restaurantes table, notify parent to refresh its stats/list
        if (selectedTable === "restaurantes" && refreshTenantsList) {
          refreshTenantsList();
        }

        setTimeout(() => {
          setSaveStatus(null);
          setToast(null);
        }, 2500);
      } else {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(errorData.error || "Erro de restrição ou formato no banco de dados.");
      }
    } catch (err: any) {
      setSaveStatus({ rowId, colKey, success: false });
      const msg = err.message || "Erro de conexão ou gravação.";
      setDbEditError(`Falha ao gravar no Supabase na coluna '${colKey}': ${msg}`);
      onAddLog(`Erro ao persistir na tabela '${selectedTable}': id ${rowId} (${msg})`, "error");
      setTimeout(() => setSaveStatus(null), 3000);
    }
  };

  // Fetch Audit Logs
  const fetchAuditLog = async () => {
    setIsFetchingAudit(true);
    try {
      const res = await fetch("/api/super-admin/db/audit-log");
      if (res.ok) {
        const data = await res.json();
        setAuditLogs(data);
      }
    } catch (err) {
      console.error("Error fetching audit logs:", err);
    } finally {
      setIsFetchingAudit(false);
    }
  };

  // Handle adding a new row
  const handleInsertRow = async (e: React.FormEvent) => {
    e.preventDefault();
    setDbEditError(null);

    // Filter fields to exclude auto-generated ones
    const isProtectedField = (name: string) => {
      const lowercase = name.toLowerCase();
      return lowercase === "id" || lowercase === "created_at" || lowercase === "criado_em";
    };
    const editableColumns = tableColumns.filter(col => !isProtectedField(col.name));

    // Regra C: Validate types and required values before triggering the insert command
    const sanitizedPayload: any = {};
    for (const col of editableColumns) {
      let val = newRowPayload[col.name];
      
      // Numeric or Integer Validation
      if (col.type === "numeric" || col.type === "integer") {
        if (val !== undefined && val !== null && val !== "") {
          const num = Number(val);
          if (isNaN(num)) {
            setDbEditError(`O campo '${col.name}' deve ser um número válido.`);
            return;
          }
          sanitizedPayload[col.name] = num;
        } else {
          sanitizedPayload[col.name] = 0;
        }
      } 
      // Boolean validation
      else if (col.type === "boolean") {
        sanitizedPayload[col.name] = val === true || val === "true" || val === 1 || val === "1";
      } 
      // Text and strings
      else {
        if (!val) {
          // Check if it is a common crucial required field
          if (col.name === "name" || col.name === "subdomain" || col.name === "restaurante_id") {
            setDbEditError(`O campo '${col.name}' é obrigatório.`);
            return;
          }
          sanitizedPayload[col.name] = "";
        } else {
          sanitizedPayload[col.name] = String(val);
        }
      }
    }

    try {
      const res = await fetch(`/api/super-admin/db/${selectedTable}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(sanitizedPayload)
      });

      if (res.ok) {
        const data = await res.json();
        setRows(prev => [...prev, data.item]);
        setIsAddRowOpen(false);
        setNewRowPayload({});
        onAddLog(`Registro inserido com sucesso na tabela '${selectedTable}': ID ${data.item.id}`, "success");
        if (selectedTable === "restaurantes" && refreshTenantsList) {
          refreshTenantsList();
        }
      } else {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(errorData.error || "Falha ao persistir inserção no Supabase.");
      }
    } catch (err: any) {
      const msg = err.message || "Erro inesperado ao inserir registro.";
      setDbEditError(`Falha ao inserir no Supabase: ${msg}`);
      onAddLog(`Erro ao inserir na tabela '${selectedTable}': ${msg}`, "error");
    }
  };

  // Handle instant deleting of a row (Optimistic UI Update)
  const handleDeleteRow = async (rowId: string) => {
    setDeletingRowId(null);
    const rowToRestore = rows.find(r => r.id === rowId);
    if (!rowToRestore) return;

    // Backup current rows for potential rollback
    const originalRows = [...rows];

    // Optimistic UI update: remove row immediately from screen
    setRows(prev => prev.filter(r => r.id !== rowId));
    onAddLog(`Tabela '${selectedTable}': Removendo registro ${rowId} (Otimista)...`, "info");

    try {
      const res = await fetch(`/api/super-admin/db/${selectedTable}/${rowId}`, {
        method: "DELETE"
      });

      if (res.ok) {
        onAddLog(`Registro ${rowId} excluído com sucesso da tabela '${selectedTable}'.`, "success");
        setDbEditError(null);
        if (selectedTable === "restaurantes" && refreshTenantsList) {
          refreshTenantsList();
        }
      } else {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(errorData.error || "Erro de restrição de integridade (PostgreSQL) ou permissão.");
      }
    } catch (err: any) {
      // Revert optimistic update immediately
      setRows(originalRows);
      const msg = err.message || "Erro de conexão.";
      setDbEditError(`Falha ao excluir o registro '${rowId}': ${msg}`);
      onAddLog(`Erro ao excluir na tabela '${selectedTable}': ID ${rowId} (${msg})`, "error");
    }
  };

  // Handle adding a new column - Intercept with DDL Confirm
  const handleCreateColumn = async (e: React.FormEvent) => {
    e.preventDefault();
    setDbEditError(null);
    setSqlSuggestion(null);

    const { name: colName } = newColumnData;
    if (!colName.trim()) {
      setDbEditError("O nome da coluna não pode estar em branco.");
      return;
    }

    // Intercept to show warning before physical database schema update (ALTER TABLE)
    setShowColumnConfirm(true);
  };

  const executeCreateColumn = async () => {
    setShowColumnConfirm(false);
    setDbEditError(null);
    setSqlSuggestion(null);

    const { name: colName, type: colType } = newColumnData;
    try {
      const res = await fetch(`/api/super-admin/db/${selectedTable}/column`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ columnName: colName, columnType: colType })
      });

      if (res.ok) {
        const data = await res.json();
        setIsAddColumnOpen(false);
        setNewColumnData({ name: "", type: "text" });
        
        // Refresh table data to reflect new column structure
        await fetchTableData(selectedTable);

        if (data.dbExecuted) {
          onAddLog(`Coluna '${data.columnName}' (${data.columnType}) adicionada fisicamente ao Supabase!`, "success");
        } else {
          setSqlSuggestion({
            query: data.sqlCommand,
            message: data.message
          });
          onAddLog(`Coluna '${data.columnName}' expandida em tempo real na memória.`, "warning");
        }
      } else {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(errorData.error || "Erro de schema no banco de dados.");
      }
    } catch (err: any) {
      const msg = err.message || "Erro ao adicionar coluna.";
      setDbEditError(`Falha ao criar coluna: ${msg}`);
      onAddLog(`Erro ao adicionar coluna à tabela '${selectedTable}': ${msg}`, "error");
    }
  };

  // Trigger quick database backup before manual edits
  const handleBackup = async () => {
    setIsBackingUp(true);
    setBackupResult(null);
    try {
      const res = await fetch("/api/super-admin/db/backup", { method: "POST" });
      if (res.ok) {
        const data = await res.json();
        setBackupResult({ filename: data.filename, size: data.size });
        onAddLog(`Backup de segurança gerado: ${data.filename}`, "success");
      }
    } catch (err) {
      onAddLog("Falha ao gerar backup de segurança das tabelas", "critical");
    } finally {
      setIsBackingUp(false);
    }
  };

  // Filter rows based on search
  const filteredRows = rows.filter(row => {
    if (!searchTerm) return true;
    const term = searchTerm.toLowerCase();
    return Object.values(row).some(val => 
      String(val).toLowerCase().includes(term)
    );
  });

  const headers = tableColumns.map(col => col.name);

  return (
    <div className="space-y-6" id="superadmin-db-editor">
      
      {/* Header and Controls */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-[#121420] border border-[#1e293b]/40 p-4 rounded">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-emerald-950/20/40 border border-[#00b894]/20 rounded">
            <Database className="w-5 h-5 text-[#00b894]" />
          </div>
          <div>
            <h3 className="text-sm font-mono text-white font-bold flex items-center gap-2">
              EDITOR VISUAL DO BANCO DE DADOS (SUPABASE REAL)
            </h3>
            <p className="text-[10px] text-slate-500 font-mono mt-0.5">
              PLANILHA OPERACIONAL COM PERSISTÊNCIA DIRETA E VALIDAÇÃO ESTRITA DE ENUM/TIPOS
            </p>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={() => {
              const defaultPayload: any = {};
              tableColumns.forEach(col => {
                const lowercase = col.name.toLowerCase();
                if (lowercase === "id" || lowercase === "created_at" || lowercase === "criado_em") return;
                defaultPayload[col.name] = col.type === "boolean" ? false : col.type === "integer" || col.type === "numeric" ? 0 : "";
              });
              setNewRowPayload(defaultPayload);
              setIsAddRowOpen(true);
            }}
            className="bg-[#00b894] hover:bg-[#059669] text-black px-3 py-2 rounded cursor-pointer text-xs font-mono font-bold flex items-center gap-1.5 shadow-[0_0_8px_rgba(16,185,129,0.2)] transition-all"
            title="Adicionar uma nova linha de dados a esta tabela"
          >
            <Plus className="w-3.5 h-3.5 text-black stroke-[3px]" />
            NOVO REGISTRO
          </button>

          <button
            onClick={() => {
              setNewColumnData({ name: "", type: "text" });
              setIsAddColumnOpen(true);
            }}
            className="bg-black border border-[#1e293b]/40 hover:border-slate-600 p-2 rounded text-slate-300 hover:text-white cursor-pointer text-xs font-mono font-bold flex items-center gap-1.5 transition-colors"
            title="Adicionar uma nova coluna de dados na tabela"
          >
            <Plus className="w-3.5 h-3.5 text-[#00b894]" />
            NOVA COLUNA
          </button>

          <button
            onClick={handleBackup}
            disabled={isBackingUp}
            className="bg-black border border-[#1e293b]/40 hover:border-slate-700 hover:bg-[#121420]/40 p-2 rounded text-slate-400 hover:text-white transition-all cursor-pointer text-xs font-mono font-bold flex items-center gap-1.5 shadow-[0_0_8px_rgba(0,0,0,0.5)]"
            title="Executar backup instantâneo de segurança"
          >
            {isBackingUp ? (
              <RefreshCw className="w-3.5 h-3.5 animate-spin text-[#00b894]" />
            ) : (
              <Download className="w-3.5 h-3.5 text-amber-500" />
            )}
            {isBackingUp ? "GERANDO BACKUP..." : "BACKUP RÁPIDO"}
          </button>

          <button
            onClick={() => fetchTableData(selectedTable)}
            disabled={isLoading}
            className="bg-black border border-[#1e293b]/40 hover:border-[#334155] p-2 rounded text-slate-400 hover:text-white transition-colors cursor-pointer"
            title="Recarregar dados"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? "animate-spin text-[#00b894]" : ""}`} />
          </button>
        </div>
      </div>

      {/* Backup Notification Banner */}
      <AnimatePresence>
        {backupResult && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="bg-[#00b894]/10 border border-[#00b894]/50 p-3.5 rounded flex items-center justify-between text-xs font-mono"
          >
            <div className="flex items-center gap-2.5">
              <CheckCircle className="w-4 h-4 text-[#00b894]" />
              <div>
                <span className="text-[#00b894] font-bold">SEGURANÇA_DUMP:</span> SQL dump gerado com sucesso para proteção de escrita.
                <div className="text-[10px] text-slate-400 mt-0.5">
                  Arquivo: <span className="text-white font-bold">{backupResult.filename}</span> • Tamanho: <span className="text-amber-400 font-bold">{backupResult.size}</span>
                </div>
              </div>
            </div>
            <button 
              onClick={() => setBackupResult(null)}
              className="text-slate-500 hover:text-white text-[10px] font-bold underline cursor-pointer"
            >
              FECHAR
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Error Notification Banner */}
      <AnimatePresence>
        {dbEditError && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="bg-red-950/40 border border-red-500/50 p-3.5 rounded flex items-center justify-between text-xs font-mono text-red-200"
          >
            <div className="flex items-center gap-2.5">
              <AlertCircle className="w-4 h-4 text-red-500 shrink-0" />
              <div>
                <span className="text-red-400 font-bold">ERRO_GRAVAÇÃO_SUPABASE:</span> {dbEditError}
              </div>
            </div>
            <button 
              onClick={() => setDbEditError(null)}
              className="text-red-400 hover:text-white text-[10px] font-bold underline ml-4 shrink-0 cursor-pointer"
            >
              FECHAR
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* SQL Suggestion Banner */}
      <AnimatePresence>
        {sqlSuggestion && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="bg-amber-950/40 border border-amber-500/50 p-4 rounded text-xs font-mono text-amber-200 space-y-2.5 shadow-[0_0_15px_rgba(245,158,11,0.1)]"
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <ShieldAlert className="w-4 h-4 text-amber-400 shrink-0" />
                <span className="text-amber-400 font-bold uppercase tracking-wider">AÇÃO NECESSÁRIA NO SUPABASE:</span>
              </div>
              <button 
                onClick={() => setSqlSuggestion(null)}
                className="text-amber-400 hover:text-white text-[10px] font-bold underline cursor-pointer"
              >
                OCULTAR
              </button>
            </div>
            <p className="text-[11px] leading-relaxed text-slate-300">
              {sqlSuggestion.message}
            </p>
            <div className="bg-black/80 border border-[#1e293b]/40 p-3 rounded text-white relative font-mono text-[11px] overflow-x-auto">
              <code>{sqlSuggestion.query}</code>
              <button
                onClick={() => {
                  navigator.clipboard.writeText(sqlSuggestion.query);
                  onAddLog("Script SQL copiado com sucesso para o clipboard!", "success");
                }}
                className="absolute right-2 top-2 bg-[#1a1f2e] border border-[#334155] hover:bg-black hover:text-[#00b894] px-2 py-1 rounded text-[9px] font-bold cursor-pointer transition-colors"
              >
                COPIAR SQL
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Tab Switcher */}
      <div className="flex border-b border-[#1e293b]/40 gap-6 text-[11px] font-mono font-bold pb-2">
        <button
          onClick={() => setActiveTab("spreadsheet")}
          className={`pb-2 px-1 cursor-pointer border-b-2 transition-all ${
            activeTab === "spreadsheet" 
              ? "text-[#00b894] border-[#00b894]" 
              : "text-slate-400 border-transparent hover:text-white"
          }`}
        >
          [ PLANILHA DE DADOS ]
        </button>
        <button
          onClick={() => {
            setActiveTab("audit");
            fetchAuditLog();
          }}
          className={`pb-2 px-1 cursor-pointer border-b-2 transition-all flex items-center gap-1.5 ${
            activeTab === "audit" 
              ? "text-amber-500 border-amber-500" 
              : "text-slate-400 border-transparent hover:text-white"
          }`}
        >
          <History className="w-3.5 h-3.5 shrink-0" />
          [ HISTÓRICO DE AÇÕES / AUDITORIA ]
        </button>
      </div>

      {activeTab === "spreadsheet" ? (
        <>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        
        {/* Table selector panel */}
        <div className="md:col-span-1 bg-[#121420] border border-[#1e293b]/40 p-4 rounded flex flex-col space-y-3">
          <span className="text-[10px] font-mono text-slate-500 uppercase tracking-widest border-b border-[#1e293b]/40 pb-1.5 font-bold flex items-center gap-1.5">
            <Table2 className="w-3.5 h-3.5 text-[#00b894]" />
            TABELAS_POSTGRES
          </span>
          <div className="space-y-1.5 flex-1">
            {tables.map(tbl => (
              <button
                key={tbl}
                onClick={() => setSelectedTable(tbl)}
                className={`w-full text-left font-mono text-xs px-3 py-2 rounded transition-all cursor-pointer flex flex-col justify-center space-y-0.5 ${
                  selectedTable === tbl 
                    ? "bg-[#1a1f2e] text-[#00b894] border-l-2 border-[#00b894] font-bold" 
                    : "text-slate-400 hover:bg-black/40 hover:text-white"
                }`}
              >
                <span className="truncate">{tbl.toUpperCase()}</span>
                <span className="text-[9px] text-slate-500 font-sans block truncate">
                  {tbl === "restaurantes" ? "Planos, status e whitelabel" 
                   : tbl === "configuracoes_restaurante" ? "Ajustes de permissões e regras"
                   : tbl === "configuracoes_ia" ? "Parâmetros do assistente virtual"
                   : tbl === "activity_logs" ? "Auditoria de logs de suporte"
                   : tbl === "comandas" ? "Checagem de faturamento e volumes"
                   : tbl === "failed_webhooks" ? "Falhas de pagamento do Asaas"
                   : "Tabela de dados"}
                </span>
              </button>
            ))}
          </div>
          <div className="bg-black/40 border border-[#1e293b]/40 p-2.5 rounded text-[9px] text-slate-500 space-y-1">
            <span className="text-white opacity-40 font-bold block uppercase">Como editar:</span>
            <p>1. Clique duas vezes em qualquer célula de dados.</p>
            <p>2. Digite o novo valor desejado.</p>
            <p>3. Pressione <span className="text-white font-bold">ENTER</span> para salvar ou clique fora para cancelar.</p>
          </div>
        </div>

        {/* Main Grid spreadsheet table panel */}
        <div className="md:col-span-3 bg-[#121420] border border-[#1e293b]/40 p-4 rounded flex flex-col min-h-[380px]" id="db-grid-container">
          
          {/* Grid filter bar */}
          <div className="flex items-center justify-between gap-3 mb-4">
            <div className="relative flex-1 max-w-sm">
              <Search className="w-3.5 h-3.5 text-slate-500 absolute left-2.5 top-2.5" />
              <input
                type="text"
                placeholder={`Pesquisar na tabela ${selectedTable}...`}
                className="w-full bg-black border border-[#1e293b]/40 rounded pl-8 pr-3 py-1.5 text-xs font-mono text-white focus:outline-none focus:border-[#00b894]"
                value={searchTerm}
                onChange={e => setSearchTerm(e.target.value)}
              />
            </div>
            <div className="text-[10px] text-slate-500 font-mono">
              MOSTRANDO: <span className="text-[#00b894] font-bold">{filteredRows.length}</span> / {rows.length} REGISTROS
            </div>
          </div>

          {/* Grid spreadsheet viewport */}
          <div className="overflow-x-auto flex-1 border border-zinc-950 rounded bg-black">
            {isLoading ? (
              <div className="flex flex-col items-center justify-center py-20 text-slate-500">
                <RefreshCw className="w-8 h-8 animate-spin text-[#00b894] mb-2" />
                <span className="font-mono text-xs">Consultando banco de dados...</span>
              </div>
            ) : rows.length === 0 ? (
              <div className="text-center py-20 text-slate-600 font-mono text-xs italic">
                Nenhum registro encontrado nesta tabela.
              </div>
            ) : (
              <table className="w-full text-left font-mono text-xs border-collapse">
                <thead>
                  <tr className="border-b border-[#1e293b]/40 bg-[#090c15]">
                    {headers.map(header => (
                      <th 
                        key={header} 
                        className="p-2.5 font-bold text-slate-400 text-[10px] uppercase border-r border-[#1e293b]/40 bg-[#121420] shrink-0"
                      >
                        {header}
                      </th>
                    ))}
                    <th className="p-2.5 font-bold text-[#00b894] text-[10px] uppercase bg-[#121420] text-center w-[110px] shrink-0">
                      Ações
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-900 text-slate-300">
                  {filteredRows.map((row) => (
                    <tr key={row.id} className="hover:bg-[#1a1f2e]/20 transition-colors">
                      {headers.map((header) => {
                        const isEditing = editingCell?.rowId === row.id && editingCell?.colKey === header;
                        const isSaving = saveStatus?.rowId === row.id && saveStatus?.colKey === header;
                        const hasIdHeader = header === "id";

                        // Cast cell contents
                        let displayVal = String(row[header] !== undefined && row[header] !== null ? row[header] : "");
                        if (typeof row[header] === "boolean") {
                          displayVal = row[header] ? "TRUE" : "FALSE";
                        }

                        // Apply LGPD masking for comandas table
                        if (selectedTable === "comandas" && row[header]) {
                          if (header === "delivery_telefone") {
                            displayVal = "(XX) 999**-**88";
                          } else if (header === "delivery_endereco") {
                            const valStr = String(row[header]);
                            if (valStr.includes(",")) {
                              const parts = valStr.split(",");
                              displayVal = `${parts[0].trim()}, 12...`;
                            } else {
                              displayVal = valStr.length > 15 ? `${valStr.substring(0, 15)}...` : `${valStr}...`;
                            }
                          }
                        }

                        return (
                          <td 
                            key={header} 
                            className={`p-2 border-r border-zinc-950 relative min-w-[120px] max-w-[240px] truncate ${
                              hasIdHeader ? "bg-[#121420]/50 font-bold text-slate-500 text-[10px] select-all cursor-copy" : "cursor-pointer"
                            }`}
                            onDoubleClick={() => {
                              if (!hasIdHeader) {
                                if (selectedTable === "comandas" && (header === "delivery_telefone" || header === "delivery_endereco")) {
                                  onAddLog("Acesso negado (LGPD): Edição de dados pessoais de clientes é restrita.", "warning");
                                  return;
                                }
                                isCancelingRef.current = false;
                                setEditingCell({ rowId: row.id, colKey: header });
                                setEditValue(String(row[header]));
                              }
                            }}
                            title={hasIdHeader ? "ID não editável" : "Clique duas vezes para editar"}
                          >
                            {isEditing ? (
                              <div className="absolute inset-0 z-10 p-1 bg-black">
                                <input
                                  type="text"
                                  className="w-full h-full bg-zinc-900 border border-[#00b894] px-1.5 text-xs text-white font-mono rounded focus:outline-none focus:ring-1 focus:ring-[#00b894]"
                                  value={editValue}
                                  onChange={e => setEditValue(e.target.value)}
                                  onKeyDown={(e) => {
                                    if (e.key === "Enter") {
                                      let parsedVal: any = editValue;
                                      if (typeof row[header] === "boolean") {
                                        parsedVal = editValue.toLowerCase() === "true" || editValue === "1";
                                      } else if (typeof row[header] === "number") {
                                        parsedVal = Number(editValue);
                                      }
                                      handleSaveCell(row.id, header, parsedVal);
                                    } else if (e.key === "Escape") {
                                      isCancelingRef.current = true;
                                      setEditingCell(null);
                                    }
                                  }}
                                  onBlur={() => {
                                    if (isCancelingRef.current) return;
                                    let parsedVal: any = editValue;
                                    if (typeof row[header] === "boolean") {
                                      parsedVal = editValue.toLowerCase() === "true" || editValue === "1";
                                    } else if (typeof row[header] === "number") {
                                      parsedVal = Number(editValue);
                                    }
                                    handleSaveCell(row.id, header, parsedVal);
                                  }}
                                  autoFocus
                                />
                              </div>
                            ) : (
                              <div className="flex items-center justify-between group">
                                <span className={`${
                                  typeof row[header] === "boolean" 
                                    ? row[header] ? "text-[#00b894] font-bold" : "text-red-500 font-bold"
                                    : typeof row[header] === "number" && header === "price"
                                    ? "text-[#00b894] font-bold"
                                    : "text-slate-300"
                                }`}>
                                  {header === "price" || header === "monthlyBilling"
                                    ? `R$ ${Number(row[header]).toFixed(2)}`
                                    : displayVal}
                                </span>

                                {!hasIdHeader && (
                                  <span className="opacity-0 group-hover:opacity-40 text-[9px] text-slate-500 select-none">
                                    [edit]
                                  </span>
                                )}

                                {/* Save feedback indicators */}
                                {isSaving && (
                                  <span className={`absolute right-1 top-1 text-[8px] font-bold px-1 rounded animate-fade-in ${
                                    saveStatus.success ? "bg-emerald-950/20 text-[#00b894] border border-[#00b894]/20" : "bg-red-950 text-red-400 border border-red-900"
                                  }`}>
                                    {saveStatus.success ? "SAVED" : "FAIL"}
                                  </span>
                                )}
                              </div>
                            )}
                          </td>
                        );
                      })}
                      {/* Action Column Cell */}
                      <td className="p-2 text-center bg-[#121420]/25 border-l border-[#1e293b]/40 w-[110px] shrink-0">
                        {deletingRowId === row.id ? (
                          <div className="flex items-center justify-center gap-1.5 font-sans">
                            <span className="text-[9px] text-amber-500 font-bold font-mono">Apagar?</span>
                            <button
                              onClick={() => handleDeleteRow(row.id)}
                              className="bg-red-950 text-red-400 hover:bg-red-900 border border-red-800 px-1 py-0.5 rounded text-[9px] font-bold cursor-pointer transition-colors"
                            >
                              Sim
                            </button>
                            <button
                              onClick={() => setDeletingRowId(null)}
                              className="bg-zinc-800 text-slate-400 hover:bg-zinc-700 px-1 py-0.5 rounded text-[9px] font-bold cursor-pointer transition-colors"
                            >
                              Não
                            </button>
                          </div>
                        ) : (
                          <button
                            onClick={() => setDeletingRowId(row.id)}
                            className="text-red-500 hover:text-red-400 cursor-pointer p-1 rounded hover:bg-red-950/30 transition-colors inline-flex items-center justify-center"
                            title="Excluir este registro permanentemente"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>

      {/* Modal: Add Row */}
      <AnimatePresence>
        {isAddRowOpen && (
          <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <motion.div 
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-[#050814] border border-[#1e293b]/40 rounded-lg max-w-lg w-full p-5 font-mono text-xs text-slate-300 space-y-4 shadow-[0_0_30px_rgba(0,0,0,0.8)]"
            >
              <div className="flex items-center justify-between border-b border-[#1e293b]/40 pb-3">
                <span className="text-[#00b894] font-bold uppercase tracking-wider flex items-center gap-1.5">
                  <Plus className="w-4 h-4" /> INSERIR REGISTRO: {selectedTable.toUpperCase()}
                </span>
                <button 
                  type="button"
                  onClick={() => setIsAddRowOpen(false)}
                  className="text-slate-500 hover:text-white cursor-pointer"
                >
                  [FECHAR]
                </button>
              </div>

              <form onSubmit={handleInsertRow} className="space-y-4">
                <div className="grid grid-cols-1 gap-3 max-h-[350px] overflow-y-auto pr-1">
                  {tableColumns
                    .filter(col => {
                      const lowercase = col.name.toLowerCase();
                      return lowercase !== "id" && lowercase !== "created_at" && lowercase !== "criado_em";
                    })
                    .map((col) => {
                      const isBool = col.type === "boolean";
                      const isNum = col.type === "numeric" || col.type === "integer";

                      return (
                        <div key={col.name} className="space-y-1">
                          <label className="text-slate-400 font-bold uppercase tracking-wide text-[10px] block">
                            {col.name} {isNum ? "(NÚMERO)" : isBool ? "(BOLEANO)" : "(TEXTO)"}
                          </label>
                          {isBool ? (
                            <select
                              className="w-full bg-black border border-[#1e293b]/40 rounded p-2 text-xs font-mono text-white focus:outline-none focus:border-[#00b894]"
                              value={String(newRowPayload[col.name] ?? false)}
                              onChange={(e) => setNewRowPayload({ ...newRowPayload, [col.name]: e.target.value === "true" })}
                            >
                              <option value="true">TRUE</option>
                              <option value="false">FALSE</option>
                            </select>
                          ) : (
                            <input
                              type={isNum ? "number" : "text"}
                              step={isNum ? "any" : undefined}
                              className="w-full bg-black border border-[#1e293b]/40 rounded p-2 text-xs font-mono text-white focus:outline-none focus:border-[#00b894]"
                              placeholder={`Inserir valor para ${col.name}...`}
                              value={newRowPayload[col.name] ?? ""}
                              onChange={(e) => {
                                let val: any = e.target.value;
                                if (isNum && e.target.value !== "") val = Number(e.target.value);
                                setNewRowPayload({ ...newRowPayload, [col.name]: val });
                              }}
                              required={col.name === "name" || col.name === "subdomain" || col.name === "number" || col.name === "restaurante_id"}
                            />
                          )}
                        </div>
                      );
                    })}
                </div>

                <div className="flex items-center justify-end gap-2 pt-3 border-t border-[#1e293b]/40">
                  <button
                    type="button"
                    onClick={() => setIsAddRowOpen(false)}
                    className="px-3.5 py-2 rounded bg-black border border-[#1e293b]/40 hover:border-slate-600 text-slate-400 hover:text-white cursor-pointer"
                  >
                    CANCELAR
                  </button>
                  <button
                    type="submit"
                    className="px-4 py-2 rounded bg-[#00b894] hover:bg-[#059669] text-black font-bold cursor-pointer shadow-[0_0_10px_rgba(16,185,129,0.3)]"
                  >
                    CONFIRMAR INSERÇÃO
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Modal: Add Column */}
      <AnimatePresence>
        {isAddColumnOpen && (
          <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <motion.div 
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-[#050814] border border-[#1e293b]/40 rounded-lg max-w-sm w-full p-5 font-mono text-xs text-slate-300 space-y-4 shadow-[0_0_30px_rgba(0,0,0,0.8)]"
            >
              <div className="flex items-center justify-between border-b border-[#1e293b]/40 pb-3">
                <span className="text-amber-500 font-bold uppercase tracking-wider flex items-center gap-1.5">
                  <Plus className="w-4 h-4 text-[#00b894]" /> ADICIONAR COLUNA: {selectedTable.toUpperCase()}
                </span>
                <button 
                  type="button"
                  onClick={() => setIsAddColumnOpen(false)}
                  className="text-slate-500 hover:text-white cursor-pointer"
                >
                  [FECHAR]
                </button>
              </div>

              <form onSubmit={handleCreateColumn} className="space-y-4">
                <div className="space-y-3">
                  <div className="space-y-1">
                    <label className="text-slate-400 font-bold uppercase tracking-wide text-[10px] block">
                      Nome da Coluna
                    </label>
                    <input
                      type="text"
                      className="w-full bg-black border border-[#1e293b]/40 rounded p-2 text-xs font-mono text-white focus:outline-none focus:border-[#00b894]"
                      placeholder="Ex: address, rating, thumbnail..."
                      value={newColumnData.name}
                      onChange={(e) => setNewColumnData({ ...newColumnData, name: e.target.value })}
                      required
                      autoFocus
                    />
                    <span className="text-[9px] text-slate-500 block">
                      Apenas letras minúsculas, números e underline (_).
                    </span>
                  </div>

                  <div className="space-y-1">
                    <label className="text-slate-400 font-bold uppercase tracking-wide text-[10px] block">
                      Tipo de Dado (PostgreSQL)
                    </label>
                    <select
                      className="w-full bg-black border border-[#1e293b]/40 rounded p-2 text-xs font-mono text-white focus:outline-none focus:border-[#00b894]"
                      value={newColumnData.type}
                      onChange={(e) => setNewColumnData({ ...newColumnData, type: e.target.value })}
                    >
                      <option value="text">TEXT (Texto / String)</option>
                      <option value="integer">INTEGER (Número Inteiro)</option>
                      <option value="numeric">NUMERIC (Número Decimal)</option>
                      <option value="boolean">BOOLEAN (Booleano / Sim-Não)</option>
                    </select>
                  </div>
                </div>

                <div className="flex items-center justify-end gap-2 pt-3 border-t border-[#1e293b]/40">
                  <button
                    type="button"
                    onClick={() => setIsAddColumnOpen(false)}
                    className="px-3.5 py-2 rounded bg-black border border-[#1e293b]/40 hover:border-slate-600 text-slate-400 hover:text-white cursor-pointer"
                  >
                    CANCELAR
                  </button>
                  <button
                    type="submit"
                    className="px-4 py-2 rounded bg-amber-500 hover:bg-amber-600 text-black font-bold cursor-pointer"
                  >
                    CRIAR COLUNA
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

        </>
      ) : (
        <div className="bg-[#121420] border border-[#1e293b]/40 p-5 rounded space-y-4 font-mono text-xs text-slate-300">
          <div className="flex items-center justify-between border-b border-[#1e293b]/40 pb-3">
            <div className="flex items-center gap-2">
              <History className="w-5 h-5 text-amber-500" />
              <div>
                <h4 className="text-sm font-bold text-white uppercase">[AUDIT_LOG_STREAM] REGISTRO CENTRAL DE AUDITORIA</h4>
                <p className="text-[10px] text-slate-500 mt-0.5">ÚLTIMAS 50 AÇÕES DE ESCRITA, ALTERAÇÃO E DDL EXECUTADAS NO SISTEMA</p>
              </div>
            </div>
            <button
              onClick={fetchAuditLog}
              disabled={isFetchingAudit}
              className="bg-black hover:bg-zinc-950 border border-slate-800 text-slate-300 hover:text-white px-3 py-1.5 rounded cursor-pointer transition-all flex items-center gap-1.5"
            >
              <RefreshCw className={`w-3.5 h-3.5 text-amber-500 ${isFetchingAudit ? "animate-spin" : ""}`} />
              RECARREGAR AUDITORIA
            </button>
          </div>

          {isFetchingAudit ? (
            <div className="py-12 flex flex-col items-center justify-center gap-2 text-slate-500">
              <RefreshCw className="w-6 h-6 animate-spin text-amber-500" />
              <span>Carregando dados da auditoria central...</span>
            </div>
          ) : auditLogs.length === 0 ? (
            <div className="py-12 text-center text-slate-500 bg-black/20 rounded border border-dashed border-[#1e293b]/40">
              Nenhum registro de auditoria encontrado na base de dados central.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-[11px] border-collapse">
                <thead>
                  <tr className="border-b border-[#1e293b] text-slate-400 font-bold bg-black/40">
                    <th className="py-2.5 px-3">DATA/HORA</th>
                    <th className="py-2.5 px-3">OPERADOR</th>
                    <th className="py-2.5 px-3">AÇÃO</th>
                    <th className="py-2.5 px-3">TABELA AFETADA</th>
                    <th className="py-2.5 px-3">CAMPO</th>
                    <th className="py-2.5 px-3">VALOR ANTIGO</th>
                    <th className="py-2.5 px-3">VALOR NOVO</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#1e293b]/40">
                  {auditLogs.slice(0, 50).map((log) => (
                    <tr key={log.id} className="hover:bg-black/30 transition-colors">
                      <td className="py-2.5 px-3 text-slate-400 font-bold whitespace-nowrap">{log.timestamp}</td>
                      <td className="py-2.5 px-3 text-white">
                        <span className="px-1.5 py-0.5 rounded bg-zinc-900 border border-zinc-700/50 text-[10px] text-zinc-300">
                          {log.who}
                        </span>
                      </td>
                      <td className="py-2.5 px-3 font-bold">
                        <span className={`px-1.5 py-0.5 rounded text-[10px] ${
                          log.action.includes("Limpeza") ? "bg-amber-950/40 text-amber-400 border border-amber-900/40" :
                          log.action.includes("Reiniciar") ? "bg-red-950/40 text-red-400 border border-red-900/40" :
                          log.action.includes("Excluir") ? "bg-red-950/40 text-red-400 border border-red-900/40" :
                          log.action.includes("Criar Coluna") ? "bg-cyan-950/40 text-cyan-400 border border-cyan-900/40" :
                          "bg-emerald-950/40 text-emerald-400 border border-emerald-900/40"
                        }`}>
                          {log.action}
                        </span>
                      </td>
                      <td className="py-2.5 px-3 text-slate-400">{log.affected_table}</td>
                      <td className="py-2.5 px-3 font-bold text-slate-300">{log.affected_field}</td>
                      <td className="py-2.5 px-3 text-red-400 max-w-xs truncate" title={String(log.old_value)}>
                        {log.old_value !== null && log.old_value !== undefined ? String(log.old_value) : "-"}
                      </td>
                      <td className="py-2.5 px-3 text-emerald-400 max-w-xs truncate" title={String(log.new_value)}>
                        {log.new_value !== null && log.new_value !== undefined ? String(log.new_value) : "-"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Modal: Confirm Cell Edit */}
      <AnimatePresence>
        {pendingCellEdit && (
          <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4 font-mono text-xs text-slate-300">
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-[#050814] border border-[#1e293b]/40 rounded-lg max-w-md w-full p-5 space-y-4 shadow-[0_0_35px_rgba(0,184,148,0.15)]"
            >
              <div className="flex items-center gap-2 text-[#00b894] font-bold border-b border-[#1e293b]/40 pb-3 uppercase text-sm">
                <ShieldAlert className="w-5 h-5 text-[#00b894] shrink-0" />
                <span>Confirmar Edição de Célula</span>
              </div>
              <p className="leading-relaxed">
                Deseja realmente alterar o campo <strong className="text-white">"{pendingCellEdit.colKey}"</strong> do registro <strong className="text-white">"{pendingCellEdit.rowId}"</strong> na tabela <strong className="text-[#00b894]">"{selectedTable}"</strong>?
              </p>
              <div className="bg-black/60 border border-[#1e293b]/40 p-3 rounded space-y-2 text-[11px]">
                <div>
                  <span className="text-slate-500 block text-[10px] uppercase font-bold">VALOR ANTIGO:</span>
                  <span className="text-red-400 font-bold line-through block truncate">
                    {pendingCellEdit.oldValue !== undefined && pendingCellEdit.oldValue !== null ? String(pendingCellEdit.oldValue) : "(vazio)"}
                  </span>
                </div>
                <div>
                  <span className="text-slate-500 block text-[10px] uppercase font-bold">VALOR NOVO:</span>
                  <span className="text-[#00b894] font-bold block truncate">
                    {pendingCellEdit.newValue !== undefined && pendingCellEdit.newValue !== null ? String(pendingCellEdit.newValue) : "(vazio)"}
                  </span>
                </div>
              </div>
              <div className="flex items-center justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setPendingCellEdit(null)}
                  className="bg-zinc-900 hover:bg-zinc-800 border border-zinc-700/50 px-3 py-2 rounded text-slate-400 hover:text-white cursor-pointer transition-colors"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={async () => {
                    const { rowId, colKey, newValue } = pendingCellEdit;
                    setPendingCellEdit(null);
                    await executeSaveCell(rowId, colKey, newValue);
                  }}
                  className="bg-emerald-950 text-[#00b894] hover:bg-emerald-900 border border-emerald-800 px-4 py-2 rounded font-bold cursor-pointer transition-colors"
                >
                  Confirmar Edição
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Modal: Confirm Column Creation */}
      <AnimatePresence>
        {showColumnConfirm && (
          <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-[60] flex items-center justify-center p-4 font-mono text-xs text-slate-300">
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-[#050814] border border-amber-900/40 rounded-lg max-w-md w-full p-5 space-y-4 shadow-[0_0_35px_rgba(245,158,11,0.15)]"
            >
              <div className="flex items-center gap-2 text-amber-500 font-bold border-b border-[#1e293b]/40 pb-3 uppercase text-sm">
                <ShieldAlert className="w-5 h-5 text-amber-500 shrink-0" />
                <span>Confirmar Criação de Coluna</span>
              </div>
              <p className="leading-relaxed">
                Você tem certeza que deseja criar uma nova coluna física chamada <strong className="text-white">"{newColumnData.name.toLowerCase().replace(/[^a-z0-9_]/g, "")}"</strong> do tipo <strong className="text-white">"{newColumnData.type.toUpperCase()}"</strong> na tabela <strong className="text-[#00b894]">"{selectedTable}"</strong>?
              </p>
              <div className="bg-amber-950/20 border border-amber-900/30 p-3 rounded text-amber-400 text-[11px] leading-relaxed">
                <strong>🚨 Alerta de Alteração de Schema (DDL)</strong>
                <p className="mt-1">
                  Esta ação alterará fisicamente o esquema da tabela no PostgreSQL (Supabase). Colunas adicionadas não podem ser facilmente removidas pela interface e afetarão todos os registros existentes.
                </p>
              </div>
              <div className="flex items-center justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setShowColumnConfirm(false)}
                  className="bg-zinc-900 hover:bg-zinc-800 border border-zinc-700/50 px-3 py-2 rounded text-slate-400 hover:text-white cursor-pointer transition-colors"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={executeCreateColumn}
                  className="bg-amber-950 text-amber-400 hover:bg-amber-900 border border-amber-800 px-4 py-2 rounded font-bold cursor-pointer transition-colors flex items-center gap-1.5"
                >
                  <Plus className="w-3.5 h-3.5" />
                  Confirmar Schema (DDL)
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Real Supabase Save Success Toast */}
      {toast && (
        <div className={`fixed bottom-5 right-5 z-50 flex items-center gap-2 px-4 py-3 rounded border shadow-lg font-mono text-xs animate-bounce ${
          toast.type === "success" 
            ? "bg-emerald-950/90 text-emerald-400 border-emerald-500/50" 
            : "bg-red-950/90 text-red-400 border-red-500/50"
        }`} id="supabase-toast-message">
          <CheckCircle className="w-4 h-4 text-emerald-400 animate-pulse" />
          <span>{toast.message}</span>
        </div>
      )}
    </div>
  );
}
