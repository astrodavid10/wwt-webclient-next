<template>
  <div class="inview" :class="{ strip: layout === 'strip' }">
    <div v-if="result && sources.length > 1 && layout === 'list'" class="iv-filters" role="group" aria-label="Filter by telescope">
      <button type="button" class="chip" :aria-pressed="filter === null" @click="filter = null">All</button>
      <button
        v-for="s in sources"
        :key="s.tag"
        type="button"
        class="chip"
        :aria-pressed="filter === s.tag"
        @click="filter = filter === s.tag ? null : s.tag"
      ><i :style="{ background: sourceColor(s.tag) }"></i>{{ s.tag || "Other" }} <span class="chip-n">{{ s.n }}</span></button>
    </div>
    <div v-if="result && scrubPlaces.length > 1 && layout === 'list'" class="iv-actions">
      <button type="button" class="btn iv-scrub" @click="emit('scrubAll', scrubPlaces)">
        <font-awesome-icon icon="film" /> {{ scrubLabel }}
      </button>
    </div>
    <p v-if="!result" class="iv-empty">Loading the image index…</p>
    <template v-else-if="layout === 'strip'">
      <div class="iv-strip" role="list" aria-label="Images that fit this view">
        <div v-if="scrubPlaces.length > 1" class="iv-card" role="listitem">
          <button type="button" class="iv-card-open iv-card-scrub" @click="emit('scrubAll', scrubPlaces)">
            <span class="iv-card-img"><font-awesome-icon icon="film" /></span>
            <span class="iv-card-name">{{ scrubLabel }}</span>
          </button>
        </div>
        <div v-for="item in stripItems" :key="item.place.id" class="iv-card" role="listitem">
          <button
            type="button"
            class="iv-card-open"
            :class="{ sel: item.place.id === selectedId }"
            @click="emit('open', item.place)"
            @pointerenter="emit('hover', item.place.id)"
            @pointerleave="emit('hover', null)"
          >
            <span class="iv-card-img"><thumb :place="item.place" /></span>
            <span class="iv-card-name">{{ item.place.name }}</span>
            <span class="iv-meta"><i :style="{ background: sourceColor(item.place.source) }"></i>{{ item.place.source || "Image" }}<template v-if="item.place.band"> · {{ BAND_SHORT[item.place.band.band] }}</template> · {{ formatSize(item.place.sizeDeg) }}</span>
          </button>
        </div>
        <p v-if="!stripItems.length" class="iv-empty">No images here. Zoom out or follow an arrow at the edge of the sky.</p>
      </div>
    </template>
    <template v-else>
      <section v-for="g in groups" :key="g.id" class="iv-group" :aria-labelledby="`ivg-${g.id}`">
        <h3 :id="`ivg-${g.id}`" class="iv-group-title">
          <span>{{ g.title }}</span>
          <span class="iv-group-count">{{ g.items.length }}</span>
        </h3>
        <p v-if="g.hint" class="iv-hint">{{ g.hint }}</p>
        <ul class="iv-list">
          <li
            v-for="item in g.items.slice(0, shownCount(g.id))"
            :key="item.place.id"
            class="iv-row"
            :class="{ sel: item.place.id === selectedId, hov: item.place.id === hoveredId }"
            @pointerenter="emit('hover', item.place.id)"
            @pointerleave="emit('hover', null)"
          >
            <button
              type="button"
              class="iv-open"
              @click="emit('open', item.place)"
              @focus="emit('hover', item.place.id)"
              @blur="emit('hover', null)"
            >
              <span class="iv-thumb"><thumb :place="item.place" /></span>
              <span class="iv-text">
                <span class="iv-name">{{ item.place.name }}</span>
                <span class="iv-meta">
                  <i :style="{ background: sourceColor(item.place.source) }"></i>{{ item.place.source || "Image" }}<template v-if="item.place.band"> · {{ BAND_SHORT[item.place.band.band] }}</template>
                  · {{ formatSize(item.place.sizeDeg) }}<template v-if="item.dupes.length"> · {{ item.dupes.length + 1 }} versions</template>
                </span>
              </span>
            </button>
            <button
              type="button"
              class="iv-add"
              :class="{ on: inMixer(item.place.id) }"
              :aria-pressed="inMixer(item.place.id)"
              :aria-label="inMixer(item.place.id) ? `${item.place.name} is in the mixer` : `Add ${item.place.name} to the mixer`"
              :title="inMixer(item.place.id) ? 'In the mixer' : 'Add to the mixer'"
              @click="emit('add', item.place)"
            >
              <font-awesome-icon :icon="inMixer(item.place.id) ? 'check' : 'plus'" />
            </button>
          </li>
        </ul>
        <button
          v-if="g.items.length > shownCount(g.id)"
          type="button"
          class="iv-more"
          @click="expand(g.id)"
        >Show {{ Math.min(STEP, g.items.length - shownCount(g.id)) }} more</button>
      </section>
      <p v-if="!groups.length" class="iv-empty">No images overlap this view. Zoom out, or follow an arrow at the edge of the sky.</p>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, reactive, ref, watch } from "vue";
import type { InViewResult, InViewItem } from "../catalog/inView";
import type { SkyPlace } from "../catalog/types";
import { sourceColor } from "../catalog/sources";
import { BAND_SHORT } from "../catalog/bands";
import { formatSize } from "../sky";
import { MAX_REEL } from "../mixer";
import Thumb from "./Thumb.vue";

const props = defineProps<{
  result: InViewResult | null;
  layout: "list" | "strip";
  hoveredId: string | null;
  selectedId: string | null;
  mixerIds: string[];
}>();

const emit = defineEmits<{
  (e: "hover", id: string | null): void;
  (e: "open", place: SkyPlace): void;
  (e: "add", place: SkyPlace): void;
  (e: "scrubAll", places: SkyPlace[]): void;
}>();

const STEP = 12;
/** Telescope tag to show, or null for all ("" is a real tag: unattributed images). */
const filter = ref<string | null>(null);
const keep = (i: InViewItem) => filter.value === null || i.place.source === filter.value;
/** Telescopes present in this view, most images first. */
const sources = computed(() => {
  const r = props.result;
  if (!r) { return []; }
  const n = new Map<string, number>();
  for (const i of [...r.fit, ...r.small, ...r.wide]) { n.set(i.place.source, (n.get(i.place.source) ?? 0) + 1); }
  return Array.from(n, ([tag, count]) => ({ tag, n: count })).sort((a, b) => (a.tag === "" ? 1 : 0) - (b.tag === "" ? 1 : 0) || b.n - a.n);
});
// Drop a filter that no longer matches anything in view.
watch(sources, (s) => { if (filter.value !== null && !s.some((x) => x.tag === filter.value)) { filter.value = null; } });
const shown = reactive<Record<string, number>>({ fit: 12, wide: 4, small: 6 });
function shownCount(id: string): number { return shown[id] ?? STEP; }
function expand(id: string): void { shown[id] = shownCount(id) + STEP; }
// A new view resets how much of each group is expanded.
watch(() => props.result, (r, old) => {
  if (r && old && r.total !== old.total) { shown.fit = 12; shown.wide = 4; shown.small = 6; }
});

function inMixer(id: string): boolean { return props.mixerIds.includes(id); }

interface Group { id: string; title: string; hint?: string; items: InViewItem[] }
const groups = computed<Group[]>(() => {
  const r = props.result;
  if (!r) { return []; }
  const out: Group[] = [];
  const fit = r.fit.filter(keep), small = r.small.filter(keep), wide = r.wide.filter(keep);
  if (fit.length) { out.push({ id: "fit", title: "Fits this view", items: fit }); }
  if (small.length) { out.push({ id: "small", title: "Zoom in for detail", hint: "Small, detailed images inside this view.", items: small }); }
  if (wide.length) { out.push({ id: "wide", title: "Wider fields", hint: "Images bigger than the view that contain it.", items: wide }); }
  return out;
});

/**
 * What "Scrub all" puts in the mixer: everything listed (with the telescope
 * filter applied), best fits first, then detail images, then wider fields,
 * up to MAX_REEL. Duplicate versions are already merged.
 */
const allPlaces = computed(() => {
  const r = props.result;
  if (!r) { return []; }
  return [...r.fit, ...r.small, ...r.wide].filter(keep).map((i) => i.place).filter((p) => p.study);
});
const scrubPlaces = computed(() => allPlaces.value.slice(0, MAX_REEL));
const scrubLabel = computed(() => {
  const n = allPlaces.value.length;
  const what = filter.value ? `${filter.value || "other"} images` : "images";
  return n > MAX_REEL ? `Scrub the best ${MAX_REEL} of ${n} ${what}` : `Scrub all ${n} ${what} in view`;
});

const stripItems = computed(() => {
  const r = props.result;
  if (!r) { return []; }
  return [...r.fit, ...r.small, ...r.wide].filter(keep).slice(0, 24);
});
</script>

<style lang="less">
.inview { display: flex; flex-direction: column; gap: 4px; }
.iv-empty { color: var(--muted); padding: 12px; margin: 0; font-size: 0.9rem; }
.iv-filters { display: flex; gap: 6px; overflow-x: auto; padding: 8px 4px 4px; scrollbar-width: none; }
.chip { flex: none; display: inline-flex; align-items: center; gap: 5px; min-height: 30px; padding: 0 10px; border-radius: 999px; border: 1px solid var(--line); background: transparent; color: var(--muted); cursor: pointer; font: 0.74rem var(--font-mono); }
.chip i { width: 8px; height: 8px; border-radius: 2px; }
.chip[aria-pressed="true"] { color: var(--fg); border-color: var(--gold-dim); background: var(--panel-3); }
.chip-n { opacity: 0.7; }
.iv-group { display: flex; flex-direction: column; }
.iv-group-title {
  display: flex; justify-content: space-between; align-items: baseline;
  margin: 10px 8px 4px; font: 600 0.72rem/1.2 var(--font-mono); letter-spacing: 0.08em; text-transform: uppercase; color: var(--muted);
}
.iv-group-count { font-variant-numeric: tabular-nums; }
.iv-hint { margin: 0 8px 4px; font-size: 0.78rem; color: var(--muted); }
.iv-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 2px; }
.iv-row { display: flex; align-items: center; border-radius: 10px; }
.iv-row.hov, .iv-row:hover { background: var(--panel-2); }
.iv-row.sel { background: var(--panel-3); box-shadow: inset 2px 0 0 var(--gold); }
.iv-open {
  flex: 1; min-width: 0; display: flex; align-items: center; gap: 10px; padding: 6px 8px;
  background: none; border: 0; color: inherit; text-align: left; cursor: pointer; border-radius: 10px;
}
.iv-thumb { flex: none; width: 48px; height: 48px; border-radius: 8px; overflow: hidden; border: 1px solid var(--line); }
.iv-text { min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.iv-name { font-size: 0.9rem; line-height: 1.25; overflow: hidden; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; }
.iv-meta { font: 0.72rem/1.2 var(--font-mono); color: var(--muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.iv-meta i { display: inline-block; width: 8px; height: 8px; border-radius: 2px; margin-right: 5px; vertical-align: 0; }
.iv-add {
  flex: none; width: 36px; height: 36px; margin-right: 6px; border-radius: 50%;
  border: 1px solid var(--line); background: transparent; color: var(--muted); cursor: pointer;
}
.iv-add:hover { color: var(--fg); border-color: var(--line-strong); }
.iv-add.on { color: var(--gold); border-color: var(--gold-dim); }
.iv-more {
  align-self: flex-start; margin: 4px 8px 8px 66px; padding: 4px 10px; border-radius: 999px;
  border: 1px solid var(--line); background: transparent; color: var(--sky); cursor: pointer; font-size: 0.8rem;
}
.iv-actions { display: flex; padding: 6px 4px 2px; }
.iv-scrub { width: 100%; justify-content: center; }
.iv-card-scrub .iv-card-img { display: grid; place-items: center; color: var(--gold); font-size: 1.4rem; background: var(--panel-2); }
.iv-strip { display: flex; gap: 10px; overflow-x: auto; padding: 2px 2px 8px; scroll-snap-type: x proximity; }
.iv-card { flex: none; width: 112px; scroll-snap-align: start; }
.iv-card-open {
  width: 100%; display: flex; flex-direction: column; gap: 4px; padding: 0; background: none; border: 0; color: inherit; text-align: left; cursor: pointer;
}
.iv-card-img { display: block; width: 112px; height: 64px; border-radius: 10px; overflow: hidden; border: 1px solid var(--line); }
.iv-card-open.sel .iv-card-img { border-color: var(--gold); }
.iv-card-name { font-size: 0.78rem; line-height: 1.2; overflow: hidden; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; }
</style>
