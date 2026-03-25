export function buildColorLUT(labels) {
  const lut = new Uint8Array(256 * 3);
  for (const [value, label] of labels) {
    const offset = value * 3;
    lut[offset] = label.color.r;
    lut[offset + 1] = label.color.g;
    lut[offset + 2] = label.color.b;
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
    const j = i << 2;
    rgba[j]     = oneMinusAlpha * rgba[j]     + alpha * colorLUT[ci];
    rgba[j + 1] = oneMinusAlpha * rgba[j + 1] + alpha * colorLUT[ci + 1];
    rgba[j + 2] = oneMinusAlpha * rgba[j + 2] + alpha * colorLUT[ci + 2];
  }
}
