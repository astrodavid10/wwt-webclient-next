<template>
  <section class="explore panel" role="dialog" aria-modal="false" aria-labelledby="explore-title">
    <header class="ex-head">
      <h2 id="explore-title" class="visually-hidden">Explore</h2>
      <div class="seg" role="tablist" aria-label="Explore">
        <button type="button" role="tab" :aria-selected="tab === 'collections'" :aria-pressed="tab === 'collections'" @click="tab = 'collections'">Collections</button>
        <button type="button" role="tab" :aria-selected="tab === 'tours'" :aria-pressed="tab === 'tours'" @click="openTours">Tours</button>
      </div>
      <button ref="closeBtn" type="button" class="ib" aria-label="Close Explore" @click="emit('close')"><font-awesome-icon icon="xmark" /></button>
    </header>

    <nav v-if="tab === 'collections'" class="ex-crumbs" aria-label="Folder path">
      <span v-for="(f, i) in trail" :key="i" class="ex-crumb">
        <button v-if="i < trail.length - 1" type="button" class="link-btn" @click="trail.splice(i + 1)">{{ f.name }}</button>
        <span v-else aria-current="location">{{ f.name }}</span>
        <font-awesome-icon v-if="i < trail.length - 1" icon="chevron-right" class="ex-sep" aria-hidden="true" />
      </span>
    </nav>

    <div class="ex-body">
      <p v-if="loading" class="ex-status">Loading…</p>
      <p v-else-if="error" class="ex-status">{{ error }} <button type="button" class="link-btn" @click="retry">Try again</button></p>

      <ul v-else-if="tab === 'collections'" class="ex-grid">
        <li v-for="(e, i) in current" :key="i" class="ex-item">
          <template v-if="e.kind === 'folder'">
            <button type="button" class="ex-card" @click="openFolder(e)">
              <span class="ex-img"><img :src="e.thumb" alt="" loading="lazy" @error="hideImg" /><font-awesome-icon icon="folder-open" class="ex-folder-icon" /></span>
              <span class="ex-name">{{ e.name }}</span>
            </button>
          </template>
          <template v-else-if="e.kind === 'place'">
            <button type="button" class="ex-card" @click="e.allSky ? emit('background', e.place) : emit('open', e.place)">
              <span class="ex-img"><img :src="placeThumb(e)" alt="" loading="lazy" @error="fallbackImg($event, e.thumb)" /></span>
              <span class="ex-name">{{ e.place.name }}</span>
              <span class="ex-meta">{{ e.allSky ? "All-sky · use as background" : e.place.study ? (e.place.source || "Image") : "Object" }}</span>
            </button>
            <button
              v-if="e.place.study && !e.allSky"
              type="button"
              class="ex-add"
              :class="{ on: mixerIds.includes(e.place.id) }"
              :aria-label="`Add ${e.place.name} to the mixer`"
              title="Add to the mixer"
              @click="emit('add', e.place)"
            ><font-awesome-icon :icon="mixerIds.includes(e.place.id) ? 'check' : 'plus'" /></button>
          </template>
        </li>
      </ul>

      <ul v-else class="ex-tours">
        <li v-for="t in tours" :key="t.id" class="ex-tour">
          <span class="ex-tour-img"><img :src="t.thumb" alt="" loading="lazy" @error="hideImg" /></span>
          <div class="ex-tour-text">
            <h3>{{ t.title }}</h3>
            <p class="ex-meta">{{ formatLength(t.seconds) }}<template v-if="t.author"> · {{ t.author }}</template></p>
            <p class="ex-desc">{{ t.description }}</p>
          </div>
          <button type="button" class="btn primary" :aria-label="`Play the tour ${t.title}`" @click="emit('tour', t)"><font-awesome-icon icon="play" /> Play</button>
        </li>
      </ul>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import type { SkyPlace } from "../catalog/types";
import { EXPLORE_ROOT, TOURS_ROOT, Entry, FolderEntry, PlaceEntry, TourEntry, loadFolder } from "../catalog/wtml";
import { thumbnailFor } from "../catalog/imagery";

const props = defineProps<{ byUrl: Map<string, SkyPlace>; mixerIds: string[] }>();
const emit = defineEmits<{
  (e: "close"): void; (e: "open", p: SkyPlace): void; (e: "add", p: SkyPlace): void;
  (e: "background", p: SkyPlace): void; (e: "tour", t: TourEntry): void;
}>();

interface Crumb { name: string; entries: Entry[] }
const tab = ref<"collections" | "tours">("collections");
const trail = ref<Crumb[]>([]);
const tours = ref<TourEntry[]>([]);
const loading = ref(false);
const error = ref("");
const closeBtn = ref<HTMLButtonElement | null>(null);
let lastAction: () => Promise<void> = async () => undefined;

const current = computed(() => trail.value[trail.value.length - 1]?.entries ?? []);

async function run(action: () => Promise<void>): Promise<void> {
  lastAction = action;
  loading.value = true;
  error.value = "";
  try { await action(); } catch (err) {
    console.warn("[explore]", err);
    error.value = "This collection couldn't be loaded.";
  } finally { loading.value = false; }
}
function retry(): void { run(lastAction); }

async function openFolder(f: FolderEntry): Promise<void> {
  if (f.children) { trail.value.push({ name: f.name, entries: f.children }); return; }
  await run(async () => {
    const entries = await loadFolder(f.url, props.byUrl);
    // Single-child wrapper folders: skip straight through.
    const only = entries.length === 1 && entries[0].kind === "folder" ? entries[0] : null;
    if (only && only.kind === "folder" && only.url) {
      trail.value.push({ name: f.name, entries: await loadFolder(only.url, props.byUrl) });
    } else {
      trail.value.push({ name: f.name, entries: only && only.kind === "folder" && only.children ? only.children : entries });
    }
  });
}

function flattenTours(entries: Entry[]): TourEntry[] {
  return entries.flatMap((e) => e.kind === "tour" ? [e] : e.kind === "folder" && e.children ? flattenTours(e.children) : []);
}
async function openTours(): Promise<void> {
  tab.value = "tours";
  if (tours.value.length) { return; }
  await run(async () => { tours.value = flattenTours(await loadFolder(TOURS_ROOT, props.byUrl)); });
}

function formatLength(s: number): string {
  if (!s) { return "Tour"; }
  const m = Math.floor(s / 60), r = Math.round(s % 60);
  return `${m}:${String(r).padStart(2, "0")}`;
}
function hideImg(e: Event): void { (e.target as HTMLImageElement).style.visibility = "hidden"; }
/** The study's sharp level-0 tile when it has one (all-sky surveys keep their own thumbnail). */
function placeThumb(e: PlaceEntry): string { return (!e.allSky && thumbnailFor(e.place)) || e.thumb; }
function fallbackImg(ev: Event, url: string): void {
  const img = ev.target as HTMLImageElement;
  if (url && img.src !== url) { img.src = url; } else { hideImg(ev); }
}

onMounted(() => {
  closeBtn.value?.focus();
  run(async () => { trail.value = [{ name: "Collections", entries: await loadFolder(EXPLORE_ROOT, props.byUrl) }]; });
});
</script>

<style lang="less">
.explore { display: flex; flex-direction: column; min-height: 0; overflow: hidden; }
.ex-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 10px 10px 8px 12px; }
.ex-crumbs { display: flex; flex-wrap: wrap; align-items: center; gap: 2px 6px; padding: 0 14px 8px; font-size: 0.88rem; border-bottom: 1px solid var(--line); }
.ex-crumbs .link-btn { padding: 2px; }
.ex-crumb { display: inline-flex; align-items: center; gap: 6px; }
.ex-sep { color: var(--muted); font-size: 0.65rem; }
.ex-body { overflow-y: auto; padding: 12px; min-height: 0; flex: 1; }
.ex-status { color: var(--muted); margin: 0; }
.ex-grid { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 12px; }
.ex-item { position: relative; min-width: 0; }
.ex-card { width: 100%; display: flex; flex-direction: column; gap: 4px; padding: 0; background: none; border: 0; text-align: left; cursor: pointer; color: inherit; }
.ex-img { position: relative; display: block; aspect-ratio: 16 / 10; border-radius: 10px; overflow: hidden; background: var(--panel-2); border: 1px solid var(--line); }
.ex-img img { width: 100%; height: 100%; object-fit: cover; display: block; }
.ex-card:hover .ex-img { border-color: var(--sky); }
.ex-folder-icon { position: absolute; right: 6px; bottom: 6px; color: var(--fg); filter: drop-shadow(0 1px 2px #000); }
.ex-name { font-size: 0.86rem; line-height: 1.25; overflow: hidden; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; }
.ex-meta { font: 0.7rem var(--font-mono); color: var(--muted); margin: 0; }
.ex-add { position: absolute; top: 6px; right: 6px; width: 32px; height: 32px; border-radius: 50%; border: 1px solid var(--line-strong); background: var(--glass); color: var(--fg); cursor: pointer; }
.ex-add.on { color: var(--gold); border-color: var(--gold-dim); }
.ex-tours { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 10px; }
.ex-tour { display: grid; grid-template-columns: 96px minmax(0, 1fr) auto; gap: 12px; align-items: center; padding: 8px; border-radius: 12px; background: var(--panel-2); }
.ex-tour-img { width: 96px; height: 54px; border-radius: 8px; overflow: hidden; background: #000; }
.ex-tour-img img { width: 100%; height: 100%; object-fit: cover; }
.ex-tour-text { min-width: 0; }
.ex-tour h3 { margin: 0; font: 600 0.95rem var(--font-display); }
.ex-desc { margin: 2px 0 0; font-size: 0.8rem; color: var(--muted); overflow: hidden; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; }
@media (max-width: 520px) {
  .ex-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .ex-tour { grid-template-columns: 72px minmax(0, 1fr); }
  .ex-tour-img { width: 72px; height: 44px; }
  .ex-tour .btn { grid-column: 1 / -1; justify-content: center; }
}
</style>
