// shared.js - common utilities for all pages

function $(sel) { return document.querySelector(sel); }

function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 2200);
}

function formatSize(bytes) {
  if (!bytes) return '';
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(0) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

// Setup draggable file icon for detail view (move file to sidebar folder)
function setupDetailDrag(iconEl, getFile) {
  iconEl.draggable = true;
  iconEl.addEventListener('dragstart', e => {
    const file = getFile();
    if (!file) return;
    e.dataTransfer.effectAllowed = 'move';
    const path = file.relPath || file.path;
    e.dataTransfer.setData('text/plain', path);
    window._detailDragPaths = [path];
    window._detailDragObjs = [file];
    iconEl.style.opacity = '0.4';
  });
  iconEl.addEventListener('dragend', () => {
    iconEl.style.opacity = '';
    window._detailDragPaths = null;
    window._detailDragObjs = null;
  });
}
