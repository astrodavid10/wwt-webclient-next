<template>
  <div class="search" :class="{ open: showList }">
    <font-awesome-icon class="search-icon" icon="magnifying-glass" aria-hidden="true" />
    <input
      ref="input"
      v-model="query"
      type="search"
      role="combobox"
      aria-autocomplete="list"
      :aria-expanded="showList"
      aria-controls="search-results"
      :aria-activedescendant="active >= 0 ? `sr-${active}` : undefined"
      aria-label="Search the sky: object names, coordinates or constellations"
      :placeholder="placeholder"
      autocomplete="off"
      spellcheck="false"
      @focus="focused = true"
      @blur="onBlur"
      @keydown.down.prevent="moveActive(1)"
      @keydown.up.prevent="moveActive(-1)"
      @keydown.enter.prevent="choose(active >= 0 ? active : 0)"
      @keydown.esc="onEsc"
    />
    <kbd v-if="!query && !focused && !compact" class="search-kbd" aria-hidden="true">/</kbd>
    <ul v-show="showList" id="search-results" class="search-results" role="listbox">
      <li
        v-for="(h, i) in hits"
        :id="`sr-${i}`"
        :key="h.label + i"
        role="option"
        :aria-selected="i === active"
        :class="{ active: i === active }"
        @pointerdown.prevent="choose(i)"
        @pointerenter="active = i"
      >
        <span class="sr-kind" :class="h.kind">
          <font-awesome-icon :icon="KIND_ICON[h.kind]" />
        </span>
        <span class="sr-text">
          <span class="sr-label">{{ h.label }}</span>
          <span class="sr-detail">{{ h.detail }}</span>
        </span>
      </li>
      <li v-if="resolving" class="sr-status" role="option" aria-selected="false">Looking up “{{ query }}” in SIMBAD…</li>
      <li v-else-if="!hits.length && query.trim().length >= 2" class="sr-status" role="option" aria-selected="false">
        No match in WWT. Press Enter to look it up in SIMBAD.
      </li>
    </ul>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import type { SearchHit, NameIndexEntry, ConstellationEntry } from "../catalog/search";
import { parseCoordinates, resolveName, searchConstellations, searchNames } from "../catalog/search";
import { BAND_SHORT } from "../catalog/bands";
import { constellationName, formatDec, formatRA, formatSize } from "../sky";

const props = defineProps<{ index: NameIndexEntry[]; constellations: ConstellationEntry[]; compact?: boolean }>();
const emit = defineEmits<{ (e: "select", hit: SearchHit): void; (e: "message", text: string): void }>();

const KIND_ICON: Record<SearchHit["kind"], string> = {
  place: "image", coords: "crosshairs", constellation: "star", resolver: "satellite-dish",
};

const input = ref<HTMLInputElement | null>(null);
const query = ref("");
const focused = ref(false);
const active = ref(-1);
const resolving = ref(false);
const placeholder = computed(() => props.compact ? "Search the sky" : "Search M42, Crab Nebula, 05h35m −05°23′…");

const hits = computed<SearchHit[]>(() => {
  const q = query.value.trim();
  if (q.length < 2) { return []; }
  const out: SearchHit[] = [];
  const c = parseCoordinates(q);
  if (c) {
    out.push({ kind: "coords", label: `${formatRA(c[0])} ${formatDec(c[1])}`, detail: "Go to these coordinates", raDeg: c[0], decDeg: c[1], fovDeg: 1 });
  }
  for (const con of searchConstellations(props.constellations, q)) {
    out.push({ kind: "constellation", label: con.name, detail: "Constellation", raDeg: con.raDeg, decDeg: con.decDeg, fovDeg: 40 });
  }
  for (const p of searchNames(props.index, q, 10)) {
    const where = constellationName(p.constellation);
    const detail = p.study
      ? `${p.source || "Image"} · ${p.band ? BAND_SHORT[p.band.band] : ""} · ${formatSize(p.sizeDeg)} · ${where}`
      : `Object in ${where}`;
    out.push({ kind: "place", label: p.name, detail, raDeg: p.raHours * 15, decDeg: p.decDeg, fovDeg: p.zoom > 0 ? p.zoom / 6 : 1, place: p });
  }
  return out;
});

const showList = computed(() => focused.value && query.value.trim().length >= 2);
watch(hits, () => { active.value = hits.value.length ? 0 : -1; });

function moveActive(d: number): void {
  if (!hits.value.length) { return; }
  active.value = (active.value + d + hits.value.length) % hits.value.length;
}

async function choose(i: number): Promise<void> {
  const h = hits.value[i];
  if (h) {
    emit("select", h);
    query.value = "";
    input.value?.blur();
    return;
  }
  const q = query.value.trim();
  if (q.length < 2 || resolving.value) { return; }
  resolving.value = true;
  try {
    const r = await resolveName(q);
    if (r) {
      emit("select", { kind: "resolver", label: r.label, detail: "SIMBAD", raDeg: r.raDeg, decDeg: r.decDeg, fovDeg: 0.5 });
      query.value = "";
      input.value?.blur();
    } else {
      emit("message", `No object called “${q}” was found.`);
    }
  } catch {
    emit("message", "The SIMBAD name lookup couldn't be reached. Try a coordinate instead.");
  } finally {
    resolving.value = false;
  }
}

function onBlur(): void { focused.value = false; }
function onEsc(): void { if (query.value) { query.value = ""; } else { input.value?.blur(); } }

defineExpose({ focus: () => input.value?.focus() });
</script>

<style lang="less">
.search { position: relative; display: flex; align-items: center; min-width: 0; flex: 1; }
.search input {
  width: 100%; height: 42px; padding: 0 36px 0 40px; border-radius: 21px;
  border: 1px solid var(--line-strong); background: var(--glass); color: var(--fg); font: inherit; font-size: 0.95rem;
}
.search input::placeholder { color: var(--muted); }
.search input:focus { outline: none; border-color: var(--gold); }
.search input::-webkit-search-cancel-button { filter: invert(0.7); }
.search-icon { position: absolute; left: 15px; color: var(--muted); pointer-events: none; }
.search-kbd { position: absolute; right: 14px; font: 0.75rem var(--font-mono); color: var(--muted); border: 1px solid var(--line); border-radius: 4px; padding: 0 5px; pointer-events: none; }
.search-results {
  position: absolute; top: calc(100% + 6px); left: 0; right: 0; z-index: 40; margin: 0; padding: 6px; list-style: none;
  background: var(--panel); border: 1px solid var(--line-strong); border-radius: 14px; max-height: min(60vh, 460px); overflow-y: auto;
  box-shadow: 0 18px 40px -12px #000;
}
.search-results li { display: flex; gap: 10px; align-items: center; padding: 8px; border-radius: 10px; cursor: pointer; }
.search-results li.active { background: var(--panel-3); }
.sr-kind { flex: none; width: 30px; height: 30px; border-radius: 8px; display: grid; place-items: center; background: var(--panel-2); color: var(--muted); }
.sr-kind.place { color: var(--gold); }
.sr-kind.coords, .sr-kind.resolver { color: var(--sky); }
.sr-text { display: flex; flex-direction: column; min-width: 0; }
.sr-label { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.sr-detail { font: 0.72rem var(--font-mono); color: var(--muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.sr-status { color: var(--muted); font-size: 0.85rem; cursor: default !important; }
</style>
