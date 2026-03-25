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
      renderVolumeDetail(vol, detailPanel, (volume) => openVolume(volume, detailPanel, sidebar));
    });
  } catch (err) {
    const banner = document.createElement('div');
    banner.className = 'error-banner';
    banner.textContent = `Failed to load volumes: ${err.message}`;
    detailPanel.appendChild(banner);
  }
}

async function openVolume(volume, detailPanel, sidebar) {
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

init();
