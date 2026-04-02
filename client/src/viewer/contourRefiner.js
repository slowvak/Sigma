/**
 * Contour Refiner — snaps a segmentation label boundary to image edges.
 *
 * Works directly on the binary mask — no polygon tracing or filling needed.
 *
 * Algorithm:
 *   1. Extract binary mask for the active label on the axial slice
 *   2. Find boundary pixels (mask pixels with at least one 4-connected background neighbor)
 *   3. Gaussian-smooth the image slice (temporary — for gradient computation only)
 *   4. Compute Sobel gradient magnitude on the smoothed image
 *   5. For each boundary pixel, compute outward normal and search ±2px
 *      along it for the strongest gradient (only move if meaningfully stronger)
 *   6. Smooth the shift values along the boundary
 *   7. Apply shifts: contract inward or expand outward pixel by pixel
 *   8. Morphological close to smooth the result
 *
 * Volume layout: index(x,y,z) = x + y*dimX + z*dimX*dimY  (C-order RAS+)
 */

/**
 * Run contour refinement on the current axial slice.
 *
 * @param {Float32Array} volume   - full image volume
 * @param {Uint8Array}   segVolume - full segmentation volume
 * @param {number[]}     dims     - [dimX, dimY, dimZ]
 * @param {number}       sliceZ   - axial slice index
 * @param {number}       labelVal - label value to refine
 * @returns {{ indices: number[], oldValues: number[] } | null}
 *          Undo diff, or null if no pixels found
 */
export function refineContourAxial(volume, segVolume, dims, sliceZ, labelVal) {
  const [dimX, dimY] = dims;
  const sliceSize = dimX * dimY;
  const volOffset = sliceZ * sliceSize;

  // 1. Extract 2D binary mask and image slice (raw voxel order, no display flips)
  const mask = new Uint8Array(sliceSize);
  const img = new Float32Array(sliceSize);
  let hasLabel = false;
  for (let i = 0; i < sliceSize; i++) {
    if (segVolume[volOffset + i] === labelVal) {
      mask[i] = 1;
      hasLabel = true;
    }
    img[i] = volume[volOffset + i];
  }
  if (!hasLabel) return null;

  // 2. Find boundary pixels (4-connected: has at least one 0-neighbor)
  const boundary = [];
  for (let y = 0; y < dimY; y++) {
    for (let x = 0; x < dimX; x++) {
      const i = y * dimX + x;
      if (mask[i] !== 1) continue;
      if (x === 0 || x === dimX - 1 || y === 0 || y === dimY - 1 ||
          !mask[i - 1] || !mask[i + 1] || !mask[i - dimX] || !mask[i + dimX]) {
        boundary.push({ x, y });
      }
    }
  }
  if (boundary.length < 3) return null;

  // 3. Gaussian-smooth the image (sigma=1.0) — temporary for edge detection
  const smoothed = gaussianSmooth(img, dimX, dimY, 1.0);

  // 4. Sobel gradient magnitude on smoothed image
  const gradMag = sobelGradient(smoothed, dimX, dimY);

  // 5. For each boundary pixel, compute outward normal and find best gradient shift
  const normals = computeOutwardNormals(boundary, mask, dimX, dimY);

  // 5a. Determine dominant gradient direction (sign of intensity change along
  //     outward normal) so we only snap to edges with consistent polarity.
  const dominantSign = computeDominantGradientSign(boundary, normals, smoothed, dimX, dimY);

  const shifts = computeShifts(boundary, normals, gradMag, smoothed, dimX, dimY, 2, dominantSign);

  // 6. Smooth the shift values (average with neighbors along boundary)
  const smoothedShifts = smoothShifts(shifts, boundary, dimX, 3);

  // 7. Apply shifts to create new mask
  const newMask = new Uint8Array(mask);
  applyShifts(newMask, boundary, normals, smoothedShifts, dimX, dimY);

  // 8. Morphological close (dilate then erode) to smooth jagged boundary
  morphClose(newMask, dimX, dimY);

  // Build undo diff and write changes to segVolume
  const diff = { indices: [], oldValues: [] };
  for (let i = 0; i < sliceSize; i++) {
    const volIdx = volOffset + i;
    const oldVal = segVolume[volIdx];
    const wasLabel = oldVal === labelVal;
    const isLabel = newMask[i] === 1;
    if (wasLabel && !isLabel) {
      diff.indices.push(volIdx);
      diff.oldValues.push(oldVal);
      segVolume[volIdx] = 0;
    } else if (!wasLabel && isLabel) {
      diff.indices.push(volIdx);
      diff.oldValues.push(oldVal);
      segVolume[volIdx] = labelVal;
    }
  }
  return diff.indices.length > 0 ? diff : null;
}

// ---------- Outward normals for boundary pixels ----------

function computeOutwardNormals(boundary, mask, w, h) {
  const normals = new Array(boundary.length);
  for (let i = 0; i < boundary.length; i++) {
    const { x, y } = boundary[i];
    // Average direction toward background neighbors (including diagonals)
    let nx = 0, ny = 0;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        const sx = x + dx, sy = y + dy;
        if (sx < 0 || sx >= w || sy < 0 || sy >= h || mask[sy * w + sx] === 0) {
          nx += dx; ny += dy;
        }
      }
    }
    const len = Math.sqrt(nx * nx + ny * ny);
    if (len > 0.001) { nx /= len; ny /= len; }
    else { nx = 0; ny = -1; } // fallback: point up
    normals[i] = { x: nx, y: ny };
  }
  return normals;
}

// ---------- Dominant gradient direction ----------

/**
 * For each boundary pixel, sample intensity just outside vs just inside along
 * the outward normal. The sign of (outside - inside) tells us the polarity of
 * the edge. We take a majority vote to get the dominant sign for the whole
 * contour, so individual noise doesn't flip the decision.
 *
 * Returns +1 (brighter outside), -1 (darker outside), or 0 (no clear winner).
 */
function computeDominantGradientSign(boundary, normals, img, w, h) {
  let pos = 0, neg = 0;
  for (let i = 0; i < boundary.length; i++) {
    const bx = boundary[i].x, by = boundary[i].y;
    const nx = normals[i].x, ny = normals[i].y;

    // Sample 1px outward and 1px inward along the normal
    const ox = Math.round(bx + nx), oy = Math.round(by + ny);
    const ix = Math.round(bx - nx), iy = Math.round(by - ny);

    if (ox < 0 || ox >= w || oy < 0 || oy >= h) continue;
    if (ix < 0 || ix >= w || iy < 0 || iy >= h) continue;

    const diff = img[oy * w + ox] - img[iy * w + ix];
    if (diff > 0) pos++;
    else if (diff < 0) neg++;
  }

  if (pos > neg * 1.5) return 1;
  if (neg > pos * 1.5) return -1;
  return 0; // ambiguous — don't filter
}

// ---------- Compute gradient-snap shifts ----------

/**
 * @param {number} dominantSign - +1, -1, or 0. When non-zero, only snap to
 *   candidate positions whose local gradient polarity matches.
 */
function computeShifts(boundary, normals, gradMag, img, w, h, searchDist, dominantSign) {
  const shifts = new Float32Array(boundary.length);
  for (let i = 0; i < boundary.length; i++) {
    const bx = boundary[i].x, by = boundary[i].y;
    const nx = normals[i].x, ny = normals[i].y;

    // Gradient at current position (baseline)
    let baseGrad = gradMag[by * w + bx];
    let bestGrad = baseGrad;
    let bestD = 0;

    for (let d = -searchDist; d <= searchDist; d++) {
      if (d === 0) continue;
      const sx = Math.round(bx + d * nx);
      const sy = Math.round(by + d * ny);
      if (sx < 0 || sx >= w || sy < 0 || sy >= h) continue;
      const g = gradMag[sy * w + sx];
      if (g > bestGrad * 1.2 && g > bestGrad + 0.5) {
        // Check gradient direction consistency if we have a dominant sign
        if (dominantSign !== 0) {
          // Sample intensity just outside vs just inside at this candidate
          const osx = Math.round(sx + nx), osy = Math.round(sy + ny);
          const isx = Math.round(sx - nx), isy = Math.round(sy - ny);
          if (osx >= 0 && osx < w && osy >= 0 && osy < h &&
              isx >= 0 && isx < w && isy >= 0 && isy < h) {
            const localSign = Math.sign(img[osy * w + osx] - img[isy * w + isx]);
            if (localSign !== 0 && localSign !== dominantSign) continue;
          }
        }
        bestGrad = g;
        bestD = d;
      }
    }
    shifts[i] = bestD;
  }
  return shifts;
}

// ---------- Smooth shift values along boundary ----------

function smoothShifts(shifts, boundary, w, iterations) {
  // Build adjacency: boundary pixels that are 8-connected neighbors
  const n = boundary.length;
  const posMap = new Map();
  for (let i = 0; i < n; i++) {
    posMap.set(boundary[i].y * w + boundary[i].x, i);
  }

  const neighbors = new Array(n);
  for (let i = 0; i < n; i++) {
    const { x, y } = boundary[i];
    const nbrs = [];
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        const key = (y + dy) * w + (x + dx);
        if (posMap.has(key)) nbrs.push(posMap.get(key));
      }
    }
    neighbors[i] = nbrs;
  }

  let current = new Float32Array(shifts);
  for (let iter = 0; iter < iterations; iter++) {
    const next = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      let sum = current[i];
      let count = 1;
      for (const j of neighbors[i]) {
        sum += current[j];
        count++;
      }
      next[i] = sum / count;
    }
    current = next;
  }
  return current;
}

// ---------- Apply shifts to mask ----------

function applyShifts(mask, boundary, normals, shifts, w, h) {
  for (let i = 0; i < boundary.length; i++) {
    const d = Math.round(shifts[i]);
    if (d === 0) continue;

    const bx = boundary[i].x, by = boundary[i].y;
    const nx = normals[i].x, ny = normals[i].y;

    if (d < 0) {
      // Contract: remove pixels from boundary inward
      for (let step = 0; step < -d; step++) {
        const px = Math.round(bx - step * nx);
        const py = Math.round(by - step * ny);
        if (px >= 0 && px < w && py >= 0 && py < h) {
          mask[py * w + px] = 0;
        }
      }
    } else {
      // Expand: add pixels from boundary outward
      for (let step = 1; step <= d; step++) {
        const px = Math.round(bx + step * nx);
        const py = Math.round(by + step * ny);
        if (px >= 0 && px < w && py >= 0 && py < h) {
          mask[py * w + px] = 1;
        }
      }
    }
  }
}

// ---------- Morphological close (dilate then erode) ----------

function morphClose(mask, w, h) {
  const tmp = new Uint8Array(w * h);

  // Dilate with 3x3 cross kernel
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (mask[y * w + x] ||
          (x > 0 && mask[y * w + x - 1]) ||
          (x < w - 1 && mask[y * w + x + 1]) ||
          (y > 0 && mask[(y - 1) * w + x]) ||
          (y < h - 1 && mask[(y + 1) * w + x])) {
        tmp[y * w + x] = 1;
      }
    }
  }

  // Erode with 3x3 cross kernel
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (tmp[y * w + x] &&
          (x > 0 && tmp[y * w + x - 1]) &&
          (x < w - 1 && tmp[y * w + x + 1]) &&
          (y > 0 && tmp[(y - 1) * w + x]) &&
          (y < h - 1 && tmp[(y + 1) * w + x])) {
        mask[y * w + x] = 1;
      } else {
        mask[y * w + x] = 0;
      }
    }
  }
}

// ---------- Gaussian smoothing ----------

function gaussianSmooth(img, w, h, sigma) {
  const radius = Math.ceil(sigma * 3);
  const kernel = new Float32Array(radius * 2 + 1);
  let sum = 0;
  for (let i = -radius; i <= radius; i++) {
    const v = Math.exp(-0.5 * (i / sigma) ** 2);
    kernel[i + radius] = v;
    sum += v;
  }
  for (let i = 0; i < kernel.length; i++) kernel[i] /= sum;

  const tmp = new Float32Array(w * h);
  const out = new Float32Array(w * h);

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let val = 0;
      for (let k = -radius; k <= radius; k++) {
        val += img[y * w + Math.max(0, Math.min(w - 1, x + k))] * kernel[k + radius];
      }
      tmp[y * w + x] = val;
    }
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let val = 0;
      for (let k = -radius; k <= radius; k++) {
        val += tmp[Math.max(0, Math.min(h - 1, y + k)) * w + x] * kernel[k + radius];
      }
      out[y * w + x] = val;
    }
  }
  return out;
}

// ---------- Sobel gradient magnitude ----------

function sobelGradient(img, w, h) {
  const grad = new Float32Array(w * h);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const tl = img[(y-1)*w+x-1], tc = img[(y-1)*w+x], tr = img[(y-1)*w+x+1];
      const ml = img[y*w+x-1],                           mr = img[y*w+x+1];
      const bl = img[(y+1)*w+x-1], bc = img[(y+1)*w+x], br = img[(y+1)*w+x+1];

      const gx = -tl + tr - 2*ml + 2*mr - bl + br;
      const gy = -tl - 2*tc - tr + bl + 2*bc + br;
      grad[y * w + x] = Math.sqrt(gx * gx + gy * gy);
    }
  }
  return grad;
}
