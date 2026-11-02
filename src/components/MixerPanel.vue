<template>
  <div class="mixer" :class="variant">
    <!-- Compact bar: what's in the mix and the sweep (or the scrub reel), one row. -->
    <div v-if="variant === 'bar' && scrubbing" class="mx-now bar-now" aria-live="polite">
      <span class="mx-now-n">{{ mixer.scrubIndex + 1 }}/{{ mixer.reel.length }}</span>
      <span v-if="current?.place.source" class="tag" :style="{ color: sourceColor(current.place.source) }">{{ current.place.source }}</span>
      <span v-if="current?.place.band" class="tag" :style="{ color: BAND_COLORS[current.place.band.band] }">{{ BAND_SHORT[current.place.band.band] }}</span>
      <span class="mx-title">{{ current?.place.name }}</span>
    </div>
    <div v-if="variant === 'bar'" class="mx-bar">
      <button type="button" class="mx-dots" :aria-label="`Open the mixer, ${mixer.count} images`" @click="emit('expand')">
        <span v-for="l in topFirst.slice(0, 4)" :key="l.place.id" class="mx-dot" :style="{ borderColor: sourceColor(l.place.source) }">
          <thumb :place="l.place" />
        </span>
        <span class="mx-count">{{ mixer.count }}</span>
      </button>
      <template v-if="scrubbing">
        <button type="button" class="ib" :aria-label="mixer.playing ? 'Pause' : 'Play through the images'" @click="togglePlay">
          <font-awesome-icon :icon="mixer.playing ? 'pause' : 'play'" />
        </button>
        <input
          class="mx-sweep"
          type="range"
          min="0"
          :max="(mixer.reel.length - 1) * 100"
          :value="Math.round(mixer.scrubPos * 100)"
          aria-label="Scrub through the images"
          :aria-valuetext="scrubText"
          @input="onScrub"
        />
      </template>
      <input
        v-else-if="mixer.count > 1"
        class="mx-sweep"
        type="range"
        min="0"
        :max="(mixer.count - 1) * 100"
        :value="Math.round(mixer.sweep * 100)"
        aria-label="Sweep through the stack"
        :aria-valuetext="sweepText"
        @input="onSweep"
      />
      <span v-else class="mx-tip">{{ mixer.count ? "Add another image to crossfade" : "Open an image to start a mix" }}</span>
    </div>

    <template v-else>
      <div class="mx-head">
        <div class="seg" role="group" aria-label="Mixer mode">
          <button v-for="m in MODES" :key="m.id" type="button" :aria-pressed="mixer.mode === m.id" :title="m.tip" @click="setMode(m.id)">{{ m.label }}</button>
        </div>
        <button v-if="mixer.count" type="button" class="link-btn" @click="mixer.clear()">Clear</button>
      </div>

      <p v-if="!mixer.count" class="mx-empty">Open an image, or press <font-awesome-icon icon="plus" /> next to one in the list, to start a mix. The sweep slider then fades the images in from the bottom of the stack to the top. To step through everything in view, use <b>Scrub all</b> in the In view list.</p>

      <div v-if="mixer.count > 1 && mixer.mode === 'mix'" class="mx-sweep-wrap">
        <label for="mx-sweep">Sweep through the stack</label>
        <input
          id="mx-sweep"
          class="mx-sweep"
          type="range"
          min="0"
          :max="(mixer.count - 1) * 100"
          :value="Math.round(mixer.sweep * 100)"
          :aria-valuetext="sweepText"
          @input="onSweep"
        />
        <div class="mx-stops" aria-hidden="true">
          <span v-for="l in mixer.layers" :key="l.place.id" :style="{ color: sourceColor(l.place.source) }">{{ l.place.source || "•" }}</span>
        </div>
      </div>

      <div v-if="mixer.mode === 'scrub' && mixer.reel.length" class="mx-sweep-wrap mx-scrub">
        <div class="mx-now" aria-live="polite">
          <span class="mx-now-n">{{ mixer.scrubIndex + 1 }}/{{ mixer.reel.length }}</span>
          <span v-if="current?.place.source" class="tag" :style="{ color: sourceColor(current.place.source) }">{{ current.place.source }}</span>
          <span v-if="current?.place.band" class="tag" :style="{ color: BAND_COLORS[current.place.band.band] }">{{ BAND_SHORT[current.place.band.band] }}</span>
          <span class="mx-title">{{ current?.place.name }}</span>
        </div>
        <div class="mx-scrub-row">
          <button type="button" class="ib" aria-label="Previous image" :disabled="mixer.scrubPos <= 0" @click="mixer.stepScrub(-1)"><font-awesome-icon icon="backward-step" /></button>
          <button type="button" class="ib" :aria-label="mixer.playing ? 'Pause' : 'Play through the images'" :disabled="mixer.reel.length < 2" @click="togglePlay">
            <font-awesome-icon :icon="mixer.playing ? 'pause' : 'play'" />
          </button>
          <button type="button" class="ib" aria-label="Next image" :disabled="mixer.scrubPos >= mixer.reel.length - 1" @click="mixer.stepScrub(1)"><font-awesome-icon icon="forward-step" /></button>
          <div class="mx-track">
          <input
            id="mx-scrub"
            class="mx-sweep"
            type="range"
            min="0"
            :max="Math.max(0, mixer.reel.length - 1) * 100"
            :value="Math.round(mixer.scrubPos * 100)"
            aria-label="Scrub through the images"
            :aria-valuetext="scrubText"
            @input="onScrub"
          />
          <div class="mx-ticks" aria-hidden="true">
            <i v-for="(l, i) in mixer.reel" :key="l.place.id" :class="{ cur: i === mixer.scrubIndex }" :style="{ background: l.place.band ? BAND_COLORS[l.place.band.band] : undefined }"></i>
          </div>
          </div>
        </div>
        <div class="mx-scrub-opts">
          <label>Order
            <select :value="mixer.reelOrder" @change="mixer.sortReel(($event.target as HTMLSelectElement).value as ReelOrder)">
              <option value="wavelength">Wavelength (short to long)</option>
              <option value="size">Size (widest first)</option>
              <option value="telescope">Telescope</option>
              <option value="custom" disabled>As arranged</option>
            </select>
          </label>
          <label>Speed
            <select :value="mixer.playMs" @change="mixer.setPlayMs(Number(($event.target as HTMLSelectElement).value))">
              <option :value="4500">Slow</option>
              <option :value="2600">Medium</option>
              <option :value="1400">Fast</option>
            </select>
          </label>
        </div>
      </div>

      <div v-if="mixer.mode === 'swipe'" class="mx-sweep-wrap">
        <label for="mx-swipe">Swipe position</label>
        <input id="mx-swipe" type="range" min="0" max="100" :value="Math.round(mixer.swipeFrac * 100)" @input="onSwipe" />
        <p class="mx-note">The top image is shown to the right of the line, the one below it to the left. You can also drag the line on the sky.</p>
      </div>
      <div v-if="mixer.mode === 'blink'" class="mx-sweep-wrap">
        <label for="mx-blink">Blink speed</label>
        <input id="mx-blink" type="range" min="300" max="2500" step="100" :value="2800 - mixer.blinkMs" @input="onBlinkSpeed" />
      </div>

      <ol class="mx-layers" aria-label="Images in the mix, top of the stack first">
        <li
          v-for="(l, i) in topFirst"
          :key="l.place.id"
          class="mx-layer"
          :class="{ off: scrubbing ? !l.on : !l.on || l.pct === 0, preview: !l.pinned, cur: scrubbing && l === current }"
        >
          <button
            type="button"
            class="mx-thumb"
            :aria-label="scrubbing ? `Scrub to ${l.place.name}` : `Show details for ${l.place.name}`"
            @click="scrubbing && l.on ? mixer.scrubTo(mixer.reel.indexOf(l)) : emit('select', l.place)"
          >
            <thumb :place="l.place" />
          </button>
          <div class="mx-main">
            <div class="mx-name">
              <span class="tag" :style="{ color: sourceColor(l.place.source) }">{{ l.place.source || "IMG" }}</span>
              <span v-if="l.place.band" class="tag" :style="{ color: BAND_COLORS[l.place.band.band] }">{{ BAND_SHORT[l.place.band.band] }}</span>
              <span class="mx-title" :title="l.place.name">{{ l.place.name }}</span>
              <span v-if="!l.pinned" class="mx-preview">preview</span>
            </div>
            <div class="mx-ctl">
              <button type="button" class="ib" :aria-pressed="l.on" :aria-label="`Show ${l.place.name}`" @click="mixer.toggle(l.place.id)">
                <font-awesome-icon :icon="l.on ? 'eye' : 'eye-slash'" />
              </button>
              <input
                v-if="!scrubbing"
                type="range"
                min="0"
                max="100"
                :value="l.pct"
                :aria-label="`${l.place.name} opacity`"
                :aria-valuetext="`${Math.round(l.pct)} percent`"
                @input="mixer.setPct(l.place.id, Number(($event.target as HTMLInputElement).value))"
              />
              <span v-if="!scrubbing" class="mx-pct">{{ Math.round(l.pct) }}%</span>
              <button v-else type="button" class="link-btn mx-info" :aria-label="`Details for ${l.place.name}`" @click="emit('select', l.place)">Details</button>
              <button v-if="!scrubbing" type="button" class="ib" :aria-label="`Show only ${l.place.name}`" title="Show only this image" @click="mixer.solo(l.place.id)">
                <font-awesome-icon icon="bullseye" />
              </button>
              <button type="button" class="ib" :disabled="i === 0" :aria-label="`Move ${l.place.name} up`" @click="mixer.move(l.place.id, 1)">
                <font-awesome-icon icon="chevron-up" />
              </button>
              <button type="button" class="ib" :disabled="i === topFirst.length - 1" :aria-label="`Move ${l.place.name} down`" @click="mixer.move(l.place.id, -1)">
                <font-awesome-icon icon="chevron-down" />
              </button>
              <button v-if="!l.pinned" type="button" class="ib keep" :aria-label="`Keep ${l.place.name} in the mix`" title="Keep in the mix" @click="mixer.pin(l.place.id)">
                <font-awesome-icon icon="thumbtack" />
              </button>
              <button type="button" class="ib" :aria-label="`Remove ${l.place.name}`" title="Remove" @click="mixer.remove(l.place.id)">
                <font-awesome-icon icon="xmark" />
              </button>
            </div>
          </div>
        </li>
        <li v-if="mixer.count" class="mx-layer mx-bg">
          <span class="mx-thumb bg" aria-hidden="true"><font-awesome-icon icon="star" /></span>
          <div class="mx-main">
            <div class="mx-name">
              <span class="tag">SURVEY</span>
              <span class="tag">{{ backgroundBand }}</span>
              <select
                v-if="backgrounds && backgrounds.length > 1"
                class="mx-survey"
                :value="backgroundName"
                aria-label="Background survey"
                @change="emit('background', ($event.target as HTMLSelectElement).value)"
              >
                <option v-if="!backgrounds.includes(backgroundName)" :value="backgroundName">{{ backgroundName }}</option>
                <option v-for="n in backgrounds" :key="n" :value="n">{{ n }}</option>
              </select>
              <span v-else class="mx-title">{{ backgroundName }}</span>
            </div>
            <div class="mx-ctl">
              <input
                type="range"
                min="0"
                max="100"
                :value="mixer.backgroundPct"
                aria-label="Background survey brightness"
                :aria-valuetext="`${mixer.backgroundPct} percent`"
                @input="mixer.setBackgroundPct(Number(($event.target as HTMLInputElement).value))"
              />
              <span class="mx-pct">{{ mixer.backgroundPct }}%</span>
            </div>
          </div>
        </li>
      </ol>

      <!-- "Add light" (additive blending) is hidden for now. The store
           (mixer.setAdditive) and the engine patch still support it; to bring
           it back, restore this toggle and the ?blend=add line in App.vue.
      <label v-if="mixer.count > 1" class="mx-toggle">
        <input type="checkbox" :checked="mixer.additive" :disabled="mixer.mode !== 'mix'" @change="mixer.setAdditive(($event.target as HTMLInputElement).checked)" />
        Add light (additive blending, for combining wavelengths)
      </label>
      -->
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { engineStore } from "@wwtelescope/engine-pinia";
import { useMixer, MixMode, ReelOrder } from "../mixer";
import type { SkyPlace } from "../catalog/types";
import { sourceColor } from "../catalog/sources";
import { BAND_COLORS, BAND_SHORT, BANDPASS_LABELS } from "../catalog/bands";
import Thumb from "./Thumb.vue";

defineProps<{ variant: "bar" | "panel"; backgrounds?: string[] }>();
const emit = defineEmits<{ (e: "expand"): void; (e: "select", place: SkyPlace): void; (e: "background", name: string): void }>();

const mixer = useMixer();
const MODES: { id: MixMode; label: string; tip: string }[] = [
  { id: "mix", label: "Mix", tip: "Blend the images with their own opacities" },
  { id: "scrub", label: "Scrub", tip: "Step through the images one at a time" },
  { id: "blink", label: "Blink", tip: "Flip between the images" },
  { id: "swipe", label: "Swipe", tip: "Compare the top two images side by side" },
];

const topFirst = computed(() => [...mixer.layers].reverse());
const engine = engineStore();
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const backgroundBand = computed(() => { const b = (engine.backgroundImageset as any)?.get_bandPass?.(); return BANDPASS_LABELS[typeof b === "number" ? b : 3] ?? "Visible"; });
const backgroundName = computed(() => engine.backgroundImageset?.get_name() ?? "Background survey");

const sweepText = computed(() => {
  const i = Math.min(mixer.count - 1, Math.ceil(mixer.sweep));
  return mixer.layers[i] ? `up to ${mixer.layers[i].place.name}` : "";
});

const scrubbing = computed(() => mixer.mode === "scrub" && mixer.reel.length > 0);
const current = computed(() => mixer.reel[mixer.scrubIndex] ?? null);
const scrubText = computed(() => current.value ? `${mixer.scrubIndex + 1} of ${mixer.reel.length}: ${current.value.place.name}` : "");
function onScrub(e: Event): void { mixer.setScrub(Number((e.target as HTMLInputElement).value) / 100); }
function togglePlay(): void { if (mixer.playing) { mixer.pause(); } else { mixer.play(); } }
function onSweep(e: Event): void { mixer.setSweep(Number((e.target as HTMLInputElement).value) / 100); }
function onSwipe(e: Event): void { mixer.setSwipe(Number((e.target as HTMLInputElement).value) / 100); }
function onBlinkSpeed(e: Event): void { mixer.setBlinkMs(2800 - Number((e.target as HTMLInputElement).value)); }
function setMode(m: MixMode): void { mixer.setMode(m); }
</script>

<style lang="less">
.mixer { display: flex; flex-direction: column; gap: 10px; min-width: 0; }
.mx-bar { display: flex; align-items: center; gap: 12px; min-width: 0; }
.mx-dots { display: flex; align-items: center; background: none; border: 0; padding: 0; cursor: pointer; color: var(--fg); flex: none; }
.mx-dot { width: 30px; height: 30px; border-radius: 50%; overflow: hidden; border: 2px solid; margin-left: -9px; background: #000; }
.mx-dot:first-child { margin-left: 0; }
.mx-count { margin-left: 8px; font: 600 0.8rem var(--font-mono); }
.mx-tip { color: var(--muted); font-size: 0.82rem; }
.mx-head { display: flex; justify-content: space-between; align-items: center; gap: 8px; }
.mx-empty { margin: 0; color: var(--muted); font-size: 0.88rem; }
.mx-sweep-wrap { display: flex; flex-direction: column; gap: 4px; }
.mx-sweep-wrap label { font: 600 0.9rem var(--font-display); }
.mx-sweep { width: 100%; }
.mx-stops { display: flex; justify-content: space-between; font: 0.68rem var(--font-mono); }
.mx-note { margin: 0; font-size: 0.78rem; color: var(--muted); }
.mx-layers { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 4px; }
.mx-layer { display: grid; grid-template-columns: 44px minmax(0, 1fr); gap: 10px; align-items: center; padding: 6px; border-radius: 10px; background: var(--panel-2); }
.mx-layer.off { opacity: 0.6; }
.mx-layer.preview { outline: 1px dashed var(--line-strong); }
.mx-thumb { width: 44px; height: 44px; padding: 0; border-radius: 8px; overflow: hidden; border: 1px solid var(--line); cursor: pointer; background: #000; }
.mx-main { min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.mx-name { display: flex; align-items: baseline; gap: 6px; min-width: 0; }
.mx-title { font-size: 0.86rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0; }
.mx-preview { font: italic 0.7rem var(--font-mono); color: var(--muted); flex: none; }
.mx-ctl { display: flex; align-items: center; gap: 4px; min-width: 0; }
.mx-ctl input[type="range"] { flex: 1; min-width: 50px; }
.mx-pct { width: 3em; text-align: right; font: 0.72rem var(--font-mono); color: var(--muted); font-variant-numeric: tabular-nums; flex: none; }
.ib.keep { color: var(--gold); }
.mx-bg { background: transparent; border: 1px dashed var(--line); }
.mx-thumb.bg { display: grid; place-items: center; color: var(--muted); cursor: default; }
.mx-bg .tag { color: var(--muted); }
.mx-survey { flex: 1; min-width: 0; max-width: 100%; font: inherit; font-size: 0.86rem; color: var(--fg); background: transparent; border: 1px solid var(--line); border-radius: 6px; padding: 2px 4px; text-overflow: ellipsis; }
.mx-survey option { background: #0b1220; color: #e8eef8; }
.mx-now { display: flex; align-items: baseline; gap: 6px; min-width: 0; }
.mx-now .mx-title { font-weight: 600; }
.mx-now-n { font: 600 0.74rem var(--font-mono); color: var(--gold); font-variant-numeric: tabular-nums; flex: none; }
.mixer.bar { gap: 4px; }
.bar-now { padding: 0 2px; }
.mx-scrub-row { display: flex; align-items: center; gap: 4px; }
.mx-track { flex: 1; min-width: 60px; display: flex; flex-direction: column; gap: 3px; }
.mx-ticks { display: flex; gap: 2px; padding: 0 6px; }
.mx-ticks i { flex: 1; height: 4px; border-radius: 2px; background: var(--line-strong); opacity: 0.55; }
.mx-ticks i.cur { opacity: 1; outline: 1px solid var(--fg); }
.mx-scrub-opts { display: flex; flex-wrap: wrap; gap: 6px 14px; font-size: 0.8rem; color: var(--muted); }
.mx-scrub-opts label { display: flex; align-items: center; gap: 6px; }
.mx-scrub-opts select { background: var(--panel-2); border: 1px solid var(--line-strong); border-radius: 6px; padding: 3px 4px; color: var(--fg); }
.mx-layer.cur { background: var(--panel-3); box-shadow: inset 2px 0 0 var(--gold); }
.mx-info { font-size: 0.78rem; margin-right: auto; }
.mx-toggle { display: flex; gap: 8px; align-items: center; font-size: 0.84rem; color: var(--muted); cursor: pointer; }
</style>
