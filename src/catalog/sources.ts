// Display colours per telescope tag. Chosen to stay distinguishable on the
// dark UI and for common colour-vision deficiencies (Okabe-Ito based).
export const SOURCE_COLORS: Record<string, string> = {
  JWST: "#f0ab52",
  HST: "#56b4e9",
  Chandra: "#cc79a7",
  Spitzer: "#e8846b",
  ESO: "#009e73",
  NOIRLab: "#f0e442",
  Rubin: "#b8a1ff",
  SOFIA: "#d55e00",
  WISE: "#9ecae1",
  "": "#9aa7bf",
};

export function sourceColor(tag: string): string {
  return SOURCE_COLORS[tag] ?? SOURCE_COLORS[""];
}
