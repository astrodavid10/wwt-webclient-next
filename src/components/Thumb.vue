<template>
  <img
    class="thumb"
    :src="src"
    alt=""
    loading="lazy"
    decoding="async"
    @error="onError"
  />
</template>

<script setup lang="ts">
import { ref, watch } from "vue";
import type { SkyPlace } from "../catalog/types";
import { thumbnailFor } from "../catalog/imagery";

const props = defineProps<{ place: SkyPlace }>();

// Level-0 tile first (sharp, 256 px), then the catalogue thumbnail, then a blank.
const BLANK = "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";
const src = ref(thumbnailFor(props.place) || props.place.study?.thumbUrl || BLANK);
let tries = 0;

watch(() => props.place.id, () => {
  tries = 0;
  src.value = thumbnailFor(props.place) || props.place.study?.thumbUrl || BLANK;
});

function onError(): void {
  tries++;
  if (tries === 1 && props.place.study?.thumbUrl && src.value !== props.place.study.thumbUrl) {
    src.value = props.place.study.thumbUrl;
  } else {
    src.value = BLANK;
  }
}
</script>

<style lang="less">
.thumb {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: cover;
  background: #000;
}
</style>
