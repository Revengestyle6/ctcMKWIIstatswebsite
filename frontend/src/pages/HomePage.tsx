import { Link } from "react-router-dom";
import React from "react";

export default function HomePage(): React.JSX.Element {
  return (
    <div className="relative min-h-screen text-white font-sans">
      <header className="bg-black/50 backdrop-blur-sm">
        <div className="mx-auto max-w-7xl px-6 py-12 text-center">
          {/* Logo */}
        <img 
          src="/images/CTC_LOGO/ctclogo.png" 
          alt="Logo" 
          className="w-24 h-24 mx-auto mb-4 rounded-lg"
        />

          <h1 className="text-4xl font-bold sm:text-5xl">
            Custom Track Cup Season 1 Statistics
          </h1>
          <p className="mt-4 text-lg text-gray-200">
            Created by Lawrence
          </p>

          <div className="mt-6 flex justify-center gap-4 flex-wrap">
            <Link
              to="/stats"
              className="px-6 py-3 rounded-xl bg-purple-600 text-white font-semibold hover:bg-red-800 transition"
            >
              View Player Statistics
            </Link>

            <Link
              to="/top-team-players"
              className="px-6 py-3 rounded-xl bg-purple-600 text-white font-semibold hover:bg-red-700 transition"
            >
              Best Team Averages
            </Link>

            <Link
              to="/best-matchups"
              className="px-6 py-3 rounded-xl bg-purple-600 text-white font-semibold hover:bg-red-700 transition"
            >
              Team Matchups
            </Link>
          </div>
        </div>
      </header>
      <header className="bg-black/80 backdrop-blur-sm">
        <div className="mt-10 px-2 py-9">
          <div className="mx-auto max-w-6xl">
            <h1 className="text-2xl mb-6 text-center">
              This website visualizes 
              analytics using player data gathered 
              from the first season of Custom Track Cup MKWII.
              All statistics were gathered with MKW Table Bot
              generated JSON data submitted at the end of each
              match thread. Missing, incomplete, or incorrect data
              may lead to inaccuracies in the statistics shown.
              Report any duplicate names or obvious errors if seen.
            </h1>
          </div>
          </div>
        <div className="mt-8 px-6 py-8">
          <div className="mx-auto max-w-4xl">
            <h2 className="text-2xl font-bold mb-6 text-center">
              Twitch Channel
            </h2>

        <iframe
          src={`https://player.twitch.tv/?channel=customtrackcupmkwii&parent=${window.location.hostname}`}
          height="500"
          width="100%"
          allow="autoplay; fullscreen; encrypted-media"
          allowFullScreen
          className="rounded-xl shadow-lg"
          title="Custom Track Cup MKWii Twitch Channel"
        />
          </div>
      </div>
                </header>
    </div>
  );
}