#!/usr/bin/env node
/**
 * CLI oficial de desligamento e desprovisionamento isolado de tenant KÔMA.
 *
 * Consome:
 *  - POST /api/provisioning/tenants/{id}/deprovision (dry-run ou execução auditada)
 *  - GET  /api/provisioning/tenants/{id}/deprovision/verify
 *
 * Nunca imprime tokens ou segredos em stdout/stderr.
 */

import process from "node:process";

const DEFAULT_API_URL = "https://sistema-gourmet-bistro-production.up.railway.app";

function parseArgs(argv) {
  const flags = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith("--")) continue;
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (next !== undefined && !next.startsWith("--")) {
      flags[key] = next;
      i += 1;
    } else {
      flags[key] = true;
    }
  }
  return flags;
}

function usage() {
  console.log(
    [
      "Uso oficial: koma-deprovision (CLI de desligamento/exclusão isolada de tenant KÔMA)",
      "",
      "Variáveis de ambiente:",
      "  KOMA_AGENT_READ_TOKEN          Somente --verify / --dry-run",
      "  KOMA_OFFBOARDING_API_TOKEN     Execução de --mode client_offboarding",
      "  KOMA_DEPROVISIONING_API_TOKEN  Execução de --mode qa_purge (ou KOMA_SUPERADMIN_TOKEN)",
      "  KOMA_PROVISIONING_TOKEN        Alias legado compatível somente se possuir o escopo exigido",
      `  KOMA_API_URL                   URL do backend (padrão: ${DEFAULT_API_URL})`,
      "",
      "Opções:",
      "  --tenant-id <id>          ID inteiro positivo do restaurante alvo (obrigatório)",
      "  --mode <modo>             'qa_purge' (padrão, exclusivo QA/homologação) ou 'client_offboarding'",
      "  --dry-run                 Executa plano determinístico sem alterar dados (padrão)",
      "  --execute                 Executa a operação (exige --confirm, --fingerprint e --reason)",
      "  --verify                  Audita resíduos e política de não-reutilização de ID (GET)",
      "  --fingerprint <sha256>    Fingerprint retornado pelo dry-run mais recente",
      "  --confirm <frase>         Ex.: DEPROVISION_TENANT_10 ou OFFBOARD_TENANT_10",
      "  --reason <motivo>         Justificativa de auditoria (>= 8 caracteres)",
      "  --no-cleanup-storage      Não remover objetos do Supabase Storage no qa_purge",
      "  --retry-storage <paths>   Lista separada por vírgula para retomar limpeza de Storage",
      "  --actor <identificador>   Rótulo declarativo suplementar (identidade vem do token)",
      "  --api-url <url>           Sobrescreve KOMA_API_URL",
    ].join("\n"),
  );
}

async function main() {
  const flags = parseArgs(process.argv.slice(2));
  if (flags.help || flags.h) {
    usage();
    process.exit(0);
  }

  const tenantId = Number.parseInt(String(flags["tenant-id"] || ""), 10);
  if (!Number.isInteger(tenantId) || tenantId <= 0) {
    console.error("Erro: informe --tenant-id com um inteiro positivo válido.");
    process.exit(1);
  }

  const isReadAction = Boolean(flags.verify) || !(Boolean(flags.execute) && !flags["dry-run"]);
  const requestedMode = String(flags.mode || "qa_purge").trim();

  const token = String(
    isReadAction
      ? process.env.KOMA_AGENT_READ_TOKEN ||
          process.env.KOMA_DEPROVISIONING_API_TOKEN ||
          process.env.KOMA_OFFBOARDING_API_TOKEN ||
          process.env.KOMA_PROVISIONING_API_TOKEN ||
          process.env.KOMA_PROVISIONING_TOKEN ||
          process.env.KOMA_SUPERADMIN_TOKEN ||
          ""
      : requestedMode === "client_offboarding"
        ? process.env.KOMA_OFFBOARDING_API_TOKEN ||
            process.env.KOMA_DEPROVISIONING_API_TOKEN ||
            process.env.KOMA_PROVISIONING_TOKEN ||
            process.env.KOMA_SUPERADMIN_TOKEN ||
            ""
        : process.env.KOMA_DEPROVISIONING_API_TOKEN ||
            process.env.KOMA_PROVISIONING_TOKEN ||
            process.env.KOMA_SUPERADMIN_TOKEN ||
            "",
  ).trim();
  if (!token) {
    console.error(
      isReadAction
        ? "Erro: defina KOMA_AGENT_READ_TOKEN (ou token escopado/SuperAdmin equivalente)."
        : requestedMode === "client_offboarding"
          ? "Erro: defina KOMA_OFFBOARDING_API_TOKEN, KOMA_DEPROVISIONING_API_TOKEN ou KOMA_SUPERADMIN_TOKEN."
          : "Erro: defina KOMA_DEPROVISIONING_API_TOKEN ou KOMA_SUPERADMIN_TOKEN para executar qa_purge.",
    );
    process.exit(1);
  }

  const apiUrl = String(flags["api-url"] || process.env.KOMA_API_URL || DEFAULT_API_URL)
    .trim()
    .replace(/\/$/, "");
  const headers = {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };
  if (typeof flags.actor === "string" && flags.actor.trim()) {
    headers["X-Provisioning-Actor"] = flags.actor.trim();
  }

  if (flags.verify) {
    const res = await fetch(
      `${apiUrl}/api/provisioning/tenants/${tenantId}/deprovision/verify`,
      { method: "GET", headers },
    );
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      console.error(JSON.stringify({ ok: false, status: res.status, detail: data?.detail || data }, null, 2));
      process.exit(1);
    }
    console.log(JSON.stringify(data, null, 2));
    process.exit(0);
  }

  const mode = String(flags.mode || "qa_purge").trim();
  if (mode !== "qa_purge" && mode !== "client_offboarding") {
    console.error("Erro: --mode deve ser 'qa_purge' ou 'client_offboarding'.");
    process.exit(1);
  }

  const execute = Boolean(flags.execute) && !flags["dry-run"];
  const body = {
    mode,
    dry_run: !execute,
    cleanup_storage: !flags["no-cleanup-storage"],
  };
  if (typeof flags["retry-storage"] === "string" && flags["retry-storage"].trim()) {
    body.retry_storage_paths = flags["retry-storage"]
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
  }
  if (execute) {
    if (typeof flags.confirm !== "string" || !flags.confirm.trim()) {
      console.error("Erro: --execute exige --confirm <frase_exata>.");
      process.exit(1);
    }
    if (typeof flags.reason !== "string" || flags.reason.trim().length < 8) {
      console.error("Erro: --execute exige --reason com pelo menos 8 caracteres.");
      process.exit(1);
    }
    body.confirmation = flags.confirm.trim();
    body.reason = flags.reason.trim();
    if (typeof flags.fingerprint === "string" && flags.fingerprint.trim()) {
      body.expected_fingerprint = flags.fingerprint.trim();
    }
  }

  const res = await fetch(
    `${apiUrl}/api/provisioning/tenants/${tenantId}/deprovision`,
    {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    },
  );
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    console.error(JSON.stringify({ ok: false, status: res.status, detail: data?.detail || data }, null, 2));
    process.exit(1);
  }
  console.log(JSON.stringify(data, null, 2));
}

main().catch((error) => {
  console.error("Falha em koma-deprovision:", error instanceof Error ? error.message : String(error));
  process.exit(1);
});
