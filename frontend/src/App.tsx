import { BrowserRouter, Routes, Route } from "react-router-dom";
import HomePage from "./pages/HomePage";
import PlayerStats from "./components/PlayerStats";
import TopTeamPlayers from "./components/TopTeamPlayers";
import BackgroundSlideshow from "./components/BackgroundSlideshow";
import BestMatchups from "./components/BestMatchups";
import React from "react";

export default function App(): React.JSX.Element {
  return (
    <BrowserRouter>
      <BackgroundSlideshow />
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/stats" element={<PlayerStats />} />
        <Route path="/top-team-players" element={<TopTeamPlayers />} />
        <Route path="/best-matchups" element={<BestMatchups />} />
      </Routes>
    </BrowserRouter>
  );
}