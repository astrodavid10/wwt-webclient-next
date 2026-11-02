# WWT web client: next (prototype)

A prototype redesign of the [WorldWide Telescope web client](https://worldwidetelescope.org/webclient/),
built on `@wwtelescope/engine` 7.40 and `@wwtelescope/engine-pinia` (Vue 3).

**Live prototype: https://astrodavid10.github.io/wwt-webclient-next/**

This is an independent prototype, not an official WorldWide Telescope release. It keeps
WWT's data (the 27k-place search index, the Explore collections, the guided tours) and
rebuilds the interface around two things:

- **In view.** Every study image whose footprint overlaps the screen, from the whole sky
  (the classic client only searches the constellation under the centre of the view),
  grouped as *Fits this view*, *Zoom in for detail* and *Wider fields*, ranked by how
  much of the image is on screen, how well its size suits the zoom level and how central
  it is. Duplicates are merged, telescope chips filter the list, hovering outlines the
  image on the sky, and labels at the screen edges count good images just off-screen.
- **Image Mixer.** Any number of images stacked as engine layers with their own opacity.
  One *sweep* slider fades them in from the bottom of the stack to the top (e.g. survey,
  Hubble, Chandra, Webb over one nebula). *Blink* flips between them, *Swipe* shows the
  top two side by side, and the background survey is the dimmable bottom row, with its
  own survey picker. Opening an image shows it as a *preview* that the next image
  replaces unless you keep it. (*Add light*, additive blending, is built but hidden for
  now; see `MixerPanel.vue`.)
- **Scrub.** *Scrub all* puts everything in view (up to 40 images, telescope filter
  applied) in the mixer as a reel, ordered short to long wavelength, and crossfades
  through it one image at a time, by slider or play. Only the neighbours of the image
  on screen load tiles, so a long reel stays light.

Every image is tagged with a telescope and a wavelength. The catalogues rarely record
wavelength (about 47 of 3.9k images), so when they don't, the band is estimated from the
image name and then the telescope, and the image card says it is an estimate
(`src/catalog/bands.ts`).

Also: one search box (names with typo tolerance, `M42`/`NGC 1976` style designations,
coordinates in sexagesimal or decimal, constellations, and a CDS Sesame lookup for
anything else), image cards with credits and descriptions, outlines that follow each
image's real edges (computed from its level-0 tile), right-click or long-press for
"what's here?", Explore and Tours, and the whole state in the URL
(`?ra&dec&fov&layers&mode&pos&bgop&place&bg`) so *Share* reproduces the view and mix.

One layout adapts to the screen: floating panels on desktop, a tabbed bottom sheet on
phones, a right-hand sheet on short landscape screens.

## Running

Node 22, Yarn 4 (via corepack).

```bash
yarn install
yarn serve          # dev server
yarn build          # production build in dist/
yarn test           # Playwright smoke + layout tests against dist/ (build first)
yarn lint && yarn typecheck
```

Useful URL parameters: `?debug=1` exposes `window.wwtNext`; `?tileq=1..8` sets tile
sharpness.

## Layout of the code

| File | What it does |
|---|---|
| `src/catalog/searchIndex.ts` | Loads `searchdata_v2.min.js`, flattens it to `SkyPlace` records, tags telescopes |
| `src/catalog/inView.ts` | The In view computation (pure function, ~2 ms over 3.9k images) |
| `src/catalog/imagery.ts` | Engine `Imageset` construction, level-0 thumbnails, footprints (approximate and exact) |
| `src/catalog/search.ts` | Name index, coordinate parser, Sesame resolver |
| `src/catalog/wtml.ts` | WTML reader for Explore and Tours (keeps descriptions the engine drops) |
| `src/mixer.ts` | Pinia store for the mixer; drives engine layer opacity, `enabled`, order |
| `src/engine-patches.ts` | Runtime engine patches (below) |
| `src/footprints.ts` | 2D canvas overlay of image outlines |
| `src/App.vue` | Boot, camera tracking, layouts, URL state, keyboard |

### Engine patches (runtime, `src/engine-patches.ts`)

- `ImageSetLayer.draw` wrapper: additive blending for one layer (the tile shader resets
  `blendFunc` on every draw, so it is pinned while that layer draws) and a scissor clip
  for Swipe.
- `RenderContext.drawImageSet`: scales the background survey's opacity (mixer bottom row).
- `TourStop` getters: engine 7.40 calls `get_<setting>()` for every
  `WWTControl.fadeSettings` entry each frame, and during a tour the active settings object
  is a `TourStop` that lacks some of them, so every frame threw. Missing getters fall back
  to the global settings.

Also: engine-pinia bundles its own Pinia, so the app installs a second Pinia instance for
its own stores, before `wwtPinia` (engine-pinia's component resolves its store through
`this.$pinia`).

## Known gaps

- Sky mode only: no Earth, planet, panorama or 3D solar-system views yet.
- Tour playback works; tour authoring, the layer manager for catalogs/VO tables, and
  observing time/location settings are not built.
- The Sesame lookup could not be tested from the development machine (CDS unreachable).
- Footprints are exact for TAN studies with level-0 tiles; others fall back to a square
  sized from the catalogue zoom level.
- No service worker yet (the manifest is there).
