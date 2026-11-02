// Thin helpers over the engine-pinia store for camera reads and flights.

import { engineStore } from "@wwtelescope/engine-pinia";
import { Constellations, WWTControl } from "@wwtelescope/engine";
import type { ConstellationEntry } from "./catalog/search";

const D2R = Math.PI / 180;
export const MIN_FOV = 0.0005;
export const MAX_FOV = 60;

export interface Camera { raDeg: number; decDeg: number; fovDeg: number; rollDeg: number }

export function readCamera(): Camera {
  const e = engineStore();
  return {
    raDeg: (((e.raRad / D2R) % 360) + 360) % 360,
    decDeg: e.decRad / D2R,
    fovDeg: e.zoomDeg / 6,
    rollDeg: e.rollRad / D2R,
  };
}

/** Fly to a position. Resolves with the flight time in ms (0 when instant). */
export function flyTo(raDeg: number, decDeg: number, fovDeg: number, instant = false): number {
  const e = engineStore();
  const fov = Math.max(MIN_FOV, Math.min(MAX_FOV, fovDeg));
  const target = { raRad: raDeg * D2R, decRad: decDeg * D2R, zoomDeg: fov * 6, rollRad: 0 };
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (instant || reduced) {
    e.gotoRADecZoom({ ...target, instant: true }).catch(() => undefined);
    return 0;
  }
  // The engine's own estimate is exact (±40 ms); keep short hops from snapping.
  const ms = Math.max(1200, e.timeToRADecZoom(target) * 1000);
  e.gotoRADecZoom({ ...target, instant: false, duration: ms / 1000 }).catch(() => undefined);
  return ms;
}

/** IAU abbreviation of the constellation at the view centre ("ORI"). */
export function centreConstellation(): string {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return ((WWTControl.singleton as any)?.constellation as string) ?? "";
}

export function constellationName(abbr: string): string {
  return Constellations.fullNames?.[abbr] ?? abbr;
}

/** Constellation centroids for search, once the engine has loaded them. */
export function constellationList(): ConstellationEntry[] {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const centroids = (Constellations as any).constellationCentroids as Record<string, any> | null;
  if (!centroids) { return []; }
  return Object.keys(centroids).map((abbr) => {
    const p = centroids[abbr];
    return { abbr, name: constellationName(abbr), raDeg: p.get_RA() * 15, decDeg: p.get_dec() };
  }).filter((c) => c.name && c.name !== c.abbr);
}

export function formatRA(deg: number): string {
  const t = Math.round(((deg / 15) % 24 + 24) % 24 * 3600);
  const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = t % 60;
  return `${String(h).padStart(2, "0")}h${String(m).padStart(2, "0")}m${String(s).padStart(2, "0")}s`;
}

export function formatDec(deg: number): string {
  const sign = deg < 0 ? "−" : "+";
  const t = Math.round(Math.abs(deg) * 3600);
  const d = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = t % 60;
  return `${sign}${String(d).padStart(2, "0")}°${String(m).padStart(2, "0")}′${String(s).padStart(2, "0")}″`;
}

export function formatSize(deg: number): string {
  if (deg >= 1) { return `${deg.toFixed(deg >= 10 ? 0 : 1)}°`; }
  if (deg * 60 >= 1) { return `${Math.round(deg * 60)}′`; }
  return `${Math.max(1, Math.round(deg * 3600))}″`;
}
