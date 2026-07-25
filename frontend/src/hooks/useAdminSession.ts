import { useCallback, useEffect, useState } from "react";

import { fetchJson } from "../api";

export type AdminSession = {
  authenticated: boolean;
  admin?: { admin_user_id: number; email: string; role: "owner" | "admin" };
  error?: string;
};

export function useAdminSession(): {
  session: AdminSession | null;
  loading: boolean;
  refresh: () => Promise<void>;
} {
  const [session, setSession] = useState<AdminSession | null>(null);
  const [loading, setLoading] = useState(true);
  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      setSession(await fetchJson<AdminSession>("/api/auth/session"));
    } catch (error) {
      setSession({
        authenticated: false,
        error: error instanceof Error ? error.message : "Sign-in failed.",
      });
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  return { session, loading, refresh };
}
