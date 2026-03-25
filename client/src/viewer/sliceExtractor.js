/**
 * Slice extraction from a flat 3D Float32Array volume in C-order (RAS+).
 *
 * Volume layout: index(x,y,z) = x + y*dimX + z*dimX*dimY
 * where x = R-L axis, y = A-P axis, z = I-S axis
 */

/**
 * Extract an axial slice (fixed z, varies x and y).
 * Returns a zero-copy subarray — no allocation.
 *
 * @param {Float32Array} volume - Flat 3D volume
 * @param {number} z - Slice index along z (I-S) axis
 * @param {number} dimX - X dimension
 * @param {number} dimY - Y dimension
 * @returns {Float32Array} Slice of dimX * dimY pixels
 */
export function extractAxialSlice(volume, z, dimX, dimY) {
  const offset = z * dimX * dimY;
  return volume.subarray(offset, offset + dimX * dimY);
}

/**
 * Extract a coronal slice (fixed y, varies x and z).
 * Requires strided access — allocates new array.
 *
 * @param {Float32Array} volume - Flat 3D volume
 * @param {number} y - Slice index along y (A-P) axis
 * @param {number} dimX - X dimension
 * @param {number} dimY - Y dimension
 * @param {number} dimZ - Z dimension
 * @returns {Float32Array} Slice of dimX * dimZ pixels
 */
export function extractCoronalSlice(volume, y, dimX, dimY, dimZ) {
  const slice = new Float32Array(dimX * dimZ);
  for (let z = 0; z < dimZ; z++) {
    const srcOffset = y * dimX + z * dimX * dimY;
    for (let x = 0; x < dimX; x++) {
      slice[z * dimX + x] = volume[srcOffset + x];
    }
  }
  return slice;
}

/**
 * Extract a sagittal slice (fixed x, varies y and z).
 * Requires strided access — allocates new array.
 *
 * @param {Float32Array} volume - Flat 3D volume
 * @param {number} x - Slice index along x (R-L) axis
 * @param {number} dimX - X dimension
 * @param {number} dimY - Y dimension
 * @param {number} dimZ - Z dimension
 * @returns {Float32Array} Slice of dimY * dimZ pixels
 */
export function extractSagittalSlice(volume, x, dimX, dimY, dimZ) {
  const slice = new Float32Array(dimY * dimZ);
  for (let z = 0; z < dimZ; z++) {
    for (let y = 0; y < dimY; y++) {
      slice[z * dimY + y] = volume[x + y * dimX + z * dimX * dimY];
    }
  }
  return slice;
}
