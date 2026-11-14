<template>
  <svg class="loading-logo" viewBox="-30 -30 60 60" aria-hidden="true">
    <defs>
      <!-- The emblem's glass: dark at the top, glowing blue toward the bottom. -->
      <radialGradient id="llogo-glass" gradientUnits="userSpaceOnUse" cx="0" cy="12" r="34">
        <stop offset="0" stop-color="#3aa6ff" />
        <stop offset="0.5" stop-color="#0f57b8" />
        <stop offset="1" stop-color="#06173a" />
      </radialGradient>
      <radialGradient id="llogo-core" gradientUnits="userSpaceOnUse" :cx="G[0]" :cy="G[1]" r="7">
        <stop offset="0" stop-color="#ffffff" />
        <stop offset="0.35" stop-color="#cfeaff" stop-opacity="0.8" />
        <stop offset="1" stop-color="#7cc4ff" stop-opacity="0" />
      </radialGradient>
      <radialGradient id="llogo-star" gradientUnits="userSpaceOnUse" :cx="S[0]" :cy="S[1]" r="4">
        <stop offset="0" stop-color="#ffffff" />
        <stop offset="0.3" stop-color="#e6f4ff" stop-opacity="0.85" />
        <stop offset="1" stop-color="#9fd2ff" stop-opacity="0" />
      </radialGradient>
    </defs>

    <g :style="{ opacity: fade }">
      <!-- Glass, flooding in once the outline is complete. -->
      <circle :r="R" fill="url(#llogo-glass)" :style="{ opacity: glass }" />

      <!-- Rim and inner bevel, traced clockwise from the top. -->
      <circle :r="R" class="rim" pathLength="1" transform="rotate(-90)" :style="dash(rim)" />
      <circle :r="R - 2.4" class="bevel" pathLength="1" transform="rotate(-90)" :style="dash(bevel)" />

      <!-- The spiral galaxy: two arms unwinding from the core, stars along them. -->
      <path v-for="(d, i) in ARMS" :key="'a' + i" :d="d" class="arm" pathLength="1" :style="dash(arms)" />
      <circle
        v-for="(s, i) in STARS"
        :key="'s' + i"
        :cx="s.x"
        :cy="s.y"
        :r="s.r"
        class="dot"
        :style="{ opacity: arms >= s.at ? 0.9 : 0 }"
      />
      <circle :cx="G[0]" :cy="G[1]" r="7" fill="url(#llogo-core)" :style="{ opacity: core }" />

      <!-- The bright star: diffraction spikes grow out from it, then it flares. -->
      <path v-for="(d, i) in SPIKES" :key="'k' + i" :d="d" class="spike" pathLength="1" :style="dash(spikes)" />
      <circle :cx="S[0]" :cy="S[1]" :r="starR" fill="url(#llogo-star)" :style="{ opacity: spikes > 0 ? 1 : 0 }" />
    </g>
  </svg>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";

// The loading mark: the WorldWide Telescope emblem drawing itself. The glass
// sphere's rim and bevel trace in, the galaxy's two
// arms unwind from its core with stars appearing along them, the bright
// star's diffraction spikes grow out and it flares, the glass floods with
// blue, and it all fades to start again. Transparent background; a static
// frame under prefers-reduced-motion.

const CYCLE_MS = 4400;
const R = 26;
const G: [number, number] = [4, 5];         // galaxy centre (lower right, as on the emblem)
const S: [number, number] = [-9, -8.5];     // the bright star (upper left)

// Timeline, as fractions of a cycle.
const RIM: [number, number] = [0, 0.16];
const BEVEL: [number, number] = [0.06, 0.2];
const ARMS_T: [number, number] = [0.18, 0.5];
const CORE_T: [number, number] = [0.2, 0.34];
const SPIKES_T: [number, number] = [0.54, 0.64];
const FLARE_T: [number, number] = [0.64, 0.78];
const GLASS_T: [number, number] = [0.6, 0.76];
const FADE_T0 = 0.9;
const STILL_T = 0.86;

const f = (n: number): string => n.toFixed(2);
const clamp01 = (v: number): number => Math.max(0, Math.min(1, v));
const ramp = (t: number, [t0, t1]: [number, number]): number => clamp01((t - t0) / (t1 - t0));
const smooth = (v: number): number => v * v * (3 - 2 * v);

// Arms: logarithmic spirals r = a·e^(bθ), seen tilted (y squashed) and
// rotated, the second arm half a turn from the first.
const TILT = 0.6, ROT = -32 * Math.PI / 180;
function galaxyPoint(r: number, th: number): [number, number] {
  const x = r * Math.cos(th), y = r * Math.sin(th) * TILT;
  return [G[0] + x * Math.cos(ROT) - y * Math.sin(ROT), G[1] + x * Math.sin(ROT) + y * Math.cos(ROT)];
}
interface Arm { d: string; pts: [number, number][]; len: number[] }
function buildArm(phase: number): Arm {
  const pts: [number, number][] = [], len: number[] = [0];
  const steps = 60, turns = 2.5 * Math.PI;
  for (let i = 0; i <= steps; i++) {
    const th = (i / steps) * turns;
    pts.push(galaxyPoint(1.7 * Math.exp(0.27 * th), th + phase));
    if (i) { len.push(len[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1])); }
  }
  return { d: "M" + pts.map((p) => `${f(p[0])},${f(p[1])}`).join("L"), pts, len };
}
const ARM_DATA = [buildArm(0), buildArm(Math.PI)];
const ARMS = ARM_DATA.map((a) => a.d);

// Stars scattered along the arms (a fixed pseudo-random sprinkle), each shown
// once the arm has been drawn past it.
const STARS = ARM_DATA.flatMap((a, k) => {
  const total = a.len[a.len.length - 1];
  return [9, 15, 21, 27, 33, 38, 44, 49, 54, 58].map((i, j) => {
    const seed = Math.sin((i + 1) * 12.9898 + k * 78.233) * 43758.5453;
    const rnd = seed - Math.floor(seed);
    const [x, y] = a.pts[i];
    return { x: f(x + (rnd - 0.5) * 3), y: f(y + (rnd - 0.3) * 2.2), r: f(0.32 + 0.4 * ((rnd * 7) % 1)), at: a.len[i] / total + 0.02 * j / 10 };
  });
});

// Spikes: a long pair up-right/down-left and a shorter crossing pair, each
// drawn from the star outward.
const spike = (ang: number, len: number) =>
  `M${f(S[0])},${f(S[1])}L${f(S[0] + len * Math.cos(ang))},${f(S[1] - len * Math.sin(ang))}`;
const SPIKES = [
  spike(Math.PI / 3, 13), spike(Math.PI / 3 + Math.PI, 11),
  spike(-Math.PI / 6, 5.5), spike(-Math.PI / 6 + Math.PI, 5.5),
];

const t = ref(STILL_T);
const rim = computed(() => smooth(ramp(t.value, RIM)));
const bevel = computed(() => smooth(ramp(t.value, BEVEL)));
const arms = computed(() => ramp(t.value, ARMS_T));
const core = computed(() => smooth(ramp(t.value, CORE_T)));
const spikes = computed(() => smooth(ramp(t.value, SPIKES_T)));
const glass = computed(() => 0.9 * smooth(ramp(t.value, GLASS_T)));
const starR = computed(() => {
  const u = ramp(t.value, FLARE_T);
  // Grows with the spikes, flares, settles.
  return f(1.2 + 1.6 * spikes.value + 2.2 * Math.sin(Math.PI * u));
});
const fade = computed(() => 1 - smooth(ramp(t.value, [FADE_T0, 1])));
const dash = (p: number) => ({ strokeDashoffset: 1 - p, opacity: p > 0 ? 1 : 0 });

let raf = 0;
onMounted(() => {
  if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) { return; }
  const start = performance.now();
  const tick = (now: number): void => {
    t.value = ((now - start) % CYCLE_MS) / CYCLE_MS;
    raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);
});
onBeforeUnmount(() => cancelAnimationFrame(raf));
</script>

<style lang="less">
.loading-logo {
  width: 5.5rem;
  height: auto;
  flex: none;
  overflow: visible;

  .rim, .bevel, .arm, .spike {
    fill: none;
    stroke-linecap: round;
    stroke-linejoin: round;
    stroke-dasharray: 1;
  }
  .rim { stroke: #9fd2ff; stroke-width: 1.1; }
  .bevel { stroke: rgba(159, 210, 255, 0.4); stroke-width: 0.5; }
  .arm { stroke: #bfe4ff; stroke-width: 1.3; }
  .dot { fill: #e6f4ff; }
  .spike { stroke: #ffffff; stroke-width: 0.5; }
}
</style>
