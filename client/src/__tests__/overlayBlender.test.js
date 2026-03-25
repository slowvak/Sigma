import { describe, it, expect } from 'vitest';
import { blendSegmentationOverlay, buildColorLUT } from '../viewer/overlayBlender';

describe('overlayBlender', () => {
  it('buildColorLUT maps labels to RGB offsets', () => {
    const labels = new Map([
      [0, { color: { r: 0, g: 0, b: 0 } }],
      [1, { color: { r: 255, g: 0, b: 0 } }],
      [5, { color: { r: 0, g: 255, b: 255 } }]
    ]);
    const lut = buildColorLUT(labels);
    expect(lut).toBeInstanceOf(Uint8Array);
    expect(lut.length).toBe(768);
    
    // Label 1
    expect(lut[3]).toBe(255);
    expect(lut[4]).toBe(0);
    expect(lut[5]).toBe(0);
    
    // Label 5
    expect(lut[15]).toBe(0);
    expect(lut[16]).toBe(255);
    expect(lut[17]).toBe(255);
  });

  it('blendSegmentationOverlay with alpha=0 leaves RGBA unchanged', () => {
    const segSlice = new Uint8Array([1, 2]);
    const rgba = new Uint8ClampedArray([10, 10, 10, 255, 20, 20, 20, 255]);
    const lut = new Uint8Array(768);
    lut[3] = 255; // Red for label 1
    lut[6] = 0; lut[7] = 255; // Green for label 2
    
    blendSegmentationOverlay(segSlice, rgba, lut, 0);
    expect(rgba).toEqual(new Uint8ClampedArray([10, 10, 10, 255, 20, 20, 20, 255]));
  });

  it('blendSegmentationOverlay with alpha=1 replaces RGB where label != 0', () => {
    const segSlice = new Uint8Array([1, 0]);
    const rgba = new Uint8ClampedArray([10, 10, 10, 255, 20, 20, 20, 255]);
    const lut = new Uint8Array(768);
    lut[3] = 255; lut[4] = 0; lut[5] = 0; // Red for label 1
    
    blendSegmentationOverlay(segSlice, rgba, lut, 1);
    expect(rgba).toEqual(new Uint8ClampedArray([255, 0, 0, 255, 20, 20, 20, 255]));
  });

  it('blendSegmentationOverlay with alpha=0.5 produces midpoint', () => {
    const segSlice = new Uint8Array([1]);
    const rgba = new Uint8ClampedArray([100, 100, 100, 255]);
    const lut = new Uint8Array(768);
    lut[3] = 200; lut[4] = 0; lut[5] = 0; // Dark red for label 1
    
    blendSegmentationOverlay(segSlice, rgba, lut, 0.5);
    // 0.5 * 100 + 0.5 * 200 = 150
    // 0.5 * 100 + 0.5 * 0 = 50
    expect(rgba[0]).toBe(150);
    expect(rgba[1]).toBe(50);
    expect(rgba[2]).toBe(50);
  });
});
