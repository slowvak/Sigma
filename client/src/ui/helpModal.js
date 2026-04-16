export function openHelpModal() {
  const overlay = document.createElement('div');
  overlay.style.position = 'fixed';
  overlay.style.top = '0';
  overlay.style.left = '0';
  overlay.style.width = '100vw';
  overlay.style.height = '100vh';
  overlay.style.backgroundColor = 'rgba(0,0,0,0.7)';
  overlay.style.display = 'flex';
  overlay.style.justifyContent = 'center';
  overlay.style.alignItems = 'center';
  overlay.style.zIndex = '9999';

  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) document.body.removeChild(overlay);
  });

  const onKeydown = (e) => {
    if (e.key === 'Escape') {
      if (document.body.contains(overlay)) document.body.removeChild(overlay);
      document.removeEventListener('keydown', onKeydown);
    }
  };
  document.addEventListener('keydown', onKeydown);

  const modal = document.createElement('div');
  modal.className = 'help-modal';
  modal.style.backgroundColor = '#1e1e1e';
  modal.style.padding = '2rem';
  modal.style.borderRadius = '8px';
  modal.style.minWidth = '420px';
  modal.style.maxWidth = '600px';
  modal.style.maxHeight = '85vh';
  modal.style.overflowY = 'auto';
  modal.style.color = '#eee';
  modal.style.boxShadow = '0 10px 25px rgba(0,0,0,0.5)';

  // Header row
  const headerRow = document.createElement('div');
  headerRow.style.display = 'flex';
  headerRow.style.justifyContent = 'space-between';
  headerRow.style.alignItems = 'center';
  headerRow.style.marginBottom = '1.5rem';

  const title = document.createElement('h2');
  title.textContent = 'ΣIGMA Help';
  title.style.margin = '0';

  const closeBtn = document.createElement('button');
  closeBtn.textContent = 'Close';
  closeBtn.className = 'btn';
  closeBtn.onclick = () => {
    if (document.body.contains(overlay)) document.body.removeChild(overlay);
    document.removeEventListener('keydown', onKeydown);
  };

  headerRow.appendChild(title);
  headerRow.appendChild(closeBtn);
  modal.appendChild(headerRow);

  // Helper: build a section with a two-column table
  function section(title, rows) {
    const sec = document.createElement('div');
    sec.style.border = '1px solid #444';
    sec.style.borderRadius = '6px';
    sec.style.padding = '1rem';
    sec.style.marginBottom = '1rem';

    const h3 = document.createElement('h3');
    h3.textContent = title;
    h3.style.margin = '0 0 0.75rem 0';
    h3.style.fontSize = '1rem';
    h3.style.color = '#ccc';
    sec.appendChild(h3);

    const table = document.createElement('table');
    table.style.width = '100%';
    table.style.borderCollapse = 'collapse';
    table.cellPadding = '6';

    rows.forEach(([label, desc]) => {
      const tr = document.createElement('tr');

      const tdLabel = document.createElement('td');
      tdLabel.textContent = label;
      tdLabel.style.color = '#aaa';
      tdLabel.style.whiteSpace = 'nowrap';
      tdLabel.style.verticalAlign = 'top';
      tdLabel.style.width = '40%';

      const tdDesc = document.createElement('td');
      tdDesc.textContent = desc;
      tdDesc.style.color = '#e0e0e0';
      tdDesc.style.verticalAlign = 'top';

      tr.appendChild(tdLabel);
      tr.appendChild(tdDesc);
      table.appendChild(tr);
    });

    sec.appendChild(table);
    return sec;
  }

  modal.appendChild(section('Navigation', [
    ['4-Panel View', 'Axial, Sagittal, Coronal, Oblique panels shown simultaneously'],
    ['Scroll Slices', 'Click-drag up/down on any panel, or use mouse wheel'],
    ['Slice Slider', 'Drag the slider below each panel to jump to a slice'],
    ['Single-View', 'Click a panel\'s name label to expand it to full screen; click again to restore'],
    ['Crosshair Sync', 'Click or drag with Crosshair tool (\u2316) \u2014 all panels update to that world position'],
  ]));

  modal.appendChild(section('Window / Level', [
    ['Adjust W/L', 'Right-click drag on any panel \u2014 left/right changes Window width, up/down changes Level'],
    ['W/L readout', 'Current values shown as "W: nnn L: nnn" in the tool panel'],
    ['Presets', 'Brain, Bone, Lung, Abd buttons apply standard radiological window/level presets instantly'],
  ]));

  modal.appendChild(section('Tools', [
    ['Crosshair \u2316', 'Navigate: click to set crosshair position across all views'],
    ['Paint \u270f', 'Freehand brush \u2014 left-click drag to paint the active label'],
    ['Grow2D', 'Click a seed voxel on the current slice; the region expands to connected voxels whose intensity falls within the Min\u2013Max range. The range auto-sets to mean\u00b1stdev of the 5\u00d75 patch around the seed and can be adjusted with the dual slider or typed into the number fields.'],
    ['Brush Radius', 'Slider controls paint brush size in pixels'],
    ['Brush Depth', 'Number of adjacent slices the brush paints through simultaneously (odd numbers only)'],
    ['Intensity Limits', 'Constrain paint to voxels within a min/max HU range'],
    ['Label Overlay Opacity', 'Controls how opaque the segmentation colour overlay appears (0\u2013100%)'],
  ]));

  modal.appendChild(section('Actions', [
    ['Undo', 'Ctrl+Z \u2014 reverts the last paint, grow, refine, propagate, or fill operation (up to 5 levels)'],
    ['Refine', 'Snaps the active label boundary to image edges on the current axial slice using Sobel gradient'],
    ['Propagate', 'Copies the label from the adjacent slice and refines it \u2014 step through a stack slice by slice'],
    ['Fill Holes', 'Fills enclosed background regions within each connected component of the active label on this slice'],
    ['Clear Slice', 'Removes all voxels of the active label on the current slice only'],
    ['Filter', 'Smooths the raw image intensities. Options: 2D/3D, Mean/Median/Sigma (Gaussian-weighted mean), kernel size 3/5/7, apply to current Slice or entire Volume. A progress bar shows completion.'],
    ['Load Label Mask', 'Shown when no mask is loaded. Opens a file picker \u2014 select any NIfTI (.nii or .nii.gz) file to load it as the label mask. Labels are auto-detected from the unique non-zero values in the file.'],
    ['Save Label As...', 'Shown once a mask exists. Opens a dialog with the full suggested save path pre-filled (same directory as the source volume, named <volume>_seg.nii.gz). Edit the path as needed, then click Save.'],
    ['Auto-load on open', 'When opening a volume, SIGMA checks for a companion <name>_seg.nii.gz file in the same folder and offers to load it automatically.'],
    ['Unsaved changes', 'If you click \u2190 Back to Volumes with unsaved mask changes, SIGMA will prompt you to save or discard before leaving.'],
  ]));

  modal.appendChild(section('Labels', [
    ['Label list', 'Shows all segmentation labels. Single-click a label to make it active for painting; double-click to open the label editor (rename, change colour, delete).'],
    ['Eye icon', 'Toggle visibility of a label in the overlay'],
    ['Colour swatch', 'Click to change the label colour'],
    ['+ button', 'Add a new label; prompts for a name and assigns the next available colour'],
    ['Erase', 'Select Erase to remove voxels of any label with the paint brush'],
  ]));

  modal.appendChild(section('AI', [
    ['\ud83e\udd16 AI button', 'Opens the AI model picker. Choose a configured server-side model or TotalSegmentator.'],
    ['TotalSegmentator', 'Downloads the current volume as NIfTI and opens totalsegmentator.com for full-body auto-segmentation'],
    ['Server models', 'Add custom models in models/ai-models.json; they appear in the AI picker automatically'],
  ]));

  modal.appendChild(section('Keyboard Shortcuts', [
    ['?', 'Open this help panel'],
    ['Ctrl+Z', 'Undo last edit'],
    ['Escape', 'Close any open modal'],
  ]));

  // Footer tip
  const footer = document.createElement('p');
  footer.textContent = 'Tip: right-click drag on any viewer panel to adjust Window/Level.';
  footer.style.color = '#666';
  footer.style.fontSize = '0.85rem';
  footer.style.marginTop = '0.5rem';
  footer.style.marginBottom = '0';
  modal.appendChild(footer);

  overlay.appendChild(modal);
  document.body.appendChild(overlay);
}
