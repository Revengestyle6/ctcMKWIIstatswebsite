import { BrowserRouter, Routes, Route } from "react-router-dom";
import HomePage from "./pages/HomePage";
import PlayerStats from "./components/PlayerStats";
import TopTeamPlayers from "./components/TopTeamPlayers";
import BackgroundSlideshow from "./components/BackgroundSlideshow";
import BestMatchups from "./components/BestMatchups";
import MusicPlayer from "./components/MusicPlayer";
import React, { useEffect } from "react";

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000';

export default function App(): React.JSX.Element {
  useEffect(() => {
    // Make an API call on page load
    const fetchInitialData = async () => {
      try {
        const response = await fetch(`${API_URL}/api/teams`);
        const data = await response.json();
        console.log("Initial API call successful:", data);
      } catch (error) {
        console.error("Error fetching initial data:", error);
      }
    };

    fetchInitialData();
  }, []);

  return (
    <BrowserRouter>
      <BackgroundSlideshow />
      <MusicPlayer />
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/stats" element={<PlayerStats />} />
        <Route path="/top-team-players" element={<TopTeamPlayers />} />
        <Route path="/best-matchups" element={<BestMatchups />} />
      </Routes>
    </BrowserRouter>
  );
}