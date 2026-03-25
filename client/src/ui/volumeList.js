export function renderVolumeList(volumes, container, onSelect) {
  container.innerHTML = '';
  if (volumes.length === 0) {
    const li = document.createElement('li');
    li.className = 'volume-item';
    li.textContent = 'No volumes found.';
    container.appendChild(li);
    return;
  }
  for (const vol of volumes) {
    const li = document.createElement('li');
    li.className = 'volume-item';
    li.setAttribute('role', 'option');
    li.setAttribute('aria-selected', 'false');
    li.setAttribute('tabindex', '0');
    li.dataset.volumeId = vol.id;

    const headerRow = document.createElement('div');
    headerRow.className = 'volume-item-header';

    const name = document.createElement('span');
    name.className = 'volume-name';
    name.textContent = vol.filename || vol.name;

    const badge = document.createElement('span');
    badge.className = `volume-badge ${vol.format}`;
    badge.textContent = vol.format.toUpperCase();

    headerRow.appendChild(name);
    headerRow.appendChild(badge);

    const dims = document.createElement('span');
    dims.className = 'volume-dims';
    dims.textContent = `${vol.dimensions[0]} x ${vol.dimensions[1]} x ${vol.dimensions[2]}`;

    li.appendChild(headerRow);
    li.appendChild(dims);

    li.addEventListener('click', () => onSelect(vol));
    li.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        onSelect(vol);
      }
    });

    container.appendChild(li);
  }
}
