import React, { useEffect, useState } from "react";

export default function BackgroundSlideshow(): React.JSX.Element {
  const images = Array.from({ length: 343 }, (_, i) => `/images/CT_BGS/bg_(${i + 1}).png`);

  const [current, setCurrent] = useState(0);

  // Preload only current image for reduced data transfer
  useEffect(() => {
    const preload = (src: string) => {
      const img = new Image();
      img.src = src;
    };
    
    // Preload only the current image
    preload(images[current]);
  }, [current, images]);

  useEffect(() => {
    const interval = setInterval(() => {
      setCurrent((prev) => (prev + 1) % images.length);
    }, 7000);
    return () => clearInterval(interval);
  }, [images.length]);

  return (
    <div className="fixed inset-0 z-0 overflow-hidden bg-black">
      {/* Render only current image to reduce memory/bandwidth */}
      {images[current] && (
        <img
          key={images[current]}
          src={images[current]}
          alt={`Background ${current + 1}`}
          className="absolute inset-0 w-full h-full object-cover"
        />
      )}
      {/* Preload next image in background for smoother transition */}
      {images[(current + 1) % images.length] && (
        <link
          rel="preload"
          as="image"
          href={images[(current + 1) % images.length]}
        />
      )}

      {/* Dark overlay */}
      <div className="absolute inset-0 bg-black/40 z-10" />
    </div>
  );
}