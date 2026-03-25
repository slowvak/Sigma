const API_BASE = '/api';

export async function fetchVolumes() {
  const response = await fetch(`${API_BASE}/volumes`);
  if (!response.ok) throw new Error(`Failed to fetch volumes: ${response.status}`);
  return response.json();
}

export async function fetchVolumeMetadata(volumeId) {
  const response = await fetch(`${API_BASE}/volumes/${volumeId}/metadata`);
  if (!response.ok) throw new Error(`Failed to fetch metadata: ${response.status}`);
  return response.json();
}

export async function fetchVolumeData(volumeId) {
  const response = await fetch(`${API_BASE}/volumes/${volumeId}/data`);
  if (!response.ok) throw new Error(`Failed to fetch volume data: ${response.status}`);
  return response.arrayBuffer();
}
