// Event handlers, message handler, and initialization

document.addEventListener('mousedown', (e) => {
  if (isDesignMode()) {
    e.preventDefault();
    e.stopPropagation();
  }
  const px = e.clientX, py = e.clientY;
  if (state.mode === 'addWaypoint') {
    addWaypoint(px, py);
  } else if (state.mode === 'addClickWaypoint') {
    addClickWaypoint(px, py);
  } else if (state.mode === 'moveWaypoint') {
    const idx = hitTestWaypoint(px, py);
    if (idx >= 0) {
      state.draggingWaypointIndex = idx;
    }
  } else if (state.mode === 'addRectKeepIn' || state.mode === 'addRectKeepOut') {
    startConstraint(px, py);
  } else if (state.mode === 'addPathKeepIn' || state.mode === 'addPathKeepOut') {
    state.pathWaypoints.push({
      x: px / state.screenWidth,
      y: py / state.screenHeight,
      pixelX: px,
      pixelY: py
    });
    renderOverlay();
  } else if (state.mode === 'resizeConstraint') {
    const hit = hitTestConstraint(px, py);
    if (hit) {
      const c = state.constraints[hit.index];
      state.resizingConstraintIndex = hit.index;
      state.resizingHandle = hit.handle;
      if (c.type === 'path') {
        state.resizeStart = { mx: px, my: py, path: c.path.map(([nx, ny]) => [nx * state.screenWidth, ny * state.screenHeight]), width: c.width, waypointIndex: hit.waypointIndex };
      } else {
        state.resizeStart = {
          mx: px, my: py,
          x: c.x * state.screenWidth,
          y: c.y * state.screenHeight,
          w: c.width * state.screenWidth,
          h: c.height * state.screenHeight
        };
      }
    }
  }
}, true);

document.addEventListener('mousemove', (e) => {
  state.lastMouseX = e.clientX;
  state.lastMouseY = e.clientY;
}, { capture: true, passive: true });

['mouseover', 'mouseout', 'mouseenter', 'mouseleave',
 'pointerover', 'pointerout', 'pointerenter', 'pointerleave',
 'pointermove',
 'click', 'auxclick', 'dblclick'].forEach(evtName => {
  document.addEventListener(evtName, blockPageEventInDesignMode, true);
});

document.addEventListener('mousemove', (e) => {
  const px = e.clientX, py = e.clientY;
  if (isDesignMode()) {
    e.preventDefault();
    e.stopPropagation();
  }
  if (state.draggingWaypointIndex !== null) {
    updateWaypointPosition(state.draggingWaypointIndex, px, py);
  } else if ((state.mode === 'addRectKeepIn' || state.mode === 'addRectKeepOut') && state.constraintStart) {
    updateConstraint(px, py);
  } else if (state.resizingConstraintIndex !== null && state.resizeStart) {
    const c = state.constraints[state.resizingConstraintIndex];
    if (c.type === 'path') {
      applyResizePath(state.resizingConstraintIndex, state.resizingHandle, state.resizeStart, px, py);
    } else {
      const dx = px - state.resizeStart.mx, dy = py - state.resizeStart.my;
      applyResize(state.resizingConstraintIndex, state.resizingHandle,
        { x: state.resizeStart.x, y: state.resizeStart.y, w: state.resizeStart.w, h: state.resizeStart.h },
        dx, dy);
    }
  } else if (state.mode === 'addPathKeepIn' || state.mode === 'addPathKeepOut') {
    state.pathPreviewCursor = { x: px, y: py };
    renderOverlay();
  }
}, true);

document.addEventListener('mouseup', (e) => {
  if (isDesignMode()) {
    e.preventDefault();
    e.stopPropagation();
  }
  if ((state.mode === 'addRectKeepIn' || state.mode === 'addRectKeepOut') && state.constraintStart) {
    const constraintType = state.mode === 'addRectKeepOut' ? 'keep-out' : 'keep-in';
    finishConstraint(e.clientX, e.clientY, constraintType);
  } else if (state.draggingWaypointIndex !== null) {
    state.draggingWaypointIndex = null;
  } else if (state.resizingConstraintIndex !== null) {
    state.resizingConstraintIndex = null;
    state.resizingHandle = null;
    state.resizeStart = null;
  }
}, true);

document.addEventListener('keydown', (e) => {
  if (e.repeat) return;
  if (e.key === 'q' || e.key === 'Q') {
    e.preventDefault();
    e.stopPropagation();
    setMode('addWaypoint');
  } else if (e.key === 'w' || e.key === 'W') {
    e.preventDefault();
    e.stopPropagation();
    setMode('moveWaypoint');
  } else if (e.key === 'e' || e.key === 'E') {
    e.preventDefault();
    e.stopPropagation();
    setMode('addClickWaypoint');
  } else if (e.key === 's' || e.key === 'S') {
    e.preventDefault();
    e.stopPropagation();
    setMode('addRectKeepIn');
  } else if (e.key === 'd' || e.key === 'D') {
    e.preventDefault();
    e.stopPropagation();
    setMode('addPathKeepIn');
  } else if (e.key === 'f' || e.key === 'F') {
    e.preventDefault();
    e.stopPropagation();
    setMode('addRectKeepOut');
  } else if (e.key === 'g' || e.key === 'G') {
    e.preventDefault();
    e.stopPropagation();
    setMode('addPathKeepOut');
  } else if (e.key === 'a' || e.key === 'A') {
    e.preventDefault();
    e.stopPropagation();
    setMode('resizeConstraint');
  } else if (e.key === 'Escape') {
    e.preventDefault();
    e.stopPropagation();
    setMode('passthrough');
  } else if ((e.metaKey || e.ctrlKey) && e.key === 'z' && !e.shiftKey) {
    e.preventDefault();
    undo();
  } else if ((e.metaKey || e.ctrlKey) && e.key === 'z' && e.shiftKey) {
    e.preventDefault();
    redo();
  }
}, true);

document.addEventListener('keyup', (e) => {
  if (e.key === 'q' || e.key === 'Q' || e.key === 'w' || e.key === 'W' ||
      e.key === 'e' || e.key === 'E' ||
      e.key === 's' || e.key === 'S' || e.key === 'd' || e.key === 'D' ||
      e.key === 'f' || e.key === 'F' || e.key === 'g' || e.key === 'G' ||
      e.key === 'a' || e.key === 'A') {
    e.preventDefault();
    e.stopPropagation();
    setMode('passthrough');
  }
}, true);

// ====== Message Handler ======

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  switch (message.type) {
    case 'setMode':
      setMode(message.mode);
      sendResponse({ success: true });
      break;
    case 'clearWaypoints':
      clearWaypoints();
      sendResponse({ success: true });
      break;
    case 'clearConstraints':
      clearConstraints();
      sendResponse({ success: true });
      break;
    case 'clearAll':
      state.items = [];
      state.undoStack = [];
      state.redoStack = [];
      syncStateFromItems();
      renderOverlay();
      notifyItemsChanged();
      try {
        chrome.runtime.sendMessage({ type: 'waypointsCleared' });
        chrome.runtime.sendMessage({ type: 'constraintsCleared' });
      } catch (_) {}
      sendResponse({ success: true });
      break;
    case 'getState':
      sendResponse({
        waypoints: state.waypoints,
        constraints: state.constraints,
        items: state.items.map(i => {
          const copy = { id: i.id, type: i.type, enabled: i.enabled, data: { ...i.data } };
          delete copy.data._enabled;
          return copy;
        }),
        undoStack: state.undoStack,
        redoStack: state.redoStack,
        mode: state.mode,
        trajectoryCount: state.trajectory.length,
        screenWidth: state.screenWidth,
        screenHeight: state.screenHeight,
        canUndo: state.undoStack.length > 0,
        canRedo: state.redoStack.length > 0,
        pathDefaultWidth: state.pathDefaultWidth
      });
      break;
    case 'setPathDefaultWidth':
      if (typeof message.normalized === 'number' && message.normalized > 0) {
        state.pathDefaultWidth = message.normalized;
      }
      sendResponse({ success: true });
      break;
    case 'undo':
      sendResponse({ success: undo() });
      break;
    case 'redo':
      sendResponse({ success: redo() });
      break;
    case 'setTrajectory':
      setTrajectory(message.trajectory);
      sendResponse({ success: true });
      break;
    case 'startReplay':
      startReplay();
      sendResponse({ success: true });
      break;
    case 'stopReplay':
      stopReplay();
      sendResponse({ success: true });
      break;
    case 'seekToTime':
      seekToTime(message.time);
      sendResponse({ success: true });
      break;
    case 'setUseDebugger':
      state.useDebugger = !!message.enabled;
      sendResponse({ success: true });
      break;
    case 'resetCursorPosition':
      createOverlay();
      showGhostCursor(message.x, message.y);
      sendResponse({ success: true });
      break;
    case 'loadReplaySegment': {
      setTrajectory(message.trajectory);
      state.isReplaying = true;
      state.currentTrajectoryIndex = 0;
      state.replayStartTime = Date.now();
      state.replayPrevElement = null;
      const segTraj = message.trajectory;
      const ct = message.clickTarget || null;
      const totalDur = segTraj.length > 0 ? segTraj[segTraj.length - 1][2] : 0;
      let dwellAccum = 0;
      let dwellStarted = false;

      function tryFireClick(curX, curY) {
        const dist = Math.hypot(curX - ct.x, curY - ct.y);
        if (dist <= 50) {
          dwellAccum += 16;
          if (dwellAccum >= (ct.dwellMs || 200)) {
            const clickResult = executeClick(ct);
            state.isReplaying = false;
            hideGhostCursor();
            try {
              chrome.runtime.sendMessage({ type: 'clickFired', result: clickResult, itemId: ct.itemId });
            } catch (_) {}
            return true;
          }
        } else {
          dwellAccum = 0;
        }
        return false;
      }

      function animateSegment() {
        if (!state.isReplaying) return;
        const elapsed = (Date.now() - state.replayStartTime) / 1000;

        if (elapsed >= totalDur) {
          const last = segTraj[segTraj.length - 1];
          if (last) { showGhostCursor(last[0], last[1]); dispatchCursorEvents(last[0], last[1]); }

          if (ct) {
            const cx = last ? last[0] : ct.x;
            const cy = last ? last[1] : ct.y;
            if (tryFireClick(cx, cy)) return;
            requestAnimationFrame(animateSegment);
            return;
          }

          state.isReplaying = false;
          try { chrome.runtime.sendMessage({ type: 'segmentComplete' }); } catch (_) {}
          return;
        }

        let currentIndex = 0;
        for (let i = 0; i < segTraj.length; i++) {
          if (segTraj[i][2] <= elapsed) currentIndex = i; else break;
        }
        const [x, y] = segTraj[currentIndex];
        showGhostCursor(x, y);
        dispatchCursorEvents(x, y);
        state.currentTrajectoryIndex = currentIndex;

        // Check click proximity during trajectory playback (not just after)
        if (ct && tryFireClick(x, y)) return;

        try {
          chrome.runtime.sendMessage({ type: 'replayProgress', current: currentIndex, total: segTraj.length, time: elapsed });
        } catch (_) {}
        requestAnimationFrame(animateSegment);
      }

      createOverlay();
      animateSegment();
      sendResponse({ success: true });
      break;
    }
    case 'loadTaskState': {
      state.items = (message.items || []).map(i => ({
        id: i.id,
        type: i.type,
        data: { ...i.data },
        enabled: i.enabled !== false
      }));
      state.undoStack = message.undoStack || [];
      state.redoStack = message.redoStack || [];
      const maxId = state.items.reduce((max, i) => {
        const num = parseInt(i.id.replace('item-', ''), 10);
        return isNaN(num) ? max : Math.max(max, num + 1);
      }, state.nextItemId);
      state.nextItemId = maxId;
      syncStateFromItems();
      if (state.waypoints.length > 0 || state.constraints.length > 0) {
        createOverlay();
      }
      renderOverlay();
      sendResponse({ success: true });
      break;
    }
    case 'deleteItem': {
      const delIdx = state.items.findIndex(i => i.id === message.itemId);
      if (delIdx >= 0) {
        state.items.splice(delIdx, 1);
        state.undoStack = state.undoStack.filter(a => a.itemId !== message.itemId);
        state.redoStack = state.redoStack.filter(a => a.itemId !== message.itemId);
        syncStateFromItems();
        renderOverlay();
        notifyUndoRedo(false, false);
      }
      sendResponse({ success: delIdx >= 0 });
      break;
    }
    case 'reorderItems': {
      const orderMap = {};
      state.items.forEach(i => { orderMap[i.id] = i; });
      state.items = (message.itemIds || []).map(id => orderMap[id]).filter(Boolean);
      syncStateFromItems();
      renderOverlay();
      sendResponse({ success: true });
      break;
    }
    case 'toggleConstraintEnabled': {
      const toggleItem = state.items.find(i => i.id === message.itemId);
      if (toggleItem && toggleItem.type === 'constraint') {
        toggleItem.enabled = !!message.enabled;
        syncStateFromItems();
        renderOverlay();
      }
      sendResponse({ success: !!toggleItem });
      break;
    }
    default:
      sendResponse({ success: false, error: 'Unknown message type' });
  }
  return true;
});

// ====== Initialization ======

setMode('passthrough');
try {
  chrome.runtime.sendMessage({ type: 'contentScriptReady', url: window.location.href });
} catch (_) {}
