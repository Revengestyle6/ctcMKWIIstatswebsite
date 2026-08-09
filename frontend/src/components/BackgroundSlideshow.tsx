import type React from "react";
import { useEffect, useState } from "react";
import { useLeague } from "../context/LeagueContext";

export default function BackgroundSlideshow(): React.JSX.Element {
  const { config } = useLeague();
  const images = config.backgrounds;
  const [current, setCurrent] = useState(0);

  useEffect(() => {
    setCurrent(images.length > 0 ? Math.floor(Math.random() * images.length) : 0);
  }, [images]);

  useEffect(() => {
    if (images.length < 2) return;
    const interval = setInterval(() => {
      setCurrent((previous) => {
        const candidate = Math.floor(Math.random() * (images.length - 1));
        return candidate >= previous ? candidate + 1 : candidate;
      });
    }, 15000);
    return () => clearInterval(interval);
  }, [images]);

  const imageUrl = images[current];

  return (
    <div className="fixed inset-0 z-0 overflow-hidden league-page-fallback" aria-hidden="true">
      {imageUrl ? (
        <img
          key={imageUrl}
          src={imageUrl}
          alt=""
          className="absolute inset-0 h-full w-full object-cover"
        />
      ) : (
        <div className="absolute inset-0 league-background-fallback" />
      )}
      <div className="absolute inset-0 z-10 bg-black/45" />
    </div>
  );
}
