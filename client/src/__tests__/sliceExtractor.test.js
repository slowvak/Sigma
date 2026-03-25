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
  it('returns Float32Array of length dimX*dimY with Y flipped (anterior at top)', () => {
    const { volume, dimX, dimY } = makeTestVolume();
    const z = 2;
    const slice = extractAxialSlice(volume, z, dimX, dimY);
    expect(slice.length).toBe(dimX * dimY); // 3*4 = 12
    // Row 0 (top) = y=3 (anterior): volume[0 + 3*3 + 2*12] = volume[33] = 33
    expect(slice[0]).toBe(33);
    // Row dimY-1 (bottom) = y=0 (posterior): volume[0 + 0*3 + 2*12] = volume[24] = 24
    expect(slice[(dimY - 1) * dimX]).toBe(24);
  });

  it('allocates new array (not zero-copy) due to Y flip', () => {
    const { volume, dimX, dimY } = makeTestVolume();
    const slice = extractAxialSlice(volume, 0, dimX, dimY);
    // Allocated array does not share buffer
    expect(slice.buffer).not.toBe(volume.buffer);
  });
});

describe('extractCoronalSlice', () => {
  it('returns Float32Array of length dimX*dimZ with Z flipped (superior at top)', () => {
    const { volume, dimX, dimY, dimZ } = makeTestVolume();
    const y = 1;
    const slice = extractCoronalSlice(volume, y, dimX, dimY, dimZ);
    expect(slice.length).toBe(dimX * dimZ); // 3*5 = 15
    // Row 0 (top) = z=4 (superior): volume[0 + 1*3 + 4*12] = volume[51] = 51
    expect(slice[0]).toBe(51);
    // Row 0, x=1: volume[1 + 1*3 + 4*12] = volume[52] = 52
    expect(slice[1]).toBe(52);
    // Row dimZ-1 (bottom) = z=0 (inferior): volume[0 + 1*3 + 0*12] = volume[3] = 3
    expect(slice[(dimZ - 1) * dimX]).toBe(3);
  });
});

describe('extractSagittalSlice', () => {
  it('returns Float32Array of length dimY*dimZ with Z flipped (superior at top)', () => {
    const { volume, dimX, dimY, dimZ } = makeTestVolume();
    const x = 1;
    const slice = extractSagittalSlice(volume, x, dimX, dimY, dimZ);
    expect(slice.length).toBe(dimY * dimZ); // 4*5 = 20
    // Row 0 (top) = z=4 (superior): volume[1 + 0*3 + 4*12] = volume[49] = 49
    expect(slice[0]).toBe(49);
    // Row 0, y=1: volume[1 + 1*3 + 4*12] = volume[52] = 52
    expect(slice[1]).toBe(52);
    // Row dimZ-1 (bottom) = z=0 (inferior): volume[1 + 0*3 + 0*12] = volume[1] = 1
    expect(slice[(dimZ - 1) * dimY]).toBe(1);
  });
});
