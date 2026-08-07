/**
 * Serviço de Integração com o Agente de Impressão Nativo Kôma (Localhost 9123).
 * Permite impressão instantânea USB RAW no Windows/Linux sem caixa de diálogo do navegador.
 */

export interface HardwareAgentHealth {
  status: string;
  service: string;
  version: string;
  platform: string;
  port: number;
}

export interface HardwarePrinter {
  name: string;
  is_default?: boolean;
  port?: string;
}

const LOCAL_AGENT_URL = "http://127.0.0.1:9123";

/**
 * Verifica se o Agente de Impressão Nativo Kôma está ativo no computador local.
 */
export async function checkHardwareAgentHealth(): Promise<HardwareAgentHealth | null> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 1200);

    const res = await fetch(`${LOCAL_AGENT_URL}/health`, {
      method: "GET",
      signal: controller.signal,
      headers: { "Accept": "application/json" }
    });

    clearTimeout(timeoutId);
    if (res.ok) {
      const json = await res.json();
      return json;
    }
  } catch {
    // Agente local não ativo (ex: dispositivo móvel do garçom)
  }
  return null;
}

/**
 * Retorna a lista de impressoras físicas conectadas ao Spooler do Windows/Linux.
 */
export async function getHardwarePrinters(): Promise<HardwarePrinter[]> {
  try {
    const res = await fetch(`${LOCAL_AGENT_URL}/printers`, {
      method: "GET",
      headers: { "Accept": "application/json" }
    });
    if (res.ok) {
      const json = await res.json();
      return json.printers || [];
    }
  } catch (err) {
    console.warn("Não foi possível listar impressoras nativas:", err);
  }
  return [];
}

/**
 * Envia um pedido de comanda para impressão instantânea USB RAW no Spooler nativo.
 */
export async function sendInstantPrintJob(
  order: any,
  printerName?: string
): Promise<{ success: boolean; message?: string; error?: string }> {
  try {
    const res = await fetch(`${LOCAL_AGENT_URL}/print`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        order,
        printer_name: printerName,
      }),
    });

    const json = await res.json();
    if (res.ok && json.success) {
      return { success: true, message: json.message };
    }
    return { success: false, error: json.error || "Falha na impressão nativa" };
  } catch (err: any) {
    return { success: false, error: err.message || "Erro de comunicação com agente local" };
  }
}
