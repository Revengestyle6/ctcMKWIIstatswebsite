import { useLeague } from "../context/LeagueContext";

export default function LeagueBackdrop() {
  const { config } = useLeague();
  // Keep the league's artwork still so it never shifts underneath the data.
  return (
    <div className="site-backdrop" aria-hidden="true">
      {config.backgrounds[0] && <img src={config.backgrounds[0]} alt="" />}
    </div>
  );
}
