import { useEffect, useState } from "react";
import { Link } from "react-router-dom";

import { fetchJson, patchJson, postJson } from "../api";
import AdminSessionPanel from "../components/AdminSessionPanel";
import { LeagueHeaderControls } from "../components/LeagueHeaderControls";
import { useAdminSession } from "../hooks/useAdminSession";

type AdminUser = {
  admin_user_id: number;
  email: string;
  role: "owner" | "admin";
  status: "invited" | "active" | "revoked";
  github_username: string | null;
  database_access_status: "not_requested" | "provisioned" | "revoked";
  repository_access_status: "not_requested" | "provisioned" | "revoked";
};
type Instructions = {
  database: { summary: string; commands: string[]; instance: string };
  repository: { summary: string; commands: string[] };
};

export default function AdminAccessPage(): React.JSX.Element {
  const auth = useAdminSession();
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [instructions, setInstructions] = useState<Instructions | null>(null);
  const [inviteEmail, setInviteEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const isOwner = auth.session?.admin?.role === "owner";

  useEffect(() => {
    if (!auth.session?.authenticated) return;
    let cancelled = false;
    Promise.all([
      fetchJson<Instructions>("/api/admin/access-instructions"),
      isOwner ? fetchJson<AdminUser[]>("/api/admin/users") : Promise.resolve([]),
    ])
      .then(([nextInstructions, nextUsers]) => {
        if (cancelled) return;
        setInstructions(nextInstructions);
        if (isOwner) setUsers(nextUsers);
      })
      .catch((caught) => {
        if (!cancelled)
          setError(caught instanceof Error ? caught.message : "Could not load access data.");
      });
    return () => {
      cancelled = true;
    };
  }, [auth.session?.authenticated, isOwner]);

  const invite = async () => {
    setError(null);
    try {
      const created = await postJson<AdminUser>("/api/admin/users", { email: inviteEmail });
      setUsers((current) => [...current, created].sort((a, b) => a.email.localeCompare(b.email)));
      setInviteEmail("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not invite administrator.");
    }
  };
  const updateUser = async (user: AdminUser, changes: Partial<AdminUser>) => {
    setError(null);
    try {
      const updated = await patchJson<AdminUser>(`/api/admin/users/${user.admin_user_id}`, changes);
      setUsers((current) =>
        current.map((entry) => (entry.admin_user_id === updated.admin_user_id ? updated : entry))
      );
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not update administrator.");
    }
  };

  return (
    <main className="relative z-10 min-h-screen bg-black/85 px-5 py-8 text-white sm:px-8">
      <div className="mx-auto max-w-6xl space-y-6">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-sm uppercase text-blue-200">Restricted administration</p>
            <h1 className="text-3xl font-bold">Administrator Access</h1>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-4">
            <nav className="flex gap-3">
              <Link to="/admin/aliases" className="text-blue-300 hover:text-blue-200">
                Alias management
              </Link>
              <Link to="/admin/review-queue" className="text-blue-300 hover:text-blue-200">
                Review queue
              </Link>
            </nav>
            <LeagueHeaderControls />
          </div>
        </header>
        <section className="border border-white/15 bg-zinc-950/90 p-5">
          <AdminSessionPanel {...auth} />
        </section>
        {auth.session?.authenticated && instructions ? (
          <section className="grid gap-5 lg:grid-cols-2">
            {(["database", "repository"] as const).map((key) => (
              <article key={key} className="border border-white/15 bg-zinc-950/90 p-5">
                <h2 className="text-xl font-bold capitalize">{key} onboarding</h2>
                <p className="mt-2 text-gray-300">{instructions[key].summary}</p>
                <ol className="mt-4 space-y-2">
                  {instructions[key].commands.map((command) => (
                    <li key={command}>
                      <code className="block overflow-x-auto bg-black/60 p-2 text-sm text-emerald-200">
                        {command}
                      </code>
                    </li>
                  ))}
                </ol>
              </article>
            ))}
          </section>
        ) : null}
        {isOwner ? (
          <section className="border border-white/15 bg-zinc-950/90 p-5">
            <h2 className="text-xl font-bold">Application administrators</h2>
            <div className="mt-4 flex flex-wrap gap-2">
              <input
                type="email"
                value={inviteEmail}
                onChange={(event) => setInviteEmail(event.target.value)}
                placeholder="Google email"
                className="min-w-72 flex-1 rounded border border-white/20 bg-black/40 px-3 py-2"
              />
              <button
                type="button"
                onClick={() => void invite()}
                className="rounded bg-emerald-500 px-4 py-2 font-bold text-black"
              >
                Invite administrator
              </button>
            </div>
            <div className="mt-5 space-y-3">
              {users.map((user) => (
                <div
                  key={user.admin_user_id}
                  className="grid gap-3 border-t border-white/10 pt-3 lg:grid-cols-[1.2fr_0.7fr_1fr_1fr_auto] lg:items-center"
                >
                  <div>
                    <strong>{user.email}</strong>
                    <p className="text-sm text-gray-400">
                      {user.role} · {user.github_username || "GitHub not recorded"}
                    </p>
                  </div>
                  <span>{user.status}</span>
                  <select
                    value={user.database_access_status}
                    onChange={(event) =>
                      void updateUser(user, {
                        database_access_status: event.target
                          .value as AdminUser["database_access_status"],
                      })
                    }
                    className="rounded bg-black/50 p-2"
                  >
                    <option value="not_requested">DB not requested</option>
                    <option value="provisioned">DB provisioned</option>
                    <option value="revoked">DB revoked</option>
                  </select>
                  <select
                    value={user.repository_access_status}
                    onChange={(event) =>
                      void updateUser(user, {
                        repository_access_status: event.target
                          .value as AdminUser["repository_access_status"],
                      })
                    }
                    className="rounded bg-black/50 p-2"
                  >
                    <option value="not_requested">Repo not requested</option>
                    <option value="provisioned">Repo provisioned</option>
                    <option value="revoked">Repo revoked</option>
                  </select>
                  <button
                    type="button"
                    onClick={() =>
                      void updateUser(user, {
                        status: user.status === "revoked" ? "invited" : "revoked",
                      })
                    }
                    className="rounded border border-white/20 px-3 py-2"
                  >
                    {user.status === "revoked" ? "Restore" : "Revoke"}
                  </button>
                </div>
              ))}
            </div>
          </section>
        ) : null}
        {error ? (
          <p className="border border-red-500/40 bg-red-950/40 p-3 text-red-200">{error}</p>
        ) : null}
      </div>
    </main>
  );
}
