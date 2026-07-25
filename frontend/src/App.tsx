import { type JSX, lazy, Suspense } from "react";
import { BrowserRouter, Route, Routes } from "react-router-dom";

import BackgroundSlideshow from "./components/BackgroundSlideshow";

const BestMatchups = lazy(() => import("./components/BestMatchups"));
const AdminAccessPage = lazy(() => import("./pages/AdminAccessPage"));
const AdminReviewQueuePage = lazy(() => import("./pages/AdminReviewQueuePage"));
const DatabaseHealthDashboard = lazy(() => import("./pages/DatabaseHealthDashboard"));
const HomePage = lazy(() => import("./pages/HomePage"));
const MatchHistory = lazy(() => import("./components/MatchHistory"));
const MatchJsonEditor = lazy(() => import("./components/MatchJsonEditor"));
const MusicPlayer = lazy(() => import("./components/MusicPlayer"));
const PlayerDashboard = lazy(() => import("./pages/PlayerDashboard"));
const PlayerStats = lazy(() => import("./components/PlayerStats"));
const TeamDashboard = lazy(() => import("./pages/TeamDashboard"));
const TopTeamPlayers = lazy(() => import("./components/TopTeamPlayers"));
const TopTracks = lazy(() => import("./components/TopTracks"));
const PlayerDirectory = lazy(() =>
  import("./pages/DashboardDirectories").then((module) => ({
    default: module.PlayerDirectory,
  }))
);
const TeamDirectory = lazy(() =>
  import("./pages/DashboardDirectories").then((module) => ({
    default: module.TeamDirectory,
  }))
);

function RouteFallback(): JSX.Element {
  return (
    <main className="relative z-10 flex min-h-screen items-center justify-center text-white">
      <p role="status" className="rounded bg-black/60 px-4 py-2">
        Loading…
      </p>
    </main>
  );
}

export default function App(): JSX.Element {
  return (
    <BrowserRouter>
      <BackgroundSlideshow />
      <Suspense fallback={null}>
        <MusicPlayer />
      </Suspense>
      <Suspense fallback={<RouteFallback />}>
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/stats" element={<PlayerStats />} />
          <Route path="/top-team-players" element={<TopTeamPlayers />} />
          <Route path="/top-tracks" element={<TopTracks />} />
          <Route path="/best-matchups" element={<BestMatchups />} />
          <Route path="/matches" element={<MatchHistory />} />
          <Route path="/players/:playerId" element={<PlayerDashboard />} />
          <Route path="/teams/:teamId" element={<TeamDashboard />} />
          <Route path="/players" element={<PlayerDirectory />} />
          <Route path="/teams" element={<TeamDirectory />} />
          <Route path="/json-editor" element={<MatchJsonEditor />} />
          <Route path="/database-health" element={<DatabaseHealthDashboard />} />
          <Route path="/admin/access" element={<AdminAccessPage />} />
          <Route path="/admin/review-queue" element={<AdminReviewQueuePage />} />
        </Routes>
      </Suspense>
    </BrowserRouter>
  );
}
