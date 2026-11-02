// Loads the WWT web client's search index (searchdata_v2.min.js, ~3.3 MB,
// 27k places of which ~3.9k carry imagery) and flattens it into SkyPlace
// records. The file is a script that assigns `wwt.searchData = {...}`, the
// same one the classic client loads, so it's injected as a <script>.

import type { SkyPlace, StudyInfo } from "./types";
import { bandFor, parseBandPass } from "./bands";

export const SEARCH_DATA_URL = "https://web.wwtassets.org/data/searchdata_v2.min.js";

interface RawFgi {
  n: string; u: string; bd: number; cX: number; cY: number;
  ct?: string; cu?: string; tu?: string; bp?: number | string; pr?: number; bl?: number; ft?: string;
  lv?: number; bu?: boolean; q?: string; oX?: number; oY?: number; r?: number; wf?: number;
}
interface RawPlace { n: string; r: number; d: number; c?: number; z?: number; fgi?: RawFgi }
interface RawData { Constellations: { name: string; places: RawPlace[] }[] }

const D2R = Math.PI / 180;

export function unitVector(raHours: number, decDeg: number): [number, number, number] {
  const a = raHours * 15 * D2R, d = decDeg * D2R;
  return [Math.cos(d) * Math.cos(a), Math.cos(d) * Math.sin(a), Math.sin(d)];
}

/** Angular separation of two unit vectors, degrees. */
export function sepDeg(a: number[], b: number[]): number {
  const c = Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
  return 2 * Math.asin(Math.min(1, c / 2)) / D2R;
}

export function https(url: string | undefined): string {
  if (!url) { return ""; }
  return url.replace(/^http:\/\//i, "https://").replace("alasky.u-strasbg.fr", "alasky.cds.unistra.fr");
}

export function fnv(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return (h >>> 0).toString(36);
}

export function slug(s: string): string {
  return s.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 32);
}

const SOURCES: [string, RegExp][] = [
  ["JWST", /jwst|webb/i],
  ["Rubin", /rubin|lsst/i],
  ["HST", /hubble|\bhst\b|stsci|spacetelescope/i],
  ["Chandra", /chandra|\bcxc\b/i],
  ["Spitzer", /spitzer|\bsst\b|ipac/i],
  ["ESO", /\beso\b|eso\.org|vlt|vista/i],
  ["NOIRLab", /noirlab|noao|kpno|ctio|gemini|kitt peak|cerro tololo/i],
  ["SOFIA", /sofia/i],
  ["WISE", /\bwise\b/i],
  ["NRAO", /nrao|\bvla\b|\bvlba\b|green bank/i],
];

/**
 * Telescope tag for an image: an explicit telescope in its name wins (JWST
 * feeds also carry "(Hubble image)" comparisons), then the tile URL's feed,
 * then the credits page, then the credits text.
 */
export function sourceFor(name: string, s: { url: string; creditsUrl: string; credits: string }): string {
  return inferSource(name) || inferSource(s.url) || inferSource(s.creditsUrl) || inferSource(s.credits);
}

export function inferSource(text: string): string {
  for (const [tag, re] of SOURCES) { if (re.test(text)) { return tag; } }
  return "";
}

function studyFrom(f: RawFgi): StudyInfo {
  return {
    url: https(f.u),
    baseDeg: f.bd,
    centerX: f.cX,
    centerY: f.cY,
    rotation: f.r ?? 0,
    offsetX: f.oX ?? 0,
    offsetY: f.oY ?? 0,
    widthFactor: f.wf ?? 2,
    tileLevels: f.lv ?? 4,
    baseLevel: f.bl ?? 0,
    bottomsUp: f.bu ?? false,
    fileType: f.ft ?? ".png",
    projection: f.pr ?? 2,  // ProjectionType.tan
    bandPass: parseBandPass(f.bp),  // stored as a name ("IR"); absent = Visible
    quadTreeMap: f.q ?? "",
    thumbUrl: https(f.tu),
    credits: (f.ct ?? "").replace(/&amp;/g, "&"),
    creditsUrl: https(f.cu),
    imagesetName: f.n,
  };
}

export function parseSearchData(data: RawData): SkyPlace[] {
  const out: SkyPlace[] = [];
  const seenIds = new Set<string>();
  for (const con of data.Constellations) {
    for (const p of con.places) {
      if (!p || typeof p.r !== "number") { continue; }
      const names = p.n.split(";").map((s) => s.trim()).filter(Boolean);
      const name = names[0] ?? "Unnamed";
      const study = p.fgi ? studyFrom(p.fgi) : null;
      const zoom = p.z ?? -1;
      const sizeDeg = study ? (zoom > 0 ? zoom / 6 : study.baseDeg) : 0;
      let id = `${slug(name)}-${fnv(study ? study.url : `${name}|${p.r}|${p.d}`).slice(0, 5)}`;
      while (seenIds.has(id)) { id += "x"; }
      seenIds.add(id);
      const source = study ? sourceFor(p.n, study) : "";
      out.push({
        id, name, names,
        raHours: p.r,
        decDeg: p.d,
        constellation: con.name,
        classification: p.c ?? 0,
        zoom,
        sizeDeg,
        vec: unitVector(p.r, p.d),
        study,
        source,
        band: study ? bandFor(p.n, study.bandPass, source) : null,
      });
    }
  }
  return out;
}

let loading: Promise<SkyPlace[]> | null = null;

/** Inject the search-data script once and resolve with the parsed places. */
export function loadSearchIndex(url = SEARCH_DATA_URL): Promise<SkyPlace[]> {
  if (loading) { return loading; }
  loading = new Promise<SkyPlace[]>((resolve, reject) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const w = window as any;
    w.wwt = w.wwt ?? {};
    if (w.wwt.searchData) { resolve(parseSearchData(w.wwt.searchData)); return; }
    const s = document.createElement("script");
    s.src = url;
    s.async = true;
    s.onload = () => {
      if (!w.wwt.searchData) { reject(new Error("The search index loaded but was empty")); return; }
      try { resolve(parseSearchData(w.wwt.searchData)); } catch (e) { reject(e); }
    };
    s.onerror = () => reject(new TypeError("The search index couldn't be downloaded"));
    document.head.appendChild(s);
  });
  loading.catch(() => { loading = null; });
  return loading;
}
