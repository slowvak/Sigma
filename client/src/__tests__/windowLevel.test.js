import { describe, it, expect } from 'vitest';
import { computeWLDrag } from '../viewer/windowLevel.js';

describe('computeWLDrag', () => {
  it('horizontal delta +30px increases windowWidth', () => {
    // sensitivity = 300/300 = 1.0, new width = 300 + 30*1.0 = 330
    const result = computeWLDrag(30, 0, 100, 300);
    expect(result.width).toBe(330);
    expect(result.center).toBe(100);
  });

  it('vertical delta +30px (down) increases windowCenter (darker)', () => {
    // sensitivity = 300/300 = 1.0, new center = 100 + 30*1.0 = 130
    const result = computeWLDrag(0, 30, 100, 300);
    expect(result.center).toBe(130);
    expect(result.width).toBe(300);
  });

  it('vertical delta -30px (up) decreases windowCenter (brighter)', () => {
    // new center = 100 + (-30)*1.0 = 70
    const result = computeWLDrag(0, -30, 100, 300);
    expect(result.center).toBe(70);
  });

  it('minimum windowWidth is 1', () => {
    // Dragging left far enough: width = max(1, 300 + (-500)*1.0) = max(1, -200) = 1
    const result = computeWLDrag(-500, 0, 100, 300);
    expect(result.width).toBe(1);
  });

  it('sensitivity scales with current width', () => {
    // width=600, sensitivity = 600/300 = 2.0
    // new width = 600 + 10*2.0 = 620
    const result = computeWLDrag(10, 0, 100, 600);
    expect(result.width).toBe(620);
  });
});
