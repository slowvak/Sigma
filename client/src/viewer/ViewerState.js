import { discoverLabels, findLowestUnusedValue, reassignLabelValue } from './labelManager.js';
import { buildColorLUT } from './overlayBlender.js';

/**
 * ViewerState — shared state for the multi-plane medical image viewer.
 * Holds cursor position [x,y,z], window/level, volume metadata, and
 * notifies subscribers on state changes.
 */
export class ViewerState {
  /**
   * @param {Object} options
   * @param {number[]} options.dims - Volume dimensions [dimX, dimY, dimZ]
   * @param {number[]} options.spacing - Voxel spacing [spX, spY, spZ] in mm
   * @param {string} options.modality - "CT", "MR", or "unknown"
   * @param {number} options.windowCenter - Initial window center (level)
   * @param {number} options.windowWidth - Initial window width
   * @param {number|null} [options.dataMin] - Minimum voxel value in the volume
   * @param {number|null} [options.dataMax] - Maximum voxel value in the volume
   */
  constructor({ dims, spacing, modality, windowCenter, windowWidth, dataMin = null, dataMax = null }) {
    this.dims = dims;
    this.spacing = spacing;
    this.modality = modality;
    this.dataMin = dataMin;
    this.dataMax = dataMax;

    // Raw image volume — Float32Array set after loading
    this.volume = null;

    // Start at center slice of each dimension (VIEW-02)
    this.cursor = [
      Math.floor(dims[0] / 2),
      Math.floor(dims[1] / 2),
      Math.floor(dims[2] / 2),
    ];

    this.windowCenter = windowCenter;
    this.windowWidth = Math.max(1, windowWidth);
    this.activePreset = null;
    this.singleView = null; // 'axial' | 'coronal' | 'sagittal' | null

    // Cursor voxel intensity — updated by ViewerPanel on mouse hover
    this.cursorValue = null;

    /** @type {Array<function(number|null): void>} */
    this.cursorValueListeners = [];

    // Tools state
    this.activeTool = 'crosshair';
    this.brushRadius = 2;
    this.multiSlice = 1; // Odd number: 1=current only, 3=current±1, 5=current±2, etc.
    this.paintConstraintMin = -1024;
    this.paintConstraintMax = 3000;

    // Segmentation state
    this.segVolume = null;          // Uint8Array — full segmentation volume
    this.segDims = null;            // [dimX, dimY, dimZ] — must match volume dims
    this.labels = new Map();        // Map<number, {name, value, color:{r,g,b}}>
    this.activeLabel = 0;           // Currently selected label value
    this.overlayOpacity = 0.5;      // 0.0-1.0 (default 50% per D-09)
    this.colorLUT = null;           // Uint8Array(768) — built from labels
    this.undoStack = [];            // Array of diffs { indices: [], oldValues: [] }

    // Oblique state
    this.obliqueTilt = 0;           // Radians, tilt away from axial plane
    this.obliqueAzimuth = 0;        // Radians, azimuth of tilt axis in axial plane

    // Region Grow state
    this.regionGrowSeed = null;     // [x, y, z]
    this.regionGrowMean = null;
    this.regionGrowMin = -1024;
    this.regionGrowMax = 3000;
    this.regionGrowAxis = null;     // 'axial' | 'coronal' | 'sagittal'
    this.executeRegionGrow = null;  // Callback set by active ViewerPanel

    /** @type {Array<function(ViewerState): void>} */
    this.listeners = [];
  }

  /**
   * Set cursor position, clamping each axis to [0, dims[i]-1].
   * @param {number} x
   * @param {number} y
   * @param {number} z
   */
  setCursor(x, y, z) {
    this.cursor = [
      Math.max(0, Math.min(Math.floor(x), this.dims[0] - 1)),
      Math.max(0, Math.min(Math.floor(y), this.dims[1] - 1)),
      Math.max(0, Math.min(Math.floor(z), this.dims[2] - 1)),
    ];
    this.notify();
  }

  /**
   * Set the raw voxel intensity value at the current hover position.
   * Fires only the lightweight cursorValueListeners, NOT the full notify(),
   * to avoid triggering slice re-renders on every mouse move.
   * @param {number|null} value - Raw voxel intensity, or null if outside volume
   */
  setCursorValue(value) {
    this.cursorValue = value;
    for (const fn of this.cursorValueListeners) {
      fn(value);
    }
  }

  /**
   * Subscribe to cursor value changes only (no re-render triggered).
   * @param {function(number|null): void} fn
   * @returns {function(): void} Unsubscribe function
   */
  subscribeCursorValue(fn) {
    this.cursorValueListeners.push(fn);
    return () => {
      const idx = this.cursorValueListeners.indexOf(fn);
      if (idx !== -1) this.cursorValueListeners.splice(idx, 1);
    };
  }

  /**
   * Set window/level values. Clears active preset.
   * @param {number} center - Window center (level)
   * @param {number} width - Window width (must be >= 1)
   */
  setWindowLevel(center, width) {
    this.windowCenter = center;
    this.windowWidth = Math.max(1, width);
    this.activePreset = null;
    this.notify();
  }

  /**
   * Set window/level from a named preset. Unlike setWindowLevel,
   * this preserves the activePreset name.
   * @param {string} name - Preset name (e.g., "Brain", "Bone")
   * @param {number} center - Window center
   * @param {number} width - Window width
   */
  setPreset(name, center, width) {
    this.windowCenter = center;
    this.windowWidth = Math.max(1, width);
    this.activePreset = name;
    this.notify();
  }

  setSegmentation(segVolume, segDims, apiLabels = []) {
    if (this.dims[0] !== segDims[0] || this.dims[1] !== segDims[1] || this.dims[2] !== segDims[2]) {
      throw new Error(`Segmentation dimensions [${segDims}] do not match volume dimensions [${this.dims}]`);
    }
    this.segVolume = segVolume;
    this.segDims = segDims;
    this.labels = discoverLabels(segVolume, apiLabels);
    this.colorLUT = buildColorLUT(this.labels);
    // Auto-select first non-background label if any exist
    this.activeLabel = 0;
    for (const [val] of this.labels) {
      if (val !== 0) { this.activeLabel = val; break; }
    }
    this.notify();
  }

  setOverlayOpacity(opacity) {
    this.overlayOpacity = Math.max(0, Math.min(1, opacity));
    this.notify();
  }

  setActiveTool(tool) {
    this.activeTool = tool;
    if (tool !== 'region-grow') {
      this.regionGrowSeed = null;
      this.regionGrowMean = null;
      this.executeRegionGrow = null;
    }
    this.notify();
  }

  setBrushRadius(radius) {
    this.brushRadius = Math.max(1, radius);
    this.notify();
  }

  setMultiSlice(depth) {
    // Ensure odd: round up to next odd number, minimum 1
    depth = Math.max(1, depth);
    if (depth % 2 === 0) depth += 1;
    this.multiSlice = depth;
    this.notify();
  }

  setPaintConstraints(min, max) {
    this.paintConstraintMin = min;
    this.paintConstraintMax = max;
    this.notify();
  }

  setObliqueTilt(tilt) {
    this.obliqueTilt = tilt;
    this.notify();
  }

  setObliqueAzimuth(azimuth) {
    this.obliqueAzimuth = azimuth;
    this.notify();
  }

  setRegionGrowRange(min, max) {
    this.regionGrowMin = min;
    this.regionGrowMax = max;
    const label = this.labels.get(this.activeLabel);
    if (label) {
      label.regionGrowMin = min;
      label.regionGrowMax = max;
    }
    this.notify();
  }

  toggleLabelVisibility(value) {
    const label = this.labels.get(value);
    if (!label) return;
    label.isVisible = label.isVisible === undefined ? false : !label.isVisible;
    this.colorLUT = buildColorLUT(this.labels);
    this.notify();
  }

  setActiveLabel(value) {
    this.activeLabel = value;
    const label = this.labels.get(value);
    if (label && label.regionGrowMin !== undefined && label.regionGrowMax !== undefined) {
      this.regionGrowMin = label.regionGrowMin;
      this.regionGrowMax = label.regionGrowMax;
    }
    this.notify();
  }

  pushUndo(diff) {
    if (!diff || !diff.indices || diff.indices.length === 0) return;
    this.undoStack.push(diff);
    if (this.undoStack.length > 3) {
      this.undoStack.shift(); // Cap at length 3
    }
    this.notify();
  }

  undo() {
    if (this.undoStack.length === 0 || !this.segVolume) return;
    const diff = this.undoStack.pop();
    for (let i = 0; i < diff.indices.length; i++) {
      this.segVolume[diff.indices[i]] = diff.oldValues[i];
    }
    this.notify();
  }

  addLabel(name, color) {
    const value = findLowestUnusedValue(this.labels);
    if (value === null) return null;
    this.labels.set(value, { name, value, color, isVisible: true });
    this.colorLUT = buildColorLUT(this.labels);
    this.notify();
    return value;
  }

  updateLabel(oldValue, newProps) {
    const label = this.labels.get(oldValue);
    if (!label) return;
    const newValue = newProps.value !== undefined ? newProps.value : oldValue;
    if (newValue !== oldValue && this.labels.has(newValue)) {
      throw new Error(`Label value ${newValue} is already in use`);
    }
    const updated = {
      name: newProps.name !== undefined ? newProps.name : label.name,
      value: newValue,
      color: newProps.color !== undefined ? newProps.color : label.color,
      isVisible: newProps.isVisible !== undefined ? newProps.isVisible : (label.isVisible !== undefined ? label.isVisible : true),
    };
    if (newValue !== oldValue) {
      reassignLabelValue(this.segVolume, oldValue, newValue);
      this.labels.delete(oldValue);
      if (this.activeLabel === oldValue) this.activeLabel = newValue;
    }
    this.labels.set(newValue, updated);
    this.colorLUT = buildColorLUT(this.labels);
    this.notify();
  }

  /**
   * Subscribe to state changes.
   * @param {function(ViewerState): void} fn - Callback
   * @returns {function(): void} Unsubscribe function
   */
  subscribe(fn) {
    this.listeners.push(fn);
    return () => {
      const idx = this.listeners.indexOf(fn);
      if (idx !== -1) this.listeners.splice(idx, 1);
    };
  }

  /**
   * Notify all subscribers of a state change.
   */
  notify() {
    for (const fn of this.listeners) {
      try {
        fn(this);
      } catch (err) {
        console.error('[ViewerState] Listener threw:', err);
      }
    }
  }
}
