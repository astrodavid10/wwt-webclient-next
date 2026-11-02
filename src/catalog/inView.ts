// "In view": every image whose footprint overlaps the screen, from any
// constellation, sorted into three groups by how its size compares with the
// field of view. Pure functions over SkyPlace data; no engine calls, so it
// can be unit-tested and run on every camera change (3.9k images < 2 ms).

import type { SkyPlace } from "./types";
import { sepDeg, unitVector } from "./searchIndex";
import { raDecToOffset } from "./imagery";

export interface ViewState {
  raDeg: number;
  decDeg: number;
  /** Vertical field of view, degrees. */
  fovDeg: number;
  /** Width / height of the canvas. */
  aspect: number;
  rollDeg?: number;
}

export interface InViewItem {
  place: SkyPlace;
  score: number;
  /** Fraction of the image's footprint that is on screen. */
  frac: number;
  /** Other entries for the same picture (same name, size and source). */
  dupes: SkyPlace[];
}

export interface EdgeHint {
  /** 0 = right, 1 = down-right ... 7 = up-right (screen directions, 45 degree steps). */
  sector: number;
  count: number;
  raDeg: number;
  decDeg: number;
}

export interface InViewResult {
  fit: InViewItem[];
  wide: InViewItem[];
  small: InViewItem[];
  /** Images overlapping the view, before duplicates are merged. */
  total: number;
  edges: EdgeHint[];
}

/** Image size / view size below which an image is "zoom in for detail". */
export const SMALL_RATIO = 0.06;
/** Image size / view size above which an image is a "wider field". */
export const WIDE_RATIO = 1.6;

/** 1 when the image spans ~45% of the view height, falling off on a log scale. */
export function sizeFit(imageDeg: number, viewDeg: number): number {
  const l = Math.log(imageDeg / viewDeg / 0.45);
  return Math.exp(-l * l / 2.2);
}

function dupeKey(p: SkyPlace): string {
  return `${p.name.toLowerCase()}|${p.sizeDeg.toFixed(3)}|${p.source}`;
}

export function computeInView(images: SkyPlace[], view: ViewState): InViewResult {
  const viewW = view.fovDeg * view.aspect, viewH = view.fovDeg;
  const halfDiag = Math.hypot(viewW, viewH) / 2;
  const centre = unitVector(view.raDeg / 15, view.decDeg);
  const roll = (view.rollDeg ?? 0) * Math.PI / 180;
  const cr = Math.cos(roll), sr = Math.sin(roll);

  const hits: InViewItem[] = [];
  const edgeBins = new Map<number, { n: number; ra: number; dec: number }>();

  for (const p of images) {
    const half = Math.max(p.sizeDeg, 1e-4) / 2;
    const sep = sepDeg(p.vec, centre);
    if (sep > halfDiag * 2 + half) { continue; }
    const t = raDecToOffset(view.raDeg, view.decDeg, p.raHours * 15, p.decDeg);
    if (!t) { continue; }
    // Screen axes: x to the right (= west on the sky), y up.
    const sx = -(t[0] * cr - t[1] * sr), sy = t[0] * sr + t[1] * cr;
    const ix = Math.max(0, Math.min(sx + half, viewW / 2) - Math.max(sx - half, -viewW / 2));
    const iy = Math.max(0, Math.min(sy + half, viewH / 2) - Math.max(sy - half, -viewH / 2));
    const ratio = p.sizeDeg / view.fovDeg;
    if (ix * iy > 0) {
      const frac = (ix * iy) / (4 * half * half);
      const central = 1 - 0.5 * Math.min(1, Math.hypot(sx / (viewW / 2), sy / (viewH / 2)) / Math.SQRT2);
      hits.push({ place: p, score: frac * sizeFit(p.sizeDeg, view.fovDeg) * central, frac, dupes: [] });
    } else if (ratio >= SMALL_RATIO && ratio <= WIDE_RATIO
      && Math.max(Math.abs(sx) / (viewW / 2), Math.abs(sy) / (viewH / 2)) < 1.9) {
      // Screen angle, y down, so sector 2 is "down".
      const ang = Math.atan2(-sy, sx);
      const sector = ((Math.round(ang / (Math.PI / 4)) % 8) + 8) % 8;
      const b = edgeBins.get(sector) ?? { n: 0, ra: 0, dec: 0 };
      b.n++; b.ra += p.raHours * 15; b.dec += p.decDeg;
      edgeBins.set(sector, b);
    }
  }

  hits.sort((a, b) => b.score - a.score);
  const groups: Record<"fit" | "wide" | "small", InViewItem[]> = { fit: [], wide: [], small: [] };
  const firstByKey = new Map<string, InViewItem>();
  for (const h of hits) {
    const key = dupeKey(h.place);
    const first = firstByKey.get(key);
    if (first) { first.dupes.push(h.place); continue; }
    firstByKey.set(key, h);
    const ratio = h.place.sizeDeg / view.fovDeg;
    groups[ratio > WIDE_RATIO ? "wide" : ratio < SMALL_RATIO ? "small" : "fit"].push(h);
  }
  // Wider fields: the closest in size first, not the whole-sky surveys.
  groups.wide.sort((a, b) => a.place.sizeDeg - b.place.sizeDeg);

  const edges: EdgeHint[] = [];
  for (const [sector, b] of edgeBins) {
    if (b.n < 2) { continue; }
    edges.push({ sector, count: b.n, raDeg: b.ra / b.n, decDeg: b.dec / b.n });
  }
  return { ...groups, total: hits.length, edges };
}
