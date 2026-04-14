import './styles.css';
import { createAppShell } from './ui/appShell.js';
import { renderVolumeList, addVolumeToList, removeVolumeFromList } from './ui/volumeList.js';
import { renderVolumeDetail, renderEmptyState } from './ui/volumeDetail.js';
import { initWebSocket, onWsEvent, onStatusChange } from './wsClient.js';
import { createConnectionStatus, updateConnectionStatus } from './ui/connectionStatus.js';
import { fetchVolumes, fetchVolumeMetadata, fetchVolumeData } from './api.js';
import { ViewerState } from './viewer/ViewerState.js';
import { FourPanelLayout } from './viewer/FourPanelLayout.js';
import { createPresetBar } from './ui/presetBar.js';
import { refineContourAxial, fillHolesOnSlice } from './viewer/contourRefiner.js';
import { loadAppConfig, appConfig } from './configStore.js';
import { openPreferencesModal } from './ui/preferencesModal.js';
import { openHelpModal } from './ui/helpModal.js';
import { showFolderPickerModal } from './ui/folderPickerModal.js';
import { getTaskParams, loadVolumeByPath, loadMaskByPath, completeTask, buildTaskUI } from './taskMode.js';

let currentVolume = null;
let currentLayout = null;

async function init() {
  await loadAppConfig();

  // Check for task mode (external workflow integration)
  const taskParams = getTaskParams();
  if (taskParams) {
    return initTaskMode(taskParams);
  }

  // Show folder picker on first launch (no source directory configured)
  if (!appConfig.source_directory) {
    const chosen = await showFolderPickerModal();
    if (chosen) {
      // Re-load config so the rest of init sees the updated value, then
      // trigger page reload as the folder picker has already triggered the server rescan.
      window.location.reload();
      return;
    }
    // If skipped, continue to show empty volume list
  }

  const { listContainer, detailPanel, sidebar, toolPanel, prefsButton, openFolderBtn, helpButton } = createAppShell();

  if (openFolderBtn) {
    openFolderBtn.addEventListener('click', async () => {
      const chosen = await showFolderPickerModal();
      if (chosen) {
         // Fetch new list of volumes from server and redraw (the modal already rescanned)
         try {
           const volumes = await fetchVolumes();
           renderVolumeList(volumes, listContainer, selectHandler);
           renderEmptyState(detailPanel);
           currentVolume = null;
           if (currentLayout) {
             currentLayout.destroy();
             currentLayout = null;
           }
         } catch (err) {
           console.error("Failed to fetch volumes after folder change:", err);
         }
      }
    });
  }

  if (prefsButton) {
    prefsButton.addEventListener('click', openPreferencesModal);
  }

  if (helpButton) {
    helpButton.addEventListener('click', openHelpModal);
  }

  document.addEventListener('keydown', (e) => {
    const tag = document.activeElement?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    if (e.key === '?') {
      e.preventDefault();
      openHelpModal();
    }
  });

  renderEmptyState(detailPanel);

  const selectHandler = (vol) => {
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
  };

  try {
    const volumes = await fetchVolumes();
    renderVolumeList(volumes, listContainer, selectHandler);
  } catch (err) {
    const banner = document.createElement('div');
    banner.className = 'error-banner';
    banner.textContent = `Failed to load volumes: ${err.message}`;
    detailPanel.appendChild(banner);
  }

  // WebSocket: real-time volume list updates
  onWsEvent((msg) => {
    if (msg.type === 'volume_added') {
      addVolumeToList(msg.data, listContainer, selectHandler);
    } else if (msg.type === 'volume_removed') {
      removeVolumeFromList(msg.data.id, listContainer);
      // If the removed volume is currently open, close the viewer
      if (currentVolume && currentVolume.id === msg.data.id) {
        currentVolume = null;
        if (currentLayout) {
          currentLayout.destroy();
          currentLayout = null;
        }
        renderEmptyState(detailPanel);
      }
    }
  });

  // Connection status indicator
  createConnectionStatus(sidebar);
  onStatusChange(updateConnectionStatus);

  // Start WebSocket connection
  initWebSocket();
}

async function initTaskMode(taskParams) {
  const taskStartTime = Date.now();

  // Build minimal shell — no sidebar, no volume browser
  const app = document.getElementById('app');
  app.innerHTML = '';

  const header = document.createElement('header');
  header.className = 'app-header';
  const h1 = document.createElement('h1');
  h1.textContent = 'NextEd';
  header.appendChild(h1);
  app.appendChild(header);

  const body = document.createElement('div');
  body.className = 'app-body';

  const toolPanel = document.createElement('div');
  toolPanel.className = 'tool-panel';
  toolPanel.style.display = 'none';

  const detailPanel = document.createElement('main');
  detailPanel.className = 'detail-panel viewer-mode';

  body.appendChild(toolPanel);
  body.appendChild(detailPanel);
  app.appendChild(body);

  // Show loading
  detailPanel.innerHTML = '<div class="empty-state"><h2>Loading task...</h2><p>Fetching volume data</p></div>';

  try {
    // Load volume by path
    const metadata = await loadVolumeByPath(taskParams.volume);
    const volumeId = metadata.id;

    // Fetch binary data
    const arrayBuffer = await fetchVolumeData(volumeId);
    const float32Volume = new Float32Array(arrayBuffer);

    const dims = metadata.dimensions;
    const spacing = metadata.voxel_spacing || [1, 1, 1];
    const modality = metadata.modality || 'unknown';
    const windowCenter = metadata.window_center ?? 128;
    const windowWidth = metadata.window_width ?? 256;
    const dataMin = metadata.data_min ?? null;
    const dataMax = metadata.data_max ?? null;

    const state = new ViewerState({ dims, spacing, modality, windowCenter, windowWidth, dataMin, dataMax });

    // Load existing mask if specified
    if (taskParams.mask) {
      try {
        const maskData = await loadMaskByPath(taskParams.mask, volumeId);
        state.segVolume = maskData;
        state.segDims = [...dims];

        // Auto-detect labels from mask
        const uniqueVals = new Set(maskData);
        const { buildColorLUT } = await import('./viewer/overlayBlender.js');
        const DEFAULT_COLORS = [
          null,
          { r: 255, g: 0, b: 0 }, { r: 0, g: 255, b: 0 }, { r: 0, g: 0, b: 255 },
          { r: 255, g: 255, b: 0 }, { r: 0, g: 255, b: 255 }, { r: 255, g: 0, b: 255 },
        ];
        for (const v of uniqueVals) {
          if (v === 0) continue;
          state.labels.set(v, {
            name: `Label ${v}`,
            value: v,
            color: v < DEFAULT_COLORS.length ? DEFAULT_COLORS[v] : { r: 200, g: 200, b: 200 },
            isVisible: true,
          });
        }
        state.colorLUT = buildColorLUT(state.labels);
        for (const [val] of state.labels) {
          if (val !== 0) { state.activeLabel = val; break; }
        }
      } catch (e) {
        console.warn('[NextEd] Failed to load task mask:', e);
      }
    }

    // Set up viewer
    detailPanel.innerHTML = '';
    if (currentLayout) { currentLayout.destroy(); currentLayout = null; }
    currentLayout = new FourPanelLayout({ container: detailPanel, state });
    state.volume = float32Volume;
    currentLayout.setVolume(float32Volume, dims, spacing);

    // Set up tool panel (edit modes)
    const isEditMode = taskParams.mode === 'edit' || taskParams.mode === 'edit+qc';
    if (isEditMode) {
      // Use a dummy sidebar element (hidden) since _setupToolPanel expects one
      const dummySidebar = document.createElement('div');
      _setupToolPanel(toolPanel, state, metadata, dummySidebar, detailPanel);
      toolPanel.style.display = 'flex';
    }

    // Build task bar (prompt + QC controls + submit button)
    const onComplete = async () => {
      const submitBtn = document.querySelector('.task-submit-btn');
      if (submitBtn) {
        submitBtn.classList.add('submitting');
        submitBtn.textContent = 'Submitting...';
      }

      try {
        const result = await completeTask(taskParams, state, volumeId, taskStartTime);
        console.log('[NextEd] Task completed:', result);

        // Show success
        const bar = document.querySelector('.task-bar');
        if (bar) {
          bar.innerHTML = '<div class="task-prompt" style="color:#6fcf97;">Task completed successfully. You may close this window.</div>';
        }
      } catch (err) {
        console.error('[NextEd] Task completion failed:', err);
        alert('Failed to complete task: ' + err.message);
        if (submitBtn) {
          submitBtn.classList.remove('submitting');
          submitBtn.textContent = 'Retry';
        }
      }
    };

    buildTaskUI(taskParams, detailPanel, onComplete);

    // Auto-run AI model if specified
    if (taskParams.aiModel) {
      try {
        const runResp = await fetch('/api/v1/ai/run', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ volume_id: volumeId, model_id: taskParams.aiModel }),
        });
        const { job_id } = await runResp.json();
        console.log(`[NextEd] Auto-running AI model ${taskParams.aiModel}, job: ${job_id}`);
      } catch (e) {
        console.warn('[NextEd] Failed to auto-run AI model:', e);
      }
    }

  } catch (err) {
    detailPanel.innerHTML = '';
    const banner = document.createElement('div');
    banner.className = 'error-banner';
    banner.textContent = `Task failed: ${err.message}`;
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
    const dataMin = metadata.data_min ?? null;
    const dataMax = metadata.data_max ?? null;

    const float32Volume = new Float32Array(arrayBuffer);

    // Diagnostic: show actual data stats in console
    let vMin = Infinity, vMax = -Infinity, nonZeroCount = 0;
    for (let i = 0; i < float32Volume.length; i++) {
      const v = float32Volume[i];
      if (v < vMin) vMin = v;
      if (v > vMax) vMax = v;
      if (v !== 0) nonZeroCount++;
    }
    console.log(`[NextEd] Volume loaded: ${float32Volume.length} voxels, range [${vMin}, ${vMax}], non-zero: ${nonZeroCount}, metadata data_min=${dataMin} data_max=${dataMax}, W/L=${windowWidth}/${windowCenter}`);
    // Sample 10 non-zero values
    const samples = [];
    for (let i = 0; i < float32Volume.length && samples.length < 10; i++) {
      if (float32Volume[i] !== 0) samples.push(float32Volume[i]);
    }
    console.log(`[NextEd] Sample non-zero values:`, samples);

    const state = new ViewerState({ dims, spacing, modality, windowCenter, windowWidth, dataMin, dataMax });

    // Load saved labels from cache
    try {
      const savedLabels = await fetch(`/api/v1/volumes/${volume.id}/labels`).then(r => r.json());
      if (Array.isArray(savedLabels) && savedLabels.length > 0) {
        for (const lb of savedLabels) {
          if (lb.value && lb.value !== 0) {
            state.labels.set(lb.value, {
              name: lb.name || `Label ${lb.value}`,
              value: lb.value,
              color: lb.color || { r: 200, g: 200, b: 200 },
              isVisible: true,
              regionGrowMin: lb.regionGrowMin,
              regionGrowMax: lb.regionGrowMax,
              paintConstraintMin: lb.paintConstraintMin,
              paintConstraintMax: lb.paintConstraintMax
            });
          }
        }
        const { buildColorLUT } = await import('./viewer/overlayBlender.js');
        state.colorLUT = buildColorLUT(state.labels);
        // Auto-select first non-background label
        for (const [val] of state.labels) {
          if (val !== 0) { state.activeLabel = val; break; }
        }
        // Create empty segVolume so paint doesn't re-prompt for existing labels
        if (!state.segVolume) {
          const [dx, dy, dz] = state.dims;
          state.segVolume = new Uint8Array(dx * dy * dz);
          state.segDims = [...state.dims];
        }
      }
    } catch (e) {
      console.warn('[NextEd] Could not load saved labels:', e);
    }

    // Auto-save labels when they change
    const saveLabels = () => {
      const labels = [];
      for (const [val, lb] of state.labels) {
        if (val === 0) continue;
        labels.push({
          value: val,
          name: lb.name,
          color: lb.color,
          regionGrowMin: lb.regionGrowMin,
          regionGrowMax: lb.regionGrowMax,
          paintConstraintMin: lb.paintConstraintMin,
          paintConstraintMax: lb.paintConstraintMax
        });
      }
      fetch(`/api/v1/volumes/${volume.id}/labels`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(labels),
      }).catch(() => {});
    };
    state.subscribe(saveLabels);

    // Clean up previous layout
    if (currentLayout) {
      currentLayout.destroy();
      currentLayout = null;
    }

    // Set up viewer in detail panel
    detailPanel.innerHTML = '';
    currentLayout = new FourPanelLayout({ container: detailPanel, state });
    state.volume = float32Volume;
    currentLayout.setVolume(float32Volume, dims, spacing);

    // Hide sidebar, set up unified tool panel
    sidebar.style.display = 'none';
    _setupToolPanel(toolPanel, state, metadata, sidebar, detailPanel);
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

/**
 * Ensure a real (non-erase) label is active before any overlay-creating operation.
 * - No labels defined → prompts to create one via state.onLabelRequired()
 * - Labels exist but erase is selected → alerts user to pick one
 * Returns true if safe to proceed.
 */
function _ensureLabel(state) {
  const hasRealLabels = [...state.labels.keys()].some(v => v !== 0);
  if (!hasRealLabels) {
    if (typeof state.onLabelRequired === 'function') {
      return state.onLabelRequired() === true;
    }
    alert('No labels defined. Add a label with the + button first.');
    return false;
  }
  if (state.activeLabel === 0) {
    alert('Select a label first — Erase mode is active.');
    return false;
  }
  return true;
}

function _setupToolPanel(toolPanel, state, metadata, sidebar, detailPanel) {
  toolPanel.innerHTML = '';

  const handleKeydown = (e) => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
    if ((e.ctrlKey || e.metaKey) && (e.key === 'z' || e.key === 'Z')) {
      e.preventDefault();
      state.undo();
    }
  };
  document.addEventListener('keydown', handleKeydown);

  // Back button
  const backBtn = document.createElement('button');
  backBtn.className = 'compact-back-btn';
  backBtn.textContent = '\u2190 Back to Volumes';
  backBtn.addEventListener('click', () => {
    document.removeEventListener('keydown', handleKeydown);
    if (currentLayout) {
      currentLayout.destroy();
      currentLayout = null;
    }
    detailPanel.classList.remove('viewer-mode');
    toolPanel.style.display = 'none';
    sidebar.style.display = '';
    init();
  });
  toolPanel.appendChild(backBtn);

  // W/L presets (compact)
  const presetBar = createPresetBar(state);
  presetBar.classList.add('compact-presets');
  toolPanel.appendChild(presetBar);

  // W/L readout (inline)
  const wlReadout = document.createElement('div');
  wlReadout.className = 'compact-wl-readout';
  const updateWL = () => {
    wlReadout.textContent = `W: ${Math.round(state.windowWidth)}  L: ${Math.round(state.windowCenter)}`;
  };
  updateWL();
  state.subscribe(updateWL);
  toolPanel.appendChild(wlReadout);
  
  // Save Action
  const saveSec = document.createElement('div');
  saveSec.className = 'tool-section compact';
  const saveBtn = document.createElement('button');
  saveBtn.textContent = '💾 Save As...';
  saveBtn.className = 'compact-btn save-btn';
  
  const showSaveModal = () => {
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;top:0;left:0;width:100vw;height:100vh;background:rgba(0,0,0,0.5);z-index:1000;display:flex;align-items:center;justify-content:center;';
    
    const modal = document.createElement('div');
    modal.style.cssText = 'background:#1e1e1e;padding:24px;border-radius:8px;width:400px;border:1px solid #3a3a3a;box-shadow:0 10px 30px rgba(0,0,0,0.5);color:#e0e0e0;';
    
    modal.innerHTML = `
      <h2 style="margin-top:0;font-size:18px;margin-bottom:8px;">Save Segmentation As...</h2>
      <p style="font-size:14px;color:#a0a0a0;margin-bottom:16px;">Provide a filename for the modified segmentation volume.</p>
      <input type="text" id="save-filename" style="width:100%;padding:8px;margin-bottom:24px;background:#2d2d2d;border:1px solid #4a9eff;border-radius:4px;color:#fff;" />
      <div style="display:flex;justify-content:flex-end;gap:8px;">
        <button id="save-cancel" style="padding:8px 16px;background:none;border:1px solid #a0a0a0;color:#a0a0a0;border-radius:4px;cursor:pointer;">Cancel</button>
        <button id="save-confirm" style="padding:8px 16px;background:#4a9eff;border:none;color:#fff;border-radius:4px;cursor:pointer;font-weight:bold;">Confirm Save</button>
      </div>
    `;
    
    overlay.appendChild(modal);
    document.body.appendChild(overlay);
    
    const input = modal.querySelector('#save-filename');
    input.value = metadata.name ? metadata.name.replace(/\.nii(\.gz)?$/, '') + '_seg.nii.gz' : 'segmentation.nii.gz';
    input.focus();
    
    const close = () => document.body.removeChild(overlay);
    
    modal.querySelector('#save-cancel').addEventListener('click', close);
    modal.querySelector('#save-confirm').addEventListener('click', () => {
      const filename = input.value.trim();
      if (!filename) return;
      
      const confirmBtn = modal.querySelector('#save-confirm');
      confirmBtn.textContent = 'Saving...';
      confirmBtn.disabled = true;
      
      fetch('/api/v1/volumes/' + metadata.id + '/segmentations?filename=' + encodeURIComponent(filename), {
        method: 'POST',
        body: state.segVolume,
        headers: { 'Content-Type': 'application/octet-stream' }
      }).then(res => {
        if (!res.ok) {
           return res.json().then(errData => { throw new Error(errData.detail || 'Save failed'); }).catch(() => { throw new Error('Save failed'); });
        }
        return res.json();
      }).then(data => {
        close();
        alert('Saved successfully: ' + data.filename);
      }).catch(err => {
        alert(err.message);
        confirmBtn.textContent = 'Confirm Save';
        confirmBtn.disabled = false;
      });
    });
  };

  saveBtn.addEventListener('click', showSaveModal);
  saveSec.appendChild(saveBtn);
  toolPanel.appendChild(saveSec);

  // Tool selection
  const toolSec = document.createElement('div');
  toolSec.className = 'tool-section compact';
  toolSec.style.flexDirection = 'row';
  toolSec.style.gap = '4px';
  toolSec.innerHTML = `
    <div id="tool-dropdown" style="position:relative;flex:1;">
      <button id="tool-dropdown-btn" class="compact-btn" style="width:100%;display:flex;align-items:center;justify-content:space-between;gap:4px;">
        <span id="tool-dropdown-label">⌖ Cursor</span>
        <span style="font-size:10px;">▾</span>
      </button>
      <div id="tool-dropdown-menu" style="display:none;position:absolute;top:100%;left:0;right:0;z-index:100;background:#fff;border:1px solid #ccc;border-radius:4px;box-shadow:0 2px 8px rgba(0,0,0,0.15);margin-top:2px;">
        <button class="tool-option compact-btn" data-tool="crosshair" data-label="⌖ Cursor" style="width:100%;text-align:left;border:none;border-radius:0;flex:unset;">⌖ Cursor</button>
        <button class="tool-option compact-btn" data-tool="paint" data-label="🖌 Paint" style="width:100%;text-align:left;border:none;border-radius:0;flex:unset;">🖌 Paint</button>
        <button class="tool-option compact-btn" data-tool="region-grow" data-label="⬡ Grow2D" style="width:100%;text-align:left;border:none;border-radius:0;flex:unset;">⬡ Grow2D</button>
      </div>
    </div>
  `;
  toolPanel.appendChild(toolSec);

  const toolDropdownBtn = toolSec.querySelector('#tool-dropdown-btn');
  const toolDropdownMenu = toolSec.querySelector('#tool-dropdown-menu');
  const toolDropdownLabel = toolSec.querySelector('#tool-dropdown-label');

  toolDropdownBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    const isOpen = toolDropdownMenu.style.display !== 'none';
    toolDropdownMenu.style.display = isOpen ? 'none' : 'block';
  });

  document.addEventListener('click', (e) => {
    if (!toolSec.contains(e.target)) {
      toolDropdownMenu.style.display = 'none';
    }
  });

  toolSec.querySelectorAll('.tool-option').forEach(btn => {
    btn.addEventListener('click', () => {
      state.setActiveTool(btn.getAttribute('data-tool'));
      toolDropdownMenu.style.display = 'none';
    });
  });

  const updateActiveTool = () => {
    const options = toolSec.querySelectorAll('.tool-option');
    options.forEach(btn => {
      if (btn.getAttribute('data-tool') === state.activeTool) {
        toolDropdownLabel.textContent = btn.getAttribute('data-label');
        btn.style.background = '#e8f0fe';
        btn.style.color = '#4a9eff';
      } else {
        btn.style.background = '';
        btn.style.color = '';
      }
    });
  };
  state.subscribe(updateActiveTool);
  updateActiveTool();

  // Action buttons row (Undo, Refine, Propagate)
  const actionRow = document.createElement('div');
  actionRow.className = 'tool-section compact';
  actionRow.style.flexDirection = 'row';
  actionRow.style.gap = '4px';
  actionRow.style.flexWrap = 'wrap';

  const undoBtn = document.createElement('button');
  undoBtn.className = 'compact-btn action-btn';
  undoBtn.title = 'Undo (Ctrl+Z)';
  undoBtn.textContent = '↶ Undo';

  const updateUndoState = () => {
    undoBtn.disabled = state.undoStack.length === 0;
    undoBtn.style.opacity = undoBtn.disabled ? '0.5' : '1';
  };
  state.subscribe(updateUndoState);
  updateUndoState();
  undoBtn.addEventListener('click', () => state.undo());

  const refineBtn = document.createElement('button');
  refineBtn.className = 'compact-btn action-btn';
  refineBtn.title = 'Refine Contour — snap label boundary to image edges';
  const refineIcon = document.createElement('img');
  refineIcon.src = '/refine-contour-icon.png';
  refineIcon.alt = '';
  refineIcon.style.cssText = 'width:14px;height:12px;object-fit:contain;vertical-align:middle;margin-right:2px;';
  refineBtn.appendChild(refineIcon);
  refineBtn.appendChild(document.createTextNode('Refine'));

  refineBtn.addEventListener('click', () => {
    if (!_ensureLabel(state)) return;
    const sliceZ = state.cursor[2];
    const diff = refineContourAxial(
      currentLayout.panels.axial.volume,
      state.segVolume,
      state.dims,
      sliceZ,
      state.activeLabel
    );
    if (!diff) {
      alert('No pixels with selected label on this slice.');
      return;
    }
    state.pushUndo(diff);
    state.notify();
  });

  const propagateBtn = document.createElement('button');
  propagateBtn.className = 'compact-btn action-btn';
  propagateBtn.title = 'Copy labels from adjacent slice(s) and refine';
  propagateBtn.textContent = '⇅ Propagate';

  propagateBtn.addEventListener('click', () => {
    if (!_ensureLabel(state)) return;
    const [dimX, dimY, dimZ] = state.dims;
    const sliceSize = dimX * dimY;
    const sliceZ = state.cursor[2];
    const volOffset = sliceZ * sliceSize;

    const hasAbove = sliceZ > 0;
    const hasBelow = sliceZ < dimZ - 1;
    if (!hasAbove && !hasBelow) {
      alert('No adjacent slices available.');
      return;
    }

    // Build undo diff for current slice
    const diff = { indices: [], oldValues: [] };

    // Read adjacent slices — check which actually have labels
    const aboveOffset = hasAbove ? (sliceZ - 1) * sliceSize : -1;
    const belowOffset = hasBelow ? (sliceZ + 1) * sliceSize : -1;

    let aboveHasLabels = false, belowHasLabels = false;
    if (hasAbove) {
      for (let i = 0; i < sliceSize; i++) {
        if (state.segVolume[aboveOffset + i] !== 0) { aboveHasLabels = true; break; }
      }
    }
    if (hasBelow) {
      for (let i = 0; i < sliceSize; i++) {
        if (state.segVolume[belowOffset + i] !== 0) { belowHasLabels = true; break; }
      }
    }

    if (!aboveHasLabels && !belowHasLabels) {
      alert('No labels on adjacent slices.');
      return;
    }

    const useBoth = aboveHasLabels && belowHasLabels;

    for (let i = 0; i < sliceSize; i++) {
      const volIdx = volOffset + i;
      const oldVal = state.segVolume[volIdx];
      let newVal;

      if (useBoth) {
        // AND logic: agree → use label, disagree → 0
        const above = state.segVolume[aboveOffset + i];
        const below = state.segVolume[belowOffset + i];
        newVal = (above === below) ? above : 0;
      } else if (aboveHasLabels) {
        newVal = state.segVolume[aboveOffset + i];
      } else {
        newVal = state.segVolume[belowOffset + i];
      }

      if (newVal !== oldVal) {
        diff.indices.push(volIdx);
        diff.oldValues.push(oldVal);
        state.segVolume[volIdx] = newVal;
      }
    }

    if (diff.indices.length > 0) {
      state.pushUndo(diff);
    }

    // Now refine each label present on this slice
    const labelsOnSlice = new Set();
    for (let i = 0; i < sliceSize; i++) {
      const v = state.segVolume[volOffset + i];
      if (v !== 0) labelsOnSlice.add(v);
    }

    for (const labelVal of labelsOnSlice) {
      const refineDiff = refineContourAxial(
        currentLayout.panels.axial.volume,
        state.segVolume,
        state.dims,
        sliceZ,
        labelVal
      );
      if (refineDiff) {
        state.pushUndo(refineDiff);
      }
    }

    state.notify();
  });

  actionRow.appendChild(undoBtn);
  actionRow.appendChild(refineBtn);
  actionRow.appendChild(propagateBtn);
  toolPanel.appendChild(actionRow);

  // Fill Holes + Filter row (each half width)
  const morphRow = document.createElement('div');
  morphRow.className = 'tool-section compact';
  morphRow.style.flexDirection = 'row';
  morphRow.style.gap = '4px';

  const fillHolesBtn = document.createElement('button');
  fillHolesBtn.className = 'compact-btn action-btn';
  fillHolesBtn.title = 'Fill holes in each connected component of the active label on this slice';
  fillHolesBtn.textContent = '⬡ Fill Holes';
  fillHolesBtn.addEventListener('click', () => {
    if (!_ensureLabel(state)) return;
    const diff = fillHolesOnSlice(state.segVolume, state.dims, state.cursor[2], state.activeLabel);
    if (!diff) { alert('No holes found on this slice.'); return; }
    state.pushUndo(diff);
    state.notify();
  });

  const filterBtn = document.createElement('button');
  filterBtn.className = 'compact-btn action-btn';
  filterBtn.title = 'Smooth / filter the active label mask';
  filterBtn.textContent = 'Filter';
  filterBtn.addEventListener('click', () => {
    if (!state.volume) { alert('No image loaded.'); return; }
    _showFilterModal(state);
  });

  const clearSliceBtn = document.createElement('button');
  clearSliceBtn.className = 'compact-btn action-btn';
  clearSliceBtn.title = 'Remove all labels on the current axial slice';
  clearSliceBtn.textContent = 'Clear Slice';
  clearSliceBtn.addEventListener('click', () => {
    if (!state.segVolume || !state.dims) return;
    const [dimX, dimY] = state.dims;
    const sliceSize = dimX * dimY;
    const base = state.cursor[2] * sliceSize;
    const indices = [], oldValues = [];
    for (let i = 0; i < sliceSize; i++) {
      if (state.segVolume[base + i] !== 0) {
        indices.push(base + i);
        oldValues.push(state.segVolume[base + i]);
        state.segVolume[base + i] = 0;
      }
    }
    if (indices.length === 0) return;
    state.pushUndo({ indices, oldValues });
    state.notify();
  });

  morphRow.appendChild(fillHolesBtn);
  morphRow.appendChild(clearSliceBtn);
  morphRow.appendChild(filterBtn);
  toolPanel.appendChild(morphRow);

  // AI button — same row style as morphRow
  const aiRow = document.createElement('div');
  aiRow.className = 'tool-section compact';
  aiRow.style.flexDirection = 'row';

  const aiBtn = document.createElement('button');
  aiBtn.className = 'compact-btn action-btn';
  aiBtn.textContent = '🤖 AI';
  aiBtn.title = 'Run AI model on current volume';
  aiBtn.style.flex = '1';
  aiBtn.addEventListener('click', () => _showAIModelPicker(state, metadata));
  aiRow.appendChild(aiBtn);
  toolPanel.appendChild(aiRow);

  // Settings section
  const settingsSec = document.createElement('div');
  settingsSec.className = 'tool-section compact';
  settingsSec.innerHTML = `
    <label class="detail-label">Brush: <span id="brush-rad-val">${state.brushRadius}</span>px</label>
    <input type="range" id="brush-radius" min="1" max="20" step="1" value="${state.brushRadius}">
    <label class="detail-label">Depth: <span id="multi-slice-val">${state.multiSlice}</span></label>
    <input type="range" id="multi-slice" min="1" max="21" step="2" value="${state.multiSlice}">
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
  constrSec.className = 'tool-section compact';
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

  // Region Grow Settings section (hidden by default)
  const rgSlidMin = -1024;
  const rgSlidMax = 3000;

  const rgSec = document.createElement('div');
  rgSec.className = 'tool-section compact';
  rgSec.style.display = 'none';
  rgSec.innerHTML = `
    <label class="detail-label">Region Grow Range</label>
    <div style="font-size:11px;color:#888;margin-bottom:6px;">Mean: <span id="rg-mean-val">-</span></div>
    <div class="dual-range-wrap">
      <div class="dual-range-track"><div class="dual-range-fill" id="rg-fill"></div></div>
      <input type="range" id="rg-min-slider" min="${rgSlidMin}" max="${rgSlidMax}" step="1" value="${state.regionGrowMin}">
      <input type="range" id="rg-max-slider" min="${rgSlidMin}" max="${rgSlidMax}" step="1" value="${state.regionGrowMax}">
    </div>
    <div style="display:flex;justify-content:space-between;gap:4px;margin-top:4px;">
      <label style="font-size:11px;color:#555;display:flex;align-items:center;gap:3px;flex:1;">
        Min <input type="number" id="rg-min-input" value="${state.regionGrowMin}" style="width:56px;font-size:11px;padding:2px 4px;border:1px solid #ccc;border-radius:3px;background:#fff;">
      </label>
      <label style="font-size:11px;color:#555;display:flex;align-items:center;gap:3px;flex:1;justify-content:flex-end;">
        Max <input type="number" id="rg-max-input" value="${state.regionGrowMax}" style="width:56px;font-size:11px;padding:2px 4px;border:1px solid #ccc;border-radius:3px;background:#fff;">
      </label>
    </div>
  `;
  toolPanel.appendChild(rgSec);

  const rgMinSlider = rgSec.querySelector('#rg-min-slider');
  const rgMaxSlider = rgSec.querySelector('#rg-max-slider');
  const rgFill = rgSec.querySelector('#rg-fill');
  const rgMeanVal = rgSec.querySelector('#rg-mean-val');
  const rgMinInput = rgSec.querySelector('#rg-min-input');
  const rgMaxInput = rgSec.querySelector('#rg-max-input');

  const updateRGFill = () => {
    const span = rgSlidMax - rgSlidMin;
    const l = (parseInt(rgMinSlider.value) - rgSlidMin) / span * 100;
    const r = (parseInt(rgMaxSlider.value) - rgSlidMin) / span * 100;
    rgFill.style.left = l + '%';
    rgFill.style.width = (r - l) + '%';
  };
  updateRGFill();

  const applyRGChange = (minVal, maxVal) => {
    rgMinSlider.value = String(minVal);
    rgMaxSlider.value = String(maxVal);
    rgMinInput.value = minVal;
    rgMaxInput.value = maxVal;
    updateRGFill();
    state.setRegionGrowRange(minVal, maxVal);
    if (state.executeRegionGrow) state.executeRegionGrow();
  };

  rgMinSlider.addEventListener('input', () => {
    let minVal = parseInt(rgMinSlider.value);
    let maxVal = parseInt(rgMaxSlider.value);
    if (minVal >= maxVal) minVal = maxVal - 1;
    rgMinSlider.style.zIndex = minVal > (rgSlidMin + rgSlidMax) / 2 ? '5' : '3';
    applyRGChange(minVal, maxVal);
  });

  rgMaxSlider.addEventListener('input', () => {
    let minVal = parseInt(rgMinSlider.value);
    let maxVal = parseInt(rgMaxSlider.value);
    if (maxVal <= minVal) maxVal = minVal + 1;
    applyRGChange(minVal, maxVal);
  });

  const commitRGInputs = () => {
    let minVal = parseInt(rgMinInput.value, 10);
    let maxVal = parseInt(rgMaxInput.value, 10);
    if (isNaN(minVal) || isNaN(maxVal)) return;
    if (minVal >= maxVal) minVal = maxVal - 1;
    // Clamp to slider range
    minVal = Math.max(rgSlidMin, Math.min(rgSlidMax - 1, minVal));
    maxVal = Math.max(rgSlidMin + 1, Math.min(rgSlidMax, maxVal));
    applyRGChange(minVal, maxVal);
  };

  rgMinInput.addEventListener('change', commitRGInputs);
  rgMaxInput.addEventListener('change', commitRGInputs);

  const updateToolPlanes = () => {
    if (state.activeTool === 'region-grow') {
      rgSec.style.display = 'flex';
      constrSec.style.display = 'none';
    } else {
      rgSec.style.display = 'none';
      constrSec.style.display = 'flex';
    }

    if (state.regionGrowMean !== null) {
      rgMeanVal.textContent = state.regionGrowMean % 1 !== 0
        ? state.regionGrowMean.toFixed(1)
        : state.regionGrowMean;
    } else {
      rgMeanVal.textContent = '-';
    }

    if (state.regionGrowMin !== parseInt(rgMinSlider.value)) {
      rgMinSlider.value = String(state.regionGrowMin);
      rgMinInput.value = state.regionGrowMin;
    }
    if (state.regionGrowMax !== parseInt(rgMaxSlider.value)) {
      rgMaxSlider.value = String(state.regionGrowMax);
      rgMaxInput.value = state.regionGrowMax;
    }
    updateRGFill();
  };
  state.subscribe(updateToolPlanes);
  updateToolPlanes();

  // Overlay opacity slider
  const opacitySec = document.createElement('div');
  opacitySec.className = 'tool-section compact';
  opacitySec.innerHTML = `
    <label class="detail-label">Label Overlay Opacity: <span id="opacity-val">${Math.round(state.overlayOpacity * 100)}%</span></label>
    <input type="range" id="overlay-opacity" min="0" max="100" step="5" value="${Math.round(state.overlayOpacity * 100)}">
  `;
  toolPanel.appendChild(opacitySec);

  const opacityInput = opacitySec.querySelector('#overlay-opacity');
  const opacityVal = opacitySec.querySelector('#opacity-val');
  opacityInput.addEventListener('input', (e) => {
    const pct = parseInt(e.target.value, 10);
    opacityVal.textContent = `${pct}%`;
    state.setOverlayOpacity(pct / 100);
  });

  // Labels section
  const labelsSec = document.createElement('div');
  labelsSec.className = 'tool-section compact';
  labelsSec.style.flex = '1';
  labelsSec.style.overflowY = 'auto';
  toolPanel.appendChild(labelsSec);
  
  const DEFAULT_LABEL_COLORS = [
      null,                        // 0 = background, not used
      { r: 255, g: 0,   b: 0   }, // 1 = red
      { r: 0,   g: 255, b: 0   }, // 2 = green
      { r: 0,   g: 0,   b: 255 }, // 3 = blue
      { r: 255, g: 255, b: 0   }, // 4 = yellow
      { r: 0,   g: 255, b: 255 }, // 5 = cyan
      { r: 255, g: 0,   b: 255 }, // 6 = magenta
  ];

  const handleAddLabel = () => {
      if (!state.segVolume) {
          // Create empty segVolume directly — do NOT call setSegmentation()
          // because that calls discoverLabels() on an empty array and wipes
          // any labels already in state.labels.
          const [dx, dy, dz] = state.dims;
          state.segVolume = new Uint8Array(dx * dy * dz);
          state.segDims = [...state.dims];
      }
      const name = prompt("Enter label name:", "New Label");
      if (name) {
          // Determine next label value
          const nextVal = state.labels.size > 0 ? Math.max(...state.labels.keys()) + 1 : 1;
          let color;
          if (nextVal < DEFAULT_LABEL_COLORS.length) {
              color = DEFAULT_LABEL_COLORS[nextVal];
          } else {
              const hex = prompt("Enter color (hex, e.g. #ff8800):", "#ff8800");
              if (!hex) return false;
              const m = hex.match(/^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
              if (m) {
                  color = { r: parseInt(m[1], 16), g: parseInt(m[2], 16), b: parseInt(m[3], 16) };
              } else {
                  alert("Invalid hex color. Use format #rrggbb");
                  return false;
              }
          }
          const val = state.addLabel(name, color);
          if (val !== null) state.setActiveLabel(val);
          return true;
      }
      return false;
  };

  state.onLabelRequired = handleAddLabel;

  const renderLabels = () => {
    labelsSec.innerHTML = `
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
        <label class="detail-label" style="margin:0;">Labels</label>
        <button id="add-label-btn" title="Add Label" style="background:none;border:none;color:#4a9eff;cursor:pointer;font-size:16px;">➕</button>
      </div>
    `;
    
    labelsSec.querySelector('#add-label-btn').addEventListener('click', handleAddLabel);

    // Always show label 0 (background/erase) at top
    {
      const row = document.createElement('div');
      row.style.display = 'flex';
      row.style.alignItems = 'center';
      row.style.marginBottom = '2px';
      row.style.padding = '4px';
      row.style.borderRadius = '4px';
      row.style.cursor = 'pointer';
      if (state.activeLabel === 0) row.style.background = '#e0e0e0';
      row.innerHTML = `
        <div style="width:12px;height:12px;background:#fff;margin-right:8px;border-radius:2px;border:1px solid #999;position:relative;overflow:hidden;">
          <div style="position:absolute;top:-1px;left:4px;color:#c00;font-size:14px;line-height:12px;">╲</div>
        </div>
        <span style="font-size:12px;flex:1;color:#888;">No Label</span>
      `;
      row.addEventListener('click', () => state.setActiveLabel(0));
      labelsSec.appendChild(row);
    }

    for (const [val, label] of state.labels) {
      if (val === 0) continue;
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
      row.addEventListener('dblclick', (e) => {
        if (!e.target.closest('.vis-toggle')) {
          _showLabelEditPopup(state, val);
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

async function _runTotalSegmentator(state, metadata) {
  if (!metadata || !metadata.id) {
    alert('No volume loaded.');
    return;
  }
  const confirmed = window.confirm(
    'This will download the volume as NIfTI and open TotalSegmentator.\n\n' +
    'Upload the downloaded file at totalsegmentator.com to run segmentation.'
  );
  if (!confirmed) return;

  // Open TotalSegmentator first (needs user-gesture context; fetch below is async)
  const tsWin = window.open('https://totalsegmentator.com', '_blank', 'noopener,noreferrer');
  if (!tsWin) alert('Popup blocked — please allow popups for this site.');

  // Fetch bytes then create a Blob URL so the download attribute works reliably
  try {
    const resp = await fetch(`/api/v1/volumes/${metadata.id}/nifti`);
    if (!resp.ok) throw new Error(`Server returned ${resp.status}`);

    const cd = resp.headers.get('Content-Disposition') || '';
    const match = cd.match(/filename="([^"]+)"/);
    const filename = match ? match[1] : `${metadata.name || 'volume'}.nii`;

    const blob = await resp.blob();
    const blobUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = blobUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(blobUrl), 30000);
  } catch (err) {
    alert('Failed to download NIfTI: ' + err.message);
  }
}

async function _showAIModelPicker(state, metadata) {
  // Fetch available models
  let models;
  try {
    const resp = await fetch('/api/v1/ai/models');
    models = await resp.json();
  } catch (e) {
    alert('Could not load AI models: ' + e.message);
    return;
  }

  if (!models) models = [];

  // Build modal
  const overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;top:0;left:0;width:100vw;height:100vh;background:rgba(0,0,0,0.5);z-index:1000;display:flex;align-items:center;justify-content:center;';

  const modal = document.createElement('div');
  modal.style.cssText = 'background:#1e1e1e;padding:24px;border-radius:8px;width:420px;border:1px solid #3a3a3a;box-shadow:0 10px 30px rgba(0,0,0,0.5);color:#e0e0e0;max-height:80vh;overflow-y:auto;';

  let html = '<h2 style="margin-top:0;font-size:18px;margin-bottom:16px;">Run AI Model</h2>';
  html += '<div style="display:flex;flex-direction:column;gap:8px;">';

  // TotalSegmentator — always present as a built-in option
  html += `
    <div class="ai-model-option" data-model-id="__totalsegmentator__"
         style="padding:12px;border:1px solid #3a3a3a;border-radius:6px;cursor:pointer;transition:background 0.1s;">
      <div style="font-weight:600;font-size:14px;">TotalSegmentator</div>
      <div style="font-size:12px;color:#a0a0a0;margin-top:4px;">Download volume as NIfTI and open totalsegmentator.com</div>
    </div>
  `;

  for (const model of models) {
    const acceptsLabel = model.accepts_labels ? ' (uses existing labels)' : '';
    html += `
      <div class="ai-model-option" data-model-id="${model.id}"
           style="padding:12px;border:1px solid #3a3a3a;border-radius:6px;cursor:pointer;transition:background 0.1s;">
        <div style="font-weight:600;font-size:14px;">${model.name}</div>
        <div style="font-size:12px;color:#a0a0a0;margin-top:4px;">${model.description || ''}${acceptsLabel}</div>
      </div>
    `;
  }
  html += '</div>';
  html += '<div id="ai-progress" style="display:none;margin-top:16px;">';
  html += '  <div style="font-size:13px;margin-bottom:8px;" id="ai-status-text">Starting...</div>';
  html += '  <div style="background:#3a3a3a;border-radius:4px;height:8px;overflow:hidden;">';
  html += '    <div id="ai-progress-bar" style="background:#4a9eff;height:100%;width:0%;transition:width 0.3s;"></div>';
  html += '  </div>';
  html += '</div>';
  html += '<button id="ai-cancel" style="margin-top:16px;padding:6px 16px;background:none;border:1px solid #a0a0a0;color:#a0a0a0;border-radius:4px;cursor:pointer;">Cancel</button>';

  modal.innerHTML = html;
  overlay.appendChild(modal);
  document.body.appendChild(overlay);

  const close = () => { if (overlay.parentNode) document.body.removeChild(overlay); };
  modal.querySelector('#ai-cancel').addEventListener('click', close);

  // Model selection
  modal.querySelectorAll('.ai-model-option').forEach(opt => {
    opt.addEventListener('mouseenter', () => { opt.style.background = '#363636'; });
    opt.addEventListener('mouseleave', () => { opt.style.background = ''; });
    opt.addEventListener('click', async () => {
      const modelId = opt.getAttribute('data-model-id');

      // TotalSegmentator is a special built-in action
      if (modelId === '__totalsegmentator__') {
        close();
        _runTotalSegmentator(state, metadata);
        return;
      }

      const model = models.find(m => m.id === modelId);

      // Disable all options
      modal.querySelectorAll('.ai-model-option').forEach(o => {
        o.style.pointerEvents = 'none';
        o.style.opacity = '0.5';
      });
      opt.style.opacity = '1';
      opt.style.borderColor = '#4a9eff';

      const progressDiv = modal.querySelector('#ai-progress');
      const statusText = modal.querySelector('#ai-status-text');
      const progressBar = modal.querySelector('#ai-progress-bar');
      progressDiv.style.display = 'block';

      try {
        // If model accepts labels and we have seg data, upload it first
        if (model.accepts_labels && state.segVolume) {
          statusText.textContent = 'Uploading labels...';
          await fetch(`/api/v1/ai/upload-seg/${metadata.id}`, {
            method: 'POST',
            body: state.segVolume,
            headers: { 'Content-Type': 'application/octet-stream' },
          });
        }

        // Submit job
        statusText.textContent = 'Submitting job...';
        const runResp = await fetch('/api/v1/ai/run', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ volume_id: metadata.id, model_id: modelId }),
        });
        const { job_id } = await runResp.json();

        // Listen for progress via SSE
        statusText.textContent = 'Running inference...';
        const evtSource = new EventSource(`/api/v1/ai/jobs/${job_id}/status`);

        await new Promise((resolve, reject) => {
          evtSource.onmessage = (event) => {
            const data = JSON.parse(event.data);
            progressBar.style.width = `${data.progress}%`;
            statusText.textContent = `Running... ${data.progress}%`;

            if (data.status === 'completed') {
              evtSource.close();
              resolve();
            } else if (data.status === 'failed') {
              evtSource.close();
              reject(new Error(data.error || 'Inference failed'));
            }
          };
          evtSource.onerror = () => {
            evtSource.close();
            reject(new Error('Lost connection to server'));
          };
        });

        // Fetch result
        statusText.textContent = 'Loading result...';
        const resultResp = await fetch(`/api/v1/ai/jobs/${job_id}/result`);
        const maskBuffer = await resultResp.arrayBuffer();
        const maskData = new Uint8Array(maskBuffer);

        const labelsJson = resultResp.headers.get('X-AI-Labels');
        const aiLabels = labelsJson ? JSON.parse(labelsJson) : [];

        // Replace segmentation volume
        if (!state.segVolume || state.segVolume.length !== maskData.length) {
          const [dx, dy, dz] = state.dims;
          state.segVolume = new Uint8Array(dx * dy * dz);
          state.segDims = [...state.dims];
        }
        state.segVolume.set(maskData);

        // Replace labels
        state.labels.clear();
        const { buildColorLUT } = await import('./viewer/overlayBlender.js');

        for (const lb of aiLabels) {
          let color = lb.color;
          if (typeof color === 'string') {
            const m = color.match(/^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
            if (m) {
              color = { r: parseInt(m[1], 16), g: parseInt(m[2], 16), b: parseInt(m[3], 16) };
            } else {
              color = { r: 200, g: 200, b: 200 };
            }
          }
          state.labels.set(lb.value, {
            name: lb.name || `Label ${lb.value}`,
            value: lb.value,
            color,
            isVisible: true,
          });
        }

        // If no labels from AI, auto-detect from mask
        if (aiLabels.length === 0) {
          const uniqueVals = new Set(maskData);
          const DEFAULT_COLORS = [
            null,
            { r: 255, g: 0, b: 0 }, { r: 0, g: 255, b: 0 }, { r: 0, g: 0, b: 255 },
            { r: 255, g: 255, b: 0 }, { r: 0, g: 255, b: 255 }, { r: 255, g: 0, b: 255 },
          ];
          for (const v of uniqueVals) {
            if (v === 0) continue;
            state.labels.set(v, {
              name: `Label ${v}`,
              value: v,
              color: v < DEFAULT_COLORS.length ? DEFAULT_COLORS[v] : { r: 200, g: 200, b: 200 },
              isVisible: true,
            });
          }
        }

        state.colorLUT = buildColorLUT(state.labels);
        if (state.labels.size > 0) {
          for (const [val] of state.labels) {
            if (val !== 0) { state.activeLabel = val; break; }
          }
        }

        state.notify();
        close();

      } catch (err) {
        statusText.textContent = `Error: ${err.message}`;
        statusText.style.color = '#ff6b6b';
        progressBar.style.background = '#ff6b6b';
      }
    });
  });
}

function _showLabelEditPopup(state, val) {
  const label = state.labels.get(val);
  if (!label) return;

  // Remove any existing label edit popup
  document.getElementById('__label-edit-overlay__')?.remove();

  const overlay = document.createElement('div');
  overlay.id = '__label-edit-overlay__';
  overlay.style.cssText = 'position:fixed;top:0;left:0;width:100vw;height:100vh;background:rgba(0,0,0,0.55);z-index:2000;display:flex;align-items:center;justify-content:center;';

  const modal = document.createElement('div');
  modal.style.cssText = 'background:#1e1e1e;padding:24px;border-radius:8px;width:300px;border:1px solid #3a3a3a;box-shadow:0 10px 30px rgba(0,0,0,0.6);color:#e0e0e0;font-size:13px;';

  const title = document.createElement('div');
  title.textContent = 'Edit Label';
  title.style.cssText = 'font-size:15px;font-weight:600;margin-bottom:18px;color:#fff;';
  modal.appendChild(title);

  function field(labelText, inputEl) {
    const wrap = document.createElement('div');
    wrap.style.cssText = 'margin-bottom:14px;';
    const lbl = document.createElement('div');
    lbl.textContent = labelText;
    lbl.style.cssText = 'font-size:11px;color:#888;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:5px;';
    wrap.appendChild(lbl);
    wrap.appendChild(inputEl);
    return wrap;
  }

  // Name
  const nameInput = document.createElement('input');
  nameInput.type = 'text';
  nameInput.value = label.name;
  nameInput.style.cssText = 'width:100%;box-sizing:border-box;background:#2a2a2a;border:1px solid #555;border-radius:4px;color:#e0e0e0;padding:6px 8px;font-size:13px;';
  modal.appendChild(field('Name', nameInput));

  // Color
  const { r, g, b } = label.color;
  const toHex = (v) => v.toString(16).padStart(2, '0');
  const colorInput = document.createElement('input');
  colorInput.type = 'color';
  colorInput.value = `#${toHex(r)}${toHex(g)}${toHex(b)}`;
  colorInput.style.cssText = 'width:100%;height:36px;border:none;border-radius:4px;cursor:pointer;background:none;padding:0;';
  modal.appendChild(field('Color', colorInput));

  // Threshold min
  const minInput = document.createElement('input');
  minInput.type = 'number';
  minInput.value = label.regionGrowMin !== undefined ? label.regionGrowMin : state.regionGrowMin;
  minInput.style.cssText = 'width:100%;box-sizing:border-box;background:#2a2a2a;border:1px solid #555;border-radius:4px;color:#e0e0e0;padding:6px 8px;font-size:13px;';
  modal.appendChild(field('Grow Min Intensity', minInput));

  // Threshold max
  const maxInput = document.createElement('input');
  maxInput.type = 'number';
  maxInput.value = label.regionGrowMax !== undefined ? label.regionGrowMax : state.regionGrowMax;
  maxInput.style.cssText = 'width:100%;box-sizing:border-box;background:#2a2a2a;border:1px solid #555;border-radius:4px;color:#e0e0e0;padding:6px 8px;font-size:13px;';
  modal.appendChild(field('Grow Max Intensity', maxInput));

  // Buttons
  const btnRow = document.createElement('div');
  btnRow.style.cssText = 'display:flex;gap:10px;justify-content:flex-end;margin-top:6px;';

  const cancelBtn = document.createElement('button');
  cancelBtn.textContent = 'Cancel';
  cancelBtn.style.cssText = 'padding:7px 16px;border-radius:4px;border:1px solid #555;background:#2a2a2a;color:#ccc;cursor:pointer;font-size:13px;';
  cancelBtn.onclick = () => overlay.remove();

  const saveBtn = document.createElement('button');
  saveBtn.textContent = 'Save';
  saveBtn.style.cssText = 'padding:7px 20px;border-radius:4px;border:none;background:#4a9eff;color:#fff;cursor:pointer;font-size:13px;font-weight:600;';
  saveBtn.onclick = () => {
    const newName = nameInput.value.trim() || label.name;
    const hex = colorInput.value;
    const newColor = {
      r: parseInt(hex.slice(1, 3), 16),
      g: parseInt(hex.slice(3, 5), 16),
      b: parseInt(hex.slice(5, 7), 16),
    };
    const newMin = parseInt(minInput.value, 10);
    const newMax = parseInt(maxInput.value, 10);

    state.updateLabel(val, { name: newName, color: newColor });

    // Store thresholds on the label object; update state if active
    const updated = state.labels.get(val);
    if (updated) {
      updated.regionGrowMin = newMin;
      updated.regionGrowMax = newMax;
    }
    if (state.activeLabel === val) {
      state.regionGrowMin = newMin;
      state.regionGrowMax = newMax;
    }

    state.notify();
    overlay.remove();
  };

  btnRow.appendChild(cancelBtn);
  btnRow.appendChild(saveBtn);
  modal.appendChild(btnRow);

  overlay.appendChild(modal);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
  document.body.appendChild(overlay);

  // Focus name field
  setTimeout(() => nameInput.focus(), 0);
}

function _showFilterModal(state) {
  const overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;top:0;left:0;width:100vw;height:100vh;background:rgba(0,0,0,0.6);z-index:2000;display:flex;align-items:center;justify-content:center;';

  const modal = document.createElement('div');
  modal.style.cssText = 'background:#1e1e1e;padding:24px;border-radius:8px;width:340px;border:1px solid #3a3a3a;box-shadow:0 10px 30px rgba(0,0,0,0.6);color:#e0e0e0;font-size:13px;';

  function radioRow(name, options, defaultVal) {
    const wrap = document.createElement('div');
    wrap.style.cssText = 'display:flex;gap:12px;flex-wrap:wrap;';
    options.forEach(({ label, value }) => {
      const id = `flt-${name}-${value}`;
      const lbl = document.createElement('label');
      lbl.style.cssText = 'display:flex;align-items:center;gap:4px;cursor:pointer;';
      const inp = document.createElement('input');
      inp.type = 'radio'; inp.name = name; inp.value = value;
      if (value === defaultVal) inp.checked = true;
      lbl.appendChild(inp); lbl.appendChild(document.createTextNode(label));
      wrap.appendChild(lbl);
    });
    return wrap;
  }

  function section(title, content) {
    const div = document.createElement('div');
    div.style.cssText = 'margin-bottom:14px;';
    const h = document.createElement('div');
    h.style.cssText = 'font-size:11px;color:#888;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:6px;';
    h.textContent = title;
    div.appendChild(h); div.appendChild(content);
    return div;
  }

  const title = document.createElement('div');
  title.textContent = 'Label Filter';
  title.style.cssText = 'font-size:15px;font-weight:600;margin-bottom:18px;color:#fff;';
  modal.appendChild(title);

  modal.appendChild(section('Mode', radioRow('flt-mode', [{ label: '2D', value: '2d' }, { label: '3D', value: '3d' }], '2d')));
  modal.appendChild(section('Filter Type', radioRow('flt-type', [
    { label: 'Mean', value: 'mean' }, { label: 'Median', value: 'median' }, { label: 'Sigma', value: 'sigma' }
  ], 'median')));
  modal.appendChild(section('Kernel Size', radioRow('flt-kernel', [
    { label: '3', value: '3' }, { label: '5', value: '5' }, { label: '7', value: '7' }
  ], '3')));
  modal.appendChild(section('Apply To', radioRow('flt-scope', [
    { label: 'Slice', value: 'slice' }, { label: 'Volume', value: 'volume' }
  ], 'slice')));

  // Progress section (hidden until Go)
  const progressSec = document.createElement('div');
  progressSec.style.cssText = 'margin-bottom:14px;display:none;';
  const progressLabel = document.createElement('div');
  progressLabel.style.cssText = 'font-size:11px;color:#888;margin-bottom:4px;';
  progressLabel.textContent = 'Progress';
  const progressTrack = document.createElement('div');
  progressTrack.style.cssText = 'height:6px;background:#333;border-radius:3px;overflow:hidden;';
  const progressBar = document.createElement('div');
  progressBar.style.cssText = 'height:100%;width:0%;background:#4a9eff;transition:width 0.1s;border-radius:3px;';
  progressTrack.appendChild(progressBar);
  progressSec.appendChild(progressLabel); progressSec.appendChild(progressTrack);
  modal.appendChild(progressSec);

  // Buttons row
  const btnRow = document.createElement('div');
  btnRow.style.cssText = 'display:flex;gap:10px;justify-content:flex-end;margin-top:4px;';

  const cancelBtn = document.createElement('button');
  cancelBtn.textContent = 'Cancel';
  cancelBtn.style.cssText = 'padding:7px 16px;border-radius:4px;border:1px solid #555;background:#2a2a2a;color:#ccc;cursor:pointer;font-size:13px;';
  cancelBtn.onclick = () => overlay.remove();

  const goBtn = document.createElement('button');
  goBtn.textContent = 'Go';
  goBtn.style.cssText = 'padding:7px 20px;border-radius:4px;border:none;background:#4a9eff;color:#fff;cursor:pointer;font-size:13px;font-weight:600;';

  goBtn.onclick = async () => {
    const getRadio = (name) => {
      const el = modal.querySelector(`input[name="${name}"]:checked`);
      return el ? el.value : null;
    };
    const mode       = getRadio('flt-mode');
    const filterType = getRadio('flt-type');
    const kernelSize = parseInt(getRadio('flt-kernel'), 10);
    const applyTo    = getRadio('flt-scope');

    if (!state.volume || !state.dims) {
      alert('No image loaded.');
      return;
    }

    // Lock UI
    goBtn.disabled = true; cancelBtn.disabled = true;
    progressSec.style.display = '';
    progressBar.style.width = '0%';

    const sliceZ = state.cursor[2];

    try {
      const { applyImageFilter } = await import('./viewer/imageFilter.js');
      await applyImageFilter(
        state.volume, state.dims,
        { mode, filterType, kernelSize, applyTo, sliceZ },
        (p) => { progressBar.style.width = `${Math.round(p * 100)}%`; }
      );

      state.notify();
    } catch (err) {
      alert(`Filter error: ${err.message}`);
    }

    overlay.remove();
  };

  btnRow.appendChild(cancelBtn); btnRow.appendChild(goBtn);
  modal.appendChild(btnRow);
  overlay.appendChild(modal);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
  document.body.appendChild(overlay);
}

init();
