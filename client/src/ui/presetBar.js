/**
 * presetBar — W/L preset buttons for CT volumes.
 * Hidden for non-CT modalities per WLVL-04.
 */

const PRESETS = [
  { name: 'Brain', center: 40, width: 80 },
  { name: 'Bone', center: 500, width: 3000 },
  { name: 'Lung', center: -500, width: 1000 },
  { name: 'Abd', center: 125, width: 450 },
];

/**
 * Create a W/L preset bar element.
 * @param {import('../viewer/ViewerState.js').ViewerState} state
 * @returns {HTMLElement}
 */
export function createPresetBar(state) {
  const container = document.createElement('div');
  container.className = 'preset-bar';

  // Hide for non-CT modalities (WLVL-04)
  if (state.modality !== 'CT') {
    container.style.display = 'none';
  }

  // Section heading
  const heading = document.createElement('div');
  heading.className = 'preset-heading';
  heading.textContent = 'Window Presets';
  container.appendChild(heading);

  const buttons = [];

  for (const preset of PRESETS) {
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

  // Update active state on state changes
  const updateActive = () => {
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
