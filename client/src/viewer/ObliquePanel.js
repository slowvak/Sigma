/**
 * ObliquePanel — renders an oblique (tilted) slice in the lower-right quadrant.
 * Starts as a copy of the axial view. The user tilts it via rotation handles
 * on the orthogonal panels. Supports crosshair, paint, erase, and region grow.
 */
import { extractObliqueSlice, extractObliqueSegSlice, obliqueCanvasToVoxel, getObliqueVectors } from './obliqueExtractor.js';
import { applyWindowLevel, computeWLDrag } from './windowLevel.js';
import { blendSegmentationOverlay } from './overlayBlender.js';

const OBLIQUE_COLOR = '#ff00ff';

export class ObliquePanel {
  constructor({ container, state }) {
    this.container = container;
    this.state = state;
    this.volume = null;
    this.dims = null;
    this.spacing = null;
    this.imageData = null;
    this.ctx = null;

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

    const labelBar = document.createElement('div');
    labelBar.className = 'panel-label-bar';

    const panelName = document.createElement('span');
    panelName.className = 'panel-name';
    panelName.textContent = 'Oblique';
    labelBar.appendChild(panelName);

    this.angleReadout = document.createElement('span');
    this.angleReadout.className = 'slice-readout';
    this.angleReadout.textContent = '0\u00B0';
    labelBar.appendChild(this.angleReadout);

    this.sliceReadout = document.createElement('span');
    this.sliceReadout.className = 'slice-readout';
    this.sliceReadout.textContent = '';
    labelBar.appendChild(this.sliceReadout);

    const spacer = document.createElement('div');
    spacer.style.flex = '1';
    labelBar.appendChild(spacer);

    this.toggleBtn = document.createElement('button');
    this.toggleBtn.className = 'panel-toggle-btn';
    this.toggleBtn.textContent = 'O';
    this.toggleBtn.setAttribute('aria-label', 'Toggle oblique single view');
    labelBar.appendChild(this.toggleBtn);

    this.container.appendChild(labelBar);

    const canvasContainer = document.createElement('div');
    canvasContainer.className = 'canvas-container';

    this.canvas = document.createElement('canvas');
    this.canvas.style.imageRendering = 'pixelated';
    this.canvas.setAttribute('role', 'img');
    this.canvas.setAttribute('aria-label', 'Oblique view of loaded volume');
    canvasContainer.appendChild(this.canvas);
    this.ctx = this.canvas.getContext('2d');

    // Slice slider (controls Z, same as axial)
    this.slider = document.createElement('input');
    this.slider.type = 'range';
    this.slider.className = 'slice-slider';
    this.slider.min = '0';
    this.slider.max = '0';
    this.slider.step = '1';
    this.slider.value = '0';
    this.slider.setAttribute('aria-label', 'Oblique depth');

    this.slider.addEventListener('input', () => {
      const val = parseInt(this.slider.value, 10);
      const [cx, cy] = this.state.cursor;
      this.state.setCursor(cx, cy, val);
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

  _setupEventHandlers() {
    this.canvas.addEventListener('contextmenu', (e) => e.preventDefault());

    this.canvas.addEventListener('mousedown', (e) => {
      if (!this.volume) return;

      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        this._isDraggingWL = true;
        this._lastWLX = e.clientX;
        this._lastWLY = e.clientY;
        this.canvas.style.cursor = 'grab';
      } else if (this.state.activeTool === 'paint') {
        e.preventDefault();
        // Ensure label/segVolume exist BEFORE starting paint drag.
        // Label 0 = erase, so only prompt when no labels exist at all.
        if (!this.state.segVolume && this.state.activeLabel !== 0) {
          if (typeof this.state.onLabelRequired === 'function') {
            this.state.onLabelRequired();
          }
          return;
        }
        if (!this.state.segVolume) return;
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
        this._isDraggingCrosshair = true;
        this._updateCrosshairFromMouse(e);
      }
    });

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
        const diff = this._currentDiff;
        this._currentDiff = null; // null BEFORE pushUndo to prevent re-entrancy
        delete diff.seen;
        this.state.pushUndo(diff);
      }
    });

    // Hover: pixel value readout
    this.canvas.addEventListener('mousemove', (e) => {
      if (!this.volume || !this.dims) return;
      if (this.canvas.clientWidth <= 0 || this.canvas.clientHeight <= 0) return;
      const rect = this.canvas.getBoundingClientRect();
      const cssX = e.clientX - rect.left;
      const cssY = e.clientY - rect.top;
      const vu = cssX * (this.canvas.width / this.canvas.clientWidth);
      const vv = cssY * (this.canvas.height / this.canvas.clientHeight);
      const [x, y, z] = obliqueCanvasToVoxel(
        vu, vv, this.state.cursor,
        this.state.obliqueTilt, this.state.obliqueAzimuth,
        this.canvas.width, this.canvas.height
      );
      const [dimX, dimY, dimZ] = this.dims;
      const xi = Math.round(x), yi = Math.round(y), zi = Math.round(z);
      if (xi >= 0 && xi < dimX && yi >= 0 && yi < dimY && zi >= 0 && zi < dimZ) {
        this.state.setCursorValue(this.volume[zi * dimX * dimY + yi * dimX + xi]);
      } else {
        this.state.setCursorValue(null);
      }
    });

    this.canvas.addEventListener('mouseleave', () => {
      this.state.setCursorValue(null);
    });

    // Scroll: move cursor along oblique normal
    this.canvas.addEventListener('wheel', (e) => {
      if (!this.volume) return;
      e.preventDefault();
      const { normal } = getObliqueVectors(this.state.obliqueTilt, this.state.obliqueAzimuth);
      const [cx, cy, cz] = this.state.cursor;
      const delta = e.deltaY > 0 ? -1 : 1;
      this.state.setCursor(
        Math.round(cx + delta * normal[0]),
        Math.round(cy + delta * normal[1]),
        Math.round(cz + delta * normal[2]),
      );
    }, { passive: false });
  }

  _updateCrosshairFromMouse(e) {
    const rect = this.canvas.getBoundingClientRect();
    const cssX = e.clientX - rect.left;
    const cssY = e.clientY - rect.top;
    const vu = cssX * (this.canvas.width / this.canvas.clientWidth);
    const vv = cssY * (this.canvas.height / this.canvas.clientHeight);
    const [x, y, z] = obliqueCanvasToVoxel(
      vu, vv, this.state.cursor,
      this.state.obliqueTilt, this.state.obliqueAzimuth,
      this.canvas.width, this.canvas.height
    );
    this.state.setCursor(Math.floor(x), Math.floor(y), Math.floor(z));
  }

  _applyBrush(e) {
    if (!this.state.segVolume) return;

    const rect = this.canvas.getBoundingClientRect();
    const cssX = e.clientX - rect.left;
    const cssY = e.clientY - rect.top;
    const centerU = cssX * (this.canvas.width / this.canvas.clientWidth);
    const centerV = cssY * (this.canvas.height / this.canvas.clientHeight);

    const { brushRadius, multiSlice, paintConstraintMin, paintConstraintMax, activeTool, activeLabel } = this.state;
    const { normal } = getObliqueVectors(this.state.obliqueTilt, this.state.obliqueAzimuth);
    const [dimX, dimY, dimZ] = this.dims;
    const R2 = brushRadius * brushRadius;
    const sliceRange = Math.floor((multiSlice - 1) / 2);
    let modified = false;

    for (let dv = -brushRadius; dv <= brushRadius; dv++) {
      for (let du = -brushRadius; du <= brushRadius; du++) {
        if (du * du + dv * dv > R2) continue;
        for (let d = -sliceRange; d <= sliceRange; d++) {
          const [bx, by, bz] = obliqueCanvasToVoxel(
            centerU + du, centerV + dv, this.state.cursor,
            this.state.obliqueTilt, this.state.obliqueAzimuth,
            this.canvas.width, this.canvas.height
          );
          const x = Math.round(bx + d * normal[0]);
          const y = Math.round(by + d * normal[1]);
          const z = Math.round(bz + d * normal[2]);

          if (x < 0 || x >= dimX || y < 0 || y >= dimY || z < 0 || z >= dimZ) continue;
          const idx = z * dimX * dimY + y * dimX + x;
          const val = this.volume[idx];
          if (val < paintConstraintMin || val > paintConstraintMax) continue;

          const newVal = activeLabel;
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

    if (modified) this.state.notify();
  }

  _startRegionGrow(e) {
    if (!this.state.segVolume || this.state.activeLabel === 0) {
      if (typeof this.state.onLabelRequired === 'function') {
        if (!this.state.onLabelRequired()) return;
      } else {
        return;
      }
    }
    if (!this.volume) return;

    const rect = this.canvas.getBoundingClientRect();
    const cssX = e.clientX - rect.left;
    const cssY = e.clientY - rect.top;
    const vu = cssX * (this.canvas.width / this.canvas.clientWidth);
    const vv = cssY * (this.canvas.height / this.canvas.clientHeight);

    const [sx, sy, sz] = obliqueCanvasToVoxel(
      vu, vv, this.state.cursor,
      this.state.obliqueTilt, this.state.obliqueAzimuth,
      this.canvas.width, this.canvas.height
    ).map(Math.floor);

    const [dimX, dimY, dimZ] = this.dims;
    if (sx < 0 || sx >= dimX || sy < 0 || sy >= dimY || sz < 0 || sz >= dimZ) return;

    // 5x5 mean around seed
    let sum = 0, count = 0;
    for (let u = -2; u <= 2; u++) {
      for (let v = -2; v <= 2; v++) {
        const [px, py, pz] = obliqueCanvasToVoxel(
          vu + u, vv + v, this.state.cursor,
          this.state.obliqueTilt, this.state.obliqueAzimuth,
          this.canvas.width, this.canvas.height
        ).map(Math.floor);
        if (px >= 0 && px < dimX && py >= 0 && py < dimY && pz >= 0 && pz < dimZ) {
          sum += this.volume[pz * dimX * dimY + py * dimX + px];
          count++;
        }
      }
    }
    const mean = count > 0 ? sum / count : 0;

    if (this._currentDiff) {
      delete this._currentDiff.seen;
      this.state.pushUndo(this._currentDiff);
      this._currentDiff = null;
    }

    this.state.regionGrowSeed = [sx, sy, sz];
    this.state.regionGrowMean = mean;
    this.state.regionGrowAxis = 'oblique';
    this.state.executeRegionGrow = () => this._applyRegionGrow();

    const label = this.state.labels.get(this.state.activeLabel);
    if (!label || label.regionGrowMin === undefined || label.regionGrowMax === undefined) {
      this.state.setRegionGrowRange(mean - 50, mean + 50);
    }
    this._applyRegionGrow();
  }

  _applyRegionGrow() {
    if (!this.state.regionGrowSeed || !this.volume || !this.state.segVolume) return;

    if (this._currentDiff) {
      for (let i = 0; i < this._currentDiff.indices.length; i++) {
        this.state.segVolume[this._currentDiff.indices[i]] = this._currentDiff.oldValues[i];
      }
    }

    const [sx, sy, sz] = this.state.regionGrowSeed;
    const { regionGrowMin, regionGrowMax, activeLabel, multiSlice } = this.state;
    const [dimX, dimY, dimZ] = this.dims;
    const sliceRange = Math.floor((multiSlice - 1) / 2);
    const { normal } = getObliqueVectors(this.state.obliqueTilt, this.state.obliqueAzimuth);

    const visited = new Uint8Array(dimX * dimY * dimZ);
    const q = [[sx, sy, sz]];
    let head = 0;
    const newDiff = { indices: [], oldValues: [] };
    visited[sz * dimX * dimY + sy * dimX + sx] = 1;

    const neighbors = [[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]];

    while (head < q.length) {
      const [cx, cy, cz] = q[head++];
      const idx = cz * dimX * dimY + cy * dimX + cx;
      const val = this.volume[idx];

      if (val >= regionGrowMin && val <= regionGrowMax) {
        newDiff.indices.push(idx);
        newDiff.oldValues.push(this.state.segVolume[idx]);
        this.state.segVolume[idx] = activeLabel;

        for (const [dx, dy, dz] of neighbors) {
          const nx = cx + dx, ny = cy + dy, nz = cz + dz;
          if (nx < 0 || nx >= dimX || ny < 0 || ny >= dimY || nz < 0 || nz >= dimZ) continue;
          // Depth constraint along oblique normal
          const dist = (nx - sx) * normal[0] + (ny - sy) * normal[1] + (nz - sz) * normal[2];
          if (Math.abs(dist) > sliceRange + 0.5) continue;
          const nIdx = nz * dimX * dimY + ny * dimX + nx;
          if (!visited[nIdx]) {
            visited[nIdx] = 1;
            q.push([nx, ny, nz]);
          }
        }
      }
    }

    this._currentDiff = newDiff;
    this.state.notify();
  }

  /**
   * Compute canvas pixel dimensions that maintain the axial field of view.
   * Physical FOV stays constant (= dimX*spX × dimY*spY), so the number of
   * canvas pixels adjusts to the effective per-pixel spacing at the current
   * orientation. The CSS display size stays constant → no magnification jumps.
   */
  _computeCanvasDims() {
    const { right, up } = getObliqueVectors(this.state.obliqueTilt, this.state.obliqueAzimuth);
    const [spX, spY, spZ] = this.spacing;

    // Axial physical FOV (reference)
    const fovX = this.dims[0] * spX;
    const fovY = this.dims[1] * spY;

    // Effective spacing per canvas pixel at current orientation
    const spH = Math.sqrt((right[0]*spX)**2 + (right[1]*spY)**2 + (right[2]*spZ)**2);
    const spV = Math.sqrt((up[0]*spX)**2 + (up[1]*spY)**2 + (up[2]*spZ)**2);

    // Pixels needed to cover the same physical FOV
    return [Math.max(1, Math.ceil(fovX / spH)), Math.max(1, Math.ceil(fovY / spV))];
  }

  setVolume(volume, dims, spacing) {
    this.volume = volume;
    this.dims = dims;
    this.spacing = spacing;

    const [w, h] = this._computeCanvasDims();
    this.canvas.width = w;
    this.canvas.height = h;
    this.ctx.imageSmoothingEnabled = false;
    this.imageData = new ImageData(w, h);

    this.slider.max = String(dims[2] - 1);
    this.slider.value = String(this.state.cursor[2]);

    this.updateDisplaySize();
    this.render();
  }

  updateDisplaySize() {
    if (!this.dims || !this.spacing) return;

    const { right, up } = getObliqueVectors(this.state.obliqueTilt, this.state.obliqueAzimuth);
    const [spX, spY, spZ] = this.spacing;

    // Effective pixel spacing: length of right/up vectors in physical space
    const spH = Math.sqrt((right[0]*spX)**2 + (right[1]*spY)**2 + (right[2]*spZ)**2);
    const spV = Math.sqrt((up[0]*spX)**2 + (up[1]*spY)**2 + (up[2]*spZ)**2);

    const physicalW = this.canvas.width * spH;
    const physicalH = this.canvas.height * spV;
    const aspectRatio = physicalW / physicalH;

    const containerW = this.canvasContainer.clientWidth - 20;
    const containerH = this.canvasContainer.clientHeight;
    if (containerW <= 0 || containerH <= 0) return;

    let displayW, displayH;
    if (aspectRatio > containerW / containerH) {
      displayW = containerW;
      displayH = containerW / aspectRatio;
    } else {
      displayH = containerH;
      displayW = containerH * aspectRatio;
    }

    this.canvas.style.width = `${Math.floor(displayW)}px`;
    this.canvas.style.height = `${Math.floor(displayH)}px`;
  }

  _updateCursor() {
    const tool = this.state.activeTool;
    if (tool === 'paint') {
      const voxelRadius = this.state.brushRadius;
      const scaleX = this.canvas.clientWidth / this.canvas.width;
      const diameter = Math.max(4, Math.round(voxelRadius * 2 * scaleX));
      const size = diameter + 2;
      const half = size / 2;
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

  render() {
    if (!this.volume || !this.dims) return;

    // Resize canvas to maintain constant physical FOV at current tilt
    const [newW, newH] = this._computeCanvasDims();
    if (this.canvas.width !== newW || this.canvas.height !== newH) {
      this.canvas.width = newW;
      this.canvas.height = newH;
      this.ctx.imageSmoothingEnabled = false;
      this.imageData = new ImageData(newW, newH);
    }
    // CSS display size: physical FOV is always fovX × fovY (constant),
    // so the aspect ratio is always dimX*spX / dimY*spY (same as axial).
    this.updateDisplaySize();

    const { obliqueTilt, obliqueAzimuth } = this.state;
    const sliceData = extractObliqueSlice(
      this.volume, this.state.cursor, this.dims,
      obliqueTilt, obliqueAzimuth,
      this.canvas.width, this.canvas.height
    );

    applyWindowLevel(sliceData, this.imageData.data, this.state.windowCenter, this.state.windowWidth);

    // Set out-of-bounds pixels (NaN from trilinear) to black
    const rgba = this.imageData.data;
    for (let i = 0, len = sliceData.length; i < len; i++) {
      if (isNaN(sliceData[i])) {
        const j = i << 2;
        rgba[j] = 0;
        rgba[j + 1] = 0;
        rgba[j + 2] = 0;
        // alpha already 255 from applyWindowLevel
      }
    }

    if (this.state.segVolume && this.state.colorLUT && this.state.overlayOpacity > 0) {
      const segSlice = extractObliqueSegSlice(
        this.state.segVolume, this.state.cursor, this.dims,
        obliqueTilt, obliqueAzimuth,
        this.canvas.width, this.canvas.height
      );
      blendSegmentationOverlay(segSlice, this.imageData.data, this.state.colorLUT, this.state.overlayOpacity);
    }

    this.ctx.putImageData(this.imageData, 0, 0);

    // Draw crosshair at center (oblique is always centered on cursor)
    const cx = Math.floor(this.canvas.width / 2);
    const cy = Math.floor(this.canvas.height / 2);
    this.ctx.save();
    this.ctx.globalAlpha = 0.6;
    this.ctx.strokeStyle = OBLIQUE_COLOR;
    this.ctx.lineWidth = 1;
    this.ctx.beginPath();
    this.ctx.moveTo(cx + 0.5, 0);
    this.ctx.lineTo(cx + 0.5, this.canvas.height);
    this.ctx.stroke();
    this.ctx.beginPath();
    this.ctx.moveTo(0, cy + 0.5);
    this.ctx.lineTo(this.canvas.width, cy + 0.5);
    this.ctx.stroke();
    this.ctx.restore();

    // Update readouts
    const tiltDeg = Math.round(obliqueTilt * 180 / Math.PI);
    const azDeg = Math.round(obliqueAzimuth * 180 / Math.PI);
    this.angleReadout.textContent = `${tiltDeg}\u00B0`;
    this.sliceReadout.textContent = `z:${this.state.cursor[2]}/${this.dims[2] - 1}`;
    this.slider.value = String(this.state.cursor[2]);
  }

  destroy() {
    if (this.resizeObserver) this.resizeObserver.disconnect();
    if (this._onMouseMove) document.removeEventListener('mousemove', this._onMouseMove);
    if (this._onMouseUp) document.removeEventListener('mouseup', this._onMouseUp);
  }
}
