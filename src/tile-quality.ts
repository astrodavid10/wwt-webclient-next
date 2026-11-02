// Sharper sky tiles (shared with the JWST app; see its wwt-hacks.ts).
//
// Dividing RenderContext.get_fovScale by TILE_QUALITY_SCALE makes the engine
// fetch finer tile levels: 2 = one extra level, 4 = two. Chosen per device
// (audit E12): 4 on a fine pointer with devicePixelRatio ≤ 1.5 and ≥ 8 GB RAM
// (or RAM unreported), otherwise 2; ?tileq=<1..8> overrides it. Pan speed is
// compensated in WWTControl.move so dragging still tracks the pointer.
// Importing this module installs the patch once.
import { RenderContext, WWTControl } from "@wwtelescope/engine";

function chooseTileQualityScale(): number {
  const q = Number(new URLSearchParams(window.location.search).get("tileq"));
  if (Number.isFinite(q) && q >= 1 && q <= 8) { return q; }
  const finePointer = window.matchMedia("(pointer: fine)").matches;
  const dpr = window.devicePixelRatio || 1;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mem = (navigator as any).deviceMemory as number | undefined;
  return finePointer && dpr <= 1.5 && (mem === undefined || mem >= 8) ? 4 : 2;
}

export const TILE_QUALITY_SCALE = chooseTileQualityScale();

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const w = window as any;
if (!w.__tileQualityInstalled) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rcProto = RenderContext.prototype as any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ctlProto = WWTControl.prototype as any;
  const origGetFovScale = rcProto.get_fovScale;
  rcProto.get_fovScale = function (this: unknown): number {
    return origGetFovScale.call(this) / TILE_QUALITY_SCALE;
  };
  const origMove = ctlProto.move;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ctlProto.move = function (this: any, x: number, y: number): void {
    if (this.get_planetLike()) { origMove.call(this, x, y); return; }
    origMove.call(this, x * TILE_QUALITY_SCALE, y * TILE_QUALITY_SCALE);
  };
  w.__tileQualityInstalled = true;
}
