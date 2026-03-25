/**
 * Slice extraction from a flat 3D Uint8Array segmentation volume in C-order (RAS+).
 *
 * Volume layout: index(x,y,z) = x + y*dimX + z*dimX*dimY
 * where x = R-L axis, y = A-P axis, z = I-S axis
 */

export function extractAxialSegSlice(segVolume, z, dimX, dimY) {
  const offset = z * dimX * dimY;
  const slice = new Uint8Array(dimX * dimY);
  // Flip Y so anterior (high y) is at the top of the canvas
  for (let y = 0; y < dimY; y++) {
    const srcRow = offset + y * dimX;
    const dstRow = (dimY - 1 - y) * dimX;
    for (let x = 0; x < dimX; x++) {
      slice[dstRow + x] = segVolume[srcRow + x];
    }
  }
  return slice;
}

export function extractCoronalSegSlice(segVolume, y, dimX, dimY, dimZ) {
  const slice = new Uint8Array(dimX * dimZ);
  for (let z = 0; z < dimZ; z++) {
    const srcOffset = y * dimX + z * dimX * dimY;
    // Flip Z so superior (high z) is at the top of the canvas
    const dstRow = dimZ - 1 - z;
    for (let x = 0; x < dimX; x++) {
      slice[dstRow * dimX + x] = segVolume[srcOffset + x];
    }
  }
  return slice;
}

export function extractSagittalSegSlice(segVolume, x, dimX, dimY, dimZ) {
  const slice = new Uint8Array(dimY * dimZ);
  for (let z = 0; z < dimZ; z++) {
    // Flip Z so superior (high z) is at the top of the canvas
    const dstRow = dimZ - 1 - z;
    for (let y = 0; y < dimY; y++) {
      slice[dstRow * dimY + y] = segVolume[x + y * dimX + z * dimX * dimY];
    }
  }
  return slice;
}
