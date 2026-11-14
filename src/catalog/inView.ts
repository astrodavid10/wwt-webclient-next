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
  /**
   * The part of the screen not covered by panels, in degrees from the screen
   * centre (x right, y up). Images are "in view" only where they overlap it,
   * and edge hints point out from its centre. Defaults to the whole screen.
   */
  window?: { x0: number; x1: number; y0: number; y1: number };
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
  const win = view.window ?? { x0: -viewW / 2, x1: viewW / 2, y0: -viewH / 2, y1: viewH / 2 };
  const winCx = (win.x0 + win.x1) / 2, winCy = (win.y0 + win.y1) / 2;
  const winHw = Math.max(1e-9, (win.x1 - win.x0) / 2), winHh = Math.max(1e-9, (win.y1 - win.y0) / 2);
  // Image sizes are judged against the visible area's shorter side.
  const refDeg = Math.min(2 * winHw, 2 * winHh);
  const centre = unitVector(view.raDeg / 15, view.decDeg);
  const roll = (view.rollDeg ?? 0) * Math.PI / 180;
  const cr = Math.cos(roll), sr = Math.sin(roll);

  const hits: InViewItem[] = [];
  // Edge clusters: summed unit vectors (an RA average breaks across 0h) and
  // the distinct pictures seen, so duplicate entries count once.
  const edgeBins = new Map<number, { keys: Set<string>; v: [number, number, number] }>();

  for (const p of images) {
    const half = Math.max(p.sizeDeg, 1e-4) / 2;
    const sep = sepDeg(p.vec, centre);
    if (sep > halfDiag * 2 + half) { continue; }
    const t = raDecToOffset(view.raDeg, view.decDeg, p.raHours * 15, p.decDeg);
    if (!t) { continue; }
    // Screen axes: x to the right (= west on the sky), y up.
    const sx = -(t[0] * cr - t[1] * sr), sy = t[0] * sr + t[1] * cr;
    const ix = Math.max(0, Math.min(sx + half, win.x1) - Math.max(sx - half, win.x0));
    const iy = Math.max(0, Math.min(sy + half, win.y1) - Math.max(sy - half, win.y0));
    const ratio = p.sizeDeg / refDeg;
    // Position relative to the visible area, in its half-widths/heights.
    const ux = (sx - winCx) / winHw, uy = (sy - winCy) / winHh;
    if (ix * iy > 0) {
      const frac = (ix * iy) / (4 * half * half);
      const central = 1 - 0.5 * Math.min(1, Math.hypot(ux, uy) / Math.SQRT2);
      hits.push({ place: p, score: frac * sizeFit(p.sizeDeg, refDeg) * central, frac, dupes: [] });
    } else if (ratio >= SMALL_RATIO && ratio <= WIDE_RATIO && Math.max(Math.abs(ux), Math.abs(uy)) < 1.9) {
      // Screen angle, y down, so sector 2 is "down".
      const ang = Math.atan2(-uy, ux);
      const sector = ((Math.round(ang / (Math.PI / 4)) % 8) + 8) % 8;
      const b = edgeBins.get(sector) ?? { keys: new Set<string>(), v: [0, 0, 0] as [number, number, number] };
      const key = dupeKey(p);
      if (!b.keys.has(key)) {
        b.keys.add(key);
        b.v[0] += p.vec[0]; b.v[1] += p.vec[1]; b.v[2] += p.vec[2];
      }
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
    const ratio = h.place.sizeDeg / refDeg;
    groups[ratio > WIDE_RATIO ? "wide" : ratio < SMALL_RATIO ? "small" : "fit"].push(h);
  }
  // Wider fields: the closest in size first, not the whole-sky surveys.
  groups.wide.sort((a, b) => a.place.sizeDeg - b.place.sizeDeg);

  const edges: EdgeHint[] = [];
  for (const [sector, b] of edgeBins) {
    const n = b.keys.size;
    if (n < 2) { continue; }
    const [x, y, z] = b.v;
    const raDeg = ((Math.atan2(y, x) * 180 / Math.PI) % 360 + 360) % 360;
    const decDeg = Math.atan2(z, Math.hypot(x, y)) * 180 / Math.PI;
    edges.push({ sector, count: n, raDeg, decDeg });
  }
  return { ...groups, total: hits.length, edges };
}
