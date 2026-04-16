/**
 * presetBar — W/L preset buttons for CT volumes.
 * Hidden for known non-CT DICOM modalities (MR, PT, etc.).
 * For CT volumes, uses standard HU-based window presets.
 * For volumes with unknown modality, scales preset parameters to the
 * actual data range so the presets produce meaningful contrast.
 */

import { appConfig } from '../configStore.js';

// CT presets defined in Hounsfield Units.
// Reference CT range: air=-1000, fat=-100, water=0, soft tissue=20-80, bone=700+
function getPresets() {
  const wl = appConfig.window_level_presets || {};
  return [
    { name: 'Brain', center: wl.Brain?.center ?? 40, width: wl.Brain?.width ?? 80 },
    { name: 'Bone', center: wl.Bone?.center ?? 500, width: wl.Bone?.width ?? 3000 },
    { name: 'Lung', center: wl.Lung?.center ?? -500, width: wl.Lung?.width ?? 1000 },
    { name: 'Abd', center: wl.Abd?.center ?? 125, width: wl.Abd?.width ?? 450 },
  ];
}


/**
 * Map a CT HU preset to the actual data range for non-CT volumes.
 *
 * Each preset targets a proportional region of the data range:
 * - Brain: narrow window on lower-mid range (~10-30% of range)
 * - Bone: wide window across most of the range
 * - Lung: narrow window on low end (~0-25% of range)
 * - Abd: medium window on mid range (~15-60% of range)
 *
 * @param {string} name - Preset name
 * @param {number} dataMin - Actual volume minimum voxel value
 * @param {number} dataMax - Actual volume maximum voxel value
 * @returns {{ center: number, width: number }}
 */
export function scalePresetToDataRange(name, dataMin, dataMax) {
  const range = dataMax - dataMin;
  if (range <= 0) {
    return { center: (dataMin + dataMax) / 2, width: Math.max(range, 0.001) };
  }
  // Proportional presets: center as fraction of range, width as fraction of range
  const proportions = {
    Brain: { centerFrac: 0.20, widthFrac: 0.10 },
    Bone:  { centerFrac: 0.60, widthFrac: 0.80 },
    Lung:  { centerFrac: 0.10, widthFrac: 0.15 },
    Abd:   { centerFrac: 0.35, widthFrac: 0.30 },
  };
  const p = proportions[name] || { centerFrac: 0.5, widthFrac: 0.5 };
  return {
    center: dataMin + p.centerFrac * range,
    width: Math.max(p.widthFrac * range, 0.001),
  };
}

/**
 * Create a W/L preset bar element.
 * @param {import('../viewer/ViewerState.js').ViewerState} state
 * @returns {HTMLElement}
 */
export function createPresetBar(state) {
  const container = document.createElement('div');
  container.className = 'preset-bar';

  // Show CT presets unless modality is KNOWN to be non-CT.
  // NIfTI files rarely carry modality info — the server heuristic marks them
  // 'CT' when d_min < -50, or 'unknown' otherwise. For 'unknown' (which covers
  // most NIfTI files), showing presets is safe and useful. Hide only when
  // modality is explicitly a non-CT DICOM modality (e.g. 'MR', 'PT', 'US').
  // Visibility is updated reactively so it responds if modality ever changes.
  const NON_CT_MODALITIES = new Set(['MR', 'PT', 'NM', 'US', 'MG', 'XA', 'RF']);
  const updateVisibility = () => {
    const hidden = NON_CT_MODALITIES.has(state.modality);
    container.style.display = hidden ? 'none' : '';
  };

  // Section heading
  const heading = document.createElement('div');
  heading.className = 'preset-heading';
  heading.textContent = 'Window Presets';
  container.appendChild(heading);

  const buttons = [];
  const activePresets = getPresets();

  for (const preset of activePresets) {
    const btn = document.createElement('button');
    btn.className = 'preset-btn';
    btn.textContent = preset.name;
    btn.setAttribute('aria-pressed', 'false');

    btn.addEventListener('click', () => {
      state.setPreset(preset.name, preset.center, preset.width);
    });

    container.appendChild(btn);
    buttons.push({ btn, preset });
  }

  // Update active preset button highlight and bar visibility on state changes
  const updateActive = () => {
    updateVisibility();
    for (const { btn, preset } of buttons) {
      const isActive = state.activePreset === preset.name;
      btn.classList.toggle('active', isActive);
      btn.setAttribute('aria-pressed', isActive ? 'true' : 'false');
    }
  };

  state.subscribe(updateActive);
  updateActive();

  return container;
}
