import { useState } from "react";

import {
  localDevelopmentAuthEnabled,
  setLocalDevelopmentAdmin,
  signInWithGoogle,
  signOutAdmin,
} from "../authClient";
import type { AdminSession } from "../hooks/useAdminSession";

export default function AdminSessionPanel({
  session,
  loading,
  refresh,
}: {
  session: AdminSession | null;
  loading: boolean;
  refresh: () => Promise<void>;
}): React.JSX.Element {
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  if (loading) return <p role="status">Checking administrator access…</p>;
  if (session?.authenticated && session.admin) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p>
          Signed in as <strong>{session.admin.email}</strong> ({session.admin.role})
        </p>
        <button
          type="button"
          className="rounded border border-white/20 px-3 py-2 hover:bg-white/10"
          onClick={() => void signOutAdmin().then(refresh)}
        >
          Sign out
        </button>
      </div>
    );
  }
  const signIn = async () => {
    setError(null);
    try {
      await signInWithGoogle();
      await refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Google sign-in failed.");
    }
  };
  const applyDevelopmentEmail = async () => {
    setError(null);
    try {
      setLocalDevelopmentAdmin(email);
      await refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Development sign-in failed.");
    }
  };
  return (
    <div className="space-y-3">
      <p>Sign in with an owner-approved Google account to use administrator tools.</p>
      <button
        type="button"
        onClick={() => void signIn()}
        className="rounded bg-blue-500 px-4 py-2 font-bold text-white hover:bg-blue-400"
      >
        Sign in with Google
      </button>
      {localDevelopmentAuthEnabled() ? (
        <div className="flex max-w-xl flex-wrap gap-2 border-t border-white/10 pt-3">
          <input
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="Bootstrapped local administrator email"
            className="min-w-72 flex-1 rounded border border-white/20 bg-black/40 px-3 py-2"
          />
          <button
            type="button"
            onClick={() => void applyDevelopmentEmail()}
            className="rounded border border-amber-300/40 px-3 py-2 text-amber-100"
          >
            Use local identity
          </button>
        </div>
      ) : null}
      {session?.error || error ? <p className="text-red-300">{session?.error || error}</p> : null}
    </div>
  );
}
