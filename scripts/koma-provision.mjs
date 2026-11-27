#!/usr/bin/env node
/**
 * CLI oficial de provisionamento expresso KÔMA (Caminho B).
 *
 * Consome POST /api/provisioning/express com dry-run determinístico,
 * chave de idempotência e suporte a texto estruturado ou JSON.
 * Nunca imprime tokens nem senhas no stdout/stderr.
 */

import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const DEFAULT_API_URL = "https://sistema-gourmet-bistro-production.up.railway.app";

function parseArgs(argv) {
  const flags = {};
  const positionals = [];
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith("--")) {
      positionals.push(arg);
      continue;
    }
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (next !== undefined && !next.startsWith("--")) {
      flags[key] = next;
      i += 1;
    } else {
      flags[key] = true;
    }
  }
  return { flags, positionals };
}

function usage() {
  console.log(
    [
      "Uso oficial: koma-provision (CLI de provisionamento expresso KÔMA)",
      "",
      "Variáveis de ambiente:",
      "  KOMA_PROVISIONING_TOKEN   Token escopado para /api/provisioning/express (ou KOMA_SUPERADMIN_TOKEN)",
      `  KOMA_API_URL              URL do backend (padrão: ${DEFAULT_API_URL})`,
      "",
      "Opções:",
      "  --input <arquivo>         Lê texto estruturado (.txt/.md) ou JSON (.json)",
      "  --stdin                   Lê texto/JSON estruturado da entrada padrão",
      "  --dry-run                 Valida e pré-visualiza sem criar registros no banco",
      "  --qa-lab                  Marca como laboratório QA e abre janela privada de QA",
      "  --restaurant-id <id>      Sugere ID elegível específico (sem forçar histórico)",
      "  --idempotency-key <key>   Chave idempotente explícita para evitar duplicação",
      "  --actor <identificador>   Rótulo de auditoria do executor",
      "  --json                    Saída JSON pura sem textos adicionais",
    ].join("\n"),
  );
}

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf-8");
}

async function main() {
  const { flags } = parseArgs(process.argv.slice(2));
  if (flags.help || flags.h) {
    usage();
    process.exit(0);
  }

  const token = String(
    process.env.KOMA_PROVISIONING_TOKEN || process.env.KOMA_SUPERADMIN_TOKEN || "",
  ).trim();
  if (!token) {
    console.error(
      "Erro: defina KOMA_PROVISIONING_TOKEN ou KOMA_SUPERADMIN_TOKEN antes de executar.",
    );
    process.exit(1);
  }

  let rawContent = "";
  if (typeof flags.input === "string") {
    const resolved = path.resolve(process.cwd(), flags.input);
    rawContent = fs.readFileSync(resolved, "utf-8");
  } else if (flags.stdin) {
    rawContent = await readStdin();
  } else {
    usage();
    process.exit(1);
  }

  const trimmed = rawContent.trim();
  if (!trimmed) {
    console.error("Erro: entrada vazia.");
    process.exit(1);
  }

  let body = {};
  if (trimmed.startsWith("{")) {
    try {
      body = JSON.parse(trimmed);
    } catch (error) {
      console.error(`Erro: JSON inválido (${error instanceof Error ? error.message : String(error)}).`);
      process.exit(1);
    }
  } else {
    body = { structured_text: trimmed };
  }

  if (flags["dry-run"]) body.dry_run = true;
  if (flags["qa-lab"]) body.qa_lab = true;
  if (typeof flags["restaurant-id"] === "string") {
    const parsedId = Number.parseInt(flags["restaurant-id"], 10);
    if (!Number.isInteger(parsedId) || parsedId <= 0) {
      console.error("Erro: --restaurant-id precisa ser inteiro positivo.");
      process.exit(1);
    }
    body.restaurant_id = parsedId;
  }

  const apiUrl = String(flags["api-url"] || process.env.KOMA_API_URL || DEFAULT_API_URL)
    .trim()
    .replace(/\/$/, "");
  const headers = {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };
  if (typeof flags["idempotency-key"] === "string" && flags["idempotency-key"].trim()) {
    headers["Idempotency-Key"] = flags["idempotency-key"].trim();
  }
  if (typeof flags.actor === "string" && flags.actor.trim()) {
    headers["X-Provisioning-Actor"] = flags.actor.trim();
  }

  const response = await fetch(`${apiUrl}/api/provisioning/express`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    console.error(
      JSON.stringify(
        {
          ok: false,
          status: response.status,
          detail: data?.detail || data,
        },
        null,
        2,
      ),
    );
    process.exit(1);
  }

  if (data.dryRun && Array.isArray(data.missingFields) && data.missingFields.length > 0 && !flags.json) {
    console.error(
      `Atenção (dry-run): campos obrigatórios ausentes sem invenção: ${data.missingFields.join(", ")}`,
    );
  }

  // Sanitiza qualquer token acidental antes de imprimir
  const output = { ...data };
  if (output.activation && typeof output.activation === "object") {
    output.activation = {
      mode: output.activation.mode,
      invitePending: Boolean(output.activation.token),
    };
  }
  console.log(JSON.stringify(output, null, 2));
}

main().catch((error) => {
  console.error("Falha em koma-provision:", error instanceof Error ? error.message : String(error));
  process.exit(1);
});
