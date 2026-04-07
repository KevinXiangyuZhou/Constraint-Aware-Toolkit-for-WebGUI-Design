// Task management, UI rendering, tool button event listeners

// ====== Task & Step Management ======

function generateTaskId() {
  return 'task-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9);
}

function generateStepId() {
  return 'step-' + Date.now() + '-' + Math.random().toString(36).substr(2, 6);
}

function nextStepName(task) {
  // Find the highest existing "Step N" number in this task and increment
  let max = 0;
  if (task && task.steps) {
    for (const s of task.steps) {
      const m = s.name.match(/^Step\s+(\d+)$/);
      if (m) max = Math.max(max, parseInt(m[1], 10));
    }
  }
  return 'Step ' + (max + 1);
}

function createStep(name) {
  return {
    id: generateStepId(),
    name: name || 'Step 1',
    items: [],
    undoStack: [],
    redoStack: [],
    expanded: true
  };
}

function createTask(name) {
  const id = generateTaskId();
  if (!name) {
    name = 'Task ' + nextTaskNumber;
    nextTaskNumber++;
  }
  const step = createStep('Step 1');
  const task = {
    id,
    name,
    steps: [step],
    activeStepIdx: 0,
    expanded: true
  };
  tasks.push(task);
  return task;
}

// Helper: get the active step of a task
function getActiveStep(task) {
  if (!task || !task.steps || task.steps.length === 0) return null;
  const idx = Math.max(0, Math.min(task.activeStepIdx || 0, task.steps.length - 1));
  return task.steps[idx];
}

// Helper: get active step of the currently active task
function getActiveTaskStep() {
  const task = tasks.find(t => t.id === activeTaskId);
  return task ? getActiveStep(task) : null;
}

async function saveActiveStepState() {
  const step = getActiveTaskStep();
  if (!step) return;
  try {
    const st = await sendToContentScript({ type: 'getState' });
    if (st) {
      step.items = st.items || [];
      step.undoStack = st.undoStack || [];
      step.redoStack = st.redoStack || [];
    }
  } catch (_) {}
}

// Alias kept for backward compat with experiment runner
var saveActiveTaskState = saveActiveStepState;

async function loadStepIntoPage(step) {
  if (!step) return;
  try {
    await sendToContentScript({
      type: 'loadTaskState',
      items: step.items,
      undoStack: step.undoStack || [],
      redoStack: step.redoStack || []
    });
    const st = await sendToContentScript({ type: 'getState' });
    if (st) {
      updateCountsFromState(st);
      btnUndo.disabled = !(st.canUndo);
      btnRedo.disabled = !(st.canRedo);
    }
  } catch (_) {}
}

async function switchToStep(task, stepIdx) {
  // Save current step first
  await saveActiveStepState();
  task.activeStepIdx = stepIdx;
  await loadStepIntoPage(getActiveStep(task));
  renderTasksList();
}

async function addNewTask() {
  await saveActiveStepState();

  const task = createTask();
  activeTaskId = task.id;

  await loadStepIntoPage(getActiveStep(task));
  renderTasksList();
  renderExpChecks();
}

async function switchToTask(taskId) {
  if (activeTaskId === taskId) return;

  await saveActiveStepState();

  activeTaskId = taskId;
  const newTask = tasks.find(t => t.id === taskId);

  if (newTask) {
    await loadStepIntoPage(getActiveStep(newTask));
  } else {
    try {
      await sendToContentScript({
        type: 'loadTaskState', items: [], undoStack: [], redoStack: []
      });
    } catch (_) {}
  }

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
      activeTaskId = task.id;
      await loadStepIntoPage(getActiveStep(task));
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

function renameStep(task, stepIdx, newName) {
  newName = newName.trim();
  if (!newName) return false;
  if (task.steps[stepIdx]) {
    task.steps[stepIdx].name = newName;
    renderTasksList();
    return true;
  }
  return false;
}

async function addStepToTask(task) {
  // Save current step before adding new one
  if (task.id === activeTaskId) await saveActiveStepState();
  const step = createStep(nextStepName(task));
  task.steps.push(step);
  task.activeStepIdx = task.steps.length - 1;
  if (task.id === activeTaskId) {
    await loadStepIntoPage(step);
  }
  renderTasksList();
  renderExpChecks();
}

async function deleteStep(task, stepIdx) {
  if (task.steps.length <= 1) return; // keep at least one step

  const wasActive = task.id === activeTaskId && task.activeStepIdx === stepIdx;
  task.steps.splice(stepIdx, 1);

  // Adjust activeStepIdx
  if (task.activeStepIdx >= task.steps.length) {
    task.activeStepIdx = task.steps.length - 1;
  }

  if (wasActive && task.id === activeTaskId) {
    await loadStepIntoPage(getActiveStep(task));
  }

  renderTasksList();
  renderExpChecks();
}

async function deleteItemFromTask(taskId, itemId) {
  const task = tasks.find(t => t.id === taskId);
  if (!task) return;

  // Find and remove item from whichever step contains it
  for (const step of task.steps) {
    const idx = step.items.findIndex(i => i.id === itemId);
    if (idx >= 0) {
      step.items.splice(idx, 1);
      break;
    }
  }

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

  for (const step of task.steps) {
    const item = step.items.find(i => i.id === itemId);
    if (item) { item.enabled = enabled; break; }
  }

  if (taskId === activeTaskId) {
    try {
      await sendToContentScript({ type: 'toggleConstraintEnabled', itemId, enabled });
    } catch (_) {}
  }

  renderTasksList();
}

async function reorderStepItems(taskId, stepId, newItemIds) {
  const task = tasks.find(t => t.id === taskId);
  if (!task) return;
  const step = task.steps.find(s => s.id === stepId);
  if (!step) return;

  const itemMap = {};
  step.items.forEach(i => { itemMap[i.id] = i; });
  step.items = newItemIds.map(id => itemMap[id]).filter(Boolean);

  if (taskId === activeTaskId) {
    try {
      await sendToContentScript({ type: 'reorderItems', itemIds: newItemIds });
      const st = await sendToContentScript({ type: 'getState' });
      if (st) updateCountsFromState(st);
    } catch (_) {}
  }

  renderTasksList();
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

    // Render each step
    task.steps.forEach((step, stepIdx) => {
      const isActiveStep = isActive && task.activeStepIdx === stepIdx;

      const stepEl = document.createElement('div');
      stepEl.className = 'step-container' + (isActiveStep ? ' active-step' : '');

      // Step header
      const stepHeader = document.createElement('div');
      stepHeader.className = 'step-header';

      const stepExpandIcon = document.createElement('span');
      stepExpandIcon.className = 'step-expand-icon' + (step.expanded ? ' expanded' : '');
      stepExpandIcon.textContent = '\u25B6';

      const stepNameEl = document.createElement('span');
      stepNameEl.className = 'step-name';
      stepNameEl.textContent = step.name;

      const stepActionsEl = document.createElement('div');
      stepActionsEl.className = 'step-actions';

      const stepRenameBtn = document.createElement('button');
      stepRenameBtn.className = 'task-action-btn';
      stepRenameBtn.title = 'Rename step';
      stepRenameBtn.innerHTML = '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/></svg>';
      stepRenameBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        startStepInlineRename(stepHeader, task, stepIdx);
      });

      const stepDeleteBtn = document.createElement('button');
      stepDeleteBtn.className = 'task-action-btn delete-btn';
      stepDeleteBtn.title = 'Delete step';
      stepDeleteBtn.textContent = '\u00D7';
      stepDeleteBtn.style.fontSize = '12px';
      stepDeleteBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        deleteStep(task, stepIdx);
      });

      stepActionsEl.appendChild(stepRenameBtn);
      if (task.steps.length > 1) stepActionsEl.appendChild(stepDeleteBtn);

      stepHeader.appendChild(stepExpandIcon);
      stepHeader.appendChild(stepNameEl);
      stepHeader.appendChild(stepActionsEl);
      stepEl.appendChild(stepHeader);

      // Step expand/collapse
      stepExpandIcon.addEventListener('click', (e) => {
        e.stopPropagation();
        step.expanded = !step.expanded;
        renderTasksList();
      });

      // Click header to switch to this step
      stepHeader.addEventListener('click', () => {
        if (!isActive) {
          switchToTask(task.id);
        } else if (!isActiveStep) {
          switchToStep(task, stepIdx);
        } else {
          step.expanded = !step.expanded;
          renderTasksList();
        }
      });

      // Step items list (collapsible)
      if (step.expanded) {
        const itemsListEl = document.createElement('div');
        itemsListEl.className = 'step-items-list';
        itemsListEl.dataset.taskId = task.id;
        itemsListEl.dataset.stepId = step.id;

        let wpNum = 0, cNum = 0, clickNum = 0;

        step.items.forEach(item => {
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
            if (item.data?.gotoUrl) {
              const displayUrl = item.data.gotoUrl;
              const shortUrl = displayUrl.length > 30 ? displayUrl.slice(0, 27) + '\u2026' : displayUrl;
              label.textContent = 'Click ' + clickNum + ' (Go to ' + shortUrl + ')';
              label.title = displayUrl;
            } else {
              label.textContent = 'Click ' + clickNum;
              if (item.data?.selector) label.title = item.data.selector;
            }
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

        if (step.items.length === 0) {
          const emptyMsg = document.createElement('div');
          emptyMsg.className = 'task-empty-msg';
          emptyMsg.textContent = 'No items yet';
          itemsListEl.appendChild(emptyMsg);
        }

        stepEl.appendChild(itemsListEl);
        setupStepItemDragDrop(itemsListEl, task.id, step.id);
      }

      bodyEl.appendChild(stepEl);
    });

    // "Add Step" button
    const addStepBtn = document.createElement('div');
    addStepBtn.className = 'step-add-btn';
    addStepBtn.textContent = '+ Add Step';
    addStepBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      addStepToTask(task);
    });
    bodyEl.appendChild(addStepBtn);

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
    if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
    else if (e.key === 'Escape') { e.preventDefault(); input.value = task.name; input.blur(); }
  });
}

function startStepInlineRename(stepHeader, task, stepIdx) {
  const nameEl = stepHeader.querySelector('.step-name');
  if (!nameEl) return;

  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'step-name-input';
  input.value = task.steps[stepIdx].name;

  nameEl.replaceWith(input);
  input.focus();
  input.select();

  let finished = false;
  function finishRename() {
    if (finished) return;
    finished = true;
    renameStep(task, stepIdx, input.value);
  }

  input.addEventListener('blur', finishRename);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
    else if (e.key === 'Escape') { e.preventDefault(); input.value = task.steps[stepIdx].name; input.blur(); }
  });
}

// ====== Drag and Drop for Step Items ======

function setupStepItemDragDrop(container, taskId, stepId) {
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

    reorderStepItems(taskId, stepId, filteredIds);
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
  if (confirm('Clear all items in the current step?')) {
    try {
      await sendToContentScript({ type: 'clearAll' });
      waypointCount = 0;
      constraintCount = 0;
      waypointCountSpan.textContent = '0';
      constraintCountSpan.textContent = '0';
      // Clear active step's items
      const step = getActiveTaskStep();
      if (step) {
        step.items = [];
        step.undoStack = [];
        step.redoStack = [];
      }
      btnUndo.disabled = true;
      btnRedo.disabled = true;
      renderTasksList();
      updateStatus('Cleared all items in step', 'success');
    } catch (err) {
      updateStatus('Refresh the page first, then try again.', 'error');
    }
  }
});
