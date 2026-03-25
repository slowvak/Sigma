import './styles.css';
import { createAppShell } from './ui/appShell.js';
import { renderVolumeList } from './ui/volumeList.js';
import { renderVolumeDetail, renderEmptyState } from './ui/volumeDetail.js';
import { fetchVolumes, fetchVolumeMetadata, fetchVolumeData } from './api.js';

let currentVolume = null;

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
  const loading = document.createElement('div');
  loading.className = 'empty-state';
  loading.innerHTML = '<h2>Loading...</h2><p>Downloading volume data</p>';
  detailPanel.appendChild(loading);

  try {
    const [metadata, arrayBuffer] = await Promise.all([
      fetchVolumeMetadata(volume.id),
      fetchVolumeData(volume.id),
    ]);

    console.log('Volume loaded:', metadata.name || metadata.filename, 'ArrayBuffer size:', arrayBuffer.byteLength);
  } catch (err) {
    detailPanel.innerHTML = '';
    const banner = document.createElement('div');
    banner.className = 'error-banner';
    banner.textContent = `Failed to load volume: ${err.message}`;
    detailPanel.appendChild(banner);
  }
}

init();
