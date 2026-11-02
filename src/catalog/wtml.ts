// Minimal WTML reader for the Explore browser and the tour gallery. The
// engine's own loader drops Description/Credits, so this parses the XML
// directly and turns Sky places into the same SkyPlace records the search
// index produces (reusing the index's record when the tile URL matches, so
// ids and mixer state line up).

import type { SkyPlace, StudyInfo } from "./types";
import { fnv, https, slug, sourceFor, unitVector } from "./searchIndex";
import { bandFor, parseBandPass } from "./bands";

export interface FolderEntry { kind: "folder"; name: string; thumb: string; url: string; children: Entry[] | null }
export interface PlaceEntry { kind: "place"; place: SkyPlace; thumb: string; allSky: boolean }
export interface TourEntry { kind: "tour"; id: string; title: string; description: string; author: string; seconds: number; thumb: string; url: string }
export type Entry = FolderEntry | PlaceEntry | TourEntry;

export const EXPLORE_ROOT = "https://worldwidetelescope.org/wwtweb/catalog.aspx?W=explorerootweb";
export const TOURS_ROOT = "https://web.wwtassets.org/webclient/assets/builtin-tours.wtml";

const PROJECTIONS: Record<string, number> = {
  mercator: 0, equirectangular: 1, tan: 2, toast: 3, spherical: 4, skyimage: 5, plotted: 6, healpix: 7,
};

function attr(el: Element, name: string): string { return el.getAttribute(name) ?? ""; }
function num(el: Element, name: string, dflt: number): number {
  const v = Number(attr(el, name));
  return attr(el, name) !== "" && Number.isFinite(v) ? v : dflt;
}
function childText(el: Element, tag: string): string {
  for (const c of Array.from(el.children)) { if (c.tagName === tag) { return (c.textContent ?? "").trim(); } }
  return "";
}
function stripHtml(s: string): string {
  return s.replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
}

function studyFromImageSet(is: Element): StudyInfo {
  return {
    url: https(attr(is, "Url")),
    baseDeg: num(is, "BaseDegreesPerTile", 1),
    centerX: num(is, "CenterX", 0),
    centerY: num(is, "CenterY", 0),
    rotation: num(is, "Rotation", 0),
    offsetX: num(is, "OffsetX", 0),
    offsetY: num(is, "OffsetY", 0),
    widthFactor: num(is, "WidthFactor", 2),
    tileLevels: num(is, "TileLevels", 4),
    baseLevel: num(is, "BaseTileLevel", 0),
    bottomsUp: attr(is, "BottomsUp").toLowerCase() === "true",
    fileType: attr(is, "FileType") || ".png",
    projection: PROJECTIONS[attr(is, "Projection").toLowerCase()] ?? 2,
    bandPass: parseBandPass(attr(is, "BandPass")),
    quadTreeMap: attr(is, "QuadTreeMap"),
    thumbUrl: https(childText(is, "ThumbnailUrl")),
    credits: childText(is, "Credits"),
    creditsUrl: https(childText(is, "CreditsUrl")),
    imagesetName: attr(is, "Name"),
  };
}

function findImageSet(place: Element): Element | null {
  for (const tag of ["ForegroundImageSet", "BackgroundImageSet"]) {
    for (const c of Array.from(place.children)) {
      if (c.tagName === tag) { const is = c.querySelector("ImageSet"); if (is) { return is; } }
    }
  }
  for (const c of Array.from(place.children)) { if (c.tagName === "ImageSet") { return c; } }
  return null;
}

function placeFrom(el: Element, byUrl: Map<string, SkyPlace>): PlaceEntry | null {
  const type = (attr(el, "DataSetType") || "Sky").toLowerCase();
  if (type !== "sky") { return null; }
  const is = findImageSet(el);
  if (is && (attr(is, "DataSetType") || "Sky").toLowerCase() !== "sky") { return null; }
  const study = is ? studyFromImageSet(is) : null;
  const known = study ? byUrl.get(study.url) : undefined;
  const description = stripHtml(childText(el, "Description") || (is ? childText(is, "Description") : ""));
  const thumb = https(attr(el, "Thumbnail")) || study?.thumbUrl || "";
  const allSky = !!study && (study.projection === 3 || study.projection === 7 || study.projection === 1);
  if (known) {
    if (description && !known.description) { known.description = description; }
    return { kind: "place", place: known, thumb, allSky };
  }
  const name = (attr(el, "Name").split(";")[0] || study?.imagesetName || "Unnamed").trim();
  const raHours = num(el, "RA", study ? study.centerX / 15 : 0);
  const decDeg = num(el, "Dec", study ? study.centerY : 0);
  const zoom = num(el, "ZoomLevel", -1);
  const source = study ? sourceFor(name, study) : "";
  const place: SkyPlace = {
    id: `${slug(name)}-${fnv(study ? study.url : `${name}|${raHours}|${decDeg}`).slice(0, 5)}`,
    name,
    names: attr(el, "Name").split(";").map((s) => s.trim()).filter(Boolean),
    raHours, decDeg,
    constellation: attr(el, "Constellation").toUpperCase(),
    classification: 0,
    zoom,
    sizeDeg: study ? (zoom > 0 ? zoom / 6 : study.baseDeg) : 0,
    vec: unitVector(raHours, decDeg),
    study,
    source,
    band: study ? bandFor(name, study.bandPass, source) : null,
    description: description || undefined,
  };
  return { kind: "place", place, thumb, allSky };
}

function tourFrom(el: Element): TourEntry {
  const id = attr(el, "ID");
  return {
    kind: "tour",
    id,
    title: attr(el, "Title"),
    description: attr(el, "Description"),
    author: attr(el, "Author"),
    seconds: num(el, "LengthInSecs", 0),
    thumb: https(attr(el, "ThumbnailUrl")) || `https://worldwidetelescope.org/wwtweb/GetTourThumbnail.aspx?GUID=${id}`,
    url: https(attr(el, "TourUrl")) || `https://worldwidetelescope.org/wwtweb/GetTour.aspx?GUID=${id}`,
  };
}

function entriesOf(folder: Element, byUrl: Map<string, SkyPlace>): Entry[] {
  const out: Entry[] = [];
  for (const c of Array.from(folder.children)) {
    if (c.tagName === "Folder") {
      const type = attr(c, "Type").toLowerCase();
      if (type && type !== "sky") { continue; }
      const url = https(attr(c, "Url"));
      const kids = c.children.length ? entriesOf(c, byUrl) : null;
      if (!url && kids && !kids.length) { continue; }
      out.push({ kind: "folder", name: attr(c, "Name"), thumb: https(attr(c, "Thumbnail")), url, children: url ? null : kids });
    } else if (c.tagName === "Place") {
      const p = placeFrom(c, byUrl);
      if (p) { out.push(p); }
    } else if (c.tagName === "Tour") {
      out.push(tourFrom(c));
    }
  }
  return out;
}

const cache = new Map<string, Promise<Entry[]>>();

/** Fetch a WTML folder and return its entries (cached per URL). */
export function loadFolder(url: string, byUrl: Map<string, SkyPlace>): Promise<Entry[]> {
  let p = cache.get(url);
  if (!p) {
    p = (async () => {
      const res = await fetch(url);
      if (!res.ok) { throw new Error(`${url} returned HTTP ${res.status}`); }
      const doc = new DOMParser().parseFromString(await res.text(), "text/xml");
      const root = doc.documentElement;
      if (!root || root.tagName === "parsererror" || doc.querySelector("parsererror")) { throw new Error("Not a WTML file"); }
      return entriesOf(root, byUrl);
    })();
    p.catch(() => cache.delete(url));
    cache.set(url, p);
  }
  return p;
}
