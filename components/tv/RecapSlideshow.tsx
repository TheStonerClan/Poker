"use client";

import { useEffect, useState } from "react";

type Slide = {
  /** Stable id for keying + the slide-indicator dots. */
  key: string;
  /** Short uppercase label rendered above the slide. */
  label: string;
  /** Pre-rendered server-component output for the slide body. */
  content: React.ReactNode;
};

type Props = {
  slides: Slide[];
  /** Seconds before advancing to the next slide. Default 10s. */
  intervalSec?: number;
};

/**
 * Rotates a list of slides on the TV recap. Each slide takes the full
 * available area; transitions are instant (no fade) so a player glancing
 * up never has to wait for the relevant info to come into focus.
 *
 * Children are rendered server-side and passed in as React nodes so the
 * heavy data shaping (leaderboard sort, per-player history merge,
 * payout lookups) stays in TvRecap and doesn't ship to the client.
 */
export default function RecapSlideshow({
  slides,
  intervalSec = 10,
}: Props) {
  const [index, setIndex] = useState(0);

  useEffect(() => {
    if (slides.length <= 1) return;
    const id = window.setInterval(() => {
      setIndex((prev) => (prev + 1) % slides.length);
    }, intervalSec * 1000);
    return () => window.clearInterval(id);
  }, [slides.length, intervalSec]);

  if (slides.length === 0) return null;
  const current = slides[index] ?? slides[0];

  return (
    <div className="flex flex-1 flex-col min-h-0">
      <div className="flex items-baseline justify-center gap-3 mb-[clamp(0.5rem,1.5vh,1.5rem)]">
        <span className="text-gold uppercase tracking-[0.4em] text-[clamp(0.75rem,1.2vw,1.1rem)] font-semibold">
          {current.label}
        </span>
        <span aria-hidden className="flex gap-1.5">
          {slides.map((s, i) => (
            <span
              key={s.key}
              className={`block h-1.5 w-1.5 rounded-full ${
                i === index ? "bg-gold" : "bg-fg/20"
              }`}
            />
          ))}
        </span>
      </div>
      <div className="flex flex-1 min-h-0 flex-col overflow-hidden">
        {current.content}
      </div>
    </div>
  );
}
