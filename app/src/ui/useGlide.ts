import { useEffect, useRef, useState } from "react";

import type { LatLng } from "../api/types";
import { GLIDE_MS, easeOutCubic, lerpLatLng, shouldGlide } from "../lib/glide";
import { useReduceMotion } from "./useReduceMotion";

/**
 * Where to draw a map dot whose real position is `lat`/`lng`: glides from the
 * last drawn spot to each new fix instead of teleporting (see lib/glide.ts).
 * A fix arriving mid-glide starts the next one from wherever the dot is now.
 * Under Reduce Motion, or for a jump too big to be driving, it snaps.
 *
 * Driven from JS on requestAnimationFrame because a MapLibre <Marker> is
 * placed by coordinate, not by an Animated transform. Each marker re-renders
 * only itself, for GLIDE_MS once per fix.
 */
export function useGlide(lat: number, lng: number): LatLng {
  const reduce = useReduceMotion();
  const [drawn, setDrawn] = useState<LatLng>({ lat, lng });
  const shown = useRef<LatLng>(drawn);

  useEffect(() => {
    const from = shown.current;
    const to = { lat, lng };
    const glide = !reduce && shouldGlide(from, to);
    const start = Date.now();
    let frame = 0;
    const step = () => {
      const t = glide ? Math.min(1, (Date.now() - start) / GLIDE_MS) : 1;
      const next = t >= 1 ? to : lerpLatLng(from, to, easeOutCubic(t));
      shown.current = next;
      setDrawn(next);
      if (t < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [lat, lng, reduce]);

  return drawn;
}
