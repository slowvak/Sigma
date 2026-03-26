export function createAppShell() {
  const header = document.createElement('header');
  header.className = 'app-header';
  const h1 = document.createElement('h1');
  h1.textContent = 'NextEd';
  header.appendChild(h1);

  const body = document.createElement('div');
  body.className = 'app-body';

  const sidebar = document.createElement('nav');
  sidebar.className = 'sidebar';
  const sidebarHeading = document.createElement('h2');
  sidebarHeading.className = 'sidebar-heading';
  sidebarHeading.textContent = 'Volumes';
  sidebar.appendChild(sidebarHeading);
  const listContainer = document.createElement('ul');
  listContainer.className = 'volume-list';
  listContainer.setAttribute('role', 'listbox');
  listContainer.setAttribute('aria-label', 'Available volumes');
  sidebar.appendChild(listContainer);

  const toolPanel = document.createElement('div');
  toolPanel.className = 'tool-panel';
  toolPanel.style.display = 'none';

  const detailPanel = document.createElement('main');
  detailPanel.className = 'detail-panel';

  body.appendChild(sidebar);
  body.appendChild(toolPanel);
  body.appendChild(detailPanel);

  const app = document.getElementById('app');
  app.innerHTML = '';
  app.appendChild(header);
  app.appendChild(body);

  return { listContainer, detailPanel, sidebar, toolPanel };
}
