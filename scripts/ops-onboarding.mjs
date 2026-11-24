#!/usr/bin/env node

const DEFAULT_API_URL = "https://sistema-gourmet-bistro-production.up.railway.app";
const DEFAULT_PUBLIC_APP_URL = "https://app.komafood.com.br";

function parseArgs(argv) {
  const args = [...argv];
  const command = args.shift() || "";
  const positionals = [];
  const flags = {};

  while (args.length > 0) {
    const token = args.shift();
    if (!token.startsWith("--")) {
      positionals.push(token);
      continue;
    }
    const rawKey = token.slice(2);
    if (rawKey.startsWith("no-")) {
      flags[rawKey.slice(3)] = false;
      continue;
    }
    if (rawKey.includes("=")) {
      const [key, value] = rawKey.split("=", 2);
      flags[key] = value;
      continue;
    }
    const next = args[0];
    if (next !== undefined && !next.startsWith("--")) {
      flags[rawKey] = args.shift();
    } else {
      flags[rawKey] = true;
    }
  }
  return { command, positionals, flags };
}

function usage() {
  console.error(
    [
      "Uso (requer KOMA_SUPERADMIN_TOKEN no ambiente):",
      '  node scripts/ops-onboarding.mjs qa-start <tenant_id> --reason "Homologação inicial" [--hours 24]',
      '  node scripts/ops-onboarding.mjs qa-end <tenant_id> --reason "Fim da homologação"',
      '  node scripts/ops-onboarding.mjs contract-invite <tenant_id> [--cycle mensal|anual] [--payment-method pix] [--auto-release|--no-auto-release] [--expires-hours 72] [--reason "..."]',
    ].join("\n"),
  );
}

async function callSuperAdmin({ apiUrl, token, path, body }) {
  const response = await fetch(`${apiUrl.replace(/\/$/, "")}${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = data?.detail ? ` (${data.detail})` : "";
    throw new Error(`HTTP ${response.status} em ${path}${detail}`);
  }
  return data;
}

async function main() {
  const { command, positionals, flags } = parseArgs(process.argv.slice(2));
  if (!command || command === "--help" || command === "-h") {
    usage();
    process.exit(command ? 0 : 1);
  }

  const token = (process.env.KOMA_SUPERADMIN_TOKEN || "").trim();
  if (!token) {
    console.error("Erro: defina KOMA_SUPERADMIN_TOKEN no ambiente antes de executar.");
    process.exit(1);
  }
  const apiUrl = (process.env.KOMA_API_URL || DEFAULT_API_URL).trim();
  const publicAppUrl = (process.env.KOMA_PUBLIC_APP_URL || DEFAULT_PUBLIC_APP_URL).replace(/\/$/, "");
  const tenantId = Number.parseInt(String(positionals[0] || ""), 10);
  if (!Number.isInteger(tenantId) || tenantId <= 0) {
    usage();
    process.exit(1);
  }

  if (command === "qa-start") {
    const reason = String(flags.reason || "").trim();
    if (reason.length < 10) {
      console.error("Erro: --reason precisa ter pelo menos 10 caracteres.");
      process.exit(1);
    }
    const hours = Number.parseInt(String(flags.hours || "24"), 10);
    const data = await callSuperAdmin({
      apiUrl,
      token,
      path: `/api/super-admin/onboarding/restaurantes/${tenantId}/operational-qa`,
      body: { action: "start", hours, reason },
    });
    console.log(JSON.stringify({
      restaurantId: data.restaurantId,
      qaActive: data.qaActive,
      expiresAt: data.expiresAt,
      qaMenuPath: data.qaMenuPath,
      qaMenuUrl: data.qaMenuPath ? `${publicAppUrl}${data.qaMenuPath}` : null,
      warning: "Link de QA temporário e privado. Nunca divulgar ao público.",
    }, null, 2));
    return;
  }

  if (command === "qa-end") {
    const reason = String(flags.reason || "Encerramento da homologação operacional").trim();
    const data = await callSuperAdmin({
      apiUrl,
      token,
      path: `/api/super-admin/onboarding/restaurantes/${tenantId}/operational-qa`,
      body: { action: "end", reason },
    });
    console.log(JSON.stringify(data, null, 2));
    return;
  }

  if (command === "contract-invite") {
    const cycle = String(flags.cycle || "mensal").trim().toLowerCase();
    const paymentMethod = flags["payment-method"] === "none" ? null : String(flags["payment-method"] || "pix").trim().toLowerCase();
    const autoRelease = flags["auto-release"] === undefined ? true : Boolean(flags["auto-release"]);
    const expiresHours = Number.parseInt(String(flags["expires-hours"] || "72"), 10);
    const reason = String(flags.reason || "Envio de link único para aceite contratual pelo lojista").trim();
    const data = await callSuperAdmin({
      apiUrl,
      token,
      path: "/api/super-admin/contracts/invite",
      body: {
        restaurant_id: tenantId,
        billing_cycle: cycle,
        expires_hours: expiresHours,
        payment_method_type: paymentMethod,
        auto_release_on_accept: autoRelease,
        reason,
      },
    });
    console.log(JSON.stringify({
      inviteId: data.inviteId,
      restaurantId: data.restaurantId,
      plan: data.plan,
      billingCycle: data.billingCycle,
      paymentMethodType: data.paymentMethodType,
      autoReleaseOnAccept: data.autoReleaseOnAccept,
      expiresAt: data.expiresAt,
      inviteUrl: data.inviteUrl,
    }, null, 2));
    return;
  }

  usage();
  process.exit(1);
}

main().catch((error) => {
  console.error("Falha em ops-onboarding:", error instanceof Error ? error.message : String(error));
  process.exit(1);
});
