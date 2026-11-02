// Runtime patches to the WWT engine for the mixer, installed once at import.
//
// ImageSetLayer.draw is wrapped so a layer can be drawn
//   - with additive blending ("add light", for multi-wavelength composites):
//     the tile shader calls gl.blendFunc(SRC_ALPHA, ONE_MINUS_SRC_ALPHA) on
//     every draw, so while this layer draws we pin blendFunc to (SRC_ALPHA, ONE);
//   - clipped to a vertical band (Swipe compare) with the scissor test.
// Both are keyed by layer id string and cost nothing for other layers.

import { ImageSetLayer, RenderContext } from "@wwtelescope/engine";

export interface LayerDrawOverride {
  additive?: boolean;
  /** Draw only x >= clipLeftFrac * width (fraction of the canvas, 0..1). */
  clipLeftFrac?: number;
}

export const drawOverrides = new Map<string, LayerDrawOverride>();

/**
 * Brightness of the background survey, 0..1. It's the bottom of the mixer's
 * stack; dimming it keeps additive blends from washing out to white.
 */
export const backgroundDim = { factor: 1 };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const w = window as any;
if (!w.__wwtNextLayerPatch) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const proto = ImageSetLayer.prototype as any;
  const origDraw = proto.draw;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  proto.draw = function (this: any, renderContext: any, opacity: number, flat: boolean): boolean {
    const o = drawOverrides.size ? drawOverrides.get(String(this.id)) : undefined;
    const gl: WebGL2RenderingContext | null = renderContext?.gl ?? null;
    if (!o || !gl) { return origDraw.call(this, renderContext, opacity, flat); }

    const origBlend = gl.blendFunc;
    if (o.additive) {
      gl.blendFunc = function (this: WebGL2RenderingContext) { origBlend.call(gl, gl.SRC_ALPHA, gl.ONE); };
    }
    const clip = o.clipLeftFrac !== undefined;
    if (clip) {
      const bufW = gl.drawingBufferWidth, bufH = gl.drawingBufferHeight;
      const x = Math.round(Math.min(1, Math.max(0, o.clipLeftFrac as number)) * bufW);
      gl.enable(gl.SCISSOR_TEST);
      gl.scissor(x, 0, bufW - x, bufH);
    }
    try {
      return origDraw.call(this, renderContext, opacity, flat);
    } finally {
      if (o.additive) { gl.blendFunc = origBlend; origBlend.call(gl, gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA); }
      if (clip) { gl.disable(gl.SCISSOR_TEST); }
    }
  };
  // The background is drawn with RenderContext.drawImageSet(bg, 100) before
  // the layers; scale its opacity (the clear colour is black, so this dims it).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rcProto = RenderContext.prototype as any;
  const origDrawImageSet = rcProto.drawImageSet;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  rcProto.drawImageSet = function (this: any, imageset: unknown, opacity: number) {
    if (backgroundDim.factor < 1 && imageset && imageset === this.get_backgroundImageset()) {
      opacity *= backgroundDim.factor;
    }
    return origDrawImageSet.call(this, imageset, opacity);
  };
  w.__wwtNextLayerPatch = true;
}
