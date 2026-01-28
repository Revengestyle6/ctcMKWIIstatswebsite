import React, { useEffect, useState } from "react";

export default function BackgroundSlideshow(): React.JSX.Element {
  const images = Array.from({ length: 343 }, (_, i) => `/images/CT_BGS/bg_(${i + 1}).png`);

  const [current, setCurrent] = useState(0);

  // Preload images for smooth transitions
  useEffect(() => {
    const preload = (src: string) => {
      const img = new Image();
      img.src = src;
    };
    
    // Preload current, next, and previous images
    preload(images[current]);
    preload(images[(current + 1) % images.length]);
    preload(images[(current - 1 + images.length) % images.length]);
  }, [current, images]);

  useEffect(() => {
    const interval = setInterval(() => {
      setCurrent((prev) => (prev + 1) % images.length);
    }, 7000);
    return () => clearInterval(interval);
  }, [images.length]);

  return (
    <div className="fixed inset-0 z-0 overflow-hidden bg-black">
      {/* Render current, next, and previous images for smooth fade transitions */}
      {images.map((img, idx) => {
        const isVisible = 
          idx === current || 
          idx === ((current + 1) % images.length) ||
          idx === ((current - 1 + images.length) % images.length);
        
        if (!isVisible) return null;
        
        return (
          <img
            key={img}
            src={img}
            alt={`Background ${idx + 1}`}
            className={`absolute inset-0 w-full h-full object-cover transition-opacity duration-1000 ${
              idx === current ? "opacity-100" : "opacity-0"
            }`}
          />
        );
      })}

      {/* Dark overlay */}
      <div className="absolute inset-0 bg-black/40 z-10" />
    </div>
  );
}