import { useEffect, useRef, useState } from "react";

const musicTracks = [
  "/media/audio/shared/track-01.mp3",
  "/media/audio/shared/track-02.mp3",
  "/media/audio/shared/track-03.mp3",
  "/media/audio/shared/track-04.mp3",
  "/media/audio/shared/track-05.mp3",
  "/media/audio/shared/track-06.mp3",
  "/media/audio/shared/track-07.mp3",
  "/media/audio/shared/track-08.mp3",
  "/media/audio/shared/track-09.mp3",
  "/media/audio/shared/track-10.mp3",
  "/media/audio/shared/track-11.mp3",
  "/media/audio/shared/track-12.mp3",
  "/media/audio/shared/track-13.mp3",
  "/media/audio/shared/track-14.mp3",
  "/media/audio/shared/track-15.mp3",
  "/media/audio/shared/track-16.mp3",
  "/media/audio/shared/track-17.mp3",
];

export default function MusicPlayer() {
  const [isPlaying, setIsPlaying] = useState(false);
  const [volume, setVolume] = useState(0.3);
  const [showControls, setShowControls] = useState(false);
  const [currentTrack, setCurrentTrack] = useState<string>("");
  const audioRef = useRef<HTMLAudioElement>(null);

  // Select a random track on mount so it is ready if the user enables music.
  useEffect(() => {
    const randomTrack = musicTracks[Math.floor(Math.random() * musicTracks.length)];
    setCurrentTrack(randomTrack);
  }, []);

  // Auto-play when track is loaded
  useEffect(() => {
    if (audioRef.current && currentTrack) {
      audioRef.current.volume = volume;
      if (isPlaying) {
        const playPromise = audioRef.current.play();
        if (playPromise !== undefined) {
          playPromise.catch(() => {
            // Browser blocked auto-play, user needs to click play
            setIsPlaying(false);
          });
        }
      }
    }
  }, [currentTrack, isPlaying, volume]);

  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.volume = volume;
    }
  }, [volume]);

  const togglePlay = async () => {
    const audio = audioRef.current;
    if (!audio) return;

    if (isPlaying) {
      audio.pause();
      setIsPlaying(false);
      return;
    }

    try {
      await audio.play();
      setIsPlaying(true);
    } catch {
      setIsPlaying(false);
    }
  };

  const handleVolumeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newVolume = parseFloat(e.target.value);
    setVolume(newVolume);
    if (audioRef.current) {
      audioRef.current.volume = newVolume;
    }
  };

  const handleTrackEnd = () => {
    // Select new random track when current one ends
    const randomTrack = musicTracks[Math.floor(Math.random() * musicTracks.length)];
    setCurrentTrack(randomTrack);
    // Audio will auto-play via the useEffect above
  };

  return (
    <>
      {/* Hidden audio element - lazy load only when needed */}
      {currentTrack && (
        <audio ref={audioRef} src={currentTrack} onEnded={handleTrackEnd} preload="metadata" />
      )}

      {/* Floating music control button */}
      <div className="fixed bottom-6 right-6 z-50">
        <div
          className="relative"
          onMouseEnter={() => setShowControls(true)}
          onMouseLeave={() => setShowControls(false)}
          onFocus={() => setShowControls(true)}
          onBlur={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget)) setShowControls(false);
          }}
        >
          {/* Controls panel */}
          {showControls && (
            <div className="absolute bottom-full right-0 w-48 rounded-lg rounded-br-none border border-purple-500/50 bg-black/90 p-4 shadow-xl backdrop-blur-sm">
              <div className="space-y-3">
                <div>
                  <label htmlFor="music-volume" className="block text-white text-sm mb-2">
                    Volume
                  </label>
                  <input
                    id="music-volume"
                    type="range"
                    min="0"
                    max="1"
                    step="0.01"
                    value={volume}
                    onChange={handleVolumeChange}
                    className="w-full accent-purple-500"
                  />
                </div>
              </div>
            </div>
          )}

          {/* Main control button */}
          <button
            type="button"
            onClick={togglePlay}
            aria-label={isPlaying ? "Pause music" : "Play music"}
            aria-pressed={isPlaying}
            className={`flex h-12 items-center gap-2 rounded-full px-3.5 font-semibold text-white shadow-lg transition-all focus:outline-none focus:ring-2 focus:ring-purple-300 focus:ring-offset-2 focus:ring-offset-black ${
              isPlaying ? "bg-purple-600 hover:bg-purple-700" : "bg-gray-700 hover:bg-gray-600"
            }`}
            title={isPlaying ? "Pause background music" : "Play background music"}
          >
            <svg
              aria-hidden="true"
              className="h-5 w-5"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M9 18V5l10-2v13" />
              <circle cx="6" cy="18" r="3" />
              <circle cx="16" cy="16" r="3" />
            </svg>
            <span className="text-sm">Music</span>
            {isPlaying ? (
              <svg
                aria-hidden="true"
                className="h-4 w-4"
                viewBox="0 0 16 16"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <path d="M5 3v10M11 3v10" />
              </svg>
            ) : (
              <svg aria-hidden="true" className="h-4 w-4" fill="currentColor" viewBox="0 0 16 16">
                <path d="m5 2.5 8 5.5-8 5.5Z" />
              </svg>
            )}
          </button>
        </div>
      </div>
    </>
  );
}
