// 2D canvas overlay that outlines image footprints on the sky: the hovered
// image, the selected one, the images in the mix, and (in "imagery map" mode)
// every image in view. Redrawn from the engine's frame callback, only when
// the camera or the set of outlines changed.

import { engineStore } from "@wwtelescope/engine-pinia";
import type { SkyPlace } from "./catalog/types";
import { footprintCorners, refineFootprint, refinedCorners } from "./catalog/imagery";

export interface Outline {
  place: SkyPlace;
  color: string;
  width: number;
  dash?: number[];
  fill?: string;
  label?: boolean;
}

export class FootprintOverlay {
  private ctx: CanvasRenderingContext2D;
  private outlines: Outline[] = [];
  private version = 0;
  private drawnKey = "";
  private corners = new Map<string, [number, number][]>();

  constructor(private canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext("2d");
    if (!ctx) { throw new Error("2D canvas unavailable"); }
    this.ctx = ctx;
  }

  set(outlines: Outline[]): void {
    this.outlines = outlines;
    this.version++;
    // Upgrade the approximate squares to the real image edges as tiles arrive.
    // Only for the few emphasised outlines, not the whole imagery map.
    for (const o of outlines) {
      if (o.fill || refinedCorners(o.place.id) !== undefined) { continue; }
      refineFootprint(o.place).then((c) => {
        if (c) { this.corners.delete(o.place.id); this.version++; }
      });
    }
  }

  private cornersFor(p: SkyPlace): [number, number][] {
    let c = this.corners.get(p.id);
    if (!c) { c = refinedCorners(p.id) ?? footprintCorners(p); this.corners.set(p.id, c); }
    return c;
  }

  draw(): void {
    const e = engineStore();
    const cssW = this.canvas.clientWidth, cssH = this.canvas.clientHeight;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const key = `${this.version}|${e.raRad}|${e.decRad}|${e.zoomDeg}|${e.rollRad}|${cssW}|${cssH}`;
    if (key === this.drawnKey) { return; }
    this.drawnKey = key;
    if (this.canvas.width !== Math.round(cssW * dpr) || this.canvas.height !== Math.round(cssH * dpr)) {
      this.canvas.width = Math.round(cssW * dpr);
      this.canvas.height = Math.round(cssH * dpr);
    }
    const g = this.ctx;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, cssW, cssH);
    for (const o of this.outlines) {
      const pts: { x: number; y: number }[] = [];
      let ok = true;
      for (const [ra, dec] of this.cornersFor(o.place)) {
        let pt: { x: number; y: number } | null = null;
        try { pt = e.findScreenPointForRADec({ ra, dec }); } catch { pt = null; }
        if (!pt || !Number.isFinite(pt.x) || !Number.isFinite(pt.y)) { ok = false; break; }
        pts.push(pt);
      }
      if (!ok) { continue; }
      // Skip outlines entirely off screen, and ones wrapped behind the view.
      const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
      if (Math.max(...xs) < 0 || Math.min(...xs) > cssW || Math.max(...ys) < 0 || Math.min(...ys) > cssH) { continue; }
      if (Math.max(...xs) - Math.min(...xs) > cssW * 4) { continue; }
      g.beginPath();
      pts.forEach((p, i) => (i ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y)));
      g.closePath();
      if (o.fill) { g.fillStyle = o.fill; g.fill(); }
      g.setLineDash(o.dash ?? []);
      g.lineWidth = o.width + 2;
      g.strokeStyle = "rgba(0,0,0,0.55)";
      g.stroke();
      g.lineWidth = o.width;
      g.strokeStyle = o.color;
      g.stroke();
      if (o.label) {
        const top = pts.reduce((a, b) => (b.y < a.y ? b : a));
        g.setLineDash([]);
        g.font = "600 12px system-ui, sans-serif";
        const text = o.place.name.length > 40 ? o.place.name.slice(0, 39) + "…" : o.place.name;
        const w = g.measureText(text).width + 12;
        const x = Math.max(4, Math.min(cssW - w - 4, top.x - w / 2)), y = Math.max(4, top.y - 26);
        g.fillStyle = "rgba(7,11,20,0.88)";
        g.fillRect(x, y, w, 20);
        g.fillStyle = o.color;
        g.fillText(text, x + 6, y + 14);
      }
    }
  }
}
