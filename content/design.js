// Mode management, waypoint/constraint CRUD, hit testing, editing, undo/redo

var MODE_HINTS = {
  addWaypoint: 'Hold Q — click to add waypoints. Release Q to exit.',
  moveWaypoint: 'Hold W — drag a waypoint to move it. Release W to exit.',
  addClickWaypoint: 'Hold E — click on an element to add a click waypoint. Release E to exit.',
  addRectKeepIn: 'Hold S — drag to draw a keep-in area (blue). Release S to exit.',
  addRectKeepOut: 'Hold F — drag to draw a keep-out area (red). Release F to exit.',
  addPathKeepIn: 'Hold D — click to add path points; release D to finish corridor (blue).',
  addPathKeepOut: 'Hold G — click to add path points; release G to finish corridor (red).',
  resizeConstraint: 'Hold A — drag constraint edge to resize. Release A to exit.',
  passthrough: '',
  replay: ''
};

var DESIGN_MODES = ['addWaypoint', 'moveWaypoint', 'addClickWaypoint', 'addRectKeepIn', 'addRectKeepOut', 'addPathKeepIn', 'addPathKeepOut', 'resizeConstraint'];

function isDesignMode() {
  return DESIGN_MODES.includes(state.mode);
}

function finalizePathConstraint() {
  if (state.pathWaypoints.length < 2) return;
  const path = state.pathWaypoints.map(p => [p.x, p.y]);
  const pathConstraint = {
    type: 'path',
    path,
    width: state.pathDefaultWidth,
    constraintType: state.pathConstraintType || 'keep-in',
    pageUrl: window.location.href
  };
  const item = { id: generateItemId(), type: 'constraint', data: pathConstraint, enabled: true };
  state.items.push(item);
  syncStateFromItems();
  state.undoStack.push({ itemId: item.id, itemCopy: JSON.parse(JSON.stringify(item)) });
  state.redoStack = [];
  renderOverlay();
  try {
    chrome.runtime.sendMessage({
      type: 'itemAdded',
      item: { id: item.id, type: 'constraint', data: pathConstraint, enabled: true },
      waypointCount: state.waypoints.length,
      constraintCount: state.constraints.length
    });
  } catch (_) {}
}

function blockPageEventInDesignMode(e) {
  if (!isDesignMode()) return;
  if (state.overlay && (e.target === state.overlay || state.overlay.contains(e.target))) return;
  e.stopPropagation();
  e.preventDefault();
}

function setMode(newMode) {
  const prevMode = state.mode;
  state.mode = newMode;
  state.draggingWaypointIndex = null;
  state.resizingConstraintIndex = null;
  state.resizingHandle = null;
  state.constraintStart = null;
  state.constraintCurrent = null;

  if (newMode === 'passthrough') {
    if ((prevMode === 'addPathKeepIn' || prevMode === 'addPathKeepOut') && state.pathWaypoints.length >= 2) {
      finalizePathConstraint();
    }
    state.pathWaypoints = [];
    state.pathPreviewCursor = null;
    document.documentElement.style.cursor = '';
    if (state.overlay) {
      state.overlay.querySelector('.design-mode-hint')?.remove();
    }
    hideGhostCursor();
  } else if (DESIGN_MODES.includes(newMode)) {
    if (newMode === 'addPathKeepIn') state.pathConstraintType = 'keep-in';
    else if (newMode === 'addPathKeepOut') state.pathConstraintType = 'keep-out';
    if (newMode !== 'addPathKeepIn' && newMode !== 'addPathKeepOut') {
      state.pathWaypoints = [];
      state.pathPreviewCursor = null;
    }
    createOverlay();
    document.documentElement.style.cursor = 'crosshair';
    let hint = state.overlay.querySelector('.design-mode-hint');
    if (!hint) {
      hint = document.createElement('div');
      hint.className = 'design-mode-hint';
      hint.style.cssText = 'position:fixed;top:12px;left:50%;transform:translateX(-50%);background:rgba(0,0,0,0.75);color:#fff;padding:8px 16px;border-radius:8px;font-family:sans-serif;font-size:14px;z-index:2147483648;pointer-events:none;';
      state.overlay.appendChild(hint);
    }
    hint.textContent = MODE_HINTS[newMode] || '';
  } else if (newMode === 'replay') {
    state.pathWaypoints = [];
    state.pathPreviewCursor = null;
    document.documentElement.style.cursor = '';
    createOverlay();
    state.overlay.querySelector('.design-mode-hint')?.remove();
  }

  try {
    chrome.runtime.sendMessage({ type: 'modeChanged', mode: newMode });
  } catch (_) {}
  renderOverlay();
}

// ====== Waypoint Management ======

function addWaypoint(x, y) {
  const normalized = {
    x: x / state.screenWidth,
    y: y / state.screenHeight,
    pixelX: x,
    pixelY: y,
    pageUrl: window.location.href
  };
  const item = { id: generateItemId(), type: 'waypoint', data: normalized, enabled: true };
  state.items.push(item);
  syncStateFromItems();
  state.undoStack.push({ itemId: item.id, itemCopy: JSON.parse(JSON.stringify(item)) });
  state.redoStack = [];
  renderOverlay();
  try {
    chrome.runtime.sendMessage({
      type: 'itemAdded',
      item: { id: item.id, type: 'waypoint', data: normalized, enabled: true },
      waypointCount: state.waypoints.length,
      constraintCount: state.constraints.length
    });
  } catch (_) {}
}

function getStableSelector(el) {
  if (!el || el === document.body || el === document.documentElement) return 'body';
  if (el.id) return '#' + CSS.escape(el.id);
  const parts = [];
  let cur = el;
  while (cur && cur !== document.body && cur !== document.documentElement) {
    let sel = cur.tagName.toLowerCase();
    if (cur.id) { parts.unshift('#' + CSS.escape(cur.id)); break; }
    if (cur.className && typeof cur.className === 'string') {
      const classes = cur.className.trim().split(/\s+/).filter(c => c.length > 0).slice(0, 2);
      if (classes.length) sel += '.' + classes.map(c => CSS.escape(c)).join('.');
    }
    const parent = cur.parentElement;
    if (parent) {
      const siblings = Array.from(parent.children).filter(c => c.tagName === cur.tagName);
      if (siblings.length > 1) {
        const idx = siblings.indexOf(cur) + 1;
        sel += ':nth-of-type(' + idx + ')';
      }
    }
    parts.unshift(sel);
    cur = cur.parentElement;
  }
  return parts.join(' > ');
}

function getXPath(el) {
  if (!el) return '';
  const parts = [];
  let cur = el;
  while (cur && cur.nodeType === Node.ELEMENT_NODE) {
    let idx = 1;
    let sib = cur.previousElementSibling;
    while (sib) {
      if (sib.tagName === cur.tagName) idx++;
      sib = sib.previousElementSibling;
    }
    parts.unshift(cur.tagName.toLowerCase() + '[' + idx + ']');
    cur = cur.parentElement;
  }
  return '/' + parts.join('/');
}

function isClickableElement(el) {
  if (!el || el === document.documentElement || el === document.body) return false;
  let cur = el;
  while (cur && cur !== document.body) {
    const tag = cur.tagName;
    if (tag === 'A' && cur.hasAttribute('href')) return true;
    if (tag === 'BUTTON' || tag === 'SELECT' || tag === 'TEXTAREA' || tag === 'SUMMARY') return true;
    if (tag === 'INPUT' && cur.type !== 'hidden') return true;
    if (tag === 'LABEL' && cur.hasAttribute('for')) return true;
    const role = cur.getAttribute('role');
    if (role && ['button', 'link', 'tab', 'menuitem', 'menuitemcheckbox', 'menuitemradio', 'option', 'switch', 'checkbox', 'radio'].includes(role)) return true;
    if (cur.hasAttribute('onclick') || cur.hasAttribute('tabindex')) return true;
    try { if (getComputedStyle(cur).cursor === 'pointer') return true; } catch (_) {}
    cur = cur.parentElement;
  }
  return false;
}

function findClickableNear(x, y, radius) {
  const el = document.elementFromPoint(x, y);
  if (isClickableElement(el)) return el;
  const offsets = [-radius, -radius / 2, 0, radius / 2, radius];
  for (const dx of offsets) {
    for (const dy of offsets) {
      if (dx === 0 && dy === 0) continue;
      const candidate = document.elementFromPoint(x + dx, y + dy);
      if (candidate && candidate !== el && isClickableElement(candidate)) return candidate;
    }
  }
  return null;
}

function showClickWarning() {
  if (!state.overlay) return;
  let toast = state.overlay.querySelector('.click-warning-toast');
  if (toast) toast.remove();
  toast = document.createElement('div');
  toast.className = 'click-warning-toast';
  toast.style.cssText = 'position:fixed;top:52px;left:50%;transform:translateX(-50%);background:rgba(234,88,12,0.92);color:#fff;padding:8px 18px;border-radius:8px;font-family:sans-serif;font-size:13px;z-index:2147483648;pointer-events:none;transition:opacity 0.4s;';
  toast.textContent = 'No clickable element found near cursor. Please try again on a link or button.';
  state.overlay.appendChild(toast);
  setTimeout(() => { toast.style.opacity = '0'; }, 2500);
  setTimeout(() => { toast.remove(); }, 3000);
}

function addClickWaypoint(x, y) {
  if (!findClickableNear(x, y, 20)) {
    showClickWarning();
    return;
  }
  const el = document.elementFromPoint(x, y);
  const selector = el ? getStableSelector(el) : '';
  const xpath = el ? getXPath(el) : '';
  const bbox = el ? el.getBoundingClientRect() : { x: x, y: y, width: 0, height: 0 };
  const data = {
    x: x / state.screenWidth,
    y: y / state.screenHeight,
    pixelX: x,
    pixelY: y,
    selector: selector,
    xpath: xpath,
    boundingBox: { x: bbox.x, y: bbox.y, width: bbox.width, height: bbox.height },
    pageUrl: window.location.href,
    dwellMs: 200,
    toleranceRadiusPx: 50
  };
  const item = { id: generateItemId(), type: 'waypoint_click', data: data, enabled: true };
  state.items.push(item);

  const anchor = el ? el.closest('a[href]') : null;
  let gotoItem = null;
  if (anchor && anchor.href) {
    gotoItem = { id: generateItemId(), type: 'goto', data: { url: anchor.href }, enabled: true };
    state.items.push(gotoItem);
  }

  syncStateFromItems();
  state.undoStack.push({ itemId: item.id, itemCopy: JSON.parse(JSON.stringify(item)) });
  if (gotoItem) state.undoStack.push({ itemId: gotoItem.id, itemCopy: JSON.parse(JSON.stringify(gotoItem)) });
  state.redoStack = [];
  renderOverlay();
  try {
    chrome.runtime.sendMessage({
      type: 'itemAdded',
      item: { id: item.id, type: 'waypoint_click', data: data, enabled: true },
      waypointCount: state.waypoints.length,
      constraintCount: state.constraints.length
    });
    if (gotoItem) {
      chrome.runtime.sendMessage({
        type: 'itemAdded',
        item: gotoItem,
        waypointCount: state.waypoints.length,
        constraintCount: state.constraints.length
      });
    }
  } catch (_) {}
}

function clearWaypoints() {
  state.items = state.items.filter(i => i.type !== 'waypoint' && i.type !== 'waypoint_click' && i.type !== 'goto');
  syncStateFromItems();
  renderOverlay();
  notifyItemsChanged();
  try { chrome.runtime.sendMessage({ type: 'waypointsCleared' }); } catch (_) {}
}

// ====== Constraint Management ======

function startConstraint(x, y) {
  state.constraintStart = { x, y };
  state.constraintCurrent = { x, y };
}

function updateConstraint(x, y) {
  if (state.constraintStart) {
    state.constraintCurrent = { x, y };
    renderOverlay();
  }
}

function finishConstraint(x, y, constraintType = 'keep-in') {
  if (!state.constraintStart) return;
  
  const start = state.constraintStart;
  const end = state.constraintCurrent || { x, y };
  const minW = 4;
  const minH = 4;
  const px = Math.min(start.x, end.x);
  const py = Math.min(start.y, end.y);
  const w = Math.max(minW, Math.abs(end.x - start.x));
  const h = Math.max(minH, Math.abs(end.y - start.y));
  
  const normalized = {
    type: 'rectangle',
    x: px / state.screenWidth,
    y: py / state.screenHeight,
    width: w / state.screenWidth,
    height: h / state.screenHeight,
    constraintType: constraintType,
    pageUrl: window.location.href
  };
  
  const item = { id: generateItemId(), type: 'constraint', data: normalized, enabled: true };
  state.items.push(item);
  syncStateFromItems();
  state.undoStack.push({ itemId: item.id, itemCopy: JSON.parse(JSON.stringify(item)) });
  state.redoStack = [];
  state.constraintStart = null;
  state.constraintCurrent = null;
  renderOverlay();
  try {
    chrome.runtime.sendMessage({
      type: 'itemAdded',
      item: { id: item.id, type: 'constraint', data: normalized, enabled: true },
      waypointCount: state.waypoints.length,
      constraintCount: state.constraints.length
    });
  } catch (_) {}
}

function clearConstraints() {
  state.items = state.items.filter(i => i.type !== 'constraint');
  syncStateFromItems();
  renderOverlay();
  notifyItemsChanged();
  try { chrome.runtime.sendMessage({ type: 'constraintsCleared' }); } catch (_) {}
}

// ====== Hit Testing & Editing ======

function hitTestWaypoint(px, py) {
  for (let i = state.waypoints.length - 1; i >= 0; i--) {
    const wp = state.waypoints[i];
    const dx = px - wp.pixelX, dy = py - wp.pixelY;
    if (dx * dx + dy * dy <= WAYPOINT_HIT_RADIUS * WAYPOINT_HIT_RADIUS) return i;
  }
  return -1;
}

function distToSegment(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1, dy = y2 - y1;
  const len = Math.hypot(dx, dy) || 1;
  const t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / (len * len)));
  const projX = x1 + t * dx, projY = y1 + t * dy;
  return Math.hypot(px - projX, py - projY);
}

function hitTestConstraint(px, py) {
  const m = CONSTRAINT_EDGE_MARGIN;
  for (let i = state.constraints.length - 1; i >= 0; i--) {
    const c = state.constraints[i];
    if (c.type === 'path' && c.path && c.path.length >= 2) {
      const pathPx = c.path.map(([nx, ny]) => [nx * state.screenWidth, ny * state.screenHeight]);
      const halfW = (c.width * state.screenWidth) / 2;
      for (let j = 0; j < pathPx.length; j++) {
        const d = Math.hypot(px - pathPx[j][0], py - pathPx[j][1]);
        if (d <= WAYPOINT_HIT_RADIUS) return { index: i, handle: 'waypoint_' + j, waypointIndex: j };
      }
      for (let j = 0; j < pathPx.length - 1; j++) {
        const d = distToSegment(px, py, pathPx[j][0], pathPx[j][1], pathPx[j + 1][0], pathPx[j + 1][1]);
        if (d >= halfW - m && d <= halfW + m) return { index: i, handle: 'width' };
      }
      continue;
    }
    const x = c.x * state.screenWidth;
    const y = c.y * state.screenHeight;
    const w = c.width * state.screenWidth;
    const h = c.height * state.screenHeight;
    const left = x, right = x + w, top = y, bottom = y + h;
    if (px < left - m || px > right + m || py < top - m || py > bottom + m) continue;
    const nearLeft = px <= left + m, nearRight = px >= right - m;
    const nearTop = py <= top + m, nearBottom = py >= bottom - m;
    if (nearLeft && nearTop) return { index: i, handle: 'nw' };
    if (nearRight && nearTop) return { index: i, handle: 'ne' };
    if (nearRight && nearBottom) return { index: i, handle: 'se' };
    if (nearLeft && nearBottom) return { index: i, handle: 'sw' };
    if (nearTop) return { index: i, handle: 'n' };
    if (nearBottom) return { index: i, handle: 's' };
    if (nearLeft) return { index: i, handle: 'w' };
    if (nearRight) return { index: i, handle: 'e' };
    return null;
  }
  return null;
}

function updateWaypointPosition(index, px, py) {
  if (index < 0 || index >= state.waypoints.length) return;
  state.waypoints[index].pixelX = px;
  state.waypoints[index].pixelY = py;
  state.waypoints[index].x = px / state.screenWidth;
  state.waypoints[index].y = py / state.screenHeight;
  renderOverlay();
}

function applyResize(index, handle, startRect, dx, dy) {
  const c = state.constraints[index];
  if (!c) return;
  let { x, y, w, h } = startRect;
  const minSize = 20;
  switch (handle) {
    case 'nw': x += dx; y += dy; w -= dx; h -= dy; break;
    case 'n':  y += dy; h -= dy; break;
    case 'ne': y += dy; w += dx; h -= dy; break;
    case 'e':  w += dx; break;
    case 'se': w += dx; h += dy; break;
    case 's':  h += dy; break;
    case 'sw': x += dx; w -= dx; h += dy; break;
    case 'w':  x += dx; w -= dx; break;
    default: return;
  }
  if (w < minSize) { x += w - minSize; w = minSize; }
  if (h < minSize) { y += h - minSize; h = minSize; }
  c.x = x / state.screenWidth;
  c.y = y / state.screenHeight;
  c.width = w / state.screenWidth;
  c.height = h / state.screenHeight;
  renderOverlay();
}

function applyResizePath(index, handle, start, currentPx, currentPy) {
  const c = state.constraints[index];
  if (!c || c.type !== 'path' || !c.path) return;
  if (handle.startsWith('waypoint_')) {
    const j = parseInt(handle.replace('waypoint_', ''), 10);
    if (j >= 0 && j < c.path.length) {
      c.path[j] = [currentPx / state.screenWidth, currentPy / state.screenHeight];
    }
  } else if (handle === 'width') {
    const deltaNorm = (currentPx - start.mx) / state.screenWidth;
    c.width = Math.max(0.005, (start.width || c.width) + deltaNorm);
  }
  renderOverlay();
}

// ====== Undo/Redo ======

function undo() {
  if (state.undoStack.length === 0) return false;
  const action = state.undoStack.pop();
  state.redoStack.push(action);
  const idx = state.items.findIndex(i => i.id === action.itemId);
  if (idx >= 0) {
    state.items.splice(idx, 1);
  }
  syncStateFromItems();
  renderOverlay();
  notifyItemsChanged();
  notifyUndoRedo(true, false);
  return true;
}

function redo() {
  if (state.redoStack.length === 0) return false;
  const action = state.redoStack.pop();
  state.undoStack.push(action);
  if (action.itemCopy) {
    state.items.push(JSON.parse(JSON.stringify(action.itemCopy)));
    syncStateFromItems();
  }
  renderOverlay();
  notifyItemsChanged();
  notifyUndoRedo(false, true);
  return true;
}

function notifyUndoRedo(undone, redone) {
  try {
    chrome.runtime.sendMessage({
      type: 'undoRedoState',
      waypointCount: state.waypoints.length,
      constraintCount: state.constraints.filter(c => c._enabled !== false).length,
      canUndo: state.undoStack.length > 0,
      canRedo: state.redoStack.length > 0,
      undo: undone,
      redo: redone
    });
  } catch (_) {}
}
