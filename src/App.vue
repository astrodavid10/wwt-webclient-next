<template>
  <div ref="root" class="app" :class="{ phone: isPhone, desk: !isPhone, side: sideSheet }" @keydown="onKey">
    <!-- The sky. Never unmounted: a remounted WWT canvas renders black. -->
    <div
      class="sky"
      @pointerdown="onSkyPointerDown"
      @pointermove="onSkyPointerMove"
      @pointerup="cancelLongPress"
      @pointercancel="cancelLongPress"
      @contextmenu.prevent="onContextMenu"
    >
      <WorldWideTelescope wwt-namespace="wwt-next" class="wwt" />
      <canvas ref="overlayCanvas" class="overlay" aria-hidden="true"></canvas>
    </div>

    <!-- Swipe compare handle -->
    <div
      v-if="ready && mixer.mode === 'swipe' && mixer.visible.length > 1"
      class="swipe-line"
      :style="{ left: `${mixer.swipeFrac * 100}%` }"
      @pointerdown.stop="startSwipeDrag"
    >
      <span class="swipe-knob" aria-hidden="true">⇔</span>
    </div>

    <!-- Edge hints: good images just off-screen in that direction -->
    <template v-if="ready && result && !tour">
      <button
        v-for="e in edgeButtons"
        :key="e.sector"
        type="button"
        class="edge"
        :style="{ left: `${e.x}px`, top: `${e.y}px` }"
        :aria-label="`${e.count} images just off-screen, pan ${e.dir}`"
        @click="flyTo(e.raDeg, e.decDeg, camera.fovDeg)"
      ><span aria-hidden="true">{{ e.arrow }}</span> {{ e.count }}</button>
    </template>

    <!-- Top bar -->
    <header ref="topbar" class="topbar">
      <a class="brand" href="https://worldwidetelescope.org/" target="_blank" rel="noopener" aria-label="WorldWide Telescope home">
        <svg viewBox="0 0 32 32" width="28" height="28" aria-hidden="true"><circle cx="16" cy="16" r="14" fill="none" stroke="#99c8ff" stroke-width="2" /><path d="M5 19c6-6 16-9 22-7" fill="none" stroke="#f0ab52" stroke-width="2.4" stroke-linecap="round" /><circle cx="21" cy="11" r="2.6" fill="#f0ab52" /></svg>
        <span v-if="!isPhone" class="brand-name">WorldWide Telescope</span>
      </a>
      <search-box
        ref="searchBox"
        :index="nameIndex"
        :constellations="constellations"
        :compact="isPhone"
        @select="onSearchSelect"
        @message="toast"
      />
      <div class="top-actions">
        <span v-if="!isPhone && ready" class="status mono" aria-live="off">{{ statusText }}</span>
        <button type="button" class="ib big explore-btn" :aria-pressed="exploreOpen" aria-label="Explore collections and tours" title="Explore collections and tours" @click="exploreOpen = !exploreOpen">
          <font-awesome-icon icon="compass" /><span v-if="!isPhone">Explore</span>
        </button>
        <button type="button" class="ib big" :aria-pressed="settingsOpen" aria-label="View settings" title="View settings" @click="settingsOpen = !settingsOpen">
          <font-awesome-icon icon="gear" />
        </button>
        <button v-if="!isPhone" type="button" class="ib big" aria-label="Share this view" title="Share this view" @click="share()">
          <font-awesome-icon icon="share-nodes" />
        </button>
      </div>
    </header>

    <div v-if="isPhone && ready" class="status-chip mono">{{ statusText }}</div>

    <explore-panel
      v-if="exploreOpen && ready"
      class="explore-wrap"
      :by-url="byUrl"
      :mixer-ids="mixer.ids"
      @close="exploreOpen = false"
      @open="onExploreOpen"
      @add="addToMix($event)"
      @background="useAsBackground"
      @tour="playTour"
    />

    <div v-if="tour" class="tour-bar panel" role="region" aria-label="Guided tour">
      <div class="tour-title">
        <span class="tag">TOUR</span>
        <span>{{ tour.title }}</span>
      </div>
      <button v-if="engine.isTourPlayerActive" type="button" class="btn" @click="engine.toggleTourPlayPauseState()">
        {{ engine.isTourPlaying ? "Pause" : "Resume" }}
      </button>
      <span v-else class="muted-text">Tour finished</span>
      <button type="button" class="btn primary" @click="exitTour"><font-awesome-icon icon="arrow-left" /> Back to exploring</button>
    </div>

    <!-- Settings popover -->
    <div v-if="settingsOpen" class="settings panel" role="dialog" aria-label="View settings">
      <div class="settings-head">
        <h2>View</h2>
        <button type="button" class="ib" aria-label="Close settings" @click="settingsOpen = false"><font-awesome-icon icon="xmark" /></button>
      </div>
      <button v-if="isPhone" type="button" class="btn" @click="settingsOpen = false; share()"><font-awesome-icon icon="share-nodes" /> Share this view</button>
      <label class="field">
        <span>Background survey</span>
        <select :value="bgName" @change="setBackground(($event.target as HTMLSelectElement).value)">
          <option v-for="n in backgrounds" :key="n" :value="n">{{ n }}</option>
        </select>
      </label>
      <label class="check"><input v-model="settings.figures" type="checkbox" /> Constellation lines</label>
      <label class="check"><input v-model="settings.boundaries" type="checkbox" /> Constellation boundaries</label>
      <label class="check"><input v-model="settings.grid" type="checkbox" /> Coordinate grid</label>
      <label class="check"><input v-model="settings.mixOutlines" type="checkbox" /> Outline images in the mix</label>
      <label class="check"><input v-model="settings.imageryMap" type="checkbox" /> Imagery map (outline every image in view)</label>
    </div>

    <!-- ===== Desktop layout ===== -->
    <template v-if="!isPhone && ready && !tour">
      <aside v-if="selected" class="card-wrap panel" aria-label="Image details">
        <image-card
          :place="selected"
          :in-mixer="mixer.has(selected.id)"
          :pinned="isPinned(selected.id)"
          @close="selected = null"
          @fly="openPlace(selected, { addToMix: false })"
          @keep="keep(selected)"
          @remove="mixer.remove(selected.id)"
          @solo="mixer.solo(selected.id)"
          @share="share()"
        />
      </aside>

      <aside v-if="railOpen" ref="rail" class="rail panel" aria-labelledby="rail-title">
        <div class="rail-head">
          <h2 id="rail-title">In view <span class="rail-where">{{ whereText }}</span></h2>
          <span class="rail-count">{{ inViewCount }}</span>
          <button type="button" class="ib" aria-label="Hide the In view list" title="Hide" @click="railOpen = false"><font-awesome-icon icon="chevron-right" /></button>
        </div>
        <div class="rail-body">
          <in-view-panel
            :result="result"
            layout="list"
            :hovered-id="hoveredId"
            :selected-id="selected?.id ?? null"
            :mixer-ids="mixer.ids"
            @hover="hoveredId = $event"
            @open="openPlace($event)"
            @add="addToMix($event)"
          />
        </div>
      </aside>
      <button v-else type="button" class="rail-tab" :aria-label="`Show the In view list, ${inViewCount} images`" @click="railOpen = true">
        <font-awesome-icon icon="chevron-left" /> In view <b>{{ inViewCount }}</b>
      </button>

      <section ref="dock" class="dock panel" :class="{ open: dockOpen }" aria-label="Image mixer">
        <div class="dock-head">
          <h2>Mixer</h2>
          <mixer-panel v-if="!dockOpen" variant="bar" class="dock-bar" @expand="dockOpen = true" />
          <button type="button" class="ib" :aria-expanded="dockOpen" :aria-label="dockOpen ? 'Collapse the mixer' : 'Expand the mixer'" @click="dockOpen = !dockOpen">
            <font-awesome-icon :icon="dockOpen ? 'chevron-down' : 'chevron-up'" />
          </button>
        </div>
        <div v-if="dockOpen" class="dock-body">
          <mixer-panel variant="panel" @select="selectPlace($event)" />
        </div>
      </section>
    </template>

    <!-- ===== Phone layout: one bottom sheet with tabs ===== -->
    <template v-if="isPhone && ready && !tour">
      <div v-if="mixer.count && sheetTab !== 'mixer'" class="phone-mixbar panel" :style="sideSheet ? {} : { bottom: `calc(${sheetHeightCss} + 8px)` }">
        <mixer-panel variant="bar" @expand="openSheet('mixer', 'half')" />
      </div>
      <section ref="sheet" class="sheet panel" :class="`snap-${sheetSnap}`" :style="sideSheet ? {} : { height: sheetHeightCss }" aria-label="Images">
        <div class="sheet-head" @pointerdown="startSheetDrag">
          <button type="button" class="grip" :aria-label="sheetSnap === 'peek' ? 'Expand the panel' : 'Shrink the panel'" @click="cycleSheet"></button>
          <div class="seg sheet-tabs" role="tablist">
            <button type="button" role="tab" :aria-selected="sheetTab === 'inview'" :aria-pressed="sheetTab === 'inview'" @click="openSheet('inview')">In view {{ inViewCount }}</button>
            <button type="button" role="tab" :aria-selected="sheetTab === 'mixer'" :aria-pressed="sheetTab === 'mixer'" @click="openSheet('mixer', 'half')">Mixer {{ mixer.count || "" }}</button>
            <button v-if="selected" type="button" role="tab" :aria-selected="sheetTab === 'card'" :aria-pressed="sheetTab === 'card'" @click="openSheet('card', 'half')">Image</button>
          </div>
        </div>
        <div class="sheet-body">
          <in-view-panel
            v-if="sheetTab === 'inview'"
            :result="result"
            :layout="sheetSnap === 'peek' && !sideSheet ? 'strip' : 'list'"
            :hovered-id="hoveredId"
            :selected-id="selected?.id ?? null"
            :mixer-ids="mixer.ids"
            @hover="hoveredId = $event"
            @open="openPlace($event)"
            @add="addToMix($event)"
          />
          <mixer-panel v-else-if="sheetTab === 'mixer'" variant="panel" @select="selectPlace($event)" />
          <image-card
            v-else-if="sheetTab === 'card' && selected"
            :place="selected"
            :in-mixer="mixer.has(selected.id)"
            :pinned="isPinned(selected.id)"
            @close="closeCard"
            @fly="openPlace(selected, { addToMix: false })"
            @keep="keep(selected)"
            @remove="mixer.remove(selected.id)"
            @solo="mixer.solo(selected.id)"
            @share="share()"
          />
        </div>
      </section>
    </template>

    <!-- Boot / error -->
    <div v-if="!ready" class="boot" role="status" aria-live="polite">
      <div v-if="bootError" class="boot-card panel">
        <font-awesome-icon icon="triangle-exclamation" class="boot-warn" />
        <h1>WorldWide Telescope couldn't start</h1>
        <p>{{ bootError }}</p>
        <button v-if="bootRetryable" type="button" class="btn primary" @click="reload">Try again</button>
      </div>
      <div v-else class="boot-card panel">
        <div class="boot-spinner" aria-hidden="true"></div>
        <p>{{ bootStage }}</p>
      </div>
    </div>

    <div v-if="toastText" class="toast" role="status">{{ toastText }}</div>
  </div>
</template>

<script setup lang="ts">
import { computed, markRaw, nextTick, onBeforeUnmount, onMounted, reactive, ref, shallowRef, watch } from "vue";
import { engineStore } from "@wwtelescope/engine-pinia";
import { loadSearchIndex } from "./catalog/searchIndex";
import { computeInView, InViewResult } from "./catalog/inView";
import { buildNameIndex, NameIndexEntry, ConstellationEntry, SearchHit } from "./catalog/search";
import { footprintSize, refineFootprint, footprintCorners, offsetToRaDec } from "./catalog/imagery";
import { sourceColor } from "./catalog/sources";
import type { SkyPlace } from "./catalog/types";
import { useMixer } from "./mixer";
import { FootprintOverlay, Outline } from "./footprints";
import { centreConstellation, constellationList, constellationName, flyTo as skyFlyTo, formatDec, formatRA, formatSize, readCamera } from "./sky";
import { describeBootError, hasWebGL, withTimeout } from "./boot";
import { numberParam, stringParam } from "./urlParams";
import SearchBox from "./components/SearchBox.vue";
import InViewPanel from "./components/InViewPanel.vue";
import MixerPanel from "./components/MixerPanel.vue";
import ImageCard from "./components/ImageCard.vue";
import ExplorePanel from "./components/ExplorePanel.vue";
import type { TourEntry } from "./catalog/wtml";
import { makeImageset } from "./catalog/imagery";

const BG_WTML = "https://data1.wwtassets.org/packages/2023/06_pas/BackgroundImagery_v2.wtml";
const DEFAULT_BG = "Digitized Sky Survey (Color)";
const DEFAULT_VIEW = { raDeg: 83.8, decDeg: -3.5, fovDeg: 14 };   // Orion

const engine = engineStore();
const mixer = useMixer();

// ── state ───────────────────────────────────────────────────────────────────
const root = ref<HTMLElement | null>(null);
const overlayCanvas = ref<HTMLCanvasElement | null>(null);
const topbar = ref<HTMLElement | null>(null);
const dock = ref<HTMLElement | null>(null);
const rail = ref<HTMLElement | null>(null);
const sheet = ref<HTMLElement | null>(null);
const searchBox = ref<InstanceType<typeof SearchBox> | null>(null);

const ready = ref(false);
const bootStage = ref("Starting the sky viewer…");
const bootError = ref("");
const bootRetryable = ref(true);

const places = shallowRef<SkyPlace[]>([]);
const images = shallowRef<SkyPlace[]>([]);
const byId = new Map<string, SkyPlace>();
const nameIndex = shallowRef<NameIndexEntry[]>([]);
const constellations = shallowRef<ConstellationEntry[]>([]);
const result = shallowRef<InViewResult | null>(null);
const hoveredId = ref<string | null>(null);
const selected = shallowRef<SkyPlace | null>(null);

/** Compact layout: one tabbed sheet instead of separate panels (phones, short screens). */
const isPhone = ref(false);
/** Compact and landscape: the sheet docks to the right edge instead of the bottom. */
const sideSheet = ref(false);
const railOpen = ref(true);
const dockOpen = ref(false);
const settingsOpen = ref(false);
const exploreOpen = ref(false);
const tour = shallowRef<TourEntry | null>(null);
let preTour: { raDeg: number; decDeg: number; fovDeg: number } | null = null;
const byUrl = new Map<string, SkyPlace>();
const sheetTab = ref<"inview" | "mixer" | "card">("inview");
const sheetSnap = ref<"peek" | "half" | "full">("peek");
const sheetDragPx = ref<number | null>(null);

const backgrounds = ref<string[]>([]);
const bgName = ref(DEFAULT_BG);
const settings = reactive({ figures: true, boundaries: false, grid: false, mixOutlines: true, imageryMap: false });

const toastText = ref("");
const viewport = reactive({ w: window.innerWidth, h: window.innerHeight, top: 64, bottom: 0, right: 0 });

// ── camera ──────────────────────────────────────────────────────────────────
const camera = computed(() => {
  // Touch the reactive engine fields so this recomputes on camera moves.
  void engine.raRad; void engine.decRad; void engine.zoomDeg; void engine.rollRad;
  return readCamera();
});
const conAbbr = ref("");
const whereText = computed(() => conAbbr.value ? `· ${constellationName(conAbbr.value)}` : "");
const statusText = computed(() => {
  const c = camera.value;
  return `${formatRA(c.raDeg)} ${formatDec(c.decDeg)} · ${formatSize(c.fovDeg)}${conAbbr.value ? ` · ${constellationName(conAbbr.value)}` : ""}`;
});
const inViewCount = computed(() => {
  const r = result.value;
  return r ? r.fit.length + r.wide.length + r.small.length : 0;
});

// ── In view: recompute on camera change, at most every 200 ms ───────────────
let ivTimer = 0, ivLast = 0;
function scheduleInView(): void {
  if (!images.value.length) { return; }
  const wait = Math.max(0, 200 - (performance.now() - ivLast));
  if (ivTimer) { return; }
  ivTimer = window.setTimeout(() => {
    ivTimer = 0;
    ivLast = performance.now();
    const c = readCamera();
    const el = root.value;
    const aspect = el ? el.clientWidth / Math.max(1, el.clientHeight) : 1.6;
    result.value = markRaw(computeInView(images.value, { raDeg: c.raDeg, decDeg: c.decDeg, fovDeg: c.fovDeg, aspect, rollDeg: c.rollDeg }));
    conAbbr.value = centreConstellation();
    updateOutlines();
  }, wait);
}
watch(() => [engine.raRad, engine.decRad, engine.zoomDeg, engine.rollRad], scheduleInView);

// ── footprints ──────────────────────────────────────────────────────────────
let overlay: FootprintOverlay | null = null;
function updateOutlines(): void {
  if (!overlay) { return; }
  const out: Outline[] = [];
  const seen = new Set<string>();
  const push = (o: Outline) => { if (!seen.has(o.place.id)) { seen.add(o.place.id); out.push(o); } };
  const hov = hoveredId.value ? byId.get(hoveredId.value) : null;
  if (hov) { push({ place: hov, color: "#ffffff", width: 2.5, label: true }); }
  if (selected.value?.study) { push({ place: selected.value, color: "#f0ab52", width: 2 }); }
  if (settings.mixOutlines) {
    for (const l of mixer.layers) { if (l.on) { push({ place: l.place, color: sourceColor(l.place.source), width: 1.4, dash: [6, 5] }); } }
  }
  if (settings.imageryMap && result.value) {
    const r = result.value;
    for (const it of [...r.wide, ...r.fit, ...r.small]) {
      push({ place: it.place, color: "rgba(240,171,82,0.55)", width: 1, fill: "rgba(240,171,82,0.05)" });
    }
  }
  overlay.set(out);
}
watch([hoveredId, selected, () => settings.mixOutlines, () => settings.imageryMap, () => mixer.urlValue], updateOutlines);

// ── edge hints ──────────────────────────────────────────────────────────────
const ARROWS = ["→", "↘", "↓", "↙", "←", "↖", "↑", "↗"];
const DIRS = ["right", "down and right", "down", "down and left", "left", "up and left", "up", "up and right"];
const edgeButtons = computed(() => {
  const r = result.value;
  if (!r) { return []; }
  // The visible sky between the chrome.
  const left = 8, right = viewport.w - viewport.right - 8, top = viewport.top + 8, bottom = viewport.h - viewport.bottom - 8;
  const cx = (left + right) / 2, cy = (top + bottom) / 2;
  return r.edges.filter((e) => e.count >= 2).map((e) => {
    const ang = e.sector * Math.PI / 4, dx = Math.cos(ang), dy = Math.sin(ang);
    const k = ((right - left) / 2 - 34) / Math.max(1e-6, Math.abs(dx));
    const k2 = ((bottom - top) / 2 - 18) / Math.max(1e-6, Math.abs(dy));
    const t = Math.min(k, k2);
    return { ...e, x: cx + dx * t, y: cy + dy * t, arrow: ARROWS[e.sector], dir: DIRS[e.sector] };
  });
});

// ── layout measurement ──────────────────────────────────────────────────────
let ro: ResizeObserver | null = null;
function measure(): void {
  viewport.w = window.innerWidth;
  viewport.h = window.innerHeight;
  isPhone.value = viewport.w < 720 || viewport.h < 520;
  sideSheet.value = isPhone.value && viewport.w > viewport.h;
  const tb = topbar.value?.getBoundingClientRect();
  viewport.top = tb ? tb.bottom : 64;
  if (sideSheet.value) {
    const sh = sheet.value?.getBoundingClientRect();
    viewport.bottom = 0;
    viewport.right = sh ? viewport.w - sh.left : 0;
  } else if (isPhone.value) {
    const sh = sheet.value?.getBoundingClientRect();
    viewport.bottom = sh ? viewport.h - sh.top : 0;
    viewport.right = 0;
  } else {
    const d = dock.value?.getBoundingClientRect();
    viewport.bottom = d ? viewport.h - d.top : 0;
    const r = rail.value?.getBoundingClientRect();
    viewport.right = r ? viewport.w - r.left : 0;
  }
  // The phone mixer bar floats above the sheet (or along the bottom beside the side sheet).
  const bar = root.value?.querySelector(".phone-mixbar")?.getBoundingClientRect();
  if (bar) { viewport.bottom = Math.max(viewport.bottom, viewport.h - bar.top); }
  root.value?.style.setProperty("--dock-h", `${viewport.bottom}px`);
  root.value?.style.setProperty("--top-h", `${viewport.top}px`);
  scheduleInView();
}
watch([isPhone, railOpen, dockOpen, sheetSnap, sheetTab, () => mixer.count, ready], () => nextTick(measure));

// ── phone sheet ─────────────────────────────────────────────────────────────
const SNAP_PX = { peek: 214, half: 0.52, full: 0.86 };
function snapHeight(s: "peek" | "half" | "full"): number {
  return s === "peek" ? SNAP_PX.peek : Math.round(viewport.h * SNAP_PX[s]);
}
const sheetHeightCss = computed(() => `${sheetDragPx.value ?? snapHeight(sheetSnap.value)}px`);
function openSheet(tab: "inview" | "mixer" | "card", snap?: "peek" | "half" | "full"): void {
  sheetTab.value = tab;
  if (snap && (sheetSnap.value === "peek" || snap === "full")) { sheetSnap.value = snap; }
}
function cycleSheet(): void {
  sheetSnap.value = sheetSnap.value === "peek" ? "half" : sheetSnap.value === "half" ? "full" : "peek";
}
function startSheetDrag(ev: PointerEvent): void {
  if ((ev.target as HTMLElement).closest(".sheet-tabs")) { return; }
  const startY = ev.clientY, startH = snapHeight(sheetSnap.value);
  let moved = false;
  const move = (e: PointerEvent) => {
    const dy = startY - e.clientY;
    if (Math.abs(dy) > 6) { moved = true; }
    if (moved) { sheetDragPx.value = Math.max(120, Math.min(viewport.h * 0.92, startH + dy)); }
  };
  const up = () => {
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", up);
    if (moved && sheetDragPx.value !== null) {
      const h = sheetDragPx.value;
      const snaps: ("peek" | "half" | "full")[] = ["peek", "half", "full"];
      sheetSnap.value = snaps.reduce((a, b) => (Math.abs(snapHeight(b) - h) < Math.abs(snapHeight(a) - h) ? b : a));
      // Swallow the click that follows a drag.
      window.addEventListener("click", (e) => e.stopPropagation(), { capture: true, once: true });
    }
    sheetDragPx.value = null;
  };
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", up);
}

// ── opening images ──────────────────────────────────────────────────────────
function framingFov(p: SkyPlace): number {
  return p.zoom > 0 ? p.zoom / 6 : p.study ? Math.max(footprintSize(p) * 1.1, 0.01) : 1;
}

/** Fly to a place, show its card, and (for images) show it on top of the mix as a preview. */
/**
 * Camera target that puts (ra, dec) at the centre of the sky left visible by
 * the panels, with `fov` fitting that area's height. The engine always
 * centres on the canvas, so the camera aims a little off the object.
 */
function frameInFreeArea(ra: number, dec: number, fov: number): [number, number, number] {
  const w = viewport.w, h = viewport.h;
  const right = viewport.right;
  let left = 0, bottom = viewport.bottom;
  if (!isPhone.value) {
    if (exploreOpen.value) { left = Math.min(772, w - 380) + 12; }
    else if (selected.value) { left = 364; }
  } else if (!sideSheet.value) {
    bottom = snapHeight(sheetSnap.value === "peek" ? "half" : sheetSnap.value);
  }
  const top = viewport.top;
  const fw = w - left - right, fh = h - top - bottom;
  if (fw < 120 || fh < 120) { return [ra, dec, fov]; }
  // Catalogue framings are a vertical FOV for a landscape screen: fit that
  // height into the free height, and ~1.3x it into the free width.
  const canvasFov = Math.max(fov * h / fh, fov * 1.3 * h / fw);
  const s = canvasFov / h;
  const dx = left + fw / 2 - w / 2, dy = top + fh / 2 - h / 2;
  const [cRa, cDec] = offsetToRaDec(ra, dec, dx * s, dy * s);
  return [cRa, cDec, canvasFov];
}

function openPlace(p: SkyPlace, opts: { addToMix?: boolean } = {}): void {
  selected.value = markRaw(p);
  if (isPhone.value) { sheetTab.value = "card"; if (sheetSnap.value === "full") { sheetSnap.value = "half"; } }
  const [ra, dec, fov] = frameInFreeArea(
    p.study ? p.study.centerX : p.raHours * 15,
    p.study ? p.study.centerY : p.decDeg,
    framingFov(p),
  );
  const ms = skyFlyTo(ra, dec, fov);
  if (p.study && opts.addToMix !== false) {
    mixer.add(p, { preview: true, fadeAfterMs: ms ? ms * 0.7 : 0 });
  }
}
function selectPlace(p: SkyPlace): void {
  selected.value = markRaw(p);
  if (isPhone.value) { sheetTab.value = "card"; }
}
function addToMix(p: SkyPlace): void {
  if (mixer.has(p.id) && isPinned(p.id)) { mixer.remove(p.id); return; }
  mixer.add(p, { fadeAfterMs: 0 });
}
function keep(p: SkyPlace): void { mixer.add(p); }
function isPinned(id: string): boolean { return mixer.layers.find((l) => l.place.id === id)?.pinned ?? false; }
function closeCard(): void { selected.value = null; sheetTab.value = "inview"; }

// ── Explore and tours ───────────────────────────────────────────────────────
function onExploreOpen(p: SkyPlace): void {
  if (!byId.has(p.id)) { byId.set(p.id, p); }
  if (isPhone.value) { exploreOpen.value = false; }
  openPlace(p);
}
function useAsBackground(p: SkyPlace): void {
  const iset = makeImageset(p);
  if (!iset) { return; }
  const registered = engine.addImagesetToRepository(iset);
  const name = registered.get_name();
  if (!backgrounds.value.includes(name)) { backgrounds.value = [...backgrounds.value, name].sort(); }
  setBackground(name);
  toast(`Background: ${name}`);
}
async function playTour(t: TourEntry): Promise<void> {
  preTour = { ...readCamera() };
  exploreOpen.value = false;
  settingsOpen.value = false;
  tour.value = t;
  mixer.suspend(true);
  try {
    await engine.loadTour({ url: t.url, play: true });
  } catch (err) {
    console.warn("[wwt-next] tour failed", err);
    toast("This tour couldn't be loaded.");
    exitTour();
  }
}
function exitTour(): void {
  try { engine.stopTour(); } catch { /* not playing */ }
  try { engine.closeTourPlayer(); } catch { /* no player */ }
  tour.value = null;
  engine.setBackgroundImageByName(bgName.value);
  applyViewSettings();
  mixer.suspend(false);
  if (preTour) { skyFlyTo(preTour.raDeg, preTour.decDeg, preTour.fovDeg, true); }
}
function flyTo(raDeg: number, decDeg: number, fovDeg: number): void { skyFlyTo(raDeg, decDeg, fovDeg); }

function onSearchSelect(h: SearchHit): void {
  if (h.place) { openPlace(h.place); return; }
  skyFlyTo(h.raDeg, h.decDeg, h.fovDeg);
  if (h.kind === "resolver") { toast(`${h.label}: from SIMBAD`); }
}

// ── "What's here?": long-press (touch) or right-click ──────────────────────
let lpTimer = 0;
let lpStart: { x: number; y: number } | null = null;
function onSkyPointerDown(ev: PointerEvent): void {
  if (ev.pointerType === "mouse" || !(ev.target instanceof HTMLCanvasElement)) { return; }
  lpStart = { x: ev.clientX, y: ev.clientY };
  window.clearTimeout(lpTimer);
  lpTimer = window.setTimeout(() => { if (lpStart) { whatsHere(lpStart.x, lpStart.y); } lpStart = null; }, 600);
}
function onSkyPointerMove(ev: PointerEvent): void {
  if (lpStart && Math.hypot(ev.clientX - lpStart.x, ev.clientY - lpStart.y) > 10) { cancelLongPress(); }
}
function cancelLongPress(): void { window.clearTimeout(lpTimer); lpStart = null; }
function onContextMenu(ev: MouseEvent): void { whatsHere(ev.clientX, ev.clientY); }

function whatsHere(x: number, y: number): void {
  let pos: { ra: number; dec: number };
  try { pos = engine.findRADecForScreenPoint({ x, y }); } catch { return; }
  const fov = camera.value.fovDeg;
  // The smallest image whose footprint contains the point, if it's not tiny on screen.
  let best: SkyPlace | null = null;
  for (const p of images.value) {
    const half = footprintSize(p) / 2;
    if (half < fov * 0.01) { continue; }
    const dRa = (((p.study!.centerX - pos.ra) + 540) % 360 - 180) * Math.cos(pos.dec * Math.PI / 180);
    const dDec = p.study!.centerY - pos.dec;
    if (Math.abs(dRa) <= half && Math.abs(dDec) <= half && (!best || p.sizeDeg < best.sizeDeg)) { best = p; }
  }
  // Otherwise the nearest named object within a few percent of the view.
  if (!best) {
    let bestD = fov * 0.04;
    for (const p of places.value) {
      if (p.constellation === "SolarSystem") { continue; }
      const dRa = (((p.raHours * 15 - pos.ra) + 540) % 360 - 180) * Math.cos(pos.dec * Math.PI / 180);
      const d = Math.hypot(dRa, p.decDeg - pos.dec);
      if (d < bestD) { bestD = d; best = p; }
    }
  }
  if (best) { selectPlace(best); hoveredId.value = null; if (isPhone.value && sheetSnap.value === "peek") { sheetSnap.value = "half"; } }
  else { toast(`Nothing catalogued at ${formatRA(pos.ra)} ${formatDec(pos.dec)}`); }
}

// ── swipe drag on the sky ───────────────────────────────────────────────────
function startSwipeDrag(ev: PointerEvent): void {
  const move = (e: PointerEvent) => mixer.setSwipe(e.clientX / window.innerWidth);
  const up = () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); };
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", up);
  move(ev);
}

// ── settings ────────────────────────────────────────────────────────────────
function applyViewSettings(): void {
  engine.applySetting(["showConstellationFigures", settings.figures]);
  engine.applySetting(["showConstellationBoundries", settings.boundaries]);
  engine.applySetting(["showConstellationSelection", false]);
  engine.applySetting(["showGrid", settings.grid]);
  engine.applySetting(["showEquatorialGridText", settings.grid]);
  engine.applySetting(["showCrosshairs", false]);
}
watch(() => [settings.figures, settings.boundaries, settings.grid], applyViewSettings);

function setBackground(name: string): void {
  bgName.value = name;
  engine.setBackgroundImageByName(name);
}

// ── URL state ───────────────────────────────────────────────────────────────
let urlTimer = 0;
function syncUrl(): void {
  window.clearTimeout(urlTimer);
  urlTimer = window.setTimeout(() => {
    if (!ready.value) { return; }
    const c = readCamera();
    const q = new URLSearchParams();
    q.set("ra", c.raDeg.toFixed(4));
    q.set("dec", c.decDeg.toFixed(4));
    q.set("fov", c.fovDeg < 1 ? c.fovDeg.toPrecision(3) : c.fovDeg.toFixed(2));
    if (mixer.count) { q.set("layers", mixer.urlValue); }
    if (mixer.mode !== "mix") { q.set("mode", mixer.mode); }
    if (mixer.additive) { q.set("blend", "add"); }
    if (mixer.backgroundPct !== 100) { q.set("bgop", String(mixer.backgroundPct)); }
    if (selected.value) { q.set("place", selected.value.id); }
    if (bgName.value !== DEFAULT_BG) { q.set("bg", bgName.value); }
    const keep = ["debug", "tileq"].filter((k) => new URLSearchParams(location.search).has(k));
    keep.forEach((k) => q.set(k, new URLSearchParams(location.search).get(k) ?? ""));
    history.replaceState(null, "", `${location.pathname}?${q.toString().replace(/%3A/g, ":").replace(/%2C/g, ",")}`);
  }, 400);
}
watch([() => engine.raRad, () => engine.decRad, () => engine.zoomDeg, () => mixer.urlValue, () => mixer.mode, () => mixer.additive, () => mixer.backgroundPct, selected, bgName], syncUrl);

async function share(): Promise<void> {
  window.clearTimeout(urlTimer);
  syncUrl();
  await new Promise((r) => setTimeout(r, 450));
  const url = location.href;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const nav = navigator as any;
  if (isPhone.value && nav.share) {
    try { await nav.share({ title: "WorldWide Telescope", url }); return; } catch { /* cancelled */ }
  }
  try { await navigator.clipboard.writeText(url); toast("Link copied: it opens this view and this mix"); }
  catch { toast(url); }
}

let toastTimer = 0;
function toast(text: string): void {
  toastText.value = text;
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => { toastText.value = ""; }, 3500);
}

// ── keyboard ────────────────────────────────────────────────────────────────
function onKey(e: KeyboardEvent): void {
  const t = e.target as HTMLElement;
  const typing = t.tagName === "INPUT" && (t as HTMLInputElement).type !== "range" && (t as HTMLInputElement).type !== "checkbox" || t.tagName === "SELECT" || t.tagName === "TEXTAREA";
  if (e.key === "Escape") {
    if (settingsOpen.value) { settingsOpen.value = false; return; }
    if (exploreOpen.value) { exploreOpen.value = false; return; }
    if (selected.value) { closeCard(); return; }
    if (dockOpen.value) { dockOpen.value = false; return; }
    return;
  }
  if (typing || e.ctrlKey || e.metaKey || e.altKey) { return; }
  if (e.key === "/") { e.preventDefault(); searchBox.value?.focus(); }
  else if (e.key === "m" || e.key === "M") { if (isPhone.value) { openSheet("mixer", "half"); } else { dockOpen.value = !dockOpen.value; } }
  else if ((e.key === "]" || e.key === "[") && mixer.count > 1) {
    const p = mixer.sweep, n = mixer.count - 1;
    mixer.setSweep(e.key === "]" ? Math.min(n, Math.floor(p + 1e-6) + 1) : Math.max(0, Math.ceil(p - 1e-6) - 1));
  }
}
function onWindowKey(e: KeyboardEvent): void {
  if (e.target === document.body) { onKey(e); }
}

// ── boot ────────────────────────────────────────────────────────────────────
function reload(): void { location.reload(); }

async function boot(): Promise<void> {
  if (!hasWebGL()) {
    bootError.value = "This browser can't display WebGL graphics, which WorldWide Telescope needs. Try an up-to-date Chrome, Edge, Firefox or Safari.";
    bootRetryable.value = false;
    return;
  }
  try {
    await withTimeout(engine.waitForReady(), "Starting the sky viewer", 30_000);
    engine.setClockSync(false);
    applyViewSettings();

    const ra = numberParam("ra"), dec = numberParam("dec"), fov = numberParam("fov");
    const v = ra !== null && dec !== null ? { raDeg: ra, decDeg: dec, fovDeg: fov ?? 10 } : DEFAULT_VIEW;
    skyFlyTo(v.raDeg, v.decDeg, v.fovDeg, true);

    bootStage.value = "Loading sky surveys…";
    try {
      const folder = await withTimeout(engine.loadImageCollection({ url: BG_WTML, loadChildFolders: true }), "Loading sky surveys");
      const names: string[] = [];
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const walk = (f: any) => {
        for (const c of f.get_children?.() ?? []) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const iset = (c as any).get_dataSetType ? c : (c as any).get_backgroundImageset?.() ?? (c as any).get_studyImageset?.();
          if (iset?.get_dataSetType?.() === 2) { names.push(iset.get_name()); } else if (c.get_children) { walk(c); }
        }
      };
      walk(folder);
      backgrounds.value = Array.from(new Set(names)).sort();
      const want = stringParam("bg") ?? DEFAULT_BG;
      bgName.value = backgrounds.value.includes(want) ? want : DEFAULT_BG;
      engine.setBackgroundImageByName(bgName.value);
    } catch (err) {
      console.warn("[wwt-next] background surveys failed to load; keeping the default", err);
    }

    bootStage.value = "Loading the image index…";
    const all = await withTimeout(loadSearchIndex(), "Loading the image index", 45_000);
    places.value = markRaw(all);
    all.forEach((p) => { byId.set(p.id, p); if (p.study) { byUrl.set(p.study.url, p); } });
    images.value = markRaw(all.filter((p) => p.study && p.constellation !== "SolarSystem" && (p.study.projection === 2 || p.study.projection === 5)));
    nameIndex.value = markRaw(buildNameIndex(all));
    constellations.value = markRaw(constellationList());

    ready.value = true;
    await nextTick();
    if (overlayCanvas.value) {
      overlay = new FootprintOverlay(overlayCanvas.value);
      engine.addFrameCallback(drawOverlay);
    }
    measure();

    const layers = stringParam("layers");
    if (layers) { await mixer.restore(layers, (id) => byId.get(id)); }
    const mode = stringParam("mode");
    if (mode === "blink" || mode === "swipe") { mixer.setMode(mode); }
    if (stringParam("blend") === "add") { mixer.setAdditive(true); }
    const bgop = numberParam("bgop");
    if (bgop !== null) { mixer.setBackgroundPct(bgop); }
    const placeId = stringParam("place");
    if (placeId && byId.get(placeId)) { selectPlace(byId.get(placeId) as SkyPlace); }
    scheduleInView();
    syncUrl();
    if (constellations.value.length === 0) { window.setTimeout(() => { constellations.value = markRaw(constellationList()); }, 4000); }

    if (stringParam("debug") !== null) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (window as any).wwtNext = { engine, mixer, byId, result, images, openPlace, whatsHere, refineFootprint, footprintCorners, overlay: () => overlay };
    }
  } catch (err) {
    console.error("[wwt-next] startup failed", err);
    bootError.value = describeBootError(err);
  }
}

function drawOverlay(): void { overlay?.draw(); }

onMounted(() => {
  measure();
  ro = new ResizeObserver(() => measure());
  if (root.value) { ro.observe(root.value); }
  window.addEventListener("resize", measure);
  window.addEventListener("keydown", onWindowKey);
  boot();
});
onBeforeUnmount(() => {
  ro?.disconnect();
  window.removeEventListener("resize", measure);
  window.removeEventListener("keydown", onWindowKey);
  try { engine.removeFrameCallback(drawOverlay); } catch { /* engine gone */ }
});
</script>

<style lang="less">
.app { position: absolute; inset: 0; overflow: hidden; }
.sky { position: absolute; inset: 0; }
.wwt { position: absolute; inset: 0; }
.overlay { position: absolute; inset: 0; width: 100%; height: 100%; pointer-events: none; }

.topbar {
  position: absolute; top: max(10px, env(safe-area-inset-top)); left: max(12px, env(safe-area-inset-left)); right: max(12px, env(safe-area-inset-right));
  display: flex; align-items: center; gap: 12px; z-index: 30; pointer-events: none;
}
.topbar > * { pointer-events: auto; }
.brand { display: flex; align-items: center; gap: 8px; color: var(--fg); text-decoration: none; flex: none; background: var(--glass); border: 1px solid var(--line); border-radius: 21px; padding: 6px 12px 6px 7px; height: 42px; }
.brand-name { font: 700 0.95rem var(--font-display); white-space: nowrap; }
.desk .search { max-width: 560px; }
.top-actions { display: flex; gap: 8px; align-items: center; margin-left: auto; flex: none; }
.ib.big { width: 42px; height: 42px; border-radius: 50%; background: var(--glass); border-color: var(--line); }
.status { color: var(--muted); font-size: 0.78rem; background: var(--glass); border: 1px solid var(--line); border-radius: 21px; padding: 0 12px; height: 42px; display: inline-flex; align-items: center; white-space: nowrap; }
@media (max-width: 1180px) { .desk .status { display: none; } }
.status-chip { position: absolute; top: calc(max(10px, env(safe-area-inset-top)) + 50px); left: 12px; z-index: 20; color: var(--muted); font-size: 0.72rem; background: var(--glass); border-radius: 12px; padding: 3px 10px; pointer-events: none; }

.settings { position: absolute; z-index: 45; top: calc(var(--top-h, 64px) + 8px); right: 12px; width: min(340px, calc(100vw - 24px)); max-height: calc(100% - var(--top-h, 64px) - 20px); overflow-y: auto; padding: 14px; display: flex; flex-direction: column; gap: 10px; }
.settings-head { display: flex; justify-content: space-between; align-items: center; }
.settings h2 { margin: 0; font: 700 1rem var(--font-display); }
.field { display: flex; flex-direction: column; gap: 4px; font-size: 0.85rem; color: var(--muted); }
.field select { background: var(--panel-2); border: 1px solid var(--line-strong); border-radius: 8px; padding: 7px; color: var(--fg); }
.check { display: flex; gap: 8px; align-items: center; font-size: 0.9rem; cursor: pointer; min-height: 30px; }

.ib.big.explore-btn { width: auto; padding: 0 14px; gap: 8px; display: inline-flex; align-items: center; border-radius: 21px; }
.phone .ib.big.explore-btn { width: 42px; padding: 0; justify-content: center; }
.explore-wrap { position: absolute; z-index: 35; left: 12px; top: calc(var(--top-h, 64px) + 10px); bottom: 12px; width: min(760px, calc(100vw - 380px)); }
.phone .explore-wrap { left: 0; right: 0; bottom: 0; width: auto; top: calc(var(--top-h, 64px) + 8px); border-radius: 18px 18px 0 0; z-index: 50; background: var(--panel-solid); }
.tour-bar { position: absolute; z-index: 40; left: 50%; transform: translateX(-50%); bottom: max(16px, env(safe-area-inset-bottom)); display: flex; align-items: center; gap: 12px; padding: 10px 12px; flex-wrap: wrap; justify-content: center; max-width: calc(100vw - 24px); }
.tour-title { display: flex; align-items: center; gap: 8px; min-width: 0; font-weight: 700; }
.tour-title .tag { color: var(--gold); }
.muted-text { color: var(--muted); font-size: 0.9rem; }

/* desktop */
.rail { position: absolute; z-index: 20; right: 12px; top: calc(var(--top-h, 64px) + 10px); bottom: 12px; width: 340px; display: flex; flex-direction: column; }
.rail-head { display: flex; align-items: center; gap: 8px; padding: 12px 10px 8px 14px; border-bottom: 1px solid var(--line); }
.rail-head h2 { margin: 0; font: 700 1.05rem var(--font-display); flex: 1; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.rail-where { font-weight: 400; color: var(--muted); font-size: 0.9rem; }
.rail-count { font: 600 0.85rem var(--font-mono); color: var(--gold); }
.rail-body { overflow-y: auto; padding: 0 6px 10px; flex: 1; min-height: 0; }
.rail-tab { position: absolute; z-index: 20; right: 12px; top: calc(var(--top-h, 64px) + 10px); background: var(--glass); border: 1px solid var(--line); border-radius: 21px; height: 40px; padding: 0 14px; color: var(--fg); cursor: pointer; display: flex; gap: 8px; align-items: center; }
.rail-tab b { color: var(--gold); font-family: var(--font-mono); }

.dock { position: absolute; z-index: 25; left: 12px; bottom: 12px; width: min(560px, calc(100vw - 380px)); display: flex; flex-direction: column; max-height: 62vh; }
.dock-head { display: flex; align-items: center; gap: 12px; padding: 8px 10px 8px 14px; min-height: 52px; }
.dock-head h2 { margin: 0; font: 700 1rem var(--font-display); flex: none; }
.dock-bar { flex: 1; min-width: 0; }
.dock.open .dock-head { border-bottom: 1px solid var(--line); justify-content: space-between; }
.dock-body { overflow-y: auto; padding: 12px; min-height: 0; }

.card-wrap { position: absolute; z-index: 22; left: 12px; top: calc(var(--top-h, 64px) + 10px); width: 340px; max-height: calc(100% - var(--top-h, 64px) - var(--dock-h, 80px) - 32px); overflow-y: auto; padding: 12px; }

/* phone */
.sheet {
  position: absolute; z-index: 25; left: 0; right: 0; bottom: 0; border-radius: 18px 18px 0 0; border-bottom: 0;
  display: flex; flex-direction: column; transition: height 0.22s ease; padding-bottom: env(safe-area-inset-bottom);
}
.sheet-head { padding: 6px 10px 8px; display: flex; flex-direction: column; align-items: center; gap: 6px; touch-action: none; }
.grip { width: 56px; height: 18px; border: 0; background: none; cursor: pointer; position: relative; }
.grip::before { content: ""; position: absolute; left: 12px; right: 12px; top: 7px; height: 4px; border-radius: 2px; background: var(--line-strong); }
.sheet-tabs { width: 100%; }
.sheet-tabs button { flex: 1; min-height: 36px; }
.sheet-body { flex: 1; min-height: 0; overflow-y: auto; padding: 0 10px 12px; }
.phone-mixbar { position: absolute; z-index: 24; left: 8px; right: 8px; padding: 6px 12px; border-radius: 26px; transition: bottom 0.22s ease; }
.side .sheet { left: auto; right: 0; top: calc(var(--top-h, 64px) + 8px); bottom: 0; width: min(360px, 46vw); border-radius: 16px 0 0 0; border-right: 0; padding-right: env(safe-area-inset-right); }
.side .grip { display: none; }
.side .phone-mixbar { right: calc(min(360px, 46vw) + 8px); bottom: max(8px, env(safe-area-inset-bottom)); }

/* sky overlays */
.edge {
  position: absolute; z-index: 15; transform: translate(-50%, -50%); background: var(--glass); color: var(--gold);
  border: 1px solid var(--gold-dim); border-radius: 999px; padding: 5px 11px; font: 600 0.78rem var(--font-mono); cursor: pointer; white-space: nowrap;
}
.edge:hover { border-color: var(--gold); }
.swipe-line { position: absolute; z-index: 18; top: 0; bottom: 0; width: 2px; margin-left: -1px; background: var(--gold); cursor: ew-resize; touch-action: none; }
.swipe-line::before { content: ""; position: absolute; inset: 0 -14px; }
.swipe-knob { position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); width: 34px; height: 34px; border-radius: 50%; background: var(--gold); color: #1b1206; display: grid; place-items: center; font-weight: 700; }

.boot { position: absolute; inset: 0; z-index: 100; display: grid; place-items: center; background: rgba(0, 0, 0, 0.55); padding: 16px; }
.boot-card { padding: 24px; max-width: 420px; display: flex; flex-direction: column; align-items: center; gap: 12px; text-align: center; }
.boot-card h1 { margin: 0; font: 700 1.2rem var(--font-display); }
.boot-card p { margin: 0; color: var(--muted); }
.boot-warn { color: var(--gold); font-size: 1.6rem; }
.boot-spinner { width: 36px; height: 36px; border-radius: 50%; border: 3px solid var(--line-strong); border-top-color: var(--gold); animation: spin 1s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }

.toast { position: absolute; z-index: 60; left: 50%; transform: translateX(-50%); top: calc(var(--top-h, 64px) + 14px); background: var(--panel-solid); border: 1px solid var(--line-strong); border-radius: 12px; padding: 10px 16px; max-width: min(520px, calc(100vw - 32px)); font-size: 0.9rem; word-break: break-word; }
</style>
