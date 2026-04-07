// Message listener, keyboard shortcuts, and initialization

// ====== Message Listener ======

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  switch (message.type) {
    case 'contentScriptReady': {
      // During replay, send the replay task's active step items
      let itemsToSend = null;
      if (playingRoundRef) {
        const replayTask = tasks.find(t => t.id === experimentResults[playingRoundRef.taskIdx]?.taskId);
        if (replayTask) {
          const step = getActiveStep(replayTask);
          if (step) itemsToSend = step.items;
        }
      }
      if (!itemsToSend) {
        const step = getActiveTaskStep();
        if (step) itemsToSend = step.items;
      }
      if (itemsToSend) {
        sendToContentScript({
          type: 'loadTaskState',
          items: itemsToSend,
          undoStack: [],
          redoStack: []
        }).then(async () => {
          if (!playingRoundRef) {
            const st = await sendToContentScript({ type: 'getState' });
            if (st) { updateCountsFromState(st); }
          }
        }).catch(() => {});
      }
      break;
    }
    case 'modeChanged':
      currentMode = message.mode;
      updateModeButtons(message.mode);
      break;
    case 'itemAdded': {
      const step = getActiveTaskStep();
      if (step) {
        step.items.push(message.item);
      }
      waypointCount = message.waypointCount ?? waypointCount;
      constraintCount = message.constraintCount ?? constraintCount;
      waypointCountSpan.textContent = waypointCount;
      constraintCountSpan.textContent = constraintCount;
      btnUndo.disabled = false;
      btnRedo.disabled = true;
      const addedType = message.item?.type;
      const typeLabel = addedType === 'waypoint' ? 'Waypoint' : addedType === 'waypoint_click' ? 'Click waypoint' : 'Constraint';
      updateStatus(`${typeLabel} added`, 'success');
      renderTasksList();
      renderExpChecks();

      // Auto-create a new step with a starting waypoint when a click navigates
      if (addedType === 'waypoint_click' && message.item?.data?.gotoUrl) {
        const task = tasks.find(t => t.id === activeTaskId);
        if (task) {
          const d = message.item.data;
          const newStep = createStep(nextStepName(task));
          newStep.items.push({
            id: 'wp-' + Date.now() + '-' + Math.random().toString(36).substr(2, 4),
            type: 'waypoint',
            data: {
              x: d.x,
              y: d.y,
              pixelX: d.pixelX,
              pixelY: d.pixelY,
              pageUrl: d.gotoUrl
            },
            enabled: true
          });
          task.steps.push(newStep);
          task.activeStepIdx = task.steps.length - 1;
          loadStepIntoPage(newStep);
          renderTasksList();
          renderExpChecks();
          updateStatus('New step created for navigation target', 'success');
        }
      }
      break;
    }
    case 'itemsChanged': {
      const step = getActiveTaskStep();
      if (step) {
        step.items = message.items || [];
      }
      waypointCount = message.waypointCount ?? waypointCount;
      constraintCount = message.constraintCount ?? constraintCount;
      waypointCountSpan.textContent = waypointCount;
      constraintCountSpan.textContent = constraintCount;
      renderTasksList();
      break;
    }
    case 'waypointsCleared':
      waypointCount = 0;
      waypointCountSpan.textContent = '0';
      break;
    case 'undoRedoState':
      waypointCount = message.waypointCount ?? waypointCount;
      constraintCount = message.constraintCount ?? constraintCount;
      waypointCountSpan.textContent = waypointCount;
      constraintCountSpan.textContent = constraintCount;
      if (message.canUndo !== undefined) btnUndo.disabled = !message.canUndo;
      if (message.canRedo !== undefined) btnRedo.disabled = !message.canRedo;
      if (message.undo) updateStatus('Undone', 'success');
      if (message.redo) updateStatus('Redone', 'success');
      break;
    case 'constraintsCleared':
      constraintCount = 0;
      constraintCountSpan.textContent = '0';
      break;
    case 'replayComplete':
      if (playingRoundRef) {
        playingRoundRef = null;
        isReplaying = false;
        renderResults();
      }
      break;
    case 'replayStopped':
      if (playingRoundRef) {
        playingRoundRef = null;
        isReplaying = false;
        renderResults();
      }
      break;
  }
  sendResponse({ success: true });
  return true;
});

// ====== Keyboard Shortcuts ======

document.addEventListener('keydown', (e) => {
  if (e.repeat) return;
  // Don't process shortcuts when editing names
  if (document.activeElement?.classList?.contains('task-name-input')) return;
  if (document.activeElement?.classList?.contains('step-name-input')) return;

  if (e.key === 'q' || e.key === 'Q') {
    e.preventDefault();
    setModeInPage('addWaypoint');
  } else if (e.key === 'w' || e.key === 'W') {
    e.preventDefault();
    setModeInPage('moveWaypoint');
  } else if (e.key === 'e' || e.key === 'E') {
    e.preventDefault();
    setModeInPage('addClickWaypoint');
  } else if (e.key === 's' || e.key === 'S') {
    e.preventDefault();
    setModeInPage('addRectKeepIn');
  } else if (e.key === 'd' || e.key === 'D') {
    e.preventDefault();
    setModeInPage('addPathKeepIn');
  } else if (e.key === 'f' || e.key === 'F') {
    e.preventDefault();
    setModeInPage('addRectKeepOut');
  } else if (e.key === 'g' || e.key === 'G') {
    e.preventDefault();
    setModeInPage('addPathKeepOut');
  } else if (e.key === 'a' || e.key === 'A') {
    e.preventDefault();
    setModeInPage('resizeConstraint');
  } else if (e.key === 'Escape') {
    e.preventDefault();
    setModeInPage('passthrough');
  } else if ((e.metaKey || e.ctrlKey) && e.key === 'z' && !e.shiftKey) {
    e.preventDefault();
    sendToContentScript({ type: 'undo' }).catch(() => updateStatus('Refresh the page first.', 'error'));
  } else if ((e.metaKey || e.ctrlKey) && e.key === 'z' && e.shiftKey) {
    e.preventDefault();
    sendToContentScript({ type: 'redo' }).catch(() => updateStatus('Refresh the page first.', 'error'));
  }
});

document.addEventListener('keyup', (e) => {
  if (document.activeElement?.classList?.contains('task-name-input')) return;
  if (document.activeElement?.classList?.contains('step-name-input')) return;

  if (e.key === 'q' || e.key === 'Q' || e.key === 'w' || e.key === 'W' ||
      e.key === 'e' || e.key === 'E' ||
      e.key === 's' || e.key === 'S' || e.key === 'd' || e.key === 'D' ||
      e.key === 'f' || e.key === 'F' || e.key === 'g' || e.key === 'G' ||
      e.key === 'a' || e.key === 'A') {
    e.preventDefault();
    setModeInPage('passthrough');
  }
});

// ====== Initialization ======

(async () => {
  // Initialize personas
  initBuiltinPersonas();
  const savedActivePersona = await loadCustomPersonas();
  if (savedActivePersona) {
    selectPersona(savedActivePersona);
  } else {
    selectPersona('builtin-office_worker');
  }
  renderPersonaSelect();

  // Create default "Task 1" with one step, set as active
  const defaultTask = createTask();
  activeTaskId = defaultTask.id;
  renderTasksList();

  try {
    const st = await sendToContentScript({ type: 'getState' });
    if (st) {
      waypointCount = st.waypoints?.length || 0;
      constraintCount = st.constraints?.length || 0;
      waypointCountSpan.textContent = waypointCount;
      constraintCountSpan.textContent = constraintCount;
      currentMode = st.mode || 'passthrough';
      updateModeButtons(currentMode);
      btnUndo.disabled = !(st.canUndo);
      btnRedo.disabled = !(st.canRedo);
      screenWidth = st.screenWidth || screenWidth;
      if (st.pathDefaultWidth != null && st.screenWidth) {
        const px = Math.round(st.pathDefaultWidth * st.screenWidth);
        corridorWidthSlider.value = Math.max(5, Math.min(80, px));
        updateCorridorWidthLabel();
      }
      // Sync existing items into the default step
      if (st.items && st.items.length > 0) {
        const step = getActiveStep(defaultTask);
        if (step) {
          step.items = st.items;
          step.undoStack = st.undoStack || [];
          step.redoStack = st.redoStack || [];
        }
        renderTasksList();
      }
    }
  } catch (_) {
    updateStatus('Refresh the webpage tab, then open this panel again.', 'error');
  }

  renderExpChecks();
})();
