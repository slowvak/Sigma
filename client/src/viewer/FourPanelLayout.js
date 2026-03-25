/**
 * FourPanelLayout — CSS Grid 2x2 layout with axial (UL), coronal (UR),
 * sagittal (LL), blank (LR) panels. Supports single-view toggle.
 */
import { ViewerPanel } from './ViewerPanel.js';

const AXES = ['axial', 'coronal', 'sagittal'];
const TOGGLE_LETTERS = { axial: 'A', coronal: 'C', sagittal: 'S' };

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
    this.panelContainers = {};

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
    this.panelContainers.axial = axialDiv;

    // Coronal (upper-right)
    const coronalDiv = document.createElement('div');
    coronalDiv.className = 'viewer-panel-container';
    this.panels.coronal = new ViewerPanel({ container: coronalDiv, axis: 'coronal', state: this.state });
    this.panelContainers.coronal = coronalDiv;

    // Sagittal (lower-left)
    const sagittalDiv = document.createElement('div');
    sagittalDiv.className = 'viewer-panel-container';
    this.panels.sagittal = new ViewerPanel({ container: sagittalDiv, axis: 'sagittal', state: this.state });
    this.panelContainers.sagittal = sagittalDiv;

    // Blank (lower-right)
    this.blankDiv = document.createElement('div');
    this.blankDiv.className = 'viewer-panel-container blank-panel';

    this.grid.appendChild(axialDiv);
    this.grid.appendChild(coronalDiv);
    this.grid.appendChild(sagittalDiv);
    this.grid.appendChild(this.blankDiv);

    this.container.appendChild(this.grid);

    // Wire single-view toggle buttons
    this._wireToggleButtons();
  }

  _wireToggleButtons() {
    for (const axis of AXES) {
      const panel = this.panels[axis];
      panel.toggleBtn.addEventListener('click', () => {
        if (this.state.singleView === axis) {
          // Already in single-view for this axis -- return to 4-panel
          this._exitSingleView();
        } else if (this.state.singleView) {
          // Switch from one single-view to another
          this._exitSingleView();
          this._enterSingleView(axis);
        } else {
          // Enter single-view
          this._enterSingleView(axis);
        }
      });
    }
  }

  _enterSingleView(axis) {
    this.state.singleView = axis;
    this.grid.classList.add('single-view');

    // Hide all panels except the active one
    for (const a of AXES) {
      const container = this.panelContainers[a];
      if (a === axis) {
        container.classList.add('active');
      } else {
        container.style.display = 'none';
      }
    }
    // Hide blank panel
    this.blankDiv.style.display = 'none';

    // Change button text to "+"
    this.panels[axis].toggleBtn.textContent = '+';
    this.panels[axis].toggleBtn.classList.add('return-btn');

    // Trigger resize for the expanded panel
    this.panels[axis].updateDisplaySize();
    this.panels[axis].render();
  }

  _exitSingleView() {
    const prevAxis = this.state.singleView;
    this.state.singleView = null;
    this.grid.classList.remove('single-view');

    // Show all panels
    for (const a of AXES) {
      const container = this.panelContainers[a];
      container.classList.remove('active');
      container.style.display = '';
    }
    this.blankDiv.style.display = '';

    // Restore button text
    if (prevAxis) {
      this.panels[prevAxis].toggleBtn.textContent = TOGGLE_LETTERS[prevAxis];
      this.panels[prevAxis].toggleBtn.classList.remove('return-btn');
    }

    // Trigger resize for all panels
    for (const a of AXES) {
      this.panels[a].updateDisplaySize();
      this.panels[a].render();
    }
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
