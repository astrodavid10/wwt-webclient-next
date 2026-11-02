// Wavelength ("band") of an image.
//
// The catalogues barely record it: in searchdata_v2 only ~47 of ~3.9k study
// images carry a BandPass ("IR", "XRay", "Radio"); the rest default to
// Visible, including every Webb, Chandra and Spitzer image. WTML files often
// say BandPass="Visible" for anything. So a catalogue value is trusted only
// when it says something other than Visible; otherwise the band is
// estimated from the image name, then from the telescope, and flagged as an
// estimate so the UI can say so. Fixing the catalogues makes the estimates
// unnecessary without code changes here.

/** wwtlib BandPass enum, by index. */
export const BANDPASS_LABELS = ["Gamma", "X-ray", "Ultraviolet", "Visible", "H-alpha", "Infrared", "Microwave", "Radio", "Visible"];

const BANDPASS_BY_NAME: Record<string, number> = {
  gamma: 0, xray: 1, "x-ray": 1, ultraviolet: 2, uv: 2, visible: 3, optical: 3, hydrogenalpha: 4, halpha: 4,
  ir: 5, infrared: 5, microwave: 6, radio: 7, visiblenight: 8,
};

/** BandPass as stored in searchdata (a name like "IR"), a WTML attribute, or a number. */
export function parseBandPass(v: unknown): number {
  if (typeof v === "number" && Number.isFinite(v)) { return v; }
  if (typeof v === "string") { return BANDPASS_BY_NAME[v.trim().toLowerCase()] ?? 3; }
  return 3;
}

export type Band = "Gamma" | "X-ray" | "Ultraviolet" | "Visible" | "H-alpha" | "Infrared" | "Microwave" | "Radio" | "Multiwavelength";

/** Short to long wavelengths (Multiwavelength last). */
export const BAND_ORDER: Band[] = ["Gamma", "X-ray", "Ultraviolet", "Visible", "H-alpha", "Infrared", "Microwave", "Radio", "Multiwavelength"];

export const BAND_SHORT: Record<Band, string> = {
  Gamma: "Gamma", "X-ray": "X-ray", Ultraviolet: "UV", Visible: "Visible", "H-alpha": "Hα",
  Infrared: "IR", Microwave: "Microwave", Radio: "Radio", Multiwavelength: "Multi-λ",
};

/** Colours run from short to long wavelengths (violet → red), neutral for visible. */
export const BAND_COLORS: Record<Band, string> = {
  Gamma: "#c9a0ff", "X-ray": "#a5b4ff", Ultraviolet: "#8fd3ff", Visible: "#d8dee9", "H-alpha": "#ff8c8c",
  Infrared: "#ffb380", Microwave: "#ffd27a", Radio: "#f5e17a", Multiwavelength: "#9fe6b8",
};

const NAME_KEYWORDS: [Band, RegExp][] = [
  ["Gamma", /gamma[- ]?ray|\bfermi\b/i],
  ["X-ray", /x[- ]?ray|\bxmm\b/i],
  ["Ultraviolet", /ultraviolet|\buv\b|galex/i],
  ["Infrared", /infrared|\bnir\b|\bmir\b|nircam|\bmiri\b|niriss|nirspec|\bir\b|near-ir|mid-ir|\birac\b|\bmips\b|\bvista\b/i],
  ["Radio", /\bradio\b|\balma\b|\bvla\b|\bvlba\b|lofar|\bmeerkat\b/i],
  ["H-alpha", /h[- ]?alpha|hα/i],
  ["Visible", /\boptical\b|\bvisible\b/i],
];

const TELESCOPE_BAND: Record<string, Band> = {
  JWST: "Infrared", Spitzer: "Infrared", WISE: "Infrared", SOFIA: "Infrared",
  Chandra: "X-ray", NRAO: "Radio",
  HST: "Visible", ESO: "Visible", NOIRLab: "Visible", Rubin: "Visible",
};

export interface BandInfo {
  band: Band;
  /** How the band was decided: the catalogue's BandPass, the image name, the telescope, or a default. */
  basis: "catalogue" | "name" | "telescope" | "default";
}

export function bandFor(name: string, bandPass: number, telescope: string): BandInfo {
  if (bandPass !== 3 && bandPass !== 8) {
    return { band: (BANDPASS_LABELS[bandPass] ?? "Visible") as Band, basis: "catalogue" };
  }
  const hits = new Set<Band>();
  for (const [band, re] of NAME_KEYWORDS) { if (re.test(name)) { hits.add(band); } }
  if (hits.size > 1) { return { band: "Multiwavelength", basis: "name" }; }
  if (hits.size === 1) { return { band: [...hits][0], basis: "name" }; }
  const t = TELESCOPE_BAND[telescope];
  if (t) { return { band: t, basis: "telescope" }; }
  return { band: "Visible", basis: "default" };
}

export function bandBasisText(basis: BandInfo["basis"]): string {
  switch (basis) {
  case "catalogue": return "from the catalogue";
  case "name": return "estimated from the image name";
  case "telescope": return "estimated from the telescope";
  default: return "not recorded; assumed visible";
  }
}
