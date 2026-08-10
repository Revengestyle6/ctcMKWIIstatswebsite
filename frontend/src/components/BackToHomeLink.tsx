import { Link } from "react-router-dom";
import { useLeague } from "../context/LeagueContext";

export function BackToHomeLink({ className = "" }: { className?: string }) {
  const { leaguePath } = useLeague();

  return (
    <Link
      to={leaguePath("/")}
      className={`inline-flex rounded-md px-2 py-2 font-semibold league-accent-text transition hover:bg-white/10 focus:outline-none league-focus-ring ${className}`}
    >
      <span aria-hidden="true">&lt;&nbsp;</span>
      Back
    </Link>
  );
}
