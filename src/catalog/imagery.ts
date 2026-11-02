// Engine-side helpers for a SkyPlace's study image: building the Imageset,
// a sharp thumbnail, and an approximate footprint on the sky.

import { Imageset, Vector3d } from "@wwtelescope/engine";
import type { SkyPlace } from "./types";

const D2R = Math.PI / 180;
const IMAGESET_TYPE_SKY = 2;
let nextImagesetId = 910_000;

/** Build the engine Imageset for a place's study, exactly as the classic client does. */
export function makeImageset(place: SkyPlace): Imageset | null {
  const s = place.study;
  if (!s) { return null; }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const create = (Imageset as any).create as (...args: unknown[]) => Imageset;
  return create(
    s.imagesetName || place.name, s.url, IMAGESET_TYPE_SKY, s.bandPass, s.projection,
    nextImagesetId++, s.baseLevel, s.tileLevels, null, s.baseDeg, s.fileType, s.bottomsUp,
    s.quadTreeMap, s.centerX, s.centerY, s.rotation, true, s.thumbUrl, false, false,
    s.widthFactor, s.offsetX, s.offsetY, s.credits, s.creditsUrl, "", "", 0, null,
  );
}

/**
 * The imageset's level-0 tile: a sharp 256 px rendering of the whole image,
 * unlike the 96x45 ThumbnailUrl. Falls back to the thumbnail for URL schemes
 * without the {1}/{2}/{3} level/x/y template.
 */
export function thumbnailFor(place: SkyPlace): string {
  const s = place.study;
  if (!s) { return ""; }
  // WidthFactor 1 studies have two level-0 tiles side by side; one is half the image.
  if (s.widthFactor === 1) { return s.thumbUrl; }
  if (hasTileTemplate(s.url)) {
    return s.url.replace(/\{1\}|\{2\}|\{3\}/g, "0");
  }
  return s.thumbUrl;
}

function hasTileTemplate(url: string): boolean {
  return /\{1\}/.test(url) && /\{2\}/.test(url) && /\{3\}/.test(url);
}

/** Side of the (square) footprint we draw, degrees. */
export function footprintSize(place: SkyPlace): number {
  const s = place.study;
  if (!s) { return 0; }
  return s.baseDeg > 0 ? Math.min(place.sizeDeg, s.baseDeg) : place.sizeDeg;
}

/** Inverse gnomonic projection: tangent-plane offset (degrees, x east) to RA/Dec. */
export function offsetToRaDec(ra0Deg: number, dec0Deg: number, xDeg: number, yDeg: number): [number, number] {
  const x = xDeg * D2R, y = yDeg * D2R, d0 = dec0Deg * D2R;
  const rho = Math.hypot(x, y);
  if (rho < 1e-12) { return [ra0Deg, dec0Deg]; }
  const c = Math.atan(rho);
  const dec = Math.asin(Math.cos(c) * Math.sin(d0) + y * Math.sin(c) * Math.cos(d0) / rho);
  const ra = ra0Deg * D2R + Math.atan2(x * Math.sin(c), rho * Math.cos(d0) * Math.cos(c) - y * Math.sin(d0) * Math.sin(c));
  return [((ra / D2R) % 360 + 360) % 360, dec / D2R];
}

/** Gnomonic projection about (ra0, dec0): RA/Dec to tangent-plane degrees, x east. Null behind. */
export function raDecToOffset(ra0Deg: number, dec0Deg: number, raDeg: number, decDeg: number): [number, number] | null {
  const a = raDeg * D2R, d = decDeg * D2R, a0 = ra0Deg * D2R, d0 = dec0Deg * D2R;
  const cosc = Math.sin(d0) * Math.sin(d) + Math.cos(d0) * Math.cos(d) * Math.cos(a - a0);
  if (cosc < 0.05) { return null; }
  const x = Math.cos(d) * Math.sin(a - a0) / cosc;
  const y = (Math.cos(d0) * Math.sin(d) - Math.sin(d0) * Math.cos(d) * Math.cos(a - a0)) / cosc;
  return [x / D2R, y / D2R];
}

/**
 * Four RA/Dec corners (degrees) of the approximate footprint: a square of
 * footprintSize() centred on the study centre, rotated by its Rotation. The
 * search index has no pixel dimensions, so the true aspect ratio is unknown.
 */
export function footprintCorners(place: SkyPlace): [number, number][] {
  const s = place.study;
  if (!s) { return []; }
  const half = footprintSize(place) / 2;
  const rot = -s.rotation * D2R;
  return [[-half, -half], [half, -half], [half, half], [-half, half]].map(([x, y]) => {
    const xr = x * Math.cos(rot) - y * Math.sin(rot), yr = x * Math.sin(rot) + y * Math.cos(rot);
    return offsetToRaDec(s.centerX, s.centerY, xr, yr);
  });
}

// ── Exact footprints from the level-0 tile ─────────────────────────────────
//
// A TAN study's level-0 tile spans BaseDegreesPerTile on a side, with the
// image somewhere inside it and transparent (or black) padding around it. The
// opaque pixels' bounding box, pushed through the same geometry the engine's
// TangentTile uses (lat/lng in the tile, then the imageset's rotation matrix),
// gives the image's true corners on the sky.

const refined = new Map<string, [number, number][] | null>();
const inflight = new Map<string, Promise<[number, number][] | null>>();
const imagesets = new Map<string, Imageset>();

/** Corners refined from the tile, if already computed (null = refinement failed). */
export function refinedCorners(id: string): [number, number][] | null | undefined {
  return refined.get(id);
}

function tileToRaDec(place: SkyPlace, px: number, py: number, size: number): [number, number] | null {
  const s = place.study;
  if (!s) { return null; }
  let iset = imagesets.get(place.id);
  if (!iset) { iset = makeImageset(place) ?? undefined; if (!iset) { return null; } imagesets.set(place.id, iset); }
  const bd = s.baseDeg, fac1 = bd / 2, factor = Math.tan(fac1 * D2R);
  const lat = bd / 2 + s.offsetY - (py / size) * bd;
  const lng = (px / size) * bd - bd / s.widthFactor + s.offsetX;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const m = (iset as any).get_matrix();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const v = m.transform((Vector3d as any).create(1, lat / fac1 * factor, -lng / fac1 * factor));
  const r = Math.hypot(v.x, v.y, v.z);
  // Engine sky frame (Coordinates.raDecTo3d): x = cos ra cos dec, y = sin dec, z = sin ra cos dec.
  const ra = ((Math.atan2(v.z, v.x) / D2R) % 360 + 360) % 360;
  return [ra, Math.asin(v.y / r) / D2R];
}

/**
 * Work out the image's real corners from its level-0 tile. Resolves with the
 * corners (also cached) or null when the tile can't be read (no CORS, no
 * tile template, bottoms-up layout).
 */
export function refineFootprint(place: SkyPlace): Promise<[number, number][] | null> {
  const known = refined.get(place.id);
  if (known !== undefined) { return Promise.resolve(known); }
  const pending = inflight.get(place.id);
  if (pending) { return pending; }
  const s = place.study;
  if (!s || s.bottomsUp || s.projection !== 2 || !hasTileTemplate(s.url)) {
    refined.set(place.id, null);
    return Promise.resolve(null);
  }
  const job = (async (): Promise<[number, number][] | null> => {
    try {
      // Level 0 is one tile across, or two when WidthFactor is 1.
      const across = s.widthFactor === 1 ? 2 : 1;
      const bmps: ImageBitmap[] = [];
      for (let x = 0; x < across; x++) {
        // Templates can repeat a placeholder ("{1}/{3}/{3}_{2}.png").
        const url = s.url.replace(/\{1\}/g, "0").replace(/\{2\}/g, String(x)).replace(/\{3\}/g, "0");
        // Cache-bust: a thumbnail <img> loaded without CORS would taint the canvas.
        const res = await fetch(`${url}${url.includes("?") ? "&" : "?"}fp=1`, { mode: "cors" });
        if (!res.ok) { return null; }
        bmps.push(await createImageBitmap(await res.blob()));
      }
      const size = bmps[0].width;
      const c = document.createElement("canvas");
      c.width = size * across; c.height = bmps[0].height;
      const g = c.getContext("2d", { willReadFrequently: true });
      if (!g) { return null; }
      bmps.forEach((b, i) => g.drawImage(b, i * size, 0));
      const d = g.getImageData(0, 0, c.width, c.height).data;
      let x0 = c.width, y0 = c.height, x1 = -1, y1 = -1;
      for (let y = 0; y < c.height; y++) {
        for (let x = 0; x < c.width; x++) {
          const i = (y * c.width + x) * 4;
          if (d[i + 3] > 8 && d[i] + d[i + 1] + d[i + 2] > 6) {
            if (x < x0) { x0 = x; } if (x > x1) { x1 = x; }
            if (y < y0) { y0 = y; } if (y > y1) { y1 = y; }
          }
        }
      }
      if (x1 < 0) { return null; }
      const corners = [[x0, y0], [x1 + 1, y0], [x1 + 1, y1 + 1], [x0, y1 + 1]]
        .map(([x, y]) => tileToRaDec(place, x, y, size));
      if (corners.some((p) => !p)) { return null; }
      return corners as [number, number][];
    } catch {
      return null;
    }
  })().then((corners) => { refined.set(place.id, corners); inflight.delete(place.id); return corners; });
  inflight.set(place.id, job);
  return job;
}
