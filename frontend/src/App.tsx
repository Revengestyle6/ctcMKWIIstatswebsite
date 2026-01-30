import { BrowserRouter, Routes, Route } from "react-router-dom";
import HomePage from "./pages/HomePage";
import PlayerStats from "./components/PlayerStats";
import TopTeamPlayers from "./components/TopTeamPlayers";
import TopTracks from "./components/TopTracks";
import BackgroundSlideshow from "./components/BackgroundSlideshow";
import BestMatchups from "./components/BestMatchups";
import MusicPlayer from "./components/MusicPlayer";
import React from "react";

const API_URL = import.meta.env.VITE_API_URL || 'https://ctc-mkwii-api-production.up.railway.app';

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
      </Routes>
    </BrowserRouter>
  );
}