import { describe, it, expect } from 'vitest';
import { extractAxialSlice, extractCoronalSlice, extractSagittalSlice } from '../viewer/sliceExtractor.js';

// Test volume: 3x4x5 in C-order
// index(x,y,z) = x + y*dimX + z*dimX*dimY = x + y*3 + z*12
function makeTestVolume() {
  const dimX = 3, dimY = 4, dimZ = 5;
  const volume = new Float32Array(dimX * dimY * dimZ);
  for (let z = 0; z < dimZ; z++) {
    for (let y = 0; y < dimY; y++) {
      for (let x = 0; x < dimX; x++) {
        volume[x + y * dimX + z * dimX * dimY] = x + y * dimX + z * dimX * dimY;
      }
    }
  }
  return { volume, dimX, dimY, dimZ };
}

describe('extractAxialSlice', () => {
  it('returns a contiguous subarray of length dimX*dimY at offset z*dimX*dimY', () => {
    const { volume, dimX, dimY } = makeTestVolume();
    const z = 2;
    const slice = extractAxialSlice(volume, z, dimX, dimY);
    expect(slice.length).toBe(dimX * dimY); // 3*4 = 12
    // First element should be at offset z*dimX*dimY = 2*12 = 24
    expect(slice[0]).toBe(24);
    // Last element: 24 + 11 = 35
    expect(slice[11]).toBe(35);
  });

  it('uses subarray (zero-copy) for axial slices', () => {
    const { volume, dimX, dimY } = makeTestVolume();
    const slice = extractAxialSlice(volume, 0, dimX, dimY);
    // Subarray shares buffer with original
    expect(slice.buffer).toBe(volume.buffer);
  });
});

describe('extractCoronalSlice', () => {
  it('returns Float32Array of length dimX*dimZ with correct values', () => {
    const { volume, dimX, dimY, dimZ } = makeTestVolume();
    const y = 1;
    const slice = extractCoronalSlice(volume, y, dimX, dimY, dimZ);
    expect(slice.length).toBe(dimX * dimZ); // 3*5 = 15
    // Element [z=0, x=0] = volume[0 + 1*3 + 0*12] = volume[3] = 3
    expect(slice[0]).toBe(3);
    // Element [z=0, x=1] = volume[1 + 1*3 + 0*12] = volume[4] = 4
    expect(slice[1]).toBe(4);
    // Element [z=1, x=0] = volume[0 + 1*3 + 1*12] = volume[15] = 15
    expect(slice[dimX]).toBe(15);
  });
});

describe('extractSagittalSlice', () => {
  it('returns Float32Array of length dimY*dimZ with correct values', () => {
    const { volume, dimX, dimY, dimZ } = makeTestVolume();
    const x = 1;
    const slice = extractSagittalSlice(volume, x, dimX, dimY, dimZ);
    expect(slice.length).toBe(dimY * dimZ); // 4*5 = 20
    // Element [z=0, y=0] = volume[1 + 0*3 + 0*12] = volume[1] = 1
    expect(slice[0]).toBe(1);
    // Element [z=0, y=1] = volume[1 + 1*3 + 0*12] = volume[4] = 4
    expect(slice[1]).toBe(4);
    // Element [z=1, y=0] = volume[1 + 0*3 + 1*12] = volume[13] = 13
    expect(slice[dimY]).toBe(13);
  });
});
