// Cursor Trajectory Simulator - Content Script
// Handles overlay, waypoint/constraint capture, and ghost cursor replay

console.log("Cursor Simulator: Content script loaded");

// Hit-test radius for waypoints and constraint handles (pixels)
const WAYPOINT_HIT_RADIUS = 14;
const CONSTRAINT_EDGE_MARGIN = 12;

// State management
const state = {
  mode: 'passthrough', // 'passthrough', 'addWaypoint', 'moveWaypoint', 'addConstraint', 'resizeConstraint', 'replay'
  waypoints: [],
  constraints: [],
  trajectory: [],
  currentTrajectoryIndex: 0,
  isReplaying: false,
  replayStartTime: null,
  overlay: null,
  canvas: null,
  ctx: null,
  ghostCursor: null,
  constraintStart: null,
  constraintCurrent: null,
  screenWidth: window.innerWidth,
  screenHeight: window.innerHeight,
  // Move waypoint
  draggingWaypointIndex: null,
  // Resize constraint: index, handle, and at mousedown: { mx, my, x, y, w, h } (pixels)
  resizingConstraintIndex: null,
  resizingHandle: null,
  resizeStart: null,
  // Undo/redo: history of added items (last = most recent)
  undoStack: [],
  redoStack: [],
  // Cursor position (capture element before overlay when entering design mode)
  lastMouseX: 0,
  lastMouseY: 0,
  // Hover lock: element under cursor when entering design mode; we block leave events so menu stays open
  menuLockElement: null,
  // Path constraint (D): waypoints for current path, preview cursor, default width (normalized)
  pathWaypoints: [],
  pathPreviewCursor: null,
  pathDefaultWidth: 0.02
};

// Initialize overlay canvas
function createOverlay() {
  if (state.screenWidth !== window.innerWidth || state.screenHeight !== window.innerHeight) {
    state.screenWidth = window.innerWidth;
    state.screenHeight = window.innerHeight;
  }
  if (state.overlay) return;
  
  const overlay = document.createElement('div');
  overlay.id = 'cursor-simulator-overlay';
  overlay.style.pointerEvents = 'none'; // default; set to 'auto' in design modes
  overlay.style.width = '100vw';
  overlay.style.height = '100vh';
  overlay.style.position = 'fixed';
  overlay.style.top = '0';
  overlay.style.left = '0';
  overlay.style.zIndex = '2147483647';
  document.body.appendChild(overlay);
  
  const canvas = document.createElement('canvas');
  canvas.id = 'cursor-simulator-canvas';
  canvas.width = state.screenWidth;
  canvas.height = state.screenHeight;
  canvas.style.width = '100%';
  canvas.style.height = '100%';
  canvas.style.pointerEvents = 'none'; // clicks go to overlay div
  overlay.appendChild(canvas);
  
  const ctx = canvas.getContext('2d');
  
  state.overlay = overlay;
  state.canvas = canvas;
  state.ctx = ctx;
  
  // Create ghost cursor element
  const ghostCursor = document.createElement('div');
  ghostCursor.className = 'ghost-cursor';
  ghostCursor.style.display = 'none';
  overlay.appendChild(ghostCursor);
  state.ghostCursor = ghostCursor;
  
  // Update canvas size on resize
  window.addEventListener('resize', () => {
    state.screenWidth = window.innerWidth;
    state.screenHeight = window.innerHeight;
    if (state.canvas) {
      state.canvas.width = state.screenWidth;
      state.canvas.height = state.screenHeight;
      renderOverlay();
    }
  });
}

function removeOverlay() {
  if (state.overlay) {
    state.overlay.remove();
    state.overlay = null;
    state.canvas = null;
    state.ctx = null;
    state.ghostCursor = null;
  }
}

// Mode switching
const MODE_HINTS = {
  addWaypoint: 'Hold Q — click to add waypoints. Release Q to exit.',
  moveWaypoint: 'Hold W — drag a waypoint to move it. Release W to exit.',
  addConstraint: 'Hold A — drag to draw a constraint. Release A to exit.',
  addPathConstraint: 'Hold D — click to add path points; release D to finish corridor.',
  resizeConstraint: 'Hold S — drag constraint edge/corner or path waypoint to resize. Release S to exit.',
  passthrough: '',
  replay: ''
};

function clearMenuLock() {
  state.menuLockElement = null;
}

function finalizePathConstraint() {
  if (state.pathWaypoints.length < 2) return;
  const path = state.pathWaypoints.map(p => [p.x, p.y]);
  const pathConstraint = {
    type: 'path',
    path,
    width: state.pathDefaultWidth,
    constraintType: 'keep-in'
  };
  state.constraints.push(pathConstraint);
  state.undoStack.push({ type: 'constraint', data: { ...pathConstraint } });
  state.redoStack = [];
  try {
    chrome.runtime.sendMessage({
      type: 'constraintAdded',
      constraint: pathConstraint,
      count: state.constraints.length
    });
  } catch (_) {}
}

// Block mouseleave/mouseout from reaching the menu element so the menu never "sees" cursor leave
function blockLeaveIfMenuLock(e) {
  const el = state.menuLockElement;
  if (!el || !el.isConnected) return;
  const designModes = ['addWaypoint', 'moveWaypoint', 'addConstraint', 'addPathConstraint', 'resizeConstraint'];
  if (!designModes.includes(state.mode)) return;
  const target = e.target;
  if (el === target || el.contains(target)) {
    e.stopPropagation();
    e.preventDefault();
  }
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
    if (prevMode === 'addPathConstraint' && state.pathWaypoints.length >= 2) {
      finalizePathConstraint();
    }
    state.pathWaypoints = [];
    state.pathPreviewCursor = null;
    clearMenuLock();
    if (state.overlay) {
      state.overlay.style.pointerEvents = 'none';
      state.overlay.style.cursor = 'default';
      state.overlay.querySelector('.design-mode-hint')?.remove();
    }
    hideGhostCursor();
  } else if (['addWaypoint', 'moveWaypoint', 'addConstraint', 'addPathConstraint', 'resizeConstraint'].includes(newMode)) {
    if (newMode !== 'addPathConstraint') {
      state.pathWaypoints = [];
      state.pathPreviewCursor = null;
    }
    clearMenuLock();
    const under = document.elementFromPoint(state.lastMouseX, state.lastMouseY);
    if (under && under !== document.body && under.isConnected) {
      state.menuLockElement = under;
    }
    createOverlay();
    state.overlay.style.pointerEvents = 'auto';
    state.overlay.style.cursor = 'crosshair';
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
    clearMenuLock();
    createOverlay();
    state.overlay.style.pointerEvents = 'none';
    state.overlay.querySelector('.design-mode-hint')?.remove();
  }

  try {
    chrome.runtime.sendMessage({ type: 'modeChanged', mode: newMode });
  } catch (_) {}
  renderOverlay();
}

// Waypoint management
function addWaypoint(x, y) {
  const normalized = {
    x: x / state.screenWidth,
    y: y / state.screenHeight,
    pixelX: x,
    pixelY: y
  };
  state.waypoints.push(normalized);
  state.undoStack.push({ type: 'waypoint', data: { ...normalized } });
  state.redoStack = [];
  renderOverlay();
  try {
    chrome.runtime.sendMessage({
      type: 'waypointAdded',
      waypoint: normalized,
      count: state.waypoints.length
    });
  } catch (_) {}
}

function clearWaypoints() {
  state.waypoints = [];
  renderOverlay();
  try { chrome.runtime.sendMessage({ type: 'waypointsCleared' }); } catch (_) {}
}

// Constraint management
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
    constraintType: constraintType
  };
  
  state.constraints.push(normalized);
  state.undoStack.push({ type: 'constraint', data: { ...normalized } });
  state.redoStack = [];
  state.constraintStart = null;
  state.constraintCurrent = null;
  renderOverlay();
  try {
    chrome.runtime.sendMessage({
      type: 'constraintAdded',
      constraint: normalized,
      count: state.constraints.length
    });
  } catch (_) {}
}

function clearConstraints() {
  state.constraints = [];
  renderOverlay();
  try { chrome.runtime.sendMessage({ type: 'constraintsCleared' }); } catch (_) {}
}

// Hit-test waypoint at pixel (px, py). Returns index or -1.
function hitTestWaypoint(px, py) {
  for (let i = state.waypoints.length - 1; i >= 0; i--) {
    const wp = state.waypoints[i];
    const dx = px - wp.pixelX, dy = py - wp.pixelY;
    if (dx * dx + dy * dy <= WAYPOINT_HIT_RADIUS * WAYPOINT_HIT_RADIUS) return i;
  }
  return -1;
}

// Distance from point (px,py) to segment (x1,y1)-(x2,y2)
function distToSegment(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1, dy = y2 - y1;
  const len = Math.hypot(dx, dy) || 1;
  const t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / (len * len)));
  const projX = x1 + t * dx, projY = y1 + t * dy;
  return Math.hypot(px - projX, py - projY);
}

// Constraint handles: corners and edges for rect; waypoint_0, waypoint_1, width for path
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

// Resize constraint from start rect and mouse delta (so we don't accumulate drift).
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

// Undo: remove last added waypoint or constraint
function undo() {
  if (state.undoStack.length === 0) return false;
  const action = state.undoStack.pop();
  state.redoStack.push(action);
  if (action.type === 'waypoint') {
    state.waypoints.pop();
  } else if (action.type === 'constraint') {
    state.constraints.pop();
  }
  renderOverlay();
  notifyUndoRedo(true, false);
  return true;
}

function redo() {
  if (state.redoStack.length === 0) return false;
  const action = state.redoStack.pop();
  state.undoStack.push(action);
  if (action.type === 'waypoint') {
    state.waypoints.push(action.data);
  } else if (action.type === 'constraint') {
    state.constraints.push(action.data);
  }
  renderOverlay();
  notifyUndoRedo(false, true);
  return true;
}

function notifyUndoRedo(undo, redo) {
  try {
    chrome.runtime.sendMessage({
      type: 'undoRedoState',
      waypointCount: state.waypoints.length,
      constraintCount: state.constraints.length,
      canUndo: state.undoStack.length > 0,
      canRedo: state.redoStack.length > 0,
      undo,
      redo
    });
  } catch (_) {}
}

// Left perpendicular to segment (ax,ay)->(bx,by), normalized (90° CCW)
function leftPerp(ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const len = Math.hypot(dx, dy) || 1;
  return { x: -dy / len, y: dx / len };
}

// Build connected corridor polygon from path points (each {x,y} or [x,y] in pixels) and halfWidth.
// Returns polygon as [x,y, x,y, ...] for left boundary then right boundary (reversed) so segments connect.
function buildCorridorPolygon(pathPx, halfWidthPx) {
  const n = pathPx.length;
  if (n < 2) return [];
  const toX = (p) => (Array.isArray(p) ? p[0] : p.x);
  const toY = (p) => (Array.isArray(p) ? p[1] : p.y);
  const left = [];
  const right = [];
  for (let i = 0; i < n; i++) {
    const px = toX(pathPx[i]), py = toY(pathPx[i]);
    let nx, ny;
    if (i === 0) {
      const perp = leftPerp(px, py, toX(pathPx[1]), toY(pathPx[1]));
      nx = perp.x; ny = perp.y;
    } else if (i === n - 1) {
      const perp = leftPerp(toX(pathPx[i - 1]), toY(pathPx[i - 1]), px, py);
      nx = perp.x; ny = perp.y;
    } else {
      const perpPrev = leftPerp(toX(pathPx[i - 1]), toY(pathPx[i - 1]), px, py);
      const perpNext = leftPerp(px, py, toX(pathPx[i + 1]), toY(pathPx[i + 1]));
      let sx = perpPrev.x + perpNext.x, sy = perpPrev.y + perpNext.y;
      const slen = Math.hypot(sx, sy);
      if (slen < 1e-6) { nx = perpPrev.x; ny = perpPrev.y; }
      else { nx = sx / slen; ny = sy / slen; }
    }
    left.push(px + halfWidthPx * nx, py + halfWidthPx * ny);
    right.push(px - halfWidthPx * nx, py - halfWidthPx * ny);
  }
  const rightReversed = [];
  for (let i = right.length - 2; i >= 0; i -= 2) rightReversed.push(right[i], right[i + 1]);
  return [...left, ...rightReversed];
}

// Draw a single connected corridor polygon (for path constraints and preview)
function drawCorridorPolygon(ctx, pathPx, halfWidthPx) {
  const poly = buildCorridorPolygon(pathPx, halfWidthPx);
  if (poly.length < 6) return;
  ctx.beginPath();
  ctx.moveTo(poly[0], poly[1]);
  for (let i = 2; i < poly.length; i += 2) ctx.lineTo(poly[i], poly[i + 1]);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
}

// Draw a single segment as rectangle (for backward compatibility / simple cases)
function drawCorridorSegment(ctx, x1, y1, x2, y2, halfWidthPx) {
  const perp = leftPerp(x1, y1, x2, y2);
  const ax = x1 + perp.x * halfWidthPx, ay = y1 + perp.y * halfWidthPx;
  const bx = x1 - perp.x * halfWidthPx, by = y1 - perp.y * halfWidthPx;
  const cx = x2 - perp.x * halfWidthPx, cy = y2 - perp.y * halfWidthPx;
  const dx = x2 + perp.x * halfWidthPx, dy = y2 + perp.y * halfWidthPx;
  ctx.beginPath();
  ctx.moveTo(ax, ay);
  ctx.lineTo(dx, dy);
  ctx.lineTo(cx, cy);
  ctx.lineTo(bx, by);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
}

// Rendering
function renderOverlay() {
  if (!state.ctx || !state.canvas) return;
  
  const ctx = state.ctx;
  ctx.clearRect(0, 0, state.canvas.width, state.canvas.height);
  
  // Draw waypoints
  state.waypoints.forEach((wp, index) => {
    const x = wp.pixelX;
    const y = wp.pixelY;
    
    // Draw marker
    ctx.fillStyle = '#3b82f6';
    ctx.beginPath();
    ctx.arc(x, y, 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'white';
    ctx.lineWidth = 2;
    ctx.stroke();
    
    // Draw label
    ctx.fillStyle = 'white';
    ctx.font = '12px Arial';
    ctx.fillText(`${index + 1}`, x + 10, y - 10);
    
    // Draw connection line
    if (index > 0) {
      const prev = state.waypoints[index - 1];
      ctx.strokeStyle = '#3b82f6';
      ctx.lineWidth = 2;
      ctx.setLineDash([5, 5]);
      ctx.beginPath();
      ctx.moveTo(prev.pixelX, prev.pixelY);
      ctx.lineTo(x, y);
      ctx.stroke();
      ctx.setLineDash([]);
    }
  });
  
  // Draw constraints
  state.constraints.forEach((constraint) => {
    ctx.strokeStyle = constraint.constraintType === 'keep-in' ? '#10b981' : '#ef4444';
    ctx.fillStyle = constraint.constraintType === 'keep-in' ? 'rgba(16, 185, 129, 0.15)' : 'rgba(239, 68, 68, 0.15)';
    ctx.setLineDash([5, 5]);
    ctx.lineWidth = 2;
    if (constraint.type === 'path' && constraint.path && constraint.path.length >= 2) {
      const halfW = (constraint.width * state.screenWidth) / 2;
      const pathPx = constraint.path.map(([nx, ny]) => [nx * state.screenWidth, ny * state.screenHeight]);
      drawCorridorPolygon(ctx, pathPx, halfW);
      ctx.setLineDash([]);
      constraint.path.forEach(([nx, ny], i) => {
        const px = nx * state.screenWidth, py = ny * state.screenHeight;
        ctx.fillStyle = '#10b981';
        ctx.beginPath();
        ctx.arc(px, py, 4, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = 'white';
        ctx.lineWidth = 1;
        ctx.stroke();
      });
    } else {
      const x = constraint.x * state.screenWidth;
      const y = constraint.y * state.screenHeight;
      const width = constraint.width * state.screenWidth;
      const height = constraint.height * state.screenHeight;
      ctx.fillRect(x, y, width, height);
      ctx.strokeRect(x, y, width, height);
      ctx.setLineDash([]);
    }
  });
  
  // Draw path constraint preview (rubber-band + connected corridor)
  if (state.mode === 'addPathConstraint' && state.pathWaypoints.length > 0) {
    const pts = state.pathWaypoints;
    const halfW = (state.pathDefaultWidth * state.screenWidth) / 2;
    ctx.strokeStyle = '#10b981';
    ctx.fillStyle = 'rgba(16, 185, 129, 0.15)';
    ctx.setLineDash([3, 3]);
    ctx.lineWidth = 2;
    const pathPx = pts.map((p) => ({ x: p.pixelX, y: p.pixelY }));
    if (state.pathPreviewCursor) pathPx.push(state.pathPreviewCursor);
    if (pathPx.length >= 2) {
      drawCorridorPolygon(ctx, pathPx, halfW);
      for (let i = 0; i < pathPx.length - 1; i++) {
        const a = pathPx[i], b = pathPx[i + 1];
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
      }
    }
    ctx.setLineDash([]);
    pts.forEach((p, i) => {
      ctx.fillStyle = '#10b981';
      ctx.beginPath();
      ctx.arc(p.pixelX, p.pixelY, 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = 'white';
      ctx.lineWidth = 2;
      ctx.stroke();
    });
  }
  
  // Draw current constraint being drawn
  if (state.constraintStart && state.constraintCurrent) {
    const start = state.constraintStart;
    const current = state.constraintCurrent;
    const x = Math.min(start.x, current.x);
    const y = Math.min(start.y, current.y);
    const width = Math.abs(current.x - start.x);
    const height = Math.abs(current.y - start.y);
    
    ctx.strokeStyle = '#10b981';
    ctx.fillStyle = 'rgba(16, 185, 129, 0.1)';
    ctx.setLineDash([5, 5]);
    ctx.lineWidth = 2;
    ctx.fillRect(x, y, width, height);
    ctx.strokeRect(x, y, width, height);
    ctx.setLineDash([]);
  }
}

// Ghost cursor replay
function showGhostCursor(x, y) {
  if (!state.ghostCursor) return;
  state.ghostCursor.style.display = 'block';
  state.ghostCursor.style.left = `${x}px`;
  state.ghostCursor.style.top = `${y}px`;
}

function hideGhostCursor() {
  if (state.ghostCursor) {
    state.ghostCursor.style.display = 'none';
  }
}

function setTrajectory(trajectory) {
  state.trajectory = trajectory;
  state.currentTrajectoryIndex = 0;
  chrome.runtime.sendMessage({ type: 'trajectoryLoaded', count: trajectory.length });
}

function startReplay() {
  if (state.trajectory.length === 0) return;
  
  state.isReplaying = true;
  state.currentTrajectoryIndex = 0;
  state.replayStartTime = Date.now();
  
  const totalDuration = state.trajectory[state.trajectory.length - 1][2];
  
  // Animate ghost cursor; stop automatically when we reach the end
  function animate() {
    if (!state.isReplaying) return;
    
    const elapsed = (Date.now() - state.replayStartTime) / 1000; // seconds
    
    // Replay finished: cursor has reached the end of the trajectory
    if (elapsed >= totalDuration) {
      const last = state.trajectory[state.trajectory.length - 1];
      showGhostCursor(last[0], last[1]);
      state.isReplaying = false;
      try {
        chrome.runtime.sendMessage({
          type: 'replayProgress',
          current: state.trajectory.length - 1,
          total: state.trajectory.length,
          time: totalDuration
        });
        chrome.runtime.sendMessage({ type: 'replayComplete' });
      } catch (_) {}
      return;
    }
    
    // Find current position in trajectory based on timestamp
    let currentIndex = 0;
    for (let i = 0; i < state.trajectory.length; i++) {
      const timestamp = state.trajectory[i][2];
      if (timestamp <= elapsed) {
        currentIndex = i;
      } else {
        break;
      }
    }
    
    const [x, y] = state.trajectory[currentIndex];
    showGhostCursor(x, y);
    
    const element = document.elementFromPoint(x, y);
    if (element) {
      const mouseEvent = new MouseEvent('mouseover', {
        view: window,
        bubbles: true,
        cancelable: true,
        clientX: x,
        clientY: y
      });
      element.dispatchEvent(mouseEvent);
    }
    
    state.currentTrajectoryIndex = currentIndex;
    try {
      chrome.runtime.sendMessage({
        type: 'replayProgress',
        current: currentIndex,
        total: state.trajectory.length,
        time: elapsed
      });
    } catch (_) {}
    
    requestAnimationFrame(animate);
  }
  
  animate();
}

function stopReplay() {
  state.isReplaying = false;
  hideGhostCursor();
  chrome.runtime.sendMessage({ type: 'replayStopped' });
}

function seekToTime(time) {
  if (state.trajectory.length === 0) return;
  
  // Trajectory format: [x, y, timestamp]
  // Find the point with timestamp closest to but not exceeding the target time
  let targetIndex = 0;
  
  for (let i = 0; i < state.trajectory.length; i++) {
    const timestamp = state.trajectory[i][2];
    if (timestamp <= time) {
      targetIndex = i;
    } else {
      break;
    }
  }
  
  if (targetIndex < state.trajectory.length) {
    const [x, y] = state.trajectory[targetIndex];
    showGhostCursor(x, y);
    state.currentTrajectoryIndex = targetIndex;
    
    // Trigger hover event at this position
    const element = document.elementFromPoint(x, y);
    if (element) {
      const mouseEvent = new MouseEvent('mouseover', {
        view: window,
        bubbles: true,
        cancelable: true,
        clientX: x,
        clientY: y
      });
      element.dispatchEvent(mouseEvent);
    }
  }
}

// Event handlers – use capture so we get events before page elements
document.addEventListener('mousedown', (e) => {
  const px = e.clientX, py = e.clientY;
  if (state.mode === 'addWaypoint') {
    e.preventDefault();
    e.stopPropagation();
    addWaypoint(px, py);
  } else if (state.mode === 'moveWaypoint') {
    const idx = hitTestWaypoint(px, py);
    if (idx >= 0) {
      e.preventDefault();
      e.stopPropagation();
      state.draggingWaypointIndex = idx;
    }
  } else if (state.mode === 'addConstraint') {
    e.preventDefault();
    e.stopPropagation();
    startConstraint(px, py);
  } else if (state.mode === 'addPathConstraint') {
    e.preventDefault();
    e.stopPropagation();
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
      e.preventDefault();
      e.stopPropagation();
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

// Passive: track cursor position (used when entering design mode to capture menu element)
document.addEventListener('mousemove', (e) => {
  state.lastMouseX = e.clientX;
  state.lastMouseY = e.clientY;
}, { capture: true, passive: true });

// Hover lock: block leave events so the menu under cursor when entering design mode stays open
document.addEventListener('mouseleave', blockLeaveIfMenuLock, true);
document.addEventListener('mouseout', blockLeaveIfMenuLock, true);
document.addEventListener('pointerleave', blockLeaveIfMenuLock, true);
document.addEventListener('pointerout', blockLeaveIfMenuLock, true);

document.addEventListener('mousemove', (e) => {
  const px = e.clientX, py = e.clientY;
  if (state.draggingWaypointIndex !== null) {
    e.preventDefault();
    e.stopPropagation();
    updateWaypointPosition(state.draggingWaypointIndex, px, py);
  } else if (state.mode === 'addConstraint' && state.constraintStart) {
    e.preventDefault();
    e.stopPropagation();
    updateConstraint(px, py);
  } else if (state.resizingConstraintIndex !== null && state.resizeStart) {
    e.preventDefault();
    e.stopPropagation();
    const c = state.constraints[state.resizingConstraintIndex];
    if (c.type === 'path') {
      applyResizePath(state.resizingConstraintIndex, state.resizingHandle, state.resizeStart, px, py);
    } else {
      const dx = px - state.resizeStart.mx, dy = py - state.resizeStart.my;
      applyResize(state.resizingConstraintIndex, state.resizingHandle,
        { x: state.resizeStart.x, y: state.resizeStart.y, w: state.resizeStart.w, h: state.resizeStart.h },
        dx, dy);
    }
  } else if (state.mode === 'addPathConstraint') {
    state.pathPreviewCursor = { x: px, y: py };
    renderOverlay();
  }
}, true);

document.addEventListener('mouseup', (e) => {
  if (state.mode === 'addConstraint' && state.constraintStart) {
    e.preventDefault();
    e.stopPropagation();
    finishConstraint(e.clientX, e.clientY, 'keep-in');
  } else if (state.draggingWaypointIndex !== null) {
    state.draggingWaypointIndex = null;
  } else if (state.resizingConstraintIndex !== null) {
    state.resizingConstraintIndex = null;
    state.resizingHandle = null;
    state.resizeStart = null;
  }
}, true);

// Hold key for design mode; release key to quit. Use capture so we run before the page (e.g. menu closing on keydown)
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
  } else if (e.key === 'a' || e.key === 'A') {
    e.preventDefault();
    e.stopPropagation();
    setMode('addConstraint');
  } else if (e.key === 's' || e.key === 'S') {
    e.preventDefault();
    e.stopPropagation();
    setMode('resizeConstraint');
  } else if (e.key === 'd' || e.key === 'D') {
    e.preventDefault();
    e.stopPropagation();
    setMode('addPathConstraint');
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
      e.key === 'a' || e.key === 'A' || e.key === 's' || e.key === 'S' ||
      e.key === 'd' || e.key === 'D') {
    e.preventDefault();
    e.stopPropagation();
    setMode('passthrough');
  }
}, true);

// Message listener from side panel
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
      state.undoStack = [];
      state.redoStack = [];
      clearWaypoints();
      clearConstraints();
      sendResponse({ success: true });
      break;
    case 'getState':
      sendResponse({
        waypoints: state.waypoints,
        constraints: state.constraints,
        mode: state.mode,
        trajectoryCount: state.trajectory.length,
        screenWidth: state.screenWidth,
        screenHeight: state.screenHeight,
        canUndo: state.undoStack.length > 0,
        canRedo: state.redoStack.length > 0
      });
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
    default:
      sendResponse({ success: false, error: 'Unknown message type' });
  }
  return true; // Keep channel open for async response
});

// Initialize
setMode('passthrough');
