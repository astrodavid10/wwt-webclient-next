import type { BandInfo } from "./bands";

// A place from the WWT search index (searchdata_v2), flattened into plain
// data. Engine objects (Imageset, layers) are only created when an image is
// actually shown, so the 27k-entry index stays cheap to hold in memory.

/** The study ("foreground") imageset of a place, in searchdata's own fields. */
export interface StudyInfo {
  url: string;
  baseDeg: number;       // BaseDegreesPerTile: angular size of the level-0 tile
  centerX: number;       // RA of the image centre, degrees
  centerY: number;       // Dec of the image centre, degrees
  rotation: number;      // degrees
  offsetX: number;
  offsetY: number;
  widthFactor: number;
  tileLevels: number;
  baseLevel: number;
  bottomsUp: boolean;
  fileType: string;
  projection: number;    // wwtlib ProjectionType
  bandPass: number;      // wwtlib BandPass
  quadTreeMap: string;
  thumbUrl: string;
  credits: string;
  creditsUrl: string;
  imagesetName: string;
}

export interface SkyPlace {
  /** Stable id for URLs: slug of the name plus a hash of the tile URL. */
  id: string;
  name: string;          // display name (first of the ";"-separated names)
  names: string[];
  raHours: number;
  decDeg: number;
  constellation: string; // IAU abbreviation, or "SolarSystem"
  classification: number;
  zoom: number;          // WTML ZoomLevel (6 x vertical FOV in degrees), -1 if unset
  /** Approximate angular size of the image, degrees. 0 for places without imagery. */
  sizeDeg: number;
  /** Unit vector, for fast separation tests. */
  vec: [number, number, number];
  study: StudyInfo | null;
  /** Telescope / source tag inferred from the URL and credits ("JWST", "HST"...). */
  source: string;
  /** Wavelength band and how it was decided (null for places without imagery). */
  band: BandInfo | null;
  /** Plain-text description, when the place came from a WTML that has one. */
  description?: string;
}

export { BANDPASS_LABELS } from "./bands";
