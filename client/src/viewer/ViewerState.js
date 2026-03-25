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
   */
  constructor({ dims, spacing, modality, windowCenter, windowWidth }) {
    this.dims = dims;
    this.spacing = spacing;
    this.modality = modality;

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
      fn(this);
    }
  }
}
