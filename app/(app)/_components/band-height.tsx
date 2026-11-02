"use client";

import { useEffect } from "react";

/**
 * Publishes the header band's height as `--band-h`, so the sticky views bar and list sit right
 * under it however many rows the band wraps to.
 */
export function BandHeight() {
  useEffect(() => {
    const band = document.getElementById("band");
    if (!band) return;
    const root = document.documentElement.style;
    const update = () => root.setProperty("--band-h", `${band.offsetHeight}px`);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(band);
    return () => observer.disconnect();
  }, []);
  return null;
}
