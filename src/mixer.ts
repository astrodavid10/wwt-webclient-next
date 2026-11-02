// The Image Mixer: any number of study images stacked as engine
// ImageSetLayers, each with its own opacity, plus a sweep that fades them in
// from the bottom of the stack to the top, Blink and Swipe compare modes, and
// additive ("add light") blending.
//
// Lessons carried over from the DataStories JWST/Orion apps:
//  - Engine layers are kept out of Vue reactivity (a Map, markRaw), otherwise
//    proxy-vs-raw comparisons fail.
//  - Opacity does not stop tile downloads; `enabled` does. A layer at 0% is
//    disabled, and an incoming layer is held at FADE_FLOOR (enabled) while the
//    camera flies so its tiles are ready when it fades in.

import { defineStore } from "pinia";
import { markRaw } from "vue";
import { engineStore } from "@wwtelescope/engine-pinia";
import { ImageSetLayer } from "@wwtelescope/engine";
import { makeImageset } from "./catalog/imagery";
import type { SkyPlace } from "./catalog/types";
import { backgroundDim, drawOverrides } from "./engine-patches";

export type MixMode = "mix" | "blink" | "swipe";

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
    urlValue: (s) => s.layers.map((l) => `${l.place.id}:${l.on ? Math.round(l.pct) : 0}`).join(","),
  },

  actions: {
    has(id: string): boolean { return this.layers.some((l) => l.place.id === id); },

    /**
     * Add a place's image to the top of the stack. With `fadeAfterMs`, the
     * layer streams tiles at FADE_FLOOR and fades in once that time has passed
     * (pass the camera's flight time).
     */
    async add(place: SkyPlace, opts: { pct?: number; fadeAfterMs?: number; preview?: boolean } = {}): Promise<boolean> {
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
      this.layers = this.layers.filter((l) => l.place.id !== id);
      this.apply();
    },

    clear(): void { [...this.ids].forEach((id) => this.remove(id)); },

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
      this.layers = arr;
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

      for (const l of this.layers) {
        const layer = engineLayers.get(l.place.id);
        if (!layer) { continue; }
        let op: number;
        if (this.mode === "blink") { op = l === blinkLayer ? 1 : 0; }
        else if (l === swipeTop) { op = 1; }
        else { op = l.on ? l.pct / 100 : 0; }
        op *= l.fade;
        if (this.suspended) { op = 0; }
        layer.set_opacity(op);
        const enabled = op > 0;
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
