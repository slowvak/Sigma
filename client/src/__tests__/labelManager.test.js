import { describe, it, expect } from 'vitest';
import { discoverLabels, findLowestUnusedValue, reassignLabelValue } from '../viewer/labelManager';

describe('labelManager', () => {
  it('discoverLabels finds background and unique non-zero values', () => {
    const vol = new Uint8Array([0, 1, 0, 3, 1, 0, 255]);
    const labels = discoverLabels(vol);
    
    expect(labels.size).toBe(4);
    expect(labels.has(0)).toBe(true);
    expect(labels.get(0).name).toBe('Background');
    
    expect(labels.has(1)).toBe(true);
    expect(labels.get(1).name).toBe('Label 1');
    expect(labels.get(1).color.r).toBe(255); // Color palette 1
    
    expect(labels.has(3)).toBe(true);
    expect(labels.get(3).name).toBe('Label 3');
    
    expect(labels.has(255)).toBe(true);
  });

  it('findLowestUnusedValue returns 1 for empty Map', () => {
    const labels = new Map();
    labels.set(0, { name: 'Background', value: 0 });
    expect(findLowestUnusedValue(labels)).toBe(1);
  });

  it('findLowestUnusedValue finds gap in sequence', () => {
    const labels = new Map();
    labels.set(0, {});
    labels.set(1, {});
    labels.set(2, {});
    labels.set(4, {});
    expect(findLowestUnusedValue(labels)).toBe(3);
  });

  it('reassignLabelValue updates matching voxels', () => {
    const vol = new Uint8Array([0, 1, 1, 2, 0]);
    reassignLabelValue(vol, 1, 5);
    expect(vol).toEqual(new Uint8Array([0, 5, 5, 2, 0]));
  });

  it('reassignLabelValue with no matches leaves unchanged', () => {
    const vol = new Uint8Array([0, 1, 2]);
    reassignLabelValue(vol, 3, 5);
    expect(vol).toEqual(new Uint8Array([0, 1, 2]));
  });
});
