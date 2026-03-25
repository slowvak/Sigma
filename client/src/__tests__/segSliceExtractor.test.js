import { describe, it, expect } from 'vitest';
import { extractAxialSegSlice, extractCoronalSegSlice, extractSagittalSegSlice } from '../viewer/segSliceExtractor';

describe('segSliceExtractor', () => {
  it('extractAxialSegSlice returns Uint8Array and flips Y', () => {
    // 2x2x2 volume = 8 voxels
    // axial slice z=0
    // [0, 1] (y=0) -> mapped to y=1
    // [2, 3] (y=1) -> mapped to y=0
    const vol = new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7]);
    const slice = extractAxialSegSlice(vol, 0, 2, 2);
    expect(slice).toBeInstanceOf(Uint8Array);
    expect(slice).toEqual(new Uint8Array([2, 3, 0, 1]));
  });

  it('extractCoronalSegSlice returns Uint8Array and flips Z', () => {
    // 2x2x2 volume
    // coronal slice y=0 => [0, 1, 4, 5]
    // z=0 -> [0, 1] -> mapped to z=1
    // z=1 -> [4, 5] -> mapped to z=0
    const vol = new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7]);
    const slice = extractCoronalSegSlice(vol, 0, 2, 2, 2);
    expect(slice).toBeInstanceOf(Uint8Array);
    expect(slice).toEqual(new Uint8Array([4, 5, 0, 1]));
  });

  it('extractSagittalSegSlice returns Uint8Array and flips Z', () => {
    // 2x2x2 volume
    // sagittal slice x=0 => [0, 2, 4, 6]
    // z=0 -> [0, 2] -> mapped to z=1
    // z=1 -> [4, 6] -> mapped to z=0
    const vol = new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7]);
    const slice = extractSagittalSegSlice(vol, 0, 2, 2, 2);
    expect(slice).toBeInstanceOf(Uint8Array);
    expect(slice).toEqual(new Uint8Array([4, 6, 0, 2]));
  });
});
