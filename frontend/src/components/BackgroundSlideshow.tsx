import React, { useEffect, useState } from "react";

export default function BackgroundSlideshow(): React.JSX.Element {
  const images = Array.from({ length: 343 }, (_, i) => `/images/CT_BGS/bg_(${i + 1}).png`);

  const [current, setCurrent] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => {
      // Advance to the next image and wrap around
      setCurrent((prev) => (prev + 1) % images.length);
    }, 7000);
    return () => clearInterval(interval);
  }, [images.length]);

  return (
    <div className="fixed inset-0 z-0 overflow-hidden bg-black">
      {images.map((img, idx) => (
        <img
          key={img}
          src={img}
          alt={`Background ${idx + 1}`}
          className={`absolute inset-0 w-full h-full object-cover transition-opacity duration-1000 ${
            idx === current ? "opacity-100" : "opacity-0"
          }`}
        />
      ))}

      {/* Dark overlay */}
      <div className="absolute inset-0 bg-black/40 z-10" />
    </div>
  );
}