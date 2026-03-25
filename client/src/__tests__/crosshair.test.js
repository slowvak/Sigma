import { describe, it, expect } from 'vitest';
import { canvasToVoxel } from '../viewer/ViewerPanel.js';

describe('canvasToVoxel', () => {
  it('axial panel: maps canvas click to voxel x,y (Y flipped)', () => {
    // Canvas click at pixel (10, 20) on a canvas width=100, height=200
    // Axial: canvasX -> cursor[0], canvasY -> cursor[1] (flipped: y = dimY-1-canvasY)
    const result = canvasToVoxel(10, 20, 'axial', { width: 100, clientWidth: 100 }, { height: 200, clientHeight: 200 }, [100, 200, 150]);
    expect(result).toEqual({ cursorUpdates: { 0: 10, 1: 179 } }); // 200-1-20 = 179
  });

  it('coronal panel: maps canvas click to voxel x,z (Z flipped)', () => {
    // Canvas click at pixel (10, 20) on a canvas width=100, height=150
    // Coronal: canvasX -> cursor[0], canvasY -> cursor[2] (flipped: z = dimZ-1-canvasY)
    const result = canvasToVoxel(10, 20, 'coronal', { width: 100, clientWidth: 100 }, { height: 150, clientHeight: 150 }, [100, 200, 150]);
    expect(result).toEqual({ cursorUpdates: { 0: 10, 2: 129 } }); // 150-1-20 = 129
  });

  it('sagittal panel: maps canvas click to voxel y,z (Z flipped)', () => {
    // Canvas click at pixel (10, 20) on a canvas width=200, height=150
    // Sagittal: canvasX -> cursor[1], canvasY -> cursor[2] (flipped: z = dimZ-1-canvasY)
    const result = canvasToVoxel(10, 20, 'sagittal', { width: 200, clientWidth: 200 }, { height: 150, clientHeight: 150 }, [100, 200, 150]);
    expect(result).toEqual({ cursorUpdates: { 1: 10, 2: 129 } }); // 150-1-20 = 129
  });

  it('accounts for CSS scaling (anisotropic)', () => {
    // canvas.width=100 but canvas.clientWidth=200 (CSS scaled 2x)
    // A click at canvasX offset 100 (CSS px) maps to voxel x=50
    // canvasY=40 at 2x scale -> voxelY=20, flipped: y=200-1-20=179
    const result = canvasToVoxel(100, 40, 'axial', { width: 100, clientWidth: 200 }, { height: 200, clientHeight: 400 }, [100, 200, 150]);
    expect(result).toEqual({ cursorUpdates: { 0: 50, 1: 179 } });
  });

  it('clamps to valid range', () => {
    // Click beyond dims should clamp (after Y flip, negative values clamp to 0)
    const result = canvasToVoxel(150, 250, 'axial', { width: 100, clientWidth: 100 }, { height: 200, clientHeight: 200 }, [100, 200, 150]);
    expect(result.cursorUpdates[0]).toBe(99); // dims[0]-1
    expect(result.cursorUpdates[1]).toBe(0); // flipped: 200-1-250 = -51, clamped to 0
  });
});
