/**
 * ViewerPanel — renders a single plane (axial, coronal, or sagittal)
 * with canvas, orientation labels, slice slider, crosshairs, and label bar.
 */
import { extractAxialSlice, extractCoronalSlice, extractSagittalSlice } from './sliceExtractor.js';
import { applyWindowLevel, computeWLDrag } from './windowLevel.js';
import { extractAxialSegSlice, extractCoronalSegSlice, extractSagittalSegSlice } from './segSliceExtractor.js';
import { blendSegmentationOverlay } from './overlayBlender.js';

const ORIENTATION_LABELS = {
  axial: { left: 'R', right: 'L', top: 'A', bottom: 'P' },
  coronal: { left: 'R', right: 'L', top: 'S', bottom: 'I' },
  sagittal: { left: 'A', right: 'P', top: 'S', bottom: 'I' },
};

const AXIS_NAMES = {
  axial: 'Axial',
  coronal: 'Coronal',
  sagittal: 'Sagittal',
};

const TOGGLE_LETTERS = {
  axial: 'A',
  coronal: 'C',
  sagittal: 'S',
};

const CROSSHAIR_COLORS = {
  axial: '#ffff00',
  coronal: '#00ff00',
  sagittal: '#ff6600',
};

/**
 * Convert canvas pixel coordinates to voxel cursor updates for a given axis.
 * Exported for testability.
 *
 * @param {number} canvasX - X position in CSS pixels relative to canvas
 * @param {number} canvasY - Y position in CSS pixels relative to canvas
 * @param {string} axis - 'axial' | 'coronal' | 'sagittal'
 * @param {{ width: number, clientWidth: number }} canvasH - Horizontal canvas info
 * @param {{ height: number, clientHeight: number }} canvasV - Vertical canvas info
 * @param {number[]} dims - Volume dimensions [dimX, dimY, dimZ]
 * @returns {{ cursorUpdates: Object }} Map of cursor index -> voxel value
 */
export function canvasToVoxel(canvasX, canvasY, axis, canvasH, canvasV, dims) {
  // Account for CSS scaling
  const voxelX = Math.floor(canvasX * (canvasH.width / canvasH.clientWidth));
  const voxelY = Math.floor(canvasY * (canvasV.height / canvasV.clientHeight));

  const cursorUpdates = {};

  if (axis === 'axial') {
    // Axial: X-flipped (right on left), Y-flipped (anterior at top)
    cursorUpdates[0] = Math.max(0, Math.min(dims[0] - 1 - voxelX, dims[0] - 1));
    cursorUpdates[1] = Math.max(0, Math.min(dims[1] - 1 - voxelY, dims[1] - 1));
  } else if (axis === 'coronal') {
    // Coronal: X-flipped (right on left), Z-flipped (superior at top)
    cursorUpdates[0] = Math.max(0, Math.min(dims[0] - 1 - voxelX, dims[0] - 1));
    cursorUpdates[2] = Math.max(0, Math.min(dims[2] - 1 - voxelY, dims[2] - 1));
  } else {
    // Sagittal: Y-flipped (anterior on left), Z-flipped (superior at top)
    cursorUpdates[1] = Math.max(0, Math.min(dims[1] - 1 - voxelX, dims[1] - 1));
    cursorUpdates[2] = Math.max(0, Math.min(dims[2] - 1 - voxelY, dims[2] - 1));
  }

  return { cursorUpdates };
}

export class ViewerPanel {
  /**
   * @param {Object} options
   * @param {HTMLElement} options.container - Parent DOM element
   * @param {string} options.axis - 'axial' | 'coronal' | 'sagittal'
   * @param {import('./ViewerState.js').ViewerState} options.state - Shared viewer state
   */
  constructor({ container, axis, state }) {
    this.container = container;
    this.axis = axis;
    this.state = state;
    this.volume = null;
    this.dims = null;
    this.spacing = null;
    this.imageData = null;
    this.ctx = null;

    // Interaction tracking
    this._isDraggingCrosshair = false;
    this._isDraggingWL = false;
    this._isPainting = false;
    this._currentDiff = null;
    this._lastWLX = 0;
    this._lastWLY = 0;

    this._buildDOM();
    this._setupResizeObserver();
    this._setupEventHandlers();
  }

  _buildDOM() {
    this.container.classList.add('viewer-panel');

    // Label bar
    const labelBar = document.createElement('div');
    labelBar.className = 'panel-label-bar';

    const panelName = document.createElement('span');
    panelName.className = 'panel-name';
    panelName.textContent = AXIS_NAMES[this.axis];
    labelBar.appendChild(panelName);

    this.sliceReadout = document.createElement('span');
    this.sliceReadout.className = 'slice-readout';
    this.sliceReadout.textContent = '0/0';
    labelBar.appendChild(this.sliceReadout);

    const spacer = document.createElement('div');
    spacer.style.flex = '1';
    labelBar.appendChild(spacer);

    const toggleBtn = document.createElement('button');
    toggleBtn.className = 'panel-toggle-btn';
    toggleBtn.textContent = TOGGLE_LETTERS[this.axis];
    toggleBtn.setAttribute('aria-label', `Toggle ${this.axis} single view`);
    labelBar.appendChild(toggleBtn);
    this.toggleBtn = toggleBtn;

    this.container.appendChild(labelBar);

    // Canvas container
    const canvasContainer = document.createElement('div');
    canvasContainer.className = 'canvas-container';

    this.canvas = document.createElement('canvas');
    this.canvas.style.imageRendering = 'pixelated';
    this.canvas.setAttribute('role', 'img');
    this.canvas.setAttribute('aria-label', `${AXIS_NAMES[this.axis]} view of loaded volume`);
    canvasContainer.appendChild(this.canvas);

    this.ctx = this.canvas.getContext('2d');

    // Orientation labels
    const labels = ORIENTATION_LABELS[this.axis];
    for (const [pos, text] of Object.entries(labels)) {
      const label = document.createElement('span');
      label.className = `orientation-label orientation-${pos}`;
      label.textContent = text;
      canvasContainer.appendChild(label);
    }

    // Slice slider
    this.slider = document.createElement('input');
    this.slider.type = 'range';
    this.slider.className = 'slice-slider';
    this.slider.min = '0';
    this.slider.max = '0';
    this.slider.step = '1';
    this.slider.value = '0';
    this.slider.setAttribute('aria-label', `${AXIS_NAMES[this.axis]} slice`);
    this.slider.setAttribute('aria-valuemin', '0');
    this.slider.setAttribute('aria-valuemax', '0');

    this.slider.addEventListener('input', () => {
      const val = parseInt(this.slider.value, 10);
      const [cx, cy, cz] = this.state.cursor;
      if (this.axis === 'axial') {
        this.state.setCursor(cx, cy, val);
      } else if (this.axis === 'coronal') {
        this.state.setCursor(cx, val, cz);
      } else {
        this.state.setCursor(val, cy, cz);
      }
    });

    canvasContainer.appendChild(this.slider);
    this.container.appendChild(canvasContainer);
    this.canvasContainer = canvasContainer;
  }

  /**
   * Update the canvas cursor based on the active tool.
   * Paint/erase: circular outline matching brush radius.
   * Crosshair/other: standard crosshair cursor.
   */
  _updateCursor() {
    const tool = this.state.activeTool;
    if (tool === 'paint' || tool === 'erase') {
      // Compute CSS pixel radius from voxel radius using canvas scaling
      const voxelRadius = this.state.brushRadius;
      const scaleX = this.canvas.clientWidth / this.canvas.width;
      const diameter = Math.max(4, Math.round(voxelRadius * 2 * scaleX));
      const size = diameter + 2; // +2 for stroke
      const half = size / 2;

      // Draw circle cursor on a tiny canvas and convert to data URL
      const c = document.createElement('canvas');
      c.width = size;
      c.height = size;
      const ctx = c.getContext('2d');
      ctx.strokeStyle = tool === 'paint' ? '#00ff00' : '#ff4444';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(half, half, diameter / 2, 0, Math.PI * 2);
      ctx.stroke();
      this.canvas.style.cursor = `url(${c.toDataURL()}) ${half} ${half}, crosshair`;
    } else {
      this.canvas.style.cursor = 'crosshair';
    }
  }

  _setupResizeObserver() {
    this.resizeObserver = new ResizeObserver(() => {
      if (this.volume) {
        this.updateDisplaySize();
        this.render();
      }
    });
    this.resizeObserver.observe(this.canvasContainer);
  }

  _setupEventHandlers() {
    // Prevent context menu on canvas (Ctrl+click on macOS triggers it)
    this.canvas.addEventListener('contextmenu', (e) => e.preventDefault());

    // Mouse down on canvas: crosshair drag or Ctrl+drag W/L
    this.canvas.addEventListener('mousedown', (e) => {
      if (!this.volume) return;

      if (e.ctrlKey || e.metaKey) {
        // Ctrl+drag W/L
        e.preventDefault();
        this._isDraggingWL = true;
        this._lastWLX = e.clientX;
        this._lastWLY = e.clientY;
        this.canvas.style.cursor = 'grab';
      } else if (this.state.activeTool === 'paint' || this.state.activeTool === 'erase') {
        e.preventDefault();
        if (this._currentDiff && !this._isPainting) {
          delete this._currentDiff.seen;
          this.state.pushUndo(this._currentDiff);
        }
        this._isPainting = true;
        this._currentDiff = { indices: [], oldValues: [], seen: new Set() };
        this._applyBrush(e);
      } else if (this.state.activeTool === 'region-grow') {
        e.preventDefault();
        this._startRegionGrow(e);
      } else {
        // Crosshair click+drag
        this._isDraggingCrosshair = true;
        this._updateCrosshairFromMouse(e);
      }
    });

    // Mouse move: update crosshair or W/L during drag
    this._onMouseMove = (e) => {
      if (this._isDraggingCrosshair) {
        this._updateCrosshairFromMouse(e);
      } else if (this._isDraggingWL) {
        const dx = e.clientX - this._lastWLX;
        const dy = e.clientY - this._lastWLY;
        const { center, width } = computeWLDrag(dx, dy, this.state.windowCenter, this.state.windowWidth);
        this.state.setWindowLevel(center, width);
        this._lastWLX = e.clientX;
        this._lastWLY = e.clientY;
      } else if (this._isPainting) {
        e.preventDefault();
        this._applyBrush(e);
      }
    };

    // Mouse up: stop all drags
    this._onMouseUp = () => {
      this._isDraggingCrosshair = false;
      if (this._isPainting) {
        this._isPainting = false;
        if (this._currentDiff) {
          delete this._currentDiff.seen;
          this.state.pushUndo(this._currentDiff);
          this._currentDiff = null;
        }
      }
      if (this._isDraggingWL) {
        this._isDraggingWL = false;
        this.canvas.style.cursor = '';
      }
    };

    document.addEventListener('mousemove', this._onMouseMove);
    document.addEventListener('mouseup', this._onMouseUp);

    this.state.subscribe(() => {
        // Commit region grow diff if we switch tools
        if (this.state.activeTool !== 'region-grow' && this._currentDiff && !this._isPainting) {
            delete this._currentDiff.seen;
            this.state.pushUndo(this._currentDiff);
            this._currentDiff = null;
        }
    });

    // Mouse move on canvas (hover): update pixel value readout
    this.canvas.addEventListener('mousemove', (e) => {
      if (!this.volume || !this.dims) return;
      // Guard against zero-size canvas (not yet laid out)
      if (this.canvas.clientWidth <= 0 || this.canvas.clientHeight <= 0) return;
      const rect = this.canvas.getBoundingClientRect();
      const cssX = e.clientX - rect.left;
      const cssY = e.clientY - rect.top;
      const { cursorUpdates } = canvasToVoxel(
        cssX, cssY, this.axis,
        { width: this.canvas.width, clientWidth: this.canvas.clientWidth },
        { height: this.canvas.height, clientHeight: this.canvas.clientHeight },
        this.dims
      );
      const [cx, cy, cz] = this.state.cursor;
      const x = cursorUpdates[0] !== undefined ? cursorUpdates[0] : cx;
      const y = cursorUpdates[1] !== undefined ? cursorUpdates[1] : cy;
      const z = cursorUpdates[2] !== undefined ? cursorUpdates[2] : cz;
      const [dimX, dimY, dimZ] = this.dims;
      // Clamp all coordinates to valid range before indexing
      const cx2 = Math.max(0, Math.min(Math.floor(x), dimX - 1));
      const cy2 = Math.max(0, Math.min(Math.floor(y), dimY - 1));
      const cz2 = Math.max(0, Math.min(Math.floor(z), dimZ - 1));
      const idx = cz2 * (dimX * dimY) + cy2 * dimX + cx2;
      if (!this._pixelLogDone) {
        console.log(`[NextEd pixel] axis=${this.axis} voxel=(${cx2},${cy2},${cz2}) idx=${idx} val=${this.volume[idx]} volLen=${this.volume.length}`);
        this._pixelLogDone = true;
        setTimeout(() => { this._pixelLogDone = false; }, 2000);
      }
      this.state.setCursorValue(this.volume[idx]);
    });

    this.canvas.addEventListener('mouseleave', () => {
      this.state.setCursorValue(null);
    });

    // Mouse wheel: scroll slices (D-01, D-02, D-03)
    this.canvas.addEventListener('wheel', (e) => {
      if (!this.volume) return;
      e.preventDefault();

      const [cx, cy, cz] = this.state.cursor;
      // deltaY > 0 = scroll down = previous slice, deltaY < 0 = scroll up = next slice
      const delta = e.deltaY > 0 ? -1 : 1;

      if (this.axis === 'axial') {
        this.state.setCursor(cx, cy, cz + delta);
      } else if (this.axis === 'coronal') {
        this.state.setCursor(cx, cy + delta, cz);
      } else {
        this.state.setCursor(cx + delta, cy, cz);
      }
    }, { passive: false });
  }

  /**
   * Convert mouse event position to voxel coords and update state cursor.
   */
  _updateCrosshairFromMouse(e) {
    const rect = this.canvas.getBoundingClientRect();
    const cssX = e.clientX - rect.left;
    const cssY = e.clientY - rect.top;

    const { cursorUpdates } = canvasToVoxel(
      cssX, cssY, this.axis,
      { width: this.canvas.width, clientWidth: this.canvas.clientWidth },
      { height: this.canvas.height, clientHeight: this.canvas.clientHeight },
      this.dims
    );

    const [cx, cy, cz] = this.state.cursor;
    const newX = cursorUpdates[0] !== undefined ? cursorUpdates[0] : cx;
    const newY = cursorUpdates[1] !== undefined ? cursorUpdates[1] : cy;
    const newZ = cursorUpdates[2] !== undefined ? cursorUpdates[2] : cz;
    this.state.setCursor(newX, newY, newZ);
  }

  /**
   * Apply brush stroke to segmentation volume based on active tools and dimensions.
   */
  _applyBrush(e) {
    if ((!this.state.segVolume && this.state.activeTool === 'paint') || this.state.activeLabel === 0) {
      if (this.state.activeTool === 'erase') {
          if (!this.state.segVolume) return; // Erasing nothing is fine
      } else {
          if (typeof this.state.onLabelRequired === 'function') {
            const success = this.state.onLabelRequired();
            if (!success) return;
          } else {
            console.warn('[NextEd] Paint ignored: no label selected.');
            return;
          }
      }
    }
    if (!this.state.segVolume) return; // Guard for erase
    
    const rect = this.canvas.getBoundingClientRect();
    const cssX = e.clientX - rect.left;
    const cssY = e.clientY - rect.top;

    const { cursorUpdates } = canvasToVoxel(
      cssX, cssY, this.axis,
      { width: this.canvas.width, clientWidth: this.canvas.clientWidth },
      { height: this.canvas.height, clientHeight: this.canvas.clientHeight },
      this.dims
    );

    const [cx, cy, cz] = this.state.cursor;
    const targetX = cursorUpdates[0] !== undefined ? cursorUpdates[0] : cx;
    const targetY = cursorUpdates[1] !== undefined ? cursorUpdates[1] : cy;
    const targetZ = cursorUpdates[2] !== undefined ? cursorUpdates[2] : cz;

    let targetDepth, uCenter, vCenter;
    
    if (this.axis === 'axial') {
      targetDepth = targetZ; uCenter = targetX; vCenter = targetY;
    } else if (this.axis === 'coronal') {
      targetDepth = targetY; uCenter = targetX; vCenter = targetZ;
    } else {
      targetDepth = targetX; uCenter = targetY; vCenter = targetZ;
    }

    const { brushRadius, multiSlice, paintConstraintMin, paintConstraintMax, activeTool, activeLabel } = this.state;
    const [dimX, dimY, dimZ] = this.dims;
    const R2 = brushRadius * brushRadius;
    const sliceRange = Math.floor((multiSlice - 1) / 2); // 1→0, 3→1, 5→2, etc.
    let modified = false;

    const depthMax = this.axis === 'axial' ? dimZ : (this.axis === 'coronal' ? dimY : dimX);
    const uMax = this.axis === 'sagittal' ? dimY : dimX;
    const vMax = this.axis === 'axial' ? dimY : dimZ;

    const minDepth = Math.max(0, targetDepth - sliceRange);
    const maxDepth = Math.min(depthMax - 1, targetDepth + sliceRange);
    
    const minU = Math.max(0, uCenter - brushRadius);
    const maxU = Math.min(uMax - 1, uCenter + brushRadius);
    const minV = Math.max(0, vCenter - brushRadius);
    const maxV = Math.min(vMax - 1, vCenter + brushRadius);

    for (let d = minDepth; d <= maxDepth; d++) {
      for (let v = minV; v <= maxV; v++) {
        for (let u = minU; u <= maxU; u++) {
          const dist2 = (u - uCenter) * (u - uCenter) + (v - vCenter) * (v - vCenter);
          if (dist2 <= R2) {
            let x, y, z;
            if (this.axis === 'axial') { z = d; x = u; y = v; }
            else if (this.axis === 'coronal') { y = d; x = u; z = v; }
            else { x = d; y = u; z = v; }

            const idx = z * (dimX * dimY) + y * dimX + x;
            const val = this.volume[idx];
            
            if (val >= paintConstraintMin && val <= paintConstraintMax) {
              const newVal = activeTool === 'paint' ? activeLabel : 0;
              const currentVal = this.state.segVolume[idx];
              if (currentVal !== newVal) {
                if (this._currentDiff && !this._currentDiff.seen.has(idx)) {
                  this._currentDiff.indices.push(idx);
                  this._currentDiff.oldValues.push(currentVal);
                  this._currentDiff.seen.add(idx);
                }
                this.state.segVolume[idx] = newVal;
                modified = true;
              }
            }
          }
        }
      }
    }

    if (modified) {
      this.state.notify();
    }
  }

  /**
   * Initialize a Region Grow session from a canvas click event.
   */
  _startRegionGrow(e) {
    if (!this.state.segVolume || this.state.activeLabel === 0) {
      if (typeof this.state.onLabelRequired === 'function') {
        const success = this.state.onLabelRequired();
        if (!success) return;
      } else {
        console.warn('[NextEd] Region grow ignored: no active label.');
        return;
      }
    }
    if (!this.volume) return;

    const rect = this.canvas.getBoundingClientRect();
    const cssX = e.clientX - rect.left;
    const cssY = e.clientY - rect.top;

    const { cursorUpdates } = canvasToVoxel(
      cssX, cssY, this.axis,
      { width: this.canvas.width, clientWidth: this.canvas.clientWidth },
      { height: this.canvas.height, clientHeight: this.canvas.clientHeight },
      this.dims
    );

    const [cx, cy, cz] = this.state.cursor;
    const targetX = cursorUpdates[0] !== undefined ? cursorUpdates[0] : cx;
    const targetY = cursorUpdates[1] !== undefined ? cursorUpdates[1] : cy;
    const targetZ = cursorUpdates[2] !== undefined ? cursorUpdates[2] : cz;

    // Calculate 5x5 mean in the current viewing plane
    let sum = 0;
    let count = 0;
    const [dimX, dimY, dimZ] = this.dims;

    let uCenter, vCenter, fixedDepth;
    if (this.axis === 'axial') {
      uCenter = targetX; vCenter = targetY; fixedDepth = targetZ;
    } else if (this.axis === 'coronal') {
      uCenter = targetX; vCenter = targetZ; fixedDepth = targetY;
    } else {
      uCenter = targetY; vCenter = targetZ; fixedDepth = targetX;
    }

    for (let u = uCenter - 2; u <= uCenter + 2; u++) {
      for (let v = vCenter - 2; v <= vCenter + 2; v++) {
        let x, y, z;
        if (this.axis === 'axial') { x = u; y = v; z = fixedDepth; }
        else if (this.axis === 'coronal') { x = u; y = fixedDepth; z = v; }
        else { x = fixedDepth; y = u; z = v; }

        if (x >= 0 && x < dimX && y >= 0 && y < dimY && z >= 0 && z < dimZ) {
          const idx = z * dimX * dimY + y * dimX + x;
          sum += this.volume[idx];
          count++;
        }
      }
    }

    const mean = count > 0 ? sum / count : 0;

    // Save previous diff (if any applied and committed)
    if (this._currentDiff) {
      delete this._currentDiff.seen;
      this.state.pushUndo(this._currentDiff);
      this._currentDiff = null;
    }

    // Set state
    this.state.regionGrowSeed = [targetX, targetY, targetZ];
    this.state.regionGrowMean = mean;
    this.state.regionGrowAxis = this.axis;
    this.state.executeRegionGrow = () => this._applyRegionGrow();

    // Check if label already has saved bounds
    const label = this.state.labels.get(this.state.activeLabel);
    if (!label || label.regionGrowMin === undefined || label.regionGrowMax === undefined) {
      // Default range (mean ± 50, adjustable by user later)
      this.state.setRegionGrowRange(mean - 50, mean + 50);
    }
    
    // The apply function reads the latest regionGrowMin/Max from state
    this._applyRegionGrow();
  }

  /**
   * Apply Region Grow with current state parameters
   */
  _applyRegionGrow() {
    if (!this.state.regionGrowSeed || !this.volume || !this.state.segVolume) return;
    
    // 1. Revert previous _currentDiff if it exists, so we start fresh from the seed
    if (this._currentDiff) {
      for (let i = 0; i < this._currentDiff.indices.length; i++) {
        this.state.segVolume[this._currentDiff.indices[i]] = this._currentDiff.oldValues[i];
      }
    }
    
    const [sx, sy, sz] = this.state.regionGrowSeed;
    const { regionGrowMin, regionGrowMax, activeLabel, multiSlice } = this.state;
    const [dimX, dimY, dimZ] = this.dims;
    const sliceRange = Math.floor((multiSlice - 1) / 2);

    // Compute depth bounds based on axis
    let minD, maxD;
    if (this.axis === 'axial') { minD = Math.max(0, sz - sliceRange); maxD = Math.min(dimZ - 1, sz + sliceRange); }
    else if (this.axis === 'coronal') { minD = Math.max(0, sy - sliceRange); maxD = Math.min(dimY - 1, sy + sliceRange); }
    else { minD = Math.max(0, sx - sliceRange); maxD = Math.min(dimX - 1, sx + sliceRange); }

    const visited = new Uint8Array(dimX * dimY * dimZ);
    const q = [[sx, sy, sz]];
    let head = 0; // index in q for pseudo-queue
    const newDiff = { indices: [], oldValues: [] };

    const startIdx = sz * dimX * dimY + sy * dimX + sx;
    visited[startIdx] = 1;

    // 6-connectivity neighbors
    const neighbors = [
        [1, 0, 0], [-1, 0, 0],
        [0, 1, 0], [0, -1, 0],
        [0, 0, 1], [0, 0, -1]
    ];

    while (head < q.length) {
        const [cx, cy, cz] = q[head++];
        const idx = cz * dimX * dimY + cy * dimX + cx;
        const val = this.volume[idx];

        if (val >= regionGrowMin && val <= regionGrowMax) {
            newDiff.indices.push(idx);
            newDiff.oldValues.push(this.state.segVolume[idx]);
            this.state.segVolume[idx] = activeLabel;

            for (const [dx, dy, dz] of neighbors) {
                const nx = cx + dx;
                const ny = cy + dy;
                const nz = cz + dz;

                if (nx >= 0 && nx < dimX && ny >= 0 && ny < dimY && nz >= 0 && nz < dimZ) {
                    let depthOut = false;
                    if (this.axis === 'axial' && (nz < minD || nz > maxD)) depthOut = true;
                    if (this.axis === 'coronal' && (ny < minD || ny > maxD)) depthOut = true;
                    if (this.axis === 'sagittal' && (nx < minD || nx > maxD)) depthOut = true;

                    if (!depthOut) {
                        const nIdx = nz * dimX * dimY + ny * dimX + nx;
                        if (!visited[nIdx]) {
                            visited[nIdx] = 1;
                            q.push([nx, ny, nz]);
                        }
                    }
                }
            }
        }
    }

    this._currentDiff = newDiff;
    this.state.notify();
  }

  /**
   * Load volume data for rendering.
   * @param {Float32Array} volume
   * @param {number[]} dims - [dimX, dimY, dimZ]
   * @param {number[]} spacing - [spX, spY, spZ]
   */
  setVolume(volume, dims, spacing) {
    this.volume = volume;
    this.dims = dims;
    this.spacing = spacing;

    // Set canvas to native voxel dimensions for this axis
    const [w, h] = this._getSliceDims();
    this.canvas.width = w;
    this.canvas.height = h;
    this.ctx.imageSmoothingEnabled = false;

    // Pre-allocate ImageData
    this.imageData = new ImageData(w, h);

    // Set slider range
    const maxSlice = this._getMaxSlice();
    this.slider.max = String(maxSlice);
    this.slider.setAttribute('aria-valuemax', String(maxSlice));
    this.slider.value = String(this._getCurrentSlice());

    this.updateDisplaySize();
    this.render();
  }

  /**
   * Get the 2D dimensions of a slice for this axis.
   * @returns {[number, number]} [width, height]
   */
  _getSliceDims() {
    if (!this.dims) return [1, 1];
    const [dimX, dimY, dimZ] = this.dims;
    if (this.axis === 'axial') return [dimX, dimY];
    if (this.axis === 'coronal') return [dimX, dimZ];
    return [dimY, dimZ]; // sagittal
  }

  /**
   * Get the spacing for the horizontal and vertical axes of this slice.
   * @returns {[number, number]} [spacingH, spacingV]
   */
  _getSliceSpacing() {
    if (!this.spacing) return [1, 1];
    const [spX, spY, spZ] = this.spacing;
    if (this.axis === 'axial') return [spX, spY];
    if (this.axis === 'coronal') return [spX, spZ];
    return [spY, spZ]; // sagittal
  }

  /**
   * Get the maximum valid slice index for this axis.
   * @returns {number}
   */
  _getMaxSlice() {
    if (!this.dims) return 0;
    const [dimX, dimY, dimZ] = this.dims;
    if (this.axis === 'axial') return dimZ - 1;
    if (this.axis === 'coronal') return dimY - 1;
    return dimX - 1; // sagittal
  }

  /**
   * Get the current slice index from state cursor for this axis.
   * @returns {number}
   */
  _getCurrentSlice() {
    if (this.axis === 'axial') return this.state.cursor[2];
    if (this.axis === 'coronal') return this.state.cursor[1];
    return this.state.cursor[0]; // sagittal
  }

  /**
   * Compute CSS display size to correct for anisotropic voxel spacing.
   */
  updateDisplaySize() {
    if (!this.dims || !this.spacing) return;

    const [sliceW, sliceH] = this._getSliceDims();
    const [spH, spV] = this._getSliceSpacing();

    // Physical dimensions in mm
    const physicalW = sliceW * spH;
    const physicalH = sliceH * spV;
    const aspectRatio = physicalW / physicalH;

    // Available display space (container minus label bar and slider)
    const containerW = this.canvasContainer.clientWidth - 20; // slider width
    const containerH = this.canvasContainer.clientHeight;

    if (containerW <= 0 || containerH <= 0) return;

    let displayW, displayH;
    const containerAspect = containerW / containerH;

    if (aspectRatio > containerAspect) {
      // Width-constrained
      displayW = containerW;
      displayH = containerW / aspectRatio;
    } else {
      // Height-constrained
      displayH = containerH;
      displayW = containerH * aspectRatio;
    }

    this.canvas.style.width = `${Math.floor(displayW)}px`;
    this.canvas.style.height = `${Math.floor(displayH)}px`;
  }

  /**
   * Render the current slice to the canvas, then draw crosshair lines.
   */
  render() {
    if (!this.volume || !this.dims || !this.imageData) return;

    const sliceIndex = this._getCurrentSlice();
    const [dimX, dimY, dimZ] = this.dims;

    // Extract the 2D slice
    let sliceData;
    if (this.axis === 'axial') {
      sliceData = extractAxialSlice(this.volume, sliceIndex, dimX, dimY);
    } else if (this.axis === 'coronal') {
      sliceData = extractCoronalSlice(this.volume, sliceIndex, dimX, dimY, dimZ);
    } else {
      sliceData = extractSagittalSlice(this.volume, sliceIndex, dimX, dimY, dimZ);
    }

    // Apply window/level
    applyWindowLevel(
      sliceData,
      this.imageData.data,
      this.state.windowCenter,
      this.state.windowWidth
    );

    if (this.state.segVolume && this.state.colorLUT && this.state.overlayOpacity > 0) {
      const segSlice = this._extractSegSlice(sliceIndex);
      blendSegmentationOverlay(segSlice, this.imageData.data, this.state.colorLUT, this.state.overlayOpacity);
    }

    // Draw to canvas
    this.ctx.putImageData(this.imageData, 0, 0);

    // Draw crosshair lines AFTER putImageData
    this._drawCrosshairs();

    // Update readout and slider
    const maxSlice = this._getMaxSlice();
    this.sliceReadout.textContent = `${sliceIndex}/${maxSlice}`;
    this.slider.value = String(sliceIndex);
    this.slider.setAttribute('aria-valuenow', String(sliceIndex));
  }

  _extractSegSlice(sliceIndex) {
    const [dimX, dimY, dimZ] = this.dims;
    if (this.axis === 'axial') {
      return extractAxialSegSlice(this.state.segVolume, sliceIndex, dimX, dimY);
    } else if (this.axis === 'coronal') {
      return extractCoronalSegSlice(this.state.segVolume, sliceIndex, dimX, dimY, dimZ);
    } else {
      return extractSagittalSegSlice(this.state.segVolume, sliceIndex, dimX, dimY, dimZ);
    }
  }

  /**
   * Draw crosshair lines on the canvas at the current cursor position.
   */
  _drawCrosshairs() {
    const ctx = this.ctx;
    const [w, h] = this._getSliceDims();
    const color = CROSSHAIR_COLORS[this.axis];

    let crossX, crossY;
    if (this.axis === 'axial') {
      // X-flipped (right on left), Y-flipped (anterior at top)
      crossX = this.dims[0] - 1 - this.state.cursor[0];
      crossY = this.dims[1] - 1 - this.state.cursor[1];
    } else if (this.axis === 'coronal') {
      // X-flipped (right on left), Z-flipped (superior at top)
      crossX = this.dims[0] - 1 - this.state.cursor[0];
      crossY = this.dims[2] - 1 - this.state.cursor[2];
    } else {
      // Y-flipped (anterior on left), Z-flipped (superior at top)
      crossX = this.dims[1] - 1 - this.state.cursor[1];
      crossY = this.dims[2] - 1 - this.state.cursor[2];
    }

    ctx.save();
    ctx.globalAlpha = 0.8;
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;

    // Vertical line at crossX
    ctx.beginPath();
    ctx.moveTo(crossX + 0.5, 0);
    ctx.lineTo(crossX + 0.5, h);
    ctx.stroke();

    // Horizontal line at crossY
    ctx.beginPath();
    ctx.moveTo(0, crossY + 0.5);
    ctx.lineTo(w, crossY + 0.5);
    ctx.stroke();

    ctx.restore();
  }

  /**
   * Clean up resources.
   */
  destroy() {
    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
    }
    if (this._onMouseMove) {
      document.removeEventListener('mousemove', this._onMouseMove);
    }
    if (this._onMouseUp) {
      document.removeEventListener('mouseup', this._onMouseUp);
    }
  }
}
