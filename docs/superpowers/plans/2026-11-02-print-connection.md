# Print connection implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Recognize the existing local print agent without conflating browser permission denial, offline agent and inaccessible printer.

**Architecture:** Keep the existing local identity endpoint, worker, tokens, backend monitor and queue. A permission-aware identity reader and hook own discovery, cancellation and user-triggered connection. The monitor continues filtering the server read model by the verified local identity.

**Tech Stack:** React 19, TypeScript, native Permissions/Fetch APIs, existing Node tests and Playwright. No dependency added.

**Spec:** docs/superpowers/specs/2026-11-02-print-connection.md (approved in chat).

## Global Constraints

- Production read-only; no writes or printing on real tenants 6/8.
- Existing Windows/Linux agent binaries, tokens, pairing and destinations remain compatible.
- Never adopt an arbitrary online agent as this computer; never disable browser protections.
- No automatic POST/reprint/test, no new service/database/cache/dependency.
- Branch/PR/CI only; no merge or publication without authorization.

## Review Focus

- Permission prompt may outlast the old 450ms identity timeout; the explicit connection gets a longer bounded wait.
- Old browsers may reject all permission names; preserve legacy discovery without misreporting permission denial.
- Permission can change while GET is active; reconcile without parallel discovery or stale identities.
- Scope can change before callbacks complete; identity must disappear immediately and responses be ignored.
- A remote agent is online while local discovery is denied; no local printers or test action may be enabled from that row.

### Task 1: Permission-aware discovery and connection lifecycle

**Files:** create src/components/printing/localAgentConnection.ts, src/components/printing/useLocalPrintAgent.ts; create tests/localAgentConnection.test.ts.

- [x] Add failing tests for granular/legacy/unsupported permission APIs, denied/prompt background reads, click discovery timeout, cancellation, alternative ports and invalid identities.
- [x] Run tests and confirm failure before implementation.
- [x] Implement the reader and hook, with coalescence, permission-change listener, visible-only reconciliation and scope cleanup.
- [x] Run focused unit tests and TypeScript; preserve identity/CORS contracts and no mutation methods.

### Task 2: Monitor integration, browser proof and CI

**Files:** modify src/components/printing/PrintMonitorPanel.tsx; create e2e/print-local-connection.spec.ts; update relevant existing workflow filters/tests.

- [x] Add browser regressions reproducing permission-denied UI, prompt-to-granted click, existing granted agent, unsupported API, remote-agent isolation and late callbacks.
- [x] Demonstrate the old monitor fails the denied/prompt scenarios before integration.
- [x] Integrate the hook and connect action. Launch the existing protocol only when discovery permits access but no agent responds. Explain denied/prompt states without making claims about paper or requiring token changes.
- [x] Run all frontend unit tests, lint/build, isolated existing agent compatibility/backend printing tests and mobile/desktop browser cases. Inspect captures.
- [ ] Request a fresh-context review, resolve material findings, create PR and follow final-head CI. Record evidence and pending physical proof.


## Verification record

- Baseline existing printing UI contracts: 11 passed.
- New pure unit contract: initial missing-module RED; final 19 focused tests passed.
- Denied/prompt browser scenarios reproduced failure on the original monitor before integration.
- Fresh-context review found two Important issues: success waiting for another hanging port, and permission reset to Ask during an active read. Both reproduced with targeted RED tests and corrected; no Critical findings.
- Final local verification: TypeScript/lint, 1,195 frontend unit tests and production build passed; 16 mobile/desktop browser scenarios passed. Captures inspected, with wrapping permission titles and no false zero-printer claim while access is blocked.
- Existing binary compatibility: 156 agent tests passed; 73 isolated backend printing/terminal-ack contracts passed. No agent binary, installer, backend or migration changed.
- The browser tests simulate permission states and bridge responses; they are not proof of a native Brave permission dialog or physical output. KA7 hardware availability and live publication remain separate.
- Additional test-only fixture e2e/fixtures/print-scope.html exercises the actual hook with late permission resolution. It is not a production build entry.
- Reference checked: https://developer.chrome.com/docs/modern-web-guidance/guides/security/local-network-access (granular loopback permission, user gesture, targetAddressSpace and legacy fallback).
