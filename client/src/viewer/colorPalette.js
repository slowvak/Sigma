export const DEFAULT_LABEL_COLORS = [
  { r: 255, g: 0,   b: 0   },  // 1: Red
  { r: 0,   g: 255, b: 0   },  // 2: Green
  { r: 0,   g: 0,   b: 255 },  // 3: Blue
  { r: 255, g: 255, b: 0   },  // 4: Yellow
  { r: 0,   g: 255, b: 255 },  // 5: Cyan
  { r: 255, g: 0,   b: 255 },  // 6: Magenta
  { r: 255, g: 128, b: 0   },  // 7: Orange
  { r: 128, g: 255, b: 0   },  // 8: Lime
  { r: 0,   g: 128, b: 255 },  // 9: Azure
  { r: 255, g: 0,   b: 128 },  // 10: Rose
  { r: 128, g: 0,   b: 255 },  // 11: Violet
  { r: 0,   g: 255, b: 128 },  // 12: Spring
  { r: 255, g: 128, b: 128 },  // 13: Salmon
  { r: 128, g: 255, b: 128 },  // 14: Light Green
  { r: 128, g: 128, b: 255 },  // 15: Periwinkle
  { r: 255, g: 255, b: 128 },  // 16: Light Yellow
  { r: 128, g: 255, b: 255 },  // 17: Light Cyan
  { r: 255, g: 128, b: 255 },  // 18: Light Magenta
  { r: 192, g: 192, b: 192 },  // 19: Silver
  { r: 255, g: 200, b: 0   },  // 20: Gold
];

export function getColorForLabel(labelValue) {
  if (labelValue === 0) return null;
  const idx = (labelValue - 1) % DEFAULT_LABEL_COLORS.length;
  return { ...DEFAULT_LABEL_COLORS[idx] };
}

export function hexToRgb(hex) {
  const val = parseInt(hex.slice(1), 16);
  return { r: (val >> 16) & 255, g: (val >> 8) & 255, b: val & 255 };
}

export function rgbToHex(r, g, b) {
  return '#' + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
}
