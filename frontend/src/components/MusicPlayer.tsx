import { useState, useRef, useEffect } from "react";

// List of music tracks (add your music files to public/music/)
const musicTracks = [
  "/music/track%20(1).mp3",
  "/music/track%20(2).mp3",
  "/music/track%20(3).mp3",
  "/music/track%20(4).mp3",
  "/music/track%20(5).mp3",
  "/music/track%20(6).mp3",
  "/music/track%20(7).mp3",
  "/music/track%20(8).mp3",
  "/music/track%20(9).mp3",
  "/music/track%20(10).mp3",
  "/music/track%20(11).mp3",
  "/music/track%20(12).mp3",
  "/music/track%20(13).mp3",
  "/music/track%20(14).mp3",
  "/music/track%20(15).mp3",
  "/music/track%20(16).mp3",
  "/music/track%20(17).mp3",
];

export default function MusicPlayer() {
  const [isPlaying, setIsPlaying] = useState(false);
  const [volume, setVolume] = useState(0.3);
  const [showControls, setShowControls] = useState(false);
  const [currentTrack, setCurrentTrack] = useState<string>("");
  const [showStartPrompt, setShowStartPrompt] = useState(true);
  const audioRef = useRef<HTMLAudioElement>(null);

  // Select random track on mount and auto-play
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
  }, [currentTrack, isPlaying]);

  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.volume = volume;
    }
  }, [volume]);

  const togglePlay = () => {
    if (audioRef.current) {
      if (isPlaying) {
        audioRef.current.pause();
      } else {
        audioRef.current.play();
      }
      setIsPlaying(!isPlaying);
    }
  };

  const startMusic = () => {
    setShowStartPrompt(false);
    setIsPlaying(true);
    if (audioRef.current) {
      audioRef.current.play();
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
      {/* Hidden audio element */}
      {currentTrack && (
        <audio
          ref={audioRef}
          src={currentTrack}
          onEnded={handleTrackEnd}
        />
      )}

      {/* Start Music Prompt */}
      {showStartPrompt && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="bg-gray-900 border-2 border-purple-500 rounded-lg p-8 shadow-2xl max-w-sm mx-4">
            <div className="text-center">
              <svg
                className="w-16 h-16 text-purple-500 mx-auto mb-4"
                fill="currentColor"
                viewBox="0 0 20 20"
              >
                <path
                  fillRule="evenodd"
                  d="M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168A1 1 0 008 8v4a1 1 0 001.555.832l3-2a1 1 0 000-1.664l-3-2z"
                  clipRule="evenodd"
                />
              </svg>
              <h2 className="text-2xl font-bold text-white mb-2">Thanks for Visiting!</h2>
              <p className="text-gray-400 mb-6">Start Background Music?</p>
              <div className="flex gap-3">
                <button
                  onClick={startMusic}
                  className="flex-1 bg-purple-600 hover:bg-purple-700 text-white font-semibold py-3 px-6 rounded-lg transition-all"
                >
                  Start Music
                </button>
                <button
                  onClick={() => setShowStartPrompt(false)}
                  className="flex-1 bg-gray-700 hover:bg-gray-600 text-white font-semibold py-3 px-6 rounded-lg transition-all"
                >
                  No Thanks
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Floating music control button */}
      <div className="fixed bottom-6 right-6 z-50">
        <div 
          className="relative"
          onMouseEnter={() => setShowControls(true)}
          onMouseLeave={() => setShowControls(false)}
        >
          {/* Controls panel */}
          {showControls && (
            <div className="absolute bottom-full right-0 bg-black/90 backdrop-blur-sm rounded-lg p-4 shadow-xl border border-purple-500/50 w-48 mb-1">
              <div className="space-y-3">
                <div>
                  <label className="block text-white text-sm mb-2">
                    Volume
                  </label>
                  <input
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
            onClick={togglePlay}
            className={`w-14 h-14 rounded-full flex items-center justify-center transition-all shadow-lg ${
              isPlaying
                ? "bg-purple-600 hover:bg-purple-700"
                : "bg-gray-700 hover:bg-gray-600"
            }`}
            title={isPlaying ? "Pause Music" : "Play Music"}
          >
            {isPlaying ? (
              <svg
                className="w-6 h-6 text-white"
                fill="currentColor"
                viewBox="0 0 20 20"
              >
                <path
                  fillRule="evenodd"
                  d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zM7 8a1 1 0 012 0v4a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v4a1 1 0 102 0V8a1 1 0 00-1-1z"
                  clipRule="evenodd"
                />
              </svg>
            ) : (
              <svg
                className="w-6 h-6 text-white ml-1"
                fill="currentColor"
                viewBox="0 0 20 20"
              >
                <path
                  fillRule="evenodd"
                  d="M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168A1 1 0 008 8v4a1 1 0 001.555.832l3-2a1 1 0 000-1.664l-3-2z"
                  clipRule="evenodd"
                />
              </svg>
            )}
          </button>
        </div>
      </div>
    </>
  );
}
