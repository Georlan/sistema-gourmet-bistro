import test from "node:test";
import assert from "node:assert/strict";
import { nextMonitorState, previousRunState, reconcileMonitor } from "../scripts/ops-monitor.mjs";
import { parseTraceLines } from "../scripts/ops-trace.mjs";
import { diagnose } from "../scripts/ops-doctor.mjs";
import {
  BACKUP_ISSUE_TITLE,
  checkBackupFreshness,
  evaluateBackupLogs,
  reconcileBackupIssue,
} from "../scripts/check-backup-freshness.mjs";

test("support code is a searchable request ID prefix", async () => {
  Object.assign(globalThis, { window: { location: { hostname: "localhost", protocol: "http:", href: "http://localhost:3000/" } } });
  const { supportCodeFromRequestId } = await import("../src/utils/supportCode");
  assert.equal(supportCodeFromRequestId("abcdef1234567890abcdef1234567890"), "abcdef123456");
  assert.equal(supportCodeFromRequestId("h3o-check-123"), "h3o-check-12");
  assert.equal(supportCodeFromRequestId("secret token"), null);
});

test("frontend observes API 500 but ignores validation and external responses", async () => {
  const events: Array<{ code: string; requestId: string }> = [];
  const fakeWindow = {
    location: { hostname: "localhost", protocol: "http:", href: "http://localhost:3000/" },
    fetch: async (input: RequestInfo | URL, _init?: RequestInit) => new Response(null, {
      status: String(input).includes("validation") ? 422 : 500,
      headers: { "X-Request-ID": "abcdef1234567890abcdef1234567890" },
    }),
    dispatchEvent: (event: CustomEvent<{ code: string; requestId: string }>) => {
      events.push(event.detail); return true;
    },
  };
  Object.assign(globalThis, { window: fakeWindow });
  const { installSupportCodeObserver, fetchWithInlineSupport } = await import("../src/utils/supportCode");
  installSupportCodeObserver();
  await fakeWindow.fetch("http://localhost:8000/orders");
  await fakeWindow.fetch("http://localhost:8000/validation");
  await fakeWindow.fetch("https://example.com/error");
  await fetchWithInlineSupport("http://localhost:8000/cardapio/pedidos", { method: 'POST', headers: { 'X-Request-ID': '1234567890abcdef1234567890abcdef' } });
  const catalogRequest = new Request('http://localhost:8000/api/cardapio-digital/public', { signal: new AbortController().signal });
  const catalogResponse = await fetchWithInlineSupport(catalogRequest);
  assert.equal(catalogRequest.headers.has('X-Request-ID'), false);
  assert.equal(catalogResponse.status, 500);
  assert.equal(catalogResponse.bodyUsed, false);
  assert.deepEqual(events, [{ code: "abcdef123456", requestId: "abcdef1234567890abcdef1234567890" }]);
});

test("monitor confirms failure, deduplicates issue, and confirms recovery", async () => {
  let state: any = {};
  const calls: string[] = [];
  const handlers = {
    createIssue: async () => { calls.push("create"); return 42; },
    updateIssue: async () => { calls.push("update"); },
    closeIssue: async () => { calls.push("close"); },
  };
  state = await reconcileMonitor({ previous: state, failures: ["503"], ...handlers });
  assert.equal(state.issue, null);
  state = await reconcileMonitor({ previous: state, failures: ["503"], ...handlers });
  state = await reconcileMonitor({ previous: state, failures: ["503"], ...handlers });
  state = await reconcileMonitor({ previous: state, failures: [], ...handlers });
  assert.equal(state.issue, 42);
  state = await reconcileMonitor({ previous: state, failures: [], ...handlers });
  assert.equal(state.issue, null);
  assert.deepEqual(calls, ["create", "update", "close"]);
  assert.deepEqual(nextMonitorState({ failures: 1, successes: 0 }, true).failures, 0);
  assert.deepEqual(previousRunState([{ id: 10, status: "in_progress" }, { id: 9, status: "completed", conclusion: "failure" }], 10, 42), { failures: 1, successes: 0, issue: 42 });
});

test("trace returns only matching structured events", () => {
  const lines = [
    JSON.stringify({ timestamp: "2026-09-27T00:00:00Z", message: "", event: "http_request", request_id: "abcdef1234567890", support_code: "abcdef123456", status_code: 500 }),
    JSON.stringify({ timestamp: "2026-09-27T00:00:00Z", message: JSON.stringify({ event: "http_exception", request_id: "abcdef1234567890", support_code: "abcdef123456", exception_type: "RuntimeError" }) }),
    JSON.stringify({ timestamp: "2026-09-27T00:00:01Z", message: "noise abcdef123456" }),
  ];
  assert.equal(parseTraceLines(lines, "abcdef123456").length, 2);
  assert.equal(parseTraceLines(lines, "00000000").length, 0);
});

test("doctor reports failed public checks with nonzero health", async () => {
  const result = await diagnose(async () => { throw new Error("controlled timeout"); });
  assert.equal(result.healthy, false);
  assert.equal(result.lines.filter(line => line.includes("FALHA")).length, 3);
});

function buildBackupLogLines(completedIso: string, extras: string[] = []): string {
  const baseMs = Date.parse(completedIso);
  const messages = [
    { offsetMs: -20_000, message: "Backup archive file is valid" },
    { offsetMs: -15_000, message: "Backup filesize: 2.39 MB" },
    { offsetMs: -5_000, message: "Backup uploaded to S3..." },
    { offsetMs: 0, message: "Database backup complete." },
  ];
  return [
    ...messages.map(({ offsetMs, message }) =>
      JSON.stringify({ timestamp: new Date(baseMs + offsetMs).toISOString(), message }),
    ),
    ...extras,
  ].join("\n");
}

test("backup freshness passes on valid recent S3 backup", () => {
  const nowMs = Date.parse("2026-11-15T15:00:00.000Z");
  const stdout = buildBackupLogLines("2026-11-15T03:01:29.000Z");
  const result = evaluateBackupLogs(stdout, nowMs);
  assert.equal(result.ok, true);
  assert.equal(result.reason, "ok");
  assert.match(result.message, /2\.39 MB/);
});

test("backup freshness fails when latest backup is stale (>36h)", () => {
  const nowMs = Date.parse("2026-11-16T18:00:00.000Z");
  const stdout = buildBackupLogLines("2026-11-15T03:01:29.000Z");
  const result = evaluateBackupLogs(stdout, nowMs);
  assert.equal(result.ok, false);
  assert.equal(result.reason, "stale");
});

test("backup freshness fails when backup is missing in last 48h", () => {
  const result = evaluateBackupLogs("", Date.parse("2026-11-15T15:00:00.000Z"));
  assert.equal(result.ok, false);
  assert.equal(result.reason, "missing");
});

test("backup freshness fails explicitly on Railway access error", () => {
  const result = checkBackupFreshness({
    spawn: () => ({ status: 1, stdout: "", stderr: "Unauthorized" } as any),
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, "access_error");
});

test("backup issue reconciliation deduplicates and closes on recovery", async () => {
  const calls: string[] = [];
  const handlers = {
    createIssue: async (title: string) => {
      assert.equal(title, BACKUP_ISSUE_TITLE);
      calls.push("create");
      return 99;
    },
    updateIssue: async () => { calls.push("update"); },
    closeIssue: async () => { calls.push("close"); },
  };
  let issue = await reconcileBackupIssue({
    result: { ok: false, reason: "stale", message: "último backup tem 40.0 horas" },
    existingIssueNumber: null,
    ...handlers,
  });
  assert.equal(issue, 99);
  issue = await reconcileBackupIssue({
    result: { ok: false, reason: "missing", message: "nenhuma execução" },
    existingIssueNumber: issue,
    ...handlers,
  });
  assert.equal(issue, 99);
  issue = await reconcileBackupIssue({
    result: { ok: true, reason: "ok", message: "ok" },
    existingIssueNumber: issue,
    ...handlers,
  });
  assert.equal(issue, null);
  assert.deepEqual(calls, ["create", "update", "close"]);
});
