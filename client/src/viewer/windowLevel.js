/**
 * Window/level rendering for Float32Array medical image data.
 *
 * Applies a linear grayscale mapping from raw voxel values to RGBA pixels.
 * This is the per-pixel float32 path — no LUT needed since float values
 * cannot be directly indexed. Fast enough for 512x512 slices (<2ms).
 */

/**
 * Apply window/level mapping to slice data, writing to an RGBA buffer.
 *
 * @param {Float32Array} sliceData - Raw voxel values for one slice
 * @param {Uint8ClampedArray} rgba - Target RGBA buffer (length = sliceData.length * 4)
 * @param {number} windowCenter - Center (level) value
 * @param {number} windowWidth - Width value (must be >= 1)
 */
export function applyWindowLevel(sliceData, rgba, windowCenter, windowWidth) {
  const len = sliceData.length;
  const minVal = windowCenter - windowWidth / 2;
  const scale = 255 / windowWidth;

  for (let i = 0; i < len; i++) {
    const raw = sliceData[i];
    let val = (raw - minVal) * scale;
    // Clamp 0-255 (Uint8ClampedArray auto-clamps, but explicit is faster
    // since we avoid the overhead of auto-clamping on every channel write)
    if (val < 0) val = 0;
    else if (val > 255) val = 255;

    const j = i << 2; // i * 4
    rgba[j] = val;     // R
    rgba[j + 1] = val; // G
    rgba[j + 2] = val; // B
    rgba[j + 3] = 255; // A
  }
}
