export function createAppShell() {
  const header = document.createElement('header');
  header.className = 'app-header';
  const h1 = document.createElement('h1');
  h1.innerHTML = 'ΣIGMA <span style="font-size:0.5em;font-weight:normal;opacity:0.7;letter-spacing:0.01em;">Segmentation &amp; Image Guided Medical Annotation</span>';
  header.appendChild(h1);

  const helpButton = document.createElement('button');
  helpButton.textContent = '?';
  helpButton.className = 'btn btn-secondary';
  helpButton.title = 'Help';
  helpButton.setAttribute('aria-label', 'Open help');
  helpButton.style.marginLeft = 'auto';
  helpButton.style.fontWeight = 'bold';
  helpButton.style.fontSize = '1rem';
  helpButton.style.padding = '4px 10px';
  header.appendChild(helpButton);

  const body = document.createElement('div');
  body.className = 'app-body';

  const sidebar = document.createElement('nav');
  sidebar.className = 'sidebar';
  const sidebarHeadingContainer = document.createElement('div');
  sidebarHeadingContainer.style.display = 'flex';
  sidebarHeadingContainer.style.justifyContent = 'space-between';
  sidebarHeadingContainer.style.alignItems = 'center';
  sidebarHeadingContainer.style.marginBottom = '1rem';

  const sidebarHeading = document.createElement('h2');
  sidebarHeading.className = 'sidebar-heading';
  sidebarHeading.textContent = 'Volumes';
  sidebarHeading.style.margin = '0';
  
  const openFolderBtn = document.createElement('button');
  openFolderBtn.textContent = 'Open Folder';
  openFolderBtn.className = 'btn btn-secondary';
  openFolderBtn.style.padding = '4px 8px';
  openFolderBtn.style.fontSize = '0.85rem';

  sidebarHeadingContainer.appendChild(sidebarHeading);
  sidebarHeadingContainer.appendChild(openFolderBtn);
  sidebar.appendChild(sidebarHeadingContainer);
  const listContainer = document.createElement('ul');
  listContainer.className = 'volume-list';
  listContainer.setAttribute('role', 'listbox');
  listContainer.setAttribute('aria-label', 'Available volumes');
  sidebar.appendChild(listContainer);

  const sidebarFooter = document.createElement('div');
  sidebarFooter.className = 'sidebar-footer';
  sidebarFooter.style.marginTop = 'auto';
  sidebarFooter.style.padding = '1rem';
  
  const prefsButton = document.createElement('button');
  prefsButton.className = 'btn btn-secondary';
  prefsButton.textContent = 'Preferences';
  prefsButton.style.width = '100%';
  sidebarFooter.appendChild(prefsButton);
  sidebar.appendChild(sidebarFooter);

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

  return { listContainer, detailPanel, sidebar, toolPanel, prefsButton, openFolderBtn, helpButton };
}
