import { useEffect, useRef, useState } from "react";

function randomTrack() {
  return `/media/audio/shared/track-${String(1 + Math.floor(Math.random() * 17)).padStart(2, "0")}.mp3`;
}

export default function MusicPlayer() {
  const [isPlaying, setIsPlaying] = useState(false);
  const [volume, setVolume] = useState(0.3);
  const [track, setTrack] = useState("");
  const [error, setError] = useState("");
  const audio = useRef<HTMLAudioElement>(null);

  useEffect(() => {
    const element = audio.current;
    if (!element || !track) return;
    let cancelled = false;
    if (isPlaying) {
      element.play().catch(() => {
        if (!cancelled) {
          setIsPlaying(false);
          setError("Music couldn’t play. Try again.");
        }
      });
    } else element.pause();
    return () => {
      cancelled = true;
    };
  }, [track, isPlaying]);

  useEffect(() => {
    if (audio.current) audio.current.volume = volume;
  }, [volume]);

  return (
    <details className="music-menu">
      <summary className="music-trigger">
        Music
        {isPlaying ? (
          <>
            <span aria-hidden="true" className="music-indicator" />
            <span className="sr-only">Playing</span>
          </>
        ) : null}
      </summary>
      <div className="nav-menu-panel music-panel">
        <p className="font-semibold">Background music</p>
        <p className="mt-1 text-sm text-gray-400">Listen while you explore.</p>
        <button
          type="button"
          className="ui-button mt-4 w-full"
          onClick={() => {
            setError("");
            if (!track) setTrack(randomTrack());
            setIsPlaying((playing) => !playing);
          }}
        >
          {isPlaying ? "Pause music" : "Play music"}
        </button>
        <label htmlFor="music-volume" className="mt-4 block text-sm text-gray-300">
          Volume
        </label>
        <input
          id="music-volume"
          type="range"
          min="0"
          max="1"
          step="0.01"
          value={volume}
          onChange={(event) => setVolume(Number(event.target.value))}
          className="mt-2 w-full"
        />
        {error && (
          <p role="status" className="mt-2 text-sm text-rose-200">
            {error}
          </p>
        )}
      </div>
      <audio
        ref={audio}
        src={track || undefined}
        preload="none"
        onEnded={() => {
          const next = randomTrack();
          if (next === track && audio.current) {
            audio.current.currentTime = 0;
            void audio.current.play().catch(() => setIsPlaying(false));
          } else setTrack(next);
        }}
      />
    </details>
  );
}
