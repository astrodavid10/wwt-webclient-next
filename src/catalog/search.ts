// One search box: object names (prefix, word-prefix, substring and small
// typos), sky coordinates in the usual formats, constellation names, and,
// for anything else, the CDS Sesame name resolver.

import type { SkyPlace } from "./types";

export interface SearchHit {
  kind: "place" | "coords" | "constellation" | "resolver";
  label: string;
  detail: string;
  raDeg: number;
  decDeg: number;
  /** Field of view to fly to, degrees. */
  fovDeg: number;
  place?: SkyPlace;
}

export interface ConstellationEntry { abbr: string; name: string; raDeg: number; decDeg: number }

function norm(s: string): string {
  return s.toLowerCase().normalize("NFKD").replace(/[^a-z0-9+\-. ]/g, " ").replace(/\s+/g, " ").trim();
}

/** Optimal string alignment distance, stopping early above `max`. */
function editDistance(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) { return max + 1; }
  const prev2 = new Array(b.length + 1).fill(0);
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) { v = Math.min(v, prev2[j - 2] + 1); }
      cur[j] = v;
      rowMin = Math.min(rowMin, v);
    }
    if (rowMin > max) { return max + 1; }
    for (let j = 0; j < prev.length; j++) { prev2[j] = prev[j]; }
    prev = cur;
  }
  return prev[b.length];
}

/** Catalogue designations: "m42" matches "M 42" and "Messier 42"; "ngc1976" matches "NGC 1976". */
function canonical(s: string): string {
  return norm(s).replace(/^messier\s*/, "m").replace(/^(m|ngc|ic|sh2|hd|hip|abell|arp|ugc)\s*-?\s*(\d)/, "$1$2");
}

export interface NameIndexEntry { place: SkyPlace; keys: string[] }

export function buildNameIndex(places: SkyPlace[]): NameIndexEntry[] {
  return places
    .filter((p) => p.constellation !== "SolarSystem")
    .map((place) => ({ place, keys: Array.from(new Set(place.names.flatMap((n) => [norm(n), canonical(n)]))) }));
}

export function searchNames(index: NameIndexEntry[], query: string, limit = 12): SkyPlace[] {
  const q = norm(query), qc = canonical(query);
  if (q.length < 2) { return []; }
  const scored: { p: SkyPlace; s: number }[] = [];
  for (const e of index) {
    let best = 0;
    for (const k of e.keys) {
      let s = 0;
      if (k === q || k === qc) { s = 100; }
      else if (k.startsWith(q) || k.startsWith(qc)) { s = 80 - Math.min(20, k.length - q.length) * 0.5; }
      else if (k.split(" ").some((w) => w.startsWith(q))) { s = 60; }
      else if (q.length >= 3 && k.includes(q)) { s = 40; }
      else if (q.length >= 5) {
        const words = k.split(" ");
        const qw = q.split(" ");
        const max = q.length >= 8 ? 2 : 1;
        if (qw.length === 1 && words.some((w) => editDistance(w, q, max) <= max)) { s = 25; }
      }
      if (s > best) { best = s; }
    }
    if (best > 0) {
      // Prefer places with imagery, then brighter/more famous (shorter names).
      scored.push({ p: e.place, s: best + (e.place.study ? 5 : 0) - e.place.name.length * 0.02 });
    }
  }
  scored.sort((a, b) => b.s - a.s);
  // Collapse identical names: keep the first (best) of each.
  const seen = new Set<string>();
  const out: SkyPlace[] = [];
  for (const { p } of scored) {
    const k = p.name.toLowerCase() + (p.study ? "" : "-noimg");
    if (seen.has(k)) { continue; }
    seen.add(k);
    out.push(p);
    if (out.length >= limit) { break; }
  }
  return out;
}

/**
 * Parse sky coordinates. Accepts
 *   05h35m17.3s -05d23m28s    05:35:17.3 -05:23:28    05 35 17.3 -05 23 28
 *   83.82 -5.39 (decimal degrees)    5.588h -5.39
 *   ra=83.8 dec=-5.4
 * Returns [raDeg, decDeg] or null.
 */
export function parseCoordinates(input: string): [number, number] | null {
  const s = input.trim().toLowerCase()
    .replace(/ra\s*=?|dec\s*=?/g, " ")
    .replace(/[,;]/g, " ")
    .replace(/[−–]/g, "-")
    .replace(/[°º]/g, "d").replace(/[′']/g, "m").replace(/[″"]/g, "s")
    .trim();
  if (!s || /[a-ce-gi-ln-rt-z]/.test(s)) { return null; }

  // Split into RA part and Dec part at the sign of the dec, or halfway through the numbers.
  const signMatch = s.match(/\s([+-])\s*\d/);
  let raPart: string, decPart: string;
  if (signMatch && signMatch.index !== undefined) {
    raPart = s.slice(0, signMatch.index); decPart = s.slice(signMatch.index + 1);
  } else {
    const hmsSplit = s.match(/^(.*?s|.*?h\s*[\d.]+m?)\s+(.*)$/);
    if (hmsSplit) { raPart = hmsSplit[1]; decPart = hmsSplit[2]; }
    else {
      const nums = s.split(/[\s:]+/).filter(Boolean);
      if (nums.length % 2 !== 0) { return null; }
      raPart = nums.slice(0, nums.length / 2).join(" ");
      decPart = nums.slice(nums.length / 2).join(" ");
    }
  }
  const sexa = (part: string): { v: number; parts: number; unit: string } | null => {
    const unit = /h/.test(part) ? "h" : /d/.test(part) ? "d" : "";
    const nums = part.replace(/[hdms]/g, " ").split(/[\s:]+/).filter(Boolean).map(Number);
    if (!nums.length || nums.length > 3 || nums.some((n) => !Number.isFinite(n))) { return null; }
    const neg = /^\s*-/.test(part);
    const a = Math.abs(nums[0]);
    const v = a + (nums[1] ?? 0) / 60 + (nums[2] ?? 0) / 3600;
    return { v: neg ? -v : v, parts: nums.length, unit };
  };
  const ra = sexa(raPart.trim()), dec = sexa(decPart.trim());
  if (!ra || !dec) { return null; }
  // RA is in hours when written sexagesimally or with an "h"; otherwise degrees.
  const raDeg = ra.unit === "h" || (ra.parts > 1 && ra.unit !== "d") ? ra.v * 15 : ra.v;
  if (raDeg < 0 || raDeg >= 360 || dec.v < -90 || dec.v > 90) { return null; }
  return [raDeg, dec.v];
}

export function searchConstellations(list: ConstellationEntry[], query: string): ConstellationEntry[] {
  const q = norm(query);
  if (q.length < 3) { return []; }
  return list.filter((c) => norm(c.name).startsWith(q) || c.abbr.toLowerCase() === q).slice(0, 3);
}

/**
 * CDS Sesame lookup (SIMBAD, then NED, then VizieR). Resolves to null when
 * the name is unknown, and rejects on network failure or timeout.
 */
export async function resolveName(name: string, timeoutMs = 6000): Promise<{ raDeg: number; decDeg: number; label: string } | null> {
  const ctrl = new AbortController();
  const timer = window.setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const url = `https://cds.unistra.fr/cgi-bin/nph-sesame/-ox/~SNV?${encodeURIComponent(name)}`;
    const text = await (await fetch(url, { signal: ctrl.signal })).text();
    const doc = new DOMParser().parseFromString(text, "text/xml");
    const ra = doc.querySelector("jradeg")?.textContent, dec = doc.querySelector("jdedeg")?.textContent;
    if (!ra || !dec) { return null; }
    const oname = doc.querySelector("oname")?.textContent?.trim() || name;
    return { raDeg: Number(ra), decDeg: Number(dec), label: oname };
  } finally {
    window.clearTimeout(timer);
  }
}
