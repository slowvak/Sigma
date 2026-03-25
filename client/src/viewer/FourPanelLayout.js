/**
 * FourPanelLayout — CSS Grid 2x2 layout with axial (UL), coronal (UR),
 * sagittal (LL), blank (LR) panels.
 */
import { ViewerPanel } from './ViewerPanel.js';

export class FourPanelLayout {
  /**
   * @param {Object} options
   * @param {HTMLElement} options.container - Parent DOM element
   * @param {import('./ViewerState.js').ViewerState} options.state - Shared viewer state
   */
  constructor({ container, state }) {
    this.container = container;
    this.state = state;
    this.panels = {};

    this._buildDOM();
    this._unsubscribe = state.subscribe(() => this._onStateChange());
  }

  _buildDOM() {
    this.grid = document.createElement('div');
    this.grid.className = 'viewer-grid';

    // Axial (upper-left)
    const axialDiv = document.createElement('div');
    axialDiv.className = 'viewer-panel-container';
    this.panels.axial = new ViewerPanel({ container: axialDiv, axis: 'axial', state: this.state });

    // Coronal (upper-right)
    const coronalDiv = document.createElement('div');
    coronalDiv.className = 'viewer-panel-container';
    this.panels.coronal = new ViewerPanel({ container: coronalDiv, axis: 'coronal', state: this.state });

    // Sagittal (lower-left)
    const sagittalDiv = document.createElement('div');
    sagittalDiv.className = 'viewer-panel-container';
    this.panels.sagittal = new ViewerPanel({ container: sagittalDiv, axis: 'sagittal', state: this.state });

    // Blank (lower-right)
    const blankDiv = document.createElement('div');
    blankDiv.className = 'viewer-panel-container blank-panel';

    this.grid.appendChild(axialDiv);
    this.grid.appendChild(coronalDiv);
    this.grid.appendChild(sagittalDiv);
    this.grid.appendChild(blankDiv);

    this.container.appendChild(this.grid);
  }

  _onStateChange() {
    this.panels.axial.render();
    this.panels.coronal.render();
    this.panels.sagittal.render();
  }

  /**
   * Load volume data into all panels.
   * @param {Float32Array} volume
   * @param {number[]} dims - [dimX, dimY, dimZ]
   * @param {number[]} spacing - [spX, spY, spZ]
   */
  setVolume(volume, dims, spacing) {
    this.panels.axial.setVolume(volume, dims, spacing);
    this.panels.coronal.setVolume(volume, dims, spacing);
    this.panels.sagittal.setVolume(volume, dims, spacing);
  }

  destroy() {
    if (this._unsubscribe) this._unsubscribe();
    this.panels.axial.destroy();
    this.panels.coronal.destroy();
    this.panels.sagittal.destroy();
    if (this.grid.parentNode) {
      this.grid.parentNode.removeChild(this.grid);
    }
  }
}
