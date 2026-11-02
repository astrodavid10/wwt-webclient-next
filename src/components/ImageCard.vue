<template>
  <article class="card" :aria-labelledby="titleId">
    <div class="card-img">
      <thumb :place="place" />
      <button type="button" class="ib card-close" aria-label="Close image details" @click="emit('close')">
        <font-awesome-icon icon="xmark" />
      </button>
    </div>
    <div class="card-body">
      <div class="card-tags">
        <span v-if="place.source" class="tag" :style="{ color: sourceColor(place.source) }">{{ place.source }}</span>
        <span v-if="place.band" class="tag band" :style="{ color: BAND_COLORS[place.band.band] }">{{ place.band.band }}</span>
      </div>
      <h2 :id="titleId" class="card-title">{{ place.name }}</h2>
      <p v-if="otherNames" class="card-aka">Also: {{ otherNames }}</p>
      <dl class="card-facts">
        <div><dt>Where</dt><dd>{{ constellation }}</dd></div>
        <div><dt>Size</dt><dd>{{ place.study ? formatSize(place.sizeDeg) : "—" }}</dd></div>
        <div v-if="place.band" class="wide"><dt>Wavelength</dt><dd>{{ place.band.band }} <span class="card-basis">({{ bandBasisText(place.band.basis) }})</span></dd></div>
        <div class="wide"><dt>Position</dt><dd class="mono">{{ formatRA(place.raHours * 15) }} {{ formatDec(place.decDeg) }}</dd></div>
      </dl>
      <p v-if="place.description" class="card-desc">{{ place.description }}</p>
      <p v-if="place.study?.credits" class="card-credits">{{ place.study.credits }}</p>
      <div class="card-actions">
        <button type="button" class="btn" @click="emit('fly')"><font-awesome-icon icon="crosshairs" /> Go to</button>
        <template v-if="place.study">
          <button v-if="!inMixer || !pinned" type="button" class="btn primary" @click="emit('keep')"><font-awesome-icon icon="layer-group" /> Keep in mix</button>
          <button v-else type="button" class="btn" @click="emit('remove')"><font-awesome-icon icon="xmark" /> Remove from mix</button>
          <button type="button" class="btn" :disabled="!inMixer" @click="emit('solo')"><font-awesome-icon icon="bullseye" /> Show only this</button>
        </template>
        <button type="button" class="btn" @click="emit('share')"><font-awesome-icon icon="share-nodes" /> Share</button>
      </div>
      <a v-if="place.study?.creditsUrl" class="card-link" :href="place.study.creditsUrl" target="_blank" rel="noopener">
        Read about this image <font-awesome-icon icon="arrow-up-right-from-square" />
      </a>
    </div>
  </article>
</template>

<script setup lang="ts">
import { computed } from "vue";
import type { SkyPlace } from "../catalog/types";
import { BAND_COLORS, bandBasisText } from "../catalog/bands";
import { sourceColor } from "../catalog/sources";
import { constellationName, formatDec, formatRA, formatSize } from "../sky";
import Thumb from "./Thumb.vue";

const props = defineProps<{ place: SkyPlace; inMixer: boolean; pinned: boolean }>();
const emit = defineEmits<{
  (e: "close"): void; (e: "fly"): void; (e: "keep"): void; (e: "remove"): void; (e: "solo"): void; (e: "share"): void;
}>();

const titleId = computed(() => `card-title-${props.place.id}`);
const otherNames = computed(() => props.place.names.slice(1, 5).join(", "));
const constellation = computed(() => props.place.constellation === "SolarSystem" ? "Solar System" : constellationName(props.place.constellation));
</script>

<style lang="less">
.card { display: flex; flex-direction: column; min-height: 0; }
.card-img { position: relative; aspect-ratio: 16 / 9; max-height: 220px; background: #000; border-radius: 12px; overflow: hidden; border: 1px solid var(--line); flex: none; }
.card-img .thumb { object-fit: contain; }
.card-close { position: absolute; top: 8px; right: 8px; background: rgba(7, 11, 20, 0.85); }
.card-body { display: flex; flex-direction: column; gap: 8px; padding: 12px 2px 4px; }
.card-tags { display: flex; gap: 6px; }
.card-basis { color: var(--muted); font-size: 0.78rem; }
.card-title { margin: 0; font: 700 1.15rem/1.2 var(--font-display); text-wrap: balance; }
.card-aka { margin: 0; color: var(--muted); font-size: 0.82rem; }
.card-facts { display: grid; grid-template-columns: 1fr 1fr; gap: 6px 12px; margin: 0; }
.card-facts div { display: flex; flex-direction: column; min-width: 0; }
.card-facts .wide { grid-column: 1 / -1; }
.card-facts dt { font: 0.68rem var(--font-mono); text-transform: uppercase; letter-spacing: 0.08em; color: var(--muted); }
.card-facts dd { margin: 0; font-size: 0.9rem; }
.card-desc { margin: 0; font-size: 0.88rem; line-height: 1.45; max-height: 12em; overflow-y: auto; }
.card-credits { margin: 0; font-size: 0.78rem; color: var(--muted); max-height: 5.5em; overflow-y: auto; }
.card-actions { display: flex; flex-wrap: wrap; gap: 6px; }
.card-link { color: var(--sky); font-size: 0.86rem; }
</style>
