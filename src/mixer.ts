// The Image Mixer: any number of study images stacked as engine
// ImageSetLayers, each with its own opacity, plus a sweep that fades them in
// from the bottom of the stack to the top, Scrub (step through a long "reel"
// one image at a time), Blink and Swipe compare modes, and additive ("add
// light") blending.
//
// Lessons carried over from the DataStories JWST/Orion apps:
//  - Engine layers are kept out of Vue reactivity (a Map, markRaw), otherwise
//    proxy-vs-raw comparisons fail.
//  - Opacity does not stop tile downloads; `enabled` does. A layer at 0% is
//    disabled, and an incoming layer is held at FADE_FLOOR (enabled) while the
//    camera flies so its tiles are ready when it fades in.
//  - Scrub mode can hold dozens of images, so only the pair being crossfaded
//    is visible and only their neighbours are enabled (at opacity 0, which
//    still streams tiles): the next image is ready before it fades in.

import { defineStore } from "pinia";
import { markRaw } from "vue";
import { engineStore } from "@wwtelescope/engine-pinia";
import { ImageSetLayer } from "@wwtelescope/engine";
import { makeImageset } from "./catalog/imagery";
import type { SkyPlace } from "./catalog/types";
import { backgroundDim, drawOverrides } from "./engine-patches";
import { BAND_ORDER } from "./catalog/bands";

export type MixMode = "mix" | "scrub" | "blink" | "swipe";
export type ReelOrder = "wavelength" | "size" | "telescope" | "custom";

/** Most images "Scrub all in view" puts in the mixer. */
export const MAX_REEL = 40;

export interface MixLayer {
  place: SkyPlace;
  /** Opacity the user chose, percent. */
  pct: number;
  on: boolean;
  /** 0..1 multiplier used for fade-ins; 1 when settled. */
  fade: number;
  /**
   * False for a "preview" layer: opening an image shows it on top of the mix,
   * and opening another image replaces it (like a browser's preview tab)
   * unless the user keeps it. Touching any of its controls keeps it.
   */
  pinned: boolean;
}

const FADE_FLOOR = 0.02;
const engineLayers = new Map<string, ImageSetLayer>();
let blinkTimer = 0;
let scrubRaf = 0;

const smooth = (u: number) => u * u * (3 - 2 * u);
const bandRank = (p: SkyPlace) => BAND_ORDER.indexOf(p.band?.band ?? "Visible");
const REEL_SORT: Record<Exclude<ReelOrder, "custom">, (a: SkyPlace, b: SkyPlace) => number> = {
  // Short to long wavelengths; within a band, by telescope, then widest first.
  wavelength: (a, b) => bandRank(a) - bandRank(b) || a.source.localeCompare(b.source) || b.sizeDeg - a.sizeDeg,
  // Widest first, so scrubbing forward feels like zooming in.
  size: (a, b) => b.sizeDeg - a.sizeDeg,
  telescope: (a, b) => (a.source || "~").localeCompare(b.source || "~") || bandRank(a) - bandRank(b) || b.sizeDeg - a.sizeDeg,
};

/** Debug/test view of the engine layers: which are enabled and at what opacity, by place id. */
export function engineLayerStates(): { id: string; enabled: boolean; opacity: number }[] {
  return Array.from(engineLayers, ([id, l]) => ({ id, enabled: l.get_enabled(), opacity: l.get_opacity() }));
}

export const useMixer = defineStore("mixer", {
  state: () => ({
    layers: [] as MixLayer[],      // bottom of the stack first
    mode: "mix" as MixMode,
    additive: false,
    swipeFrac: 0.5,
    blinkIndex: 0,
    blinkMs: 900,
    busy: 0,
    /** Background survey brightness, percent. */
    backgroundPct: 100,
    autoDimmed: false,
    /** While a guided tour plays, the mix is hidden (the tour sets its own imagery). */
    suspended: false,
    /** Scrub position, 0..(reel length - 1): image i fully shown at i, crossfading to i+1. */
    scrubPos: 0,
    playing: false,
    /** Time per image while playing, including the crossfade. */
    playMs: 2600,
    reelOrder: "custom" as ReelOrder,
  }),

  getters: {
    count: (s) => s.layers.length,
    ids: (s) => s.layers.map((l) => l.place.id),
    visible: (s) => s.layers.filter((l) => l.on && l.pct > 0),
    /** Sweep position 0..(n-1): layer i is fully in at i, fading in from i-1. */
    sweep(s): number {
      let p = 0;
      s.layers.forEach((l, i) => { if (i > 0 && l.on) { p = Math.max(p, i - 1 + l.pct / 100); } });
      return p;
    },
    /** The images Scrub steps through: every layer that is switched on, bottom first. */
    reel: (s) => s.layers.filter((l) => l.on),
    /** Index (in the reel) of the image Scrub is mostly showing. */
    scrubIndex(): number { return Math.max(0, Math.min(this.reel.length - 1, Math.round(this.scrubPos))); },
    urlValue: (s) => s.layers.map((l) => `${l.place.id}:${l.on ? Math.round(l.pct) : 0}`).join(","),
  },

  actions: {
    has(id: string): boolean { return this.layers.some((l) => l.place.id === id); },

    /**
     * Add a place's image to the top of the stack. With `fadeAfterMs`, the
     * layer streams tiles at FADE_FLOOR and fades in once that time has passed
     * (pass the camera's flight time).
     */
    async add(place: SkyPlace, opts: { pct?: number; fadeAfterMs?: number; preview?: boolean; quiet?: boolean } = {}): Promise<boolean> {
      if (this.has(place.id)) {
        if (!opts.preview) { this.pin(place.id); }
        return true;
      }
      // A new preview replaces the old one once it has faded in.
      const leaving = opts.preview ? this.layers.filter((l) => !l.pinned).map((l) => l.place.id) : [];
      const iset = makeImageset(place);
      if (!iset) { return false; }
      const engine = engineStore();
      this.busy++;
      try {
        const registered = engine.addImagesetToRepository(iset);
        const layer = markRaw(await engine.addImageSetLayer({
          url: registered.get_url(), mode: "preloaded", name: place.name, goto: false,
        }));
        engineLayers.set(place.id, layer);
        const entry: MixLayer = {
          place: markRaw(place), pct: opts.pct ?? 100, on: true,
          fade: opts.fadeAfterMs ? FADE_FLOOR : 1, pinned: !opts.preview,
        };
        this.layers.push(entry);
        this.syncOrder();
        // Scrubbing: show the image just added (unless adding a batch).
        if (this.mode === "scrub" && !opts.quiet) { this.pause(); this.scrubPos = Math.max(0, this.reel.findIndex((l) => l.place.id === place.id)); }
        this.apply();
        const done = () => leaving.forEach((id) => this.remove(id));
        if (opts.fadeAfterMs) { this.fadeIn(place.id, opts.fadeAfterMs, 700, done); } else { done(); }
        return true;
      } catch (err) {
        console.warn(`[mixer] couldn't add "${place.name}"`, err);
        return false;
      } finally {
        this.busy--;
      }
    },

    fadeIn(id: string, afterMs: number, durMs = 700, onDone?: () => void): void {
      const start = performance.now() + afterMs;
      const step = (now: number) => {
        const l = this.layers.find((x) => x.place.id === id);
        if (!l) { return; }
        const u = Math.max(0, Math.min(1, (now - start) / durMs));
        l.fade = FADE_FLOOR + (1 - FADE_FLOOR) * u * u * (3 - 2 * u);
        this.apply();
        if (u < 1) { requestAnimationFrame(step); } else if (onDone) { onDone(); }
      };
      requestAnimationFrame(step);
    },

    remove(id: string): void {
      const layer = engineLayers.get(id);
      if (layer) {
        drawOverrides.delete(String(layer.id));
        try { engineStore().deleteLayer(layer.id); } catch (err) { console.warn("[mixer] deleteLayer failed", err); }
      }
      engineLayers.delete(id);
      const cur = this.reel[this.scrubIndex];
      this.layers = this.layers.filter((l) => l.place.id !== id);
      // Scrubbing: stay on the same image when one below it goes.
      if (this.mode === "scrub") {
        const i = cur ? this.reel.findIndex((l) => l.place.id === cur.place.id) : -1;
        this.scrubPos = Math.max(0, Math.min(this.reel.length - 1, i >= 0 ? i : this.scrubPos));
        if (this.reel.length < 2) { this.pause(); }
      }
      this.apply();
    },

    clear(): void { this.pause(); [...this.ids].forEach((id) => this.remove(id)); this.scrubPos = 0; },

    /** Add several images, bottom of the stack first. Returns how many were added. */
    async addMany(places: SkyPlace[]): Promise<number> {
      let n = 0;
      for (const p of places) { if (!this.has(p.id) && await this.add(p, { quiet: true })) { n++; } }
      return n;
    },

    pin(id: string): void {
      const l = this.layers.find((x) => x.place.id === id);
      if (l) { l.pinned = true; }
    },

    setPct(id: string, pct: number): void {
      const l = this.layers.find((x) => x.place.id === id);
      if (!l) { return; }
      l.pinned = true;
      l.pct = Math.max(0, Math.min(100, pct));
      if (l.pct > 0) { l.on = true; }
      this.apply();
    },

    toggle(id: string): void {
      const l = this.layers.find((x) => x.place.id === id);
      if (l) { l.pinned = true; l.on = !l.on; if (l.on && l.pct === 0) { l.pct = 100; } this.apply(); }
    },

    solo(id: string): void {
      this.layers.forEach((l) => {
        l.on = l.place.id === id;
        if (l.on && l.pct === 0) { l.pct = 100; }
      });
      this.apply();
    },

    /** Move a layer up (+1, towards the top) or down (-1). */
    move(id: string, dir: 1 | -1): void {
      const i = this.layers.findIndex((l) => l.place.id === id), j = i + dir;
      if (i < 0 || j < 0 || j >= this.layers.length) { return; }
      const arr = [...this.layers];
      [arr[i], arr[j]] = [arr[j], arr[i]];
      arr[j].pinned = true;
      const cur = this.reel[this.scrubIndex];
      this.layers = arr;
      this.reelOrder = "custom";
      if (this.mode === "scrub" && cur) { this.scrubPos = Math.max(0, this.reel.indexOf(cur)); }
      this.syncOrder();
      this.apply();
    },

    /** Sweep: p in 0..n-1. The bottom layer stays in; layer i fades in as p goes i-1 -> i. */
    setSweep(p: number): void {
      this.layers.forEach((l, i) => {
        l.on = true;
        l.pinned = true;
        l.pct = i === 0 ? 100 : Math.round(Math.max(0, Math.min(1, p - i + 1)) * 100);
      });
      this.apply();
    },

    setMode(mode: MixMode): void {
      const prev = this.mode;
      this.pause();
      if (prev === "scrub" && mode !== "scrub" && this.reel.length > 4) {
        // Leaving a long reel: keep just the image being looked at, so the
        // whole reel doesn't switch on (and download) at once.
        const cur = this.reel[this.scrubIndex];
        this.layers.forEach((l) => { l.pct = l === cur ? 100 : 0; });
      }
      if (mode === "scrub" && prev !== "scrub") { this.scrubPos = Math.max(0, this.reel.length - 1); }
      this.mode = mode;
      this.blinkIndex = 0;
      this.restartBlink();
      this.apply();
    },
    setBlinkMs(ms: number): void { this.blinkMs = ms; this.restartBlink(); },
    restartBlink(): void {
      window.clearInterval(blinkTimer);
      blinkTimer = 0;
      if (this.mode === "blink") { blinkTimer = window.setInterval(() => this.stepBlink(), this.blinkMs); }
    },
    setAdditive(on: boolean): void {
      this.additive = on;
      // Light added on top of a bright survey saturates; dim it while adding.
      if (on && this.backgroundPct > 40) { this.setBackgroundPct(25); this.autoDimmed = true; }
      if (!on && this.autoDimmed) { this.setBackgroundPct(100); }
      this.apply();
    },
    setBackgroundPct(pct: number): void {
      this.backgroundPct = Math.max(0, Math.min(100, pct));
      this.autoDimmed = false;
      backgroundDim.factor = this.backgroundPct / 100;
    },
    setSwipe(frac: number): void { this.swipeFrac = Math.max(0, Math.min(1, frac)); this.apply(); },
    stepBlink(): void { this.blinkIndex++; this.apply(); },

    // ── Scrub ──
    setScrub(pos: number): void {
      this.pause();
      this.scrubPos = Math.max(0, Math.min(Math.max(0, this.reel.length - 1), pos));
      this.apply();
    },
    /** Crossfade to reel index `target`; long jumps cut straight there. */
    scrubTo(target: number, ms = 600): void {
      this.pause();
      const to = Math.max(0, Math.min(this.reel.length - 1, target));
      const from = this.scrubPos;
      if (Math.abs(to - from) > 1.5 || ms <= 0) { this.scrubPos = to; this.apply(); return; }
      const start = performance.now();
      const step = (now: number) => {
        const u = Math.min(1, (now - start) / ms);
        this.scrubPos = from + (to - from) * smooth(u);
        this.apply();
        if (u < 1) { scrubRaf = requestAnimationFrame(step); }
      };
      scrubRaf = requestAnimationFrame(step);
    },
    stepScrub(dir: 1 | -1): void {
      const p = this.scrubPos;
      this.scrubTo(dir > 0 ? Math.floor(p + 1e-6) + 1 : Math.ceil(p - 1e-6) - 1);
    },
    /** Play the reel: hold each image, crossfade to the next, loop at the end. */
    play(): void {
      if (this.reel.length < 2) { return; }
      this.pause();
      if (this.mode !== "scrub") { this.setMode("scrub"); }
      this.playing = true;
      let from = Math.round(this.scrubPos);
      this.scrubPos = from;
      this.apply();
      let phaseStart = performance.now();
      const step = (now: number) => {
        if (!this.playing) { return; }
        const n = this.reel.length;
        if (n < 2 || this.mode !== "scrub") { this.playing = false; return; }
        const fadeMs = Math.min(1000, this.playMs * 0.4), hold = this.playMs - fadeMs, t = now - phaseStart;
        if (t >= this.playMs || (from >= n - 1 && t >= hold)) {
          from = from >= n - 1 ? 0 : from + 1;  // the wrap from last to first is a cut
          this.scrubPos = from;
          phaseStart = now;
          this.apply();
        } else if (t > hold) {
          this.scrubPos = from + smooth((t - hold) / fadeMs);
          this.apply();
        }
        scrubRaf = requestAnimationFrame(step);
      };
      scrubRaf = requestAnimationFrame(step);
    },
    pause(): void {
      this.playing = false;
      cancelAnimationFrame(scrubRaf);
      scrubRaf = 0;
    },
    setPlayMs(ms: number): void { this.playMs = ms; },
    /** Re-order the whole stack, staying on the image currently shown. */
    sortReel(order: ReelOrder): void {
      this.reelOrder = order;
      if (order === "custom") { return; }
      const cur = this.reel[this.scrubIndex];
      const cmp = REEL_SORT[order];
      this.layers = [...this.layers].sort((a, b) => cmp(a.place, b.place));
      this.syncOrder();
      if (cur) { this.scrubPos = Math.max(0, this.reel.indexOf(cur)); }
      this.apply();
    },

    /** Engine draw order follows the stack: bottom layer drawn first. */
    syncOrder(): void {
      const engine = engineStore();
      this.layers.forEach((l, i) => {
        const layer = engineLayers.get(l.place.id);
        if (layer) { engine.setImageSetLayerOrder({ id: layer.id.toString(), order: i }); }
      });
    },

    suspend(on: boolean): void {
      this.suspended = on;
      backgroundDim.factor = on ? 1 : this.backgroundPct / 100;
      this.apply();
    },

    /** Push every layer's effective opacity, enabled flag and draw override to the engine. */
    apply(): void {
      const shown = this.layers.filter((l) => l.on);
      const blinkLayer = shown.length ? shown[this.blinkIndex % shown.length] : null;
      const vis = this.layers.filter((l) => l.on && l.pct > 0);
      const swipeTop = this.mode === "swipe" && vis.length > 1 ? vis[vis.length - 1] : null;
      const lowest = vis[0] ?? null;
      // Scrub: images i and i+1 crossfade. Each stays fully opaque through
      // half the fade, so the background never shows through where they
      // overlap. i-1 and i+2 are enabled at opacity 0 to preload their tiles.
      const scrubOp = new Map<MixLayer, number>();
      if (this.mode === "scrub" && shown.length) {
        const pos = Math.max(0, Math.min(shown.length - 1, this.scrubPos));
        const i = Math.floor(pos), f = pos - i;
        scrubOp.set(shown[i], f === 0 ? 1 : Math.min(1, 2 * (1 - f)));
        if (shown[i + 1]) { scrubOp.set(shown[i + 1], Math.min(1, 2 * f)); }
        for (const j of [i - 1, i + 2]) { if (shown[j] && !scrubOp.has(shown[j])) { scrubOp.set(shown[j], 0); } }
      }

      for (const l of this.layers) {
        const layer = engineLayers.get(l.place.id);
        if (!layer) { continue; }
        let op: number;
        let preload = false;
        if (this.mode === "scrub") { op = scrubOp.get(l) ?? 0; preload = scrubOp.has(l); }
        else if (this.mode === "blink") { op = l === blinkLayer ? 1 : 0; }
        else if (l === swipeTop) { op = 1; }
        else { op = l.on ? l.pct / 100 : 0; }
        op *= l.fade;
        if (this.suspended) { op = 0; preload = false; }
        layer.set_opacity(op);
        const enabled = op > 0 || preload;
        if (layer.get_enabled() !== enabled) { layer.set_enabled(enabled); }

        const o: { additive?: boolean; clipLeftFrac?: number } = {};
        if (this.additive && this.mode === "mix" && l !== lowest) { o.additive = true; }
        if (l === swipeTop) { o.clipLeftFrac = this.swipeFrac; }
        const key = String(layer.id);
        if (o.additive || o.clipLeftFrac !== undefined) { drawOverrides.set(key, o); } else { drawOverrides.delete(key); }
      }
    },

    /** Restore from ?layers=id:pct,... (bottom first). Unknown ids are skipped. */
    async restore(value: string, lookup: (id: string) => SkyPlace | undefined): Promise<void> {
      for (const part of value.split(",")) {
        const [id, pctStr] = part.split(":");
        const place = lookup(id);
        if (!place) { console.warn(`[mixer] ?layers=: no image with id "${id}"`); continue; }
        const pct = Number(pctStr);
        await this.add(place, { pct: Number.isFinite(pct) ? pct : 100 });
        if (pct === 0) { const l = this.layers.find((x) => x.place.id === id); if (l) { l.on = false; } }
      }
      this.apply();
    },
  },
});
