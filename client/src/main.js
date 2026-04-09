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
              regionGrowMax: lb.regionGrowMax
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
          regionGrowMax: lb.regionGrowMax
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
    <button class="tool-btn compact-btn" data-tool="crosshair">⌖</button>
    <button class="tool-btn compact-btn" data-tool="paint" title="Paint">🖌</button>
    <button class="tool-btn compact-btn" data-tool="region-grow" title="Region Grow">✨</button>
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
    if (!state.segVolume || state.activeLabel === 0) {
      alert('No active label selected.');
      return;
    }
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
    if (!state.segVolume || state.activeLabel === 0) {
      alert('No active label selected.');
      return;
    }
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

  const fillHolesBtn = document.createElement('button');
  fillHolesBtn.className = 'compact-btn action-btn';
  fillHolesBtn.title = 'Fill holes in each connected component of the active label on this slice';
  fillHolesBtn.textContent = '⬡ Fill Holes';

  fillHolesBtn.addEventListener('click', () => {
    if (!state.segVolume || state.activeLabel === 0) {
      alert('No active label selected.');
      return;
    }
    const diff = fillHolesOnSlice(state.segVolume, state.dims, state.cursor[2], state.activeLabel);
    if (!diff) {
      alert('No holes found on this slice.');
      return;
    }
    state.pushUndo(diff);
    state.notify();
  });

  actionRow.appendChild(undoBtn);
  actionRow.appendChild(refineBtn);
  actionRow.appendChild(propagateBtn);
  actionRow.appendChild(fillHolesBtn);
  toolPanel.appendChild(actionRow);

  // AI button
  const aiBtn = document.createElement('button');
  aiBtn.className = 'compact-btn';
  aiBtn.textContent = '🤖 AI';
  aiBtn.title = 'Run AI model on current volume';
  aiBtn.style.cssText = 'width:100%;margin-top:4px;padding:4px 8px;font-size:12px;';
  aiBtn.addEventListener('click', () => _showAIModelPicker(state, metadata));
  toolPanel.appendChild(aiBtn);

  // TotalSegmentator button
  const tsBtn = document.createElement('button');
  tsBtn.className = 'compact-btn';
  tsBtn.textContent = 'TotalSegmentator';
  tsBtn.title = 'Download volume as NIfTI and open TotalSegmentator';
  tsBtn.style.cssText = 'width:100%;margin-top:4px;padding:4px 8px;font-size:12px;';
  tsBtn.addEventListener('click', () => _runTotalSegmentator(state, metadata));
  toolPanel.appendChild(tsBtn);

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
  const rgSec = document.createElement('div');
  rgSec.className = 'tool-section compact';
  rgSec.style.display = 'none';
  rgSec.innerHTML = `
    <label class="detail-label">Region Grow Range</label>
    <div style="font-size:12px; color:#a0a0a0; margin-bottom:8px;">Target Mean: <span id="rg-mean-val">-</span></div>
    <div style="display:flex; flex-direction:column; gap:8px;">
      <div style="display:flex; align-items:center; gap:4px;">
        <span style="width:30px;font-size:12px;">Min:</span>
        <button id="rg-min-down" style="width:24px;border:1px solid #ccc;background:#f0f0f0;border-radius:4px;cursor:pointer;">-</button>
        <input type="number" id="rg-min" value="${state.regionGrowMin}" style="flex:1; background:#fff; border:1px solid #ccc; border-radius:4px; padding:4px; text-align:center;">
        <button id="rg-min-up" style="width:24px;border:1px solid #ccc;background:#f0f0f0;border-radius:4px;cursor:pointer;">+</button>
      </div>
      <div style="display:flex; align-items:center; gap:4px;">
        <span style="width:30px;font-size:12px;">Max:</span>
        <button id="rg-max-down" style="width:24px;border:1px solid #ccc;background:#f0f0f0;border-radius:4px;cursor:pointer;">-</button>
        <input type="number" id="rg-max" value="${state.regionGrowMax}" style="flex:1; background:#fff; border:1px solid #ccc; border-radius:4px; padding:4px; text-align:center;">
        <button id="rg-max-up" style="width:24px;border:1px solid #ccc;background:#f0f0f0;border-radius:4px;cursor:pointer;">+</button>
      </div>
    </div>
  `;
  toolPanel.appendChild(rgSec);

  const rgMinInput = rgSec.querySelector('#rg-min');
  const rgMaxInput = rgSec.querySelector('#rg-max');
  const rgMeanVal = rgSec.querySelector('#rg-mean-val');

  const updateRGRange = () => {
    let minVal = parseInt(rgMinInput.value, 10) || 0;
    let maxVal = parseInt(rgMaxInput.value, 10) || 0;
    if (minVal > maxVal - 1) minVal = maxVal - 1; // Enforce min <= max - 1
    
    // Check if the DOM value differs (in case it was manually entered wrong)
    if (parseInt(rgMinInput.value, 10) !== minVal) {
      rgMinInput.value = minVal;
    }

    state.setRegionGrowRange(minVal, maxVal);
    if (state.executeRegionGrow) {
       state.executeRegionGrow();
    }
  };

  const enforceStep = (input, delta) => {
    let val = parseInt(input.value, 10);
    if (isNaN(val)) return;
    val += delta;
    
    if (input === rgMinInput) {
        let maxVal = parseInt(rgMaxInput.value, 10) || 0;
        if (val > maxVal - 1) val = maxVal - 1;
    } else {
        let minVal = parseInt(rgMinInput.value, 10) || 0;
        if (val < minVal + 1) val = minVal + 1;
    }
    input.value = val;
    updateRGRange();
  };

  rgSec.querySelector('#rg-min-down').addEventListener('click', () => enforceStep(rgMinInput, -1));
  rgSec.querySelector('#rg-min-up').addEventListener('click', () => enforceStep(rgMinInput, 1));
  rgSec.querySelector('#rg-max-down').addEventListener('click', () => enforceStep(rgMaxInput, -1));
  rgSec.querySelector('#rg-max-up').addEventListener('click', () => enforceStep(rgMaxInput, 1));

  rgMinInput.addEventListener('change', updateRGRange);
  rgMaxInput.addEventListener('change', updateRGRange);
  rgMinInput.addEventListener('input', updateRGRange);
  rgMaxInput.addEventListener('input', updateRGRange);

  const updateToolPlanes = () => {
    if (state.activeTool === 'region-grow') {
      rgSec.style.display = 'flex';
      constrSec.style.display = 'none';
    } else {
      rgSec.style.display = 'none';
      constrSec.style.display = 'flex';
    }

    if (state.regionGrowMean !== null) {
      if (state.regionGrowMean % 1 !== 0) {
        rgMeanVal.textContent = state.regionGrowMean.toFixed(1);
      } else {
        rgMeanVal.textContent = state.regionGrowMean;
      }
    } else {
      rgMeanVal.textContent = '-';
    }
    
    if (state.regionGrowMin !== parseInt(rgMinInput.value, 10)) {
        rgMinInput.value = state.regionGrowMin;
    }
    if (state.regionGrowMax !== parseInt(rgMaxInput.value, 10)) {
        rgMaxInput.value = state.regionGrowMax;
    }
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
          const [dx, dy, dz] = state.dims;
          state.setSegmentation(new Uint8Array(dx*dy*dz), state.dims, []);
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
        <span style="font-size:12px;flex:1;color:#888;">Erase</span>
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

  if (!models || models.length === 0) {
    alert('No AI models configured. Add models to models/ai-models.json');
    return;
  }

  // Build modal
  const overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;top:0;left:0;width:100vw;height:100vh;background:rgba(0,0,0,0.5);z-index:1000;display:flex;align-items:center;justify-content:center;';

  const modal = document.createElement('div');
  modal.style.cssText = 'background:#1e1e1e;padding:24px;border-radius:8px;width:420px;border:1px solid #3a3a3a;box-shadow:0 10px 30px rgba(0,0,0,0.5);color:#e0e0e0;max-height:80vh;overflow-y:auto;';

  let html = '<h2 style="margin-top:0;font-size:18px;margin-bottom:16px;">Run AI Model</h2>';
  html += '<div style="display:flex;flex-direction:column;gap:8px;">';

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

init();
