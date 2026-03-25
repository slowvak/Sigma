import { describe, it, expect } from 'vitest';
import { canvasToVoxel } from '../viewer/ViewerPanel.js';

describe('canvasToVoxel', () => {
  it('axial panel: maps canvas click to voxel x,y', () => {
    // Canvas click at pixel (10, 20) on a canvas width=100, height=200
    // Axial: canvasX -> cursor[0], canvasY -> cursor[1]
    const result = canvasToVoxel(10, 20, 'axial', { width: 100, clientWidth: 100 }, { height: 200, clientHeight: 200 }, [100, 200, 150]);
    expect(result).toEqual({ cursorUpdates: { 0: 10, 1: 20 } });
  });

  it('coronal panel: maps canvas click to voxel x,z', () => {
    // Canvas click at pixel (10, 20) on a canvas width=100, height=150
    // Coronal: canvasX -> cursor[0], canvasY -> cursor[2]
    const result = canvasToVoxel(10, 20, 'coronal', { width: 100, clientWidth: 100 }, { height: 150, clientHeight: 150 }, [100, 200, 150]);
    expect(result).toEqual({ cursorUpdates: { 0: 10, 2: 20 } });
  });

  it('sagittal panel: maps canvas click to voxel y,z', () => {
    // Canvas click at pixel (10, 20) on a canvas width=200, height=150
    // Sagittal: canvasX -> cursor[1], canvasY -> cursor[2]
    const result = canvasToVoxel(10, 20, 'sagittal', { width: 200, clientWidth: 200 }, { height: 150, clientHeight: 150 }, [100, 200, 150]);
    expect(result).toEqual({ cursorUpdates: { 1: 10, 2: 20 } });
  });

  it('accounts for CSS scaling (anisotropic)', () => {
    // canvas.width=100 but canvas.clientWidth=200 (CSS scaled 2x)
    // A click at canvasX offset 100 (CSS px) maps to voxel x=50
    const result = canvasToVoxel(100, 40, 'axial', { width: 100, clientWidth: 200 }, { height: 200, clientHeight: 400 }, [100, 200, 150]);
    expect(result).toEqual({ cursorUpdates: { 0: 50, 1: 20 } });
  });

  it('clamps to valid range', () => {
    // Click beyond dims should clamp
    const result = canvasToVoxel(150, 250, 'axial', { width: 100, clientWidth: 100 }, { height: 200, clientHeight: 200 }, [100, 200, 150]);
    expect(result.cursorUpdates[0]).toBe(99); // dims[0]-1
    expect(result.cursorUpdates[1]).toBe(199); // dims[1]-1
  });
});
