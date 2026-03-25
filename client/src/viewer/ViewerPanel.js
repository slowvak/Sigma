/**
 * ViewerPanel — renders a single plane (axial, coronal, or sagittal)
 * with canvas, orientation labels, slice slider, and label bar.
 */
import { extractAxialSlice, extractCoronalSlice, extractSagittalSlice } from './sliceExtractor.js';
import { applyWindowLevel } from './windowLevel.js';

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

    this._buildDOM();
    this._setupResizeObserver();
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
    // Toggle button wired in Plan 03 (single-view mode)
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

  _setupResizeObserver() {
    this.resizeObserver = new ResizeObserver(() => {
      if (this.volume) {
        this.updateDisplaySize();
        this.render();
      }
    });
    this.resizeObserver.observe(this.canvasContainer);
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
   * Render the current slice to the canvas.
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

    // Draw to canvas
    this.ctx.putImageData(this.imageData, 0, 0);

    // Update readout and slider
    const maxSlice = this._getMaxSlice();
    this.sliceReadout.textContent = `${sliceIndex}/${maxSlice}`;
    this.slider.value = String(sliceIndex);
    this.slider.setAttribute('aria-valuenow', String(sliceIndex));
  }

  /**
   * Clean up resources.
   */
  destroy() {
    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
    }
  }
}
