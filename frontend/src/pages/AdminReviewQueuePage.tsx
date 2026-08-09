import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";

import { fetchJson, postJson } from "../api";
import AdminSessionPanel from "../components/AdminSessionPanel";
import { isLeagueCode } from "../config/leagues";
import { useAdminSession } from "../hooks/useAdminSession";

type Submission = {
  submission_id: string;
  status: string;
  original_filename: string;
  submitted_at: string;
  warnings: string[];
  claimed_by_admin_user_id: number | null;
  decision_note: string | null;
  accepted_match_id: number | null;
  match?: Record<string, unknown>;
};

export default function AdminReviewQueuePage(): React.JSX.Element {
  const auth = useAdminSession();
  const navigate = useNavigate();
  const [submissions, setSubmissions] = useState<Submission[]>([]);
  const [selected, setSelected] = useState<Submission | null>(null);
  const [error, setError] = useState<string | null>(null);
  const loadQueue = useCallback(async () => {
    if (!auth.session?.authenticated) return;
    try {
      setSubmissions(await fetchJson<Submission[]>("/api/admin/review-submissions"));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not load review queue.");
    }
  }, [auth.session?.authenticated]);
  useEffect(() => {
    void loadQueue();
  }, [loadQueue]);

  const loadSubmission = async (id: string) => {
    setError(null);
    try {
      setSelected(await fetchJson<Submission>(`/api/admin/review-submissions/${id}`));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not load submission.");
    }
  };
  const claim = async () => {
    if (!selected) return;
    const updated = await postJson<Submission>(
      `/api/admin/review-submissions/${selected.submission_id}/claim`,
      {}
    );
    setSelected({ ...selected, ...updated });
    await loadQueue();
  };
  const reject = async () => {
    if (!selected) return;
    const note = window.prompt("Rejection reason")?.trim();
    if (!note) return;
    await postJson(`/api/admin/review-submissions/${selected.submission_id}/reject`, { note });
    setSelected(null);
    await loadQueue();
  };
  const openEditor = () => {
    if (!selected?.match) return;
    const submittedLeague = String(selected.match.league ?? "ctc")
      .trim()
      .toLowerCase();
    const league = isLeagueCode(submittedLeague) ? submittedLeague : "ctc";
    sessionStorage.setItem(
      "ctc-review-draft",
      JSON.stringify({
        submissionId: selected.submission_id,
        filename: selected.original_filename,
        match: selected.match,
      })
    );
    navigate(
      `/json-editor?review_submission=${encodeURIComponent(selected.submission_id)}&league=${league}`
    );
  };

  return (
    <main className="relative z-10 min-h-screen bg-black/85 px-5 py-8 text-white sm:px-8">
      <div className="mx-auto max-w-6xl space-y-5">
        <header className="flex flex-wrap justify-between gap-3">
          <div>
            <p className="text-sm uppercase text-blue-200">Restricted administration</p>
            <h1 className="text-3xl font-bold">JSON Review Queue</h1>
          </div>
          <nav className="flex gap-3">
            <div className="flex gap-3">
              <Link to="/admin/aliases" className="text-blue-300">
                Alias management
              </Link>
              <Link to="/admin/access" className="text-blue-300">
                Access
              </Link>
            </div>
            <Link to="/" className="text-blue-300">
              Home
            </Link>
          </nav>
        </header>
        <section className="border border-white/15 bg-zinc-950/90 p-5">
          <AdminSessionPanel {...auth} />
        </section>
        {auth.session?.authenticated ? (
          <div className="grid gap-5 lg:grid-cols-[0.8fr_1.2fr]">
            <section className="border border-white/15 bg-zinc-950/90 p-4">
              <h2 className="text-xl font-bold">Submissions</h2>
              <div className="mt-3 max-h-[65vh] overflow-auto">
                {submissions.map((entry) => (
                  <button
                    type="button"
                    key={entry.submission_id}
                    onClick={() => void loadSubmission(entry.submission_id)}
                    className="block w-full border-t border-white/10 p-3 text-left hover:bg-white/5"
                  >
                    <strong>{entry.original_filename}</strong>
                    <span className="float-right text-sm text-blue-200">{entry.status}</span>
                    <p className="text-xs text-gray-400">
                      {new Date(entry.submitted_at).toLocaleString()}
                    </p>
                  </button>
                ))}
              </div>
            </section>
            <section className="border border-white/15 bg-zinc-950/90 p-4">
              {selected ? (
                <div className="space-y-4">
                  <div>
                    <h2 className="text-xl font-bold">{selected.original_filename}</h2>
                    <p className="text-gray-400">{selected.submission_id}</p>
                  </div>
                  {selected.warnings.length ? (
                    <ul className="list-disc space-y-1 pl-5 text-amber-200">
                      {selected.warnings.map((warning) => (
                        <li key={warning}>{warning}</li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-emerald-300">No server warnings.</p>
                  )}
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() =>
                        void claim().catch((caught) =>
                          setError(caught instanceof Error ? caught.message : "Claim failed.")
                        )
                      }
                      className="rounded border border-blue-300/40 px-3 py-2"
                    >
                      Claim
                    </button>
                    <button
                      type="button"
                      onClick={openEditor}
                      className="rounded bg-emerald-500 px-3 py-2 font-bold text-black"
                    >
                      Review in editor
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        void reject().catch((caught) =>
                          setError(caught instanceof Error ? caught.message : "Rejection failed.")
                        )
                      }
                      className="rounded border border-red-400/40 px-3 py-2 text-red-200"
                    >
                      Reject
                    </button>
                  </div>
                  <pre className="max-h-[45vh] overflow-auto bg-black/60 p-3 text-xs">
                    {JSON.stringify(selected.match, null, 2)}
                  </pre>
                </div>
              ) : (
                <p className="text-gray-400">Select a submission to review it.</p>
              )}
            </section>
          </div>
        ) : null}
        {error ? (
          <p className="border border-red-500/40 bg-red-950/40 p-3 text-red-200">{error}</p>
        ) : null}
      </div>
    </main>
  );
}
