import { useCallback, useEffect, useRef, useState } from 'react';
import { probeLocalAgent, queryLoopbackPermission, type LocalConnection } from './localAgentConnection';

/** Scope is the authenticated session: callbacks from a previous store are ignored. */
export function useLocalPrintAgent(scope: string) {
  const scopeRef = useRef(scope); scopeRef.current = scope;
  const permissionRef = useRef<PermissionStatus | null>(null);
  const requestRef = useRef<AbortController | null>(null);
  const [snapshot, setSnapshot] = useState<LocalConnection & { scope: string }>({ scope, status: 'checking', identity: null });
  const publish = useCallback((next: LocalConnection) => {
    if (scopeRef.current !== scope) return;
    setSnapshot(previous => previous.scope === scope && previous.status === next.status
      && previous.identity?.agent_id === next.identity?.agent_id ? previous : { ...next, scope });
  }, [scope]);

  const refresh = useCallback(async (interactive = false) => {
    if (scopeRef.current !== scope || requestRef.current) return null;
    const permission = permissionRef.current?.state || 'unsupported';
    if (permission === 'denied' || (permission === 'prompt' && !interactive)) {
      const status = permission === 'denied' ? 'permission_denied' : 'permission_prompt';
      publish({ status, identity: null });
      return status;
    }
    const controller = new AbortController(); requestRef.current = controller;
    if (interactive) publish({ status: 'checking', identity: null });
    try {
      const result = await probeLocalAgent({ permission, interactive, signal: controller.signal });
      if (requestRef.current !== controller || scopeRef.current !== scope) return null;
      // Permission may have changed while the browser prompt was visible.
      const current = permissionRef.current?.state;
      const next: LocalConnection = current === 'denied' ? { status: 'permission_denied', identity: null }
        : current === 'prompt' ? { status: 'permission_prompt', identity: null } : result;
      publish(next);
      return next.status;
    } finally {
      if (requestRef.current === controller) requestRef.current = null;
    }
  }, [scope, publish]);

  useEffect(() => {
    let active = true;
    let permission: PermissionStatus | null = null;
    let interval: ReturnType<typeof setInterval> | undefined;
    const changed = () => {
      if (!active || scopeRef.current !== scope) return;
      if (permission?.state === 'denied' || permission?.state === 'prompt') {
        requestRef.current?.abort(); requestRef.current = null;
        publish({ status: permission.state === 'denied' ? 'permission_denied' : 'permission_prompt', identity: null });
      } else void refresh();
    };
    permissionRef.current = null;
    void (async () => {
      permission = await queryLoopbackPermission(navigator.permissions);
      if (!active || scopeRef.current !== scope) return;
      permissionRef.current = permission;
      permission?.addEventListener('change', changed);
      await refresh();
      if (!active) return;
      interval = setInterval(() => { if (document.visibilityState === 'visible') void refresh(); }, 5_000);
    })();
    return () => {
      active = false;
      permission?.removeEventListener('change', changed);
      clearInterval(interval);
      requestRef.current?.abort(); requestRef.current = null;
    };
  }, [scope, refresh, publish]);

  const connection: LocalConnection = snapshot.scope === scope ? snapshot : { status: 'checking', identity: null };
  return { ...connection, refresh, connect: () => refresh(true) };
}
