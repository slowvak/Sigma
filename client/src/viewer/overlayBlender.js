export function buildColorLUT(labels) {
  const lut = new Uint8Array(256 * 3);
  for (const [value, label] of labels) {
    const isVisible = label.isVisible !== false;
    const offset = value * 3;
    lut[offset] = isVisible ? label.color.r : 0;
    lut[offset + 1] = isVisible ? label.color.g : 0;
    lut[offset + 2] = isVisible ? label.color.b : 0;
  }
  return lut;
}

export function blendSegmentationOverlay(segSlice, rgba, colorLUT, alpha) {
  const len = segSlice.length;
  const oneMinusAlpha = 1 - alpha;
  for (let i = 0; i < len; i++) {
    const label = segSlice[i];
    if (label === 0) continue;

    const ci = label * 3;
    const r = colorLUT[ci];
    const g = colorLUT[ci + 1];
    const b = colorLUT[ci + 2];

    if (r === 0 && g === 0 && b === 0) continue;

    const j = i << 2;
    rgba[j]     = oneMinusAlpha * rgba[j]     + alpha * r;
    rgba[j + 1] = oneMinusAlpha * rgba[j + 1] + alpha * g;
    rgba[j + 2] = oneMinusAlpha * rgba[j + 2] + alpha * b;
  }
}
