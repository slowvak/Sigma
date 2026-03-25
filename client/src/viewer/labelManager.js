import { getColorForLabel } from './colorPalette.js';

export function discoverLabels(segVolume) {
  const unique = new Set();
  for (let i = 0; i < segVolume.length; i++) {
    unique.add(segVolume[i]);
  }
  const labels = new Map();
  // Background always first (LABL-06)
  labels.set(0, { name: 'Background', value: 0, color: { r: 0, g: 0, b: 0 } });
  const sorted = [...unique].filter(v => v !== 0).sort((a, b) => a - b);
  for (const val of sorted) {
    labels.set(val, {
      name: `Label ${val}`,
      value: val,
      color: getColorForLabel(val),
    });
  }
  return labels;
}

export function findLowestUnusedValue(labels) {
  for (let v = 1; v <= 255; v++) {
    if (!labels.has(v)) return v;
  }
  return null;
}

export function reassignLabelValue(segVolume, oldValue, newValue) {
  for (let i = 0; i < segVolume.length; i++) {
    if (segVolume[i] === oldValue) {
      segVolume[i] = newValue;
    }
  }
}
