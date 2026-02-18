// Task management, UI rendering, tool button event listeners

// ====== Task Management ======

function generateTaskId() {
  return 'task-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9);
}

function createTask(name) {
  const id = generateTaskId();
  if (!name) {
    name = 'Task ' + nextTaskNumber;
    nextTaskNumber++;
  }
  const task = {
    id,
    name,
    items: [],
    undoStack: [],
    redoStack: [],
    expanded: false
  };
  tasks.push(task);
  return task;
}

var gotoItemCounter = 0;
function makeGotoItem(url) {
  return { id: 'goto-' + Date.now() + '-' + (gotoItemCounter++), type: 'goto', data: { url: url || '' }, enabled: true };
}

async function insertInitialGoto(task) {
  try {
    const tab = await getCurrentTab();
    if (tab?.url) {
      const item = makeGotoItem(tab.url);
      task.items.unshift(item);
    }
  } catch (_) {}
}

async function saveActiveTaskState() {
  if (!activeTaskId) return;
  const task = tasks.find(t => t.id === activeTaskId);
  if (!task) return;
  try {
    const st = await sendToContentScript({ type: 'getState' });
    if (st) {
      task.items = st.items || [];
      task.undoStack = st.undoStack || [];
      task.redoStack = st.redoStack || [];
    }
  } catch (_) {}
}

async function addNewTask() {
  await saveActiveTaskState();

  const task = createTask();
  await insertInitialGoto(task);
  activeTaskId = task.id;

  try {
    await sendToContentScript({
      type: 'loadTaskState',
      items: task.items,
      undoStack: [],
      redoStack: []
    });
    updateCountsFromState({ waypoints: [], constraints: [] });
    btnUndo.disabled = true;
    btnRedo.disabled = true;
  } catch (_) {}

  renderTasksList();
  renderExpChecks();
}

async function switchToTask(taskId) {
  if (activeTaskId === taskId) return;

  await saveActiveTaskState();

  activeTaskId = taskId;
  const newTask = tasks.find(t => t.id === taskId);

  try {
    await sendToContentScript({
      type: 'loadTaskState',
      items: newTask ? newTask.items : [],
      undoStack: newTask ? newTask.undoStack : [],
      redoStack: newTask ? newTask.redoStack : []
    });

    const st = await sendToContentScript({ type: 'getState' });
    if (st) {
      updateCountsFromState(st);
      btnUndo.disabled = !(st.canUndo);
      btnRedo.disabled = !(st.canRedo);
    }
  } catch (_) {}

  renderTasksList();
}

async function deleteTask(taskId) {
  const idx = tasks.findIndex(t => t.id === taskId);
  if (idx < 0) return;

  const wasActive = taskId === activeTaskId;
  tasks.splice(idx, 1);

  if (wasActive) {
    if (tasks.length > 0) {
      const nextIdx = Math.min(idx, tasks.length - 1);
      activeTaskId = null;
      await switchToTask(tasks[nextIdx].id);
    } else {
      const task = createTask();
      await insertInitialGoto(task);
      activeTaskId = task.id;
      try {
        await sendToContentScript({
          type: 'loadTaskState',
          items: task.items,
          undoStack: [],
          redoStack: []
        });
        updateCountsFromState({ waypoints: [], constraints: [] });
        btnUndo.disabled = true;
        btnRedo.disabled = true;
      } catch (_) {}
    }
  }

  renderTasksList();
  renderExpChecks();
}

function renameTask(taskId, newName) {
  newName = newName.trim();
  if (!newName) return false;
  if (tasks.some(t => t.id !== taskId && t.name === newName)) return false;
  const task = tasks.find(t => t.id === taskId);
  if (task) {
    task.name = newName;
    renderTasksList();
    return true;
  }
  return false;
}

async function deleteItemFromTask(taskId, itemId) {
  const task = tasks.find(t => t.id === taskId);
  if (!task) return;

  task.items = task.items.filter(i => i.id !== itemId);

  if (taskId === activeTaskId) {
    try {
      await sendToContentScript({ type: 'deleteItem', itemId });
      const st = await sendToContentScript({ type: 'getState' });
      if (st) {
        updateCountsFromState(st);
        btnUndo.disabled = !(st.canUndo);
        btnRedo.disabled = !(st.canRedo);
      }
    } catch (_) {}
  }

  renderTasksList();
}

async function toggleConstraintItem(taskId, itemId, enabled) {
  const task = tasks.find(t => t.id === taskId);
  if (!task) return;

  const item = task.items.find(i => i.id === itemId);
  if (item) item.enabled = enabled;

  if (taskId === activeTaskId) {
    try {
      await sendToContentScript({ type: 'toggleConstraintEnabled', itemId, enabled });
    } catch (_) {}
  }

  renderTasksList();
}

async function reorderTaskItems(taskId, newItemIds) {
  const task = tasks.find(t => t.id === taskId);
  if (!task) return;

  const itemMap = {};
  task.items.forEach(i => { itemMap[i.id] = i; });
  task.items = newItemIds.map(id => itemMap[id]).filter(Boolean);

  if (taskId === activeTaskId) {
    try {
      await sendToContentScript({ type: 'reorderItems', itemIds: newItemIds });
      const st = await sendToContentScript({ type: 'getState' });
      if (st) updateCountsFromState(st);
    } catch (_) {}
  }

  renderTasksList();
}

async function addGotoToActiveTask(url) {
  const task = tasks.find(t => t.id === activeTaskId);
  if (!task) return;
  const item = makeGotoItem(url);
  task.items.push(item);
  renderTasksList();
  renderExpChecks();
}

function updateCountsFromState(st) {
  waypointCount = st.waypoints?.length || 0;
  constraintCount = st.constraints?.length || 0;
  waypointCountSpan.textContent = waypointCount;
  constraintCountSpan.textContent = constraintCount;
}

// ====== Task UI Rendering ======

function renderTasksList() {
  if (!tasksListEl) return;
  tasksListEl.innerHTML = '';

  tasks.forEach(task => {
    const isActive = task.id === activeTaskId;

    // Task container
    const taskEl = document.createElement('div');
    taskEl.className = 'task-item' + (isActive ? ' active' : '');

    // Header
    const headerEl = document.createElement('div');
    headerEl.className = 'task-header';

    const expandIcon = document.createElement('span');
    expandIcon.className = 'task-expand-icon' + (task.expanded ? ' expanded' : '');
    expandIcon.textContent = '\u25B6';

    const nameEl = document.createElement('span');
    nameEl.className = 'task-name';
    nameEl.textContent = task.name;

    const actionsEl = document.createElement('div');
    actionsEl.className = 'task-actions';

    const renameBtn = document.createElement('button');
    renameBtn.className = 'task-action-btn';
    renameBtn.title = 'Rename';
    renameBtn.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/></svg>';

    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'task-action-btn delete-btn';
    deleteBtn.title = 'Delete task';
    deleteBtn.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></svg>';

    actionsEl.appendChild(renameBtn);
    actionsEl.appendChild(deleteBtn);

    headerEl.appendChild(expandIcon);
    headerEl.appendChild(nameEl);
    headerEl.appendChild(actionsEl);
    taskEl.appendChild(headerEl);

    // Body (expandable)
    const bodyEl = document.createElement('div');
    bodyEl.className = 'task-body';
    bodyEl.style.display = task.expanded ? 'block' : 'none';

    const itemsListEl = document.createElement('div');
    itemsListEl.className = 'task-items-list';
    itemsListEl.dataset.taskId = task.id;

    let wpNum = 0;
    let cNum = 0;
    let clickNum = 0;

    // Determine the first page URL in the task for comparison
    const firstPageUrl = (() => {
      for (const it of task.items) {
        const u = it.data?.pageUrl || it.data?.url;
        if (u) return u.split('#')[0];
      }
      return null;
    })();

    task.items.forEach(item => {
      const row = document.createElement('div');
      row.className = 'task-item-row';
      row.dataset.itemId = item.id;
      row.draggable = true;

      const handle = document.createElement('span');
      handle.className = 'drag-handle';
      handle.textContent = '\u2807';

      const icon = document.createElement('span');
      icon.className = 'item-icon';

      const label = document.createElement('span');
      label.className = 'item-label';

      if (item.type === 'waypoint') {
        wpNum++;
        icon.classList.add('waypoint-icon');
        icon.textContent = '\u25CF';
        label.textContent = 'Waypoint ' + wpNum;
      } else if (item.type === 'waypoint_click') {
        clickNum++;
        icon.classList.add('click-icon');
        icon.textContent = '\u25CF';
        label.textContent = 'Click ' + clickNum;
        if (item.data?.selector) label.title = item.data.selector;
      } else if (item.type === 'goto') {
        icon.classList.add('goto-icon');
        icon.textContent = '\u2192';
        const displayUrl = item.data?.url || '';
        const shortUrl = displayUrl.length > 40 ? displayUrl.slice(0, 37) + '\u2026' : displayUrl;
        label.textContent = 'Go to ' + shortUrl;
        label.title = displayUrl;
      } else {
        cNum++;
        const isKeepOut = item.data?.constraintType === 'keep-out';
        icon.classList.add('constraint-icon');
        if (isKeepOut) icon.classList.add('keep-out');
        icon.textContent = '\u25A1';
        const geom = item.data?.type === 'path' ? 'Corridor' : 'Area';
        const cType = isKeepOut ? 'Keep-Out' : 'Keep-In';
        const enabledLabel = item.enabled !== false ? 'Enabled' : 'Disabled';
        label.textContent = geom + ' ' + cType + ' (' + enabledLabel + ')';
      }

      row.appendChild(handle);
      row.appendChild(icon);
      row.appendChild(label);

      // Show a small hostname badge if this item is from a different page
      const itemUrl = item.data?.pageUrl || (item.type === 'goto' ? item.data?.url : null);
      if (itemUrl && firstPageUrl && itemUrl.split('#')[0] !== firstPageUrl) {
        try {
          const badge = document.createElement('span');
          badge.className = 'item-page-badge';
          badge.textContent = new URL(itemUrl).hostname;
          badge.title = itemUrl;
          row.appendChild(badge);
        } catch (_) {}
      }

      // Constraint toggle
      if (item.type === 'constraint') {
        const toggleWrap = document.createElement('span');
        toggleWrap.className = 'item-toggle-wrap';
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.checked = item.enabled !== false;
        checkbox.title = item.enabled !== false ? 'Disable constraint' : 'Enable constraint';
        checkbox.addEventListener('change', () => {
          toggleConstraintItem(task.id, item.id, checkbox.checked);
        });
        toggleWrap.appendChild(checkbox);
        row.appendChild(toggleWrap);
      }

      // Delete button
      const delBtn = document.createElement('button');
      delBtn.className = 'item-action-btn';
      delBtn.title = 'Delete';
      delBtn.textContent = '\u00D7';
      delBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        deleteItemFromTask(task.id, item.id);
      });
      row.appendChild(delBtn);

      itemsListEl.appendChild(row);
    });

    if (task.items.length === 0) {
      const emptyMsg = document.createElement('div');
      emptyMsg.className = 'task-empty-msg';
      emptyMsg.textContent = 'No items yet';
      itemsListEl.appendChild(emptyMsg);
    }

    bodyEl.appendChild(itemsListEl);
    taskEl.appendChild(bodyEl);

    // Event listeners
    expandIcon.addEventListener('click', (e) => {
      e.stopPropagation();
      task.expanded = !task.expanded;
      renderTasksList();
    });

    headerEl.addEventListener('click', () => {
      if (!isActive) {
        switchToTask(task.id);
      } else {
        task.expanded = !task.expanded;
        renderTasksList();
      }
    });

    renameBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      startInlineRename(headerEl, task);
    });

    deleteBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      deleteTask(task.id);
    });

    // Setup drag-and-drop for items
    setupItemDragDrop(itemsListEl, task.id);

    tasksListEl.appendChild(taskEl);
  });
}

function startInlineRename(headerEl, task) {
  const nameEl = headerEl.querySelector('.task-name');
  if (!nameEl) return;

  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'task-name-input';
  input.value = task.name;

  nameEl.replaceWith(input);
  input.focus();
  input.select();

  let finished = false;
  function finishRename() {
    if (finished) return;
    finished = true;
    const newName = input.value.trim();
    if (newName && newName !== task.name) {
      if (!renameTask(task.id, newName)) {
        updateStatus('Task name must be unique', 'error');
      }
    }
    renderTasksList();
  }

  input.addEventListener('blur', finishRename);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      input.blur();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      input.value = task.name;
      input.blur();
    }
  });
}

// ====== Drag and Drop for Task Items ======

function setupItemDragDrop(container, taskId) {
  let draggedItemId = null;

  container.addEventListener('dragstart', (e) => {
    const row = e.target.closest('.task-item-row');
    if (!row) return;
    draggedItemId = row.dataset.itemId;
    row.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
  });

  container.addEventListener('dragend', (e) => {
    const row = e.target.closest('.task-item-row');
    if (row) row.classList.remove('dragging');
    container.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over'));
    draggedItemId = null;
  });

  container.addEventListener('dragover', (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    container.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over'));
    const afterElement = getDragAfterElement(container, e.clientY);
    if (afterElement && afterElement.dataset.itemId !== draggedItemId) {
      afterElement.classList.add('drag-over');
    }
  });

  container.addEventListener('dragleave', (e) => {
    if (!container.contains(e.relatedTarget)) {
      container.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over'));
    }
  });

  container.addEventListener('drop', (e) => {
    e.preventDefault();
    container.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over'));
    if (!draggedItemId) return;

    const rows = Array.from(container.querySelectorAll('.task-item-row'));
    const currentIds = rows.map(r => r.dataset.itemId);
    const filteredIds = currentIds.filter(id => id !== draggedItemId);

    const afterElement = getDragAfterElement(container, e.clientY);
    if (afterElement) {
      const insertIdx = filteredIds.indexOf(afterElement.dataset.itemId);
      filteredIds.splice(insertIdx, 0, draggedItemId);
    } else {
      filteredIds.push(draggedItemId);
    }

    reorderTaskItems(taskId, filteredIds);
  });
}

function getDragAfterElement(container, y) {
  const draggableElements = [...container.querySelectorAll('.task-item-row:not(.dragging)')];

  return draggableElements.reduce((closest, child) => {
    const box = child.getBoundingClientRect();
    const offset = y - box.top - box.height / 2;
    if (offset < 0 && offset > closest.offset) {
      return { offset, element: child };
    }
    return closest;
  }, { offset: Number.NEGATIVE_INFINITY }).element;
}

// ====== Tool Button Event Listeners ======

btnAddWaypoint.addEventListener('click', () => setModeInPage('addWaypoint'));
btnMoveWaypoint.addEventListener('click', () => setModeInPage('moveWaypoint'));
btnRectKeepIn.addEventListener('click', () => setModeInPage('addRectKeepIn'));
btnRectKeepOut.addEventListener('click', () => setModeInPage('addRectKeepOut'));
btnPathKeepIn.addEventListener('click', () => setModeInPage('addPathKeepIn'));
btnPathKeepOut.addEventListener('click', () => setModeInPage('addPathKeepOut'));
btnResizeConstraint.addEventListener('click', () => setModeInPage('resizeConstraint'));
btnAddClick.addEventListener('click', () => setModeInPage('addClickWaypoint'));
document.getElementById('btn-add-goto').addEventListener('click', async () => {
  const tab = await getCurrentTab().catch(() => null);
  const defaultUrl = tab?.url || 'https://';
  const url = prompt('Enter URL for Go-to action:', defaultUrl);
  if (url && url.trim()) addGotoToActiveTask(url.trim());
});
btnQuitDesign.addEventListener('click', () => setModeInPage('passthrough'));

btnUndo.addEventListener('click', async () => {
  try {
    await sendToContentScript({ type: 'undo' });
  } catch (err) {
    updateStatus('Refresh the page first, then try again.', 'error');
  }
});

btnRedo.addEventListener('click', async () => {
  try {
    await sendToContentScript({ type: 'redo' });
  } catch (err) {
    updateStatus('Refresh the page first, then try again.', 'error');
  }
});

// Task add button
btnAddTask.addEventListener('click', () => addNewTask());

// Corridor width slider
function updateCorridorWidthLabel() {
  const px = parseInt(corridorWidthSlider.value, 10);
  corridorWidthValue.textContent = px + ' px';
}

async function onCorridorWidthChange() {
  updateCorridorWidthLabel();
  const px = parseInt(corridorWidthSlider.value, 10);
  try {
    const st = await sendToContentScript({ type: 'getState' });
    const w = st.screenWidth || screenWidth;
    screenWidth = w;
    const normalized = px / w;
    await sendToContentScript({ type: 'setPathDefaultWidth', normalized });
  } catch (_) {}
}

corridorWidthSlider.addEventListener('input', onCorridorWidthChange);

btnClear.addEventListener('click', async () => {
  if (confirm('Clear all waypoints and constraints?')) {
    try {
      await sendToContentScript({ type: 'clearAll' });
      waypointCount = 0;
      constraintCount = 0;
      waypointCountSpan.textContent = '0';
      constraintCountSpan.textContent = '0';
      // Clear active task's items
      const task = tasks.find(t => t.id === activeTaskId);
      if (task) {
        task.items = [];
        task.undoStack = [];
        task.redoStack = [];
      }
      btnUndo.disabled = true;
      btnRedo.disabled = true;
      renderTasksList();
      updateStatus('Cleared all waypoints and constraints', 'success');
    } catch (err) {
      updateStatus('Refresh the page first, then try again.', 'error');
    }
  }
});
