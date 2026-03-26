import './styles.css';
import { createAppShell } from './ui/appShell.js';
import { renderVolumeList } from './ui/volumeList.js';
import { renderVolumeDetail, renderEmptyState } from './ui/volumeDetail.js';
import { fetchVolumes, fetchVolumeMetadata, fetchVolumeData } from './api.js';
import { ViewerState } from './viewer/ViewerState.js';
import { FourPanelLayout } from './viewer/FourPanelLayout.js';
import { createPresetBar } from './ui/presetBar.js';

let currentVolume = null;
let currentLayout = null;

async function init() {
  const { listContainer, detailPanel, sidebar } = createAppShell();
  renderEmptyState(detailPanel);

  try {
    const volumes = await fetchVolumes();
    renderVolumeList(volumes, listContainer, (vol) => {
      currentVolume = vol;
      // Clear previous selections
      listContainer.querySelectorAll('.volume-item').forEach(item => {
        item.classList.remove('selected');
        item.setAttribute('aria-selected', 'false');
      });
      // Mark current as selected
      const selectedItem = listContainer.querySelector(`[data-volume-id="${vol.id}"]`);
      if (selectedItem) {
        selectedItem.classList.add('selected');
        selectedItem.setAttribute('aria-selected', 'true');
      }
      renderVolumeDetail(vol, detailPanel, (volume) => openVolume(volume, { detailPanel, sidebar, toolPanel }));
    });
  } catch (err) {
    const banner = document.createElement('div');
    banner.className = 'error-banner';
    banner.textContent = `Failed to load volumes: ${err.message}`;
    detailPanel.appendChild(banner);
  }
}

async function openVolume(volume, { detailPanel, sidebar, toolPanel }) {
  // Show loading state
  detailPanel.innerHTML = '';
  detailPanel.classList.add('viewer-mode');
  const loading = document.createElement('div');
  loading.className = 'empty-state';
  loading.innerHTML = '<h2>Loading...</h2><p>Downloading volume data</p>';
  detailPanel.appendChild(loading);

  try {
    const [metadata, arrayBuffer] = await Promise.all([
      fetchVolumeMetadata(volume.id),
      fetchVolumeData(volume.id),
    ]);

    const dims = metadata.dimensions;
    const spacing = metadata.voxel_spacing || [1, 1, 1];
    const modality = metadata.modality || 'unknown';
    const windowCenter = metadata.window_center ?? 128;
    const windowWidth = metadata.window_width ?? 256;

    const float32Volume = new Float32Array(arrayBuffer);

    const state = new ViewerState({ dims, spacing, modality, windowCenter, windowWidth });

    // Clean up previous layout
    if (currentLayout) {
      currentLayout.destroy();
      currentLayout = null;
    }

    // Set up viewer in detail panel
    detailPanel.innerHTML = '';
    currentLayout = new FourPanelLayout({ container: detailPanel, state });
    currentLayout.setVolume(float32Volume, dims, spacing);

    // Transition sidebar to viewer mode (D-06, D-07)
    _setupViewerSidebar(sidebar, metadata, state, detailPanel);
    
    // Set up editing tool panel
    _setupToolPanel(toolPanel, state);
    toolPanel.style.display = 'flex';

  } catch (err) {
    detailPanel.innerHTML = '';
    detailPanel.classList.remove('viewer-mode');
    const banner = document.createElement('div');
    banner.className = 'error-banner';
    banner.textContent = `Failed to load volume: ${err.message}`;
    detailPanel.appendChild(banner);
  }
}

function _setupViewerSidebar(sidebar, metadata, state, detailPanel) {
  // Save original sidebar content for back navigation
  const originalContent = sidebar.innerHTML;

  sidebar.innerHTML = '';

  // Back button (D-07)
  const backBtn = document.createElement('button');
  backBtn.className = 'sidebar-back-btn';
  backBtn.textContent = '\u2190 Back to volumes';
  backBtn.addEventListener('click', () => {
    if (currentLayout) {
      currentLayout.destroy();
      currentLayout = null;
    }
    detailPanel.classList.remove('viewer-mode');
    
    const toolPanel = document.querySelector('.tool-panel');
    if (toolPanel) toolPanel.style.display = 'none';

    sidebar.innerHTML = originalContent;
    // Re-initialize the app to restore event handlers
    init();
  });
  sidebar.appendChild(backBtn);

  // Volume name
  const nameEl = document.createElement('div');
  nameEl.className = 'sidebar-volume-name';
  nameEl.textContent = metadata.name || metadata.filename || 'Volume';
  sidebar.appendChild(nameEl);

  // Volume metadata summary
  const metaEl = document.createElement('div');
  metaEl.className = 'sidebar-volume-meta';
  const dims = metadata.dimensions;
  const spacing = metadata.voxel_spacing;
  metaEl.innerHTML = `${dims[0]} &times; ${dims[1]} &times; ${dims[2]}<br>` +
    (spacing ? `${spacing[0].toFixed(2)} &times; ${spacing[1].toFixed(2)} &times; ${spacing[2].toFixed(2)} mm` : '') +
    (metadata.modality ? `<br>${metadata.modality}` : '');
  sidebar.appendChild(metaEl);

  // W/L presets (visible only for CT per WLVL-04)
  const presetBar = createPresetBar(state);
  sidebar.appendChild(presetBar);

  // W/L readout
  const wlReadout = document.createElement('div');
  wlReadout.className = 'sidebar-wl-readout';
  const updateWL = () => {
    wlReadout.innerHTML = `<span>W: ${Math.round(state.windowWidth)}</span><span>L: ${Math.round(state.windowCenter)}</span>`;
  };
  updateWL();
  state.subscribe(updateWL);
  sidebar.appendChild(wlReadout);
}

function _setupToolPanel(toolPanel, state) {
  toolPanel.innerHTML = '<div class="tool-heading">Editing Tools</div>';
  
  // Tool selection
  const toolSec = document.createElement('div');
  toolSec.className = 'tool-section';
  toolSec.style.flexDirection = 'row';
  toolSec.style.gap = '4px';
  toolSec.innerHTML = `
    <button class="tool-btn" data-tool="crosshair" style="flex:1;padding:6px;border:1px solid #ccc;border-radius:4px;cursor:pointer;">⌖</button>
    <button class="tool-btn" data-tool="paint" title="Paint" style="flex:1;padding:6px;border:1px solid #ccc;border-radius:4px;cursor:pointer;">🖌</button>
    <button class="tool-btn" data-tool="erase" title="Erase" style="flex:1;padding:6px;border:1px solid #ccc;border-radius:4px;cursor:pointer;">▱</button>
  `;
  toolPanel.appendChild(toolSec);

  const toolBtns = toolSec.querySelectorAll('.tool-btn');
  toolBtns.forEach(btn => {
    btn.addEventListener('click', (e) => {
      state.setActiveTool(e.currentTarget.getAttribute('data-tool'));
    });
  });

  const updateActiveTool = () => {
    toolBtns.forEach(btn => {
      if (btn.getAttribute('data-tool') === state.activeTool) {
        btn.style.background = '#4a9eff';
        btn.style.color = '#fff';
        btn.style.borderColor = '#4a9eff';
      } else {
        btn.style.background = '#fff';
        btn.style.color = '#1e1e1e';
        btn.style.borderColor = '#ccc';
      }
    });
  };
  state.subscribe(updateActiveTool);
  updateActiveTool();

  // Settings section
  const settingsSec = document.createElement('div');
  settingsSec.className = 'tool-section';
  settingsSec.innerHTML = `
    <label class="detail-label">Brush Radius: <span id="brush-rad-val">${state.brushRadius}</span> px</label>
    <input type="range" id="brush-radius" min="1" max="20" step="1" value="${state.brushRadius}">
    
    <label class="detail-label" style="margin-top:8px;">Multi-Slice Depth: <span id="multi-slice-val">${state.multiSlice}</span></label>
    <input type="range" id="multi-slice" min="0" max="10" step="1" value="${state.multiSlice}">
  `;
  toolPanel.appendChild(settingsSec);

  const radInput = settingsSec.querySelector('#brush-radius');
  const radVal = settingsSec.querySelector('#brush-rad-val');
  radInput.addEventListener('input', (e) => {
    const val = parseInt(e.target.value, 10);
    radVal.textContent = val;
    state.setBrushRadius(val);
  });

  const sliceInput = settingsSec.querySelector('#multi-slice');
  const sliceVal = settingsSec.querySelector('#multi-slice-val');
  sliceInput.addEventListener('input', (e) => {
    const val = parseInt(e.target.value, 10);
    sliceVal.textContent = val;
    state.setMultiSlice(val);
  });

  // Constraints section
  const constrSec = document.createElement('div');
  constrSec.className = 'tool-section';
  constrSec.innerHTML = `
    <label class="detail-label">Intensity Limits (Min / Max)</label>
    <div style="display:flex; gap:8px;">
      <input type="number" id="paint-min" value="${state.paintConstraintMin}" style="width:50%; background:#fff; border:1px solid #ccc; border-radius:4px; padding:4px;">
      <input type="number" id="paint-max" value="${state.paintConstraintMax}" style="width:50%; background:#fff; border:1px solid #ccc; border-radius:4px; padding:4px;">
    </div>
  `;
  toolPanel.appendChild(constrSec);

  const minInput = constrSec.querySelector('#paint-min');
  const maxInput = constrSec.querySelector('#paint-max');
  const updateConstraints = () => {
    state.setPaintConstraints(parseInt(minInput.value, 10), parseInt(maxInput.value, 10));
  };
  minInput.addEventListener('change', updateConstraints);
  maxInput.addEventListener('change', updateConstraints);

  // Labels section
  const labelsSec = document.createElement('div');
  labelsSec.className = 'tool-section';
  labelsSec.style.flex = '1';
  labelsSec.style.overflowY = 'auto';
  toolPanel.appendChild(labelsSec);
  
  const renderLabels = () => {
    labelsSec.innerHTML = '<label class="detail-label">Labels</label>';
    for (const [val, label] of state.labels) {
      if (val === 0) continue; // Skip background label in toggles
      const row = document.createElement('div');
      row.style.display = 'flex';
      row.style.alignItems = 'center';
      row.style.marginBottom = '2px';
      row.style.padding = '4px';
      row.style.borderRadius = '4px';
      row.style.cursor = 'pointer';
      
      const isSelected = state.activeLabel === val;
      if (isSelected) {
        row.style.background = '#e0e0e0';
      }
      
      const isVis = label.isVisible !== false;
      const eyeIcon = isVis ? '👁' : '✖';
      const opacity = isVis ? '1' : '0.5';
      
      row.innerHTML = `
        <button class="vis-toggle" data-val="${val}" style="background:none;border:none;cursor:pointer;margin-right:8px;opacity:${opacity};" aria-label="Toggle visibility">${eyeIcon}</button>
        <div style="width:12px;height:12px;background:rgb(${label.color.r},${label.color.g},${label.color.b});margin-right:8px;border-radius:2px;opacity:${opacity}; border: 1px solid #333"></div>
        <span style="font-size:12px;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;opacity:${opacity};">${label.name}</span>
      `;
      
      row.addEventListener('click', (e) => {
        if (!e.target.closest('.vis-toggle')) {
          state.setActiveLabel(val);
        }
      });
      
      labelsSec.appendChild(row);
    }
    
    labelsSec.querySelectorAll('.vis-toggle').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const value = parseInt(e.currentTarget.getAttribute('data-val'), 10);
        state.toggleLabelVisibility(value);
      });
    });
  };
  
  renderLabels();
  // Subscribe to state to update labels if they change
  state.subscribe(renderLabels);
}

init();
