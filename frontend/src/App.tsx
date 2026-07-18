import { BrowserRouter, Routes, Route } from "react-router-dom";
import HomePage from "./pages/HomePage";
import PlayerStats from "./components/PlayerStats";
import TopTeamPlayers from "./components/TopTeamPlayers";
import TopTracks from "./components/TopTracks";
import BackgroundSlideshow from "./components/BackgroundSlideshow";
import BestMatchups from "./components/BestMatchups";
import MatchHistory from "./components/MatchHistory";
import MatchJsonEditor from "./components/MatchJsonEditor";
import MusicPlayer from "./components/MusicPlayer";
import PlayerDashboard from "./pages/PlayerDashboard";
import TeamDashboard from "./pages/TeamDashboard";
import { PlayerDirectory, TeamDirectory } from "./pages/DashboardDirectories";
import React from "react";

export default function App(): React.JSX.Element {
  return (
    <BrowserRouter>
      <BackgroundSlideshow />
      <MusicPlayer />
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
      </Routes>
    </BrowserRouter>
  );
}
