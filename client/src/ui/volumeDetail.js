export function renderVolumeDetail(volume, container, onOpen) {
  container.innerHTML = '';

  const heading = document.createElement('h2');
  heading.className = 'detail-heading';
  heading.textContent = volume.filename || volume.name;
  container.appendChild(heading);

  const fields = [
    { label: 'Format', value: volume.format.toUpperCase() },
    { label: 'Dimensions', value: `${volume.dimensions[0]} x ${volume.dimensions[1]} x ${volume.dimensions[2]}` },
    { label: 'Voxel Spacing', value: volume.voxel_spacing ? volume.voxel_spacing.map(s => s.toFixed(2)).join(' x ') + ' mm' : 'N/A' },
    { label: 'Modality', value: volume.modality || 'Unknown' },
  ];

  if (volume.format === 'dicom') {
    if (volume.study_description) fields.push({ label: 'Study', value: volume.study_description });
    if (volume.series_description) fields.push({ label: 'Series', value: volume.series_description });
  } else {
    if (volume.file_date) fields.push({ label: 'File Date', value: volume.file_date });
  }

  for (const f of fields) {
    const div = document.createElement('div');
    div.className = 'detail-field';
    const label = document.createElement('div');
    label.className = 'detail-label';
    label.textContent = f.label;
    const value = document.createElement('div');
    value.className = 'detail-value';
    value.textContent = f.value;
    div.appendChild(label);
    div.appendChild(value);
    container.appendChild(div);
  }

  const btn = document.createElement('button');
  btn.className = 'btn-open';
  btn.textContent = 'Open Volume';
  btn.addEventListener('click', () => onOpen(volume));
  container.appendChild(btn);
}

export function renderEmptyState(container) {
  container.innerHTML = '';
  const div = document.createElement('div');
  div.className = 'empty-state';
  const h2 = document.createElement('h2');
  h2.textContent = 'No Volume Selected';
  const p = document.createElement('p');
  p.textContent = 'Select a volume from the list to view details.';
  div.appendChild(h2);
  div.appendChild(p);
  container.appendChild(div);
}
