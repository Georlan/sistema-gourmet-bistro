import React, { useEffect, useState } from "react";
import { LockKeyhole, LogIn } from "lucide-react";
import SuperAdminPanel from "./SuperAdminPanel";
import {
  getSuperAdminToken,
  loginSuperAdmin,
  SUPER_ADMIN_AUTH_REQUIRED_EVENT,
  superAdminErrorMessage,
} from "./superAdminApi";

export function SuperAdminGate() {
  const [isAuthenticated, setIsAuthenticated] = useState(() => Boolean(getSuperAdminToken()));
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const requireLogin = () => {
      setIsAuthenticated(false);
      setPassword("");
      setError("Sua sessão terminou. Entre novamente.");
    };
    window.addEventListener(SUPER_ADMIN_AUTH_REQUIRED_EVENT, requireLogin);
    return () => window.removeEventListener(SUPER_ADMIN_AUTH_REQUIRED_EVENT, requireLogin);
  }, []);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!username.trim() || !password) return;

    setIsSubmitting(true);
    setError("");
    try {
      await loginSuperAdmin(username.trim(), password);
      setPassword("");
      setIsAuthenticated(true);
    } catch (loginError) {
      setError(superAdminErrorMessage(loginError));
    } finally {
      setIsSubmitting(false);
    }
  };

  if (isAuthenticated) {
    return <SuperAdminPanel />;
  }

  return (
    <main
      className="min-h-screen bg-koma-page text-koma-foreground flex items-center justify-center p-6"
      id="superadmin-login"
      data-testid="superadmin-login"
    >
      <section className="w-full max-w-md rounded-lg border border-[#1e293b] bg-koma-card p-7 shadow-2xl">
        <div className="mb-6 flex items-center gap-3">
          <div className="rounded-md bg-[#00b894] p-2 text-black">
            <LockKeyhole className="h-5 w-5" aria-hidden="true" />
          </div>
          <div>
            <h1 className="text-lg font-bold">Acesso SuperAdmin</h1>
            <p className="text-xs text-koma-muted">Sessão restrita da operação Kôma</p>
          </div>
        </div>

        <form className="space-y-4" onSubmit={handleSubmit}>
          <div>
            <label className="mb-1 block text-xs font-semibold" htmlFor="superadmin-username">
              Usuário
            </label>
            <input
              id="superadmin-username"
              name="username"
              type="text"
              autoComplete="username"
              required
              disabled={isSubmitting}
              value={username}
              onChange={event => setUsername(event.target.value)}
              className="w-full rounded border border-[#334155] bg-black/30 px-3 py-2 text-sm outline-none focus:border-[#00b894]"
            />
          </div>

          <div>
            <label className="mb-1 block text-xs font-semibold" htmlFor="superadmin-password">
              Senha
            </label>
            <input
              id="superadmin-password"
              name="password"
              type="password"
              autoComplete="current-password"
              required
              disabled={isSubmitting}
              value={password}
              onChange={event => setPassword(event.target.value)}
              className="w-full rounded border border-[#334155] bg-black/30 px-3 py-2 text-sm outline-none focus:border-[#00b894]"
            />
          </div>

          {error && (
            <p className="rounded border border-red-800 bg-red-950/40 px-3 py-2 text-xs text-red-300" role="alert">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={isSubmitting || !username.trim() || !password}
            className="flex w-full items-center justify-center gap-2 rounded bg-[#00b894] px-4 py-2.5 text-sm font-bold text-black disabled:cursor-not-allowed disabled:opacity-50"
          >
            <LogIn className="h-4 w-4" aria-hidden="true" />
            {isSubmitting ? "Autenticando..." : "Entrar"}
          </button>
        </form>
      </section>
    </main>
  );
}

export default SuperAdminGate;
