// Side Panel Controller for Cursor Simulator

// Initialize Lucide icons (replaces <i data-lucide="..."> with SVG)
if (typeof lucide !== 'undefined') {
  lucide.createIcons();
}

let currentMode = 'passthrough';
let waypointCount = 0;
let constraintCount = 0;
let trajectoryCount = 0;
let currentTrajectory = [];
let totalDuration = 0;
let isReplaying = false;
let screenWidth = 1920; // fallback for corridor width px <-> normalized

// DOM elements
const btnAddWaypoint = document.getElementById('btn-add-waypoint');
const btnMoveWaypoint = document.getElementById('btn-move-waypoint');
const btnRectKeepIn = document.getElementById('btn-rect-keep-in');
const btnRectKeepOut = document.getElementById('btn-rect-keep-out');
const btnPathKeepIn = document.getElementById('btn-path-keep-in');
const btnPathKeepOut = document.getElementById('btn-path-keep-out');
const btnResizeConstraint = document.getElementById('btn-resize-constraint');
const btnQuitDesign = document.getElementById('btn-quit-design');
const btnUndo = document.getElementById('btn-undo');
const btnRedo = document.getElementById('btn-redo');
const btnSimulate = document.getElementById('btn-simulate');
const btnClear = document.getElementById('btn-clear');
const btnReplay = document.getElementById('btn-replay');
const btnStop = document.getElementById('btn-stop');
const statusDiv = document.getElementById('status');
const waypointCountSpan = document.getElementById('waypoint-count');
const constraintCountSpan = document.getElementById('constraint-count');
const trajectoryCountSpan = document.getElementById('trajectory-count');
const replaySection = document.getElementById('replay-section');
const timeline = document.getElementById('timeline');
const timelineProgress = document.getElementById('timeline-progress');
const timelineHandle = document.getElementById('timeline-handle');
const timelineCurrent = document.getElementById('timeline-current');
const timelineTotal = document.getElementById('timeline-total');
const activeBadge = document.getElementById('active-badge');
const modeHint = document.getElementById('mode-hint');
const contextualSliderWrap = document.getElementById('contextual-slider-wrap');
const corridorWidthSlider = document.getElementById('corridor-width-slider');
const corridorWidthValue = document.getElementById('corridor-width-value');

const TOOL_BUTTONS = [
  btnAddWaypoint,
  btnMoveWaypoint,
  btnRectKeepIn,
  btnRectKeepOut,
  btnPathKeepIn,
  btnPathKeepOut,
  btnResizeConstraint,
  btnQuitDesign
];

const ACTIVE_BADGE_LABELS = {
  addWaypoint: 'ACTIVE: Add waypoint (Q)',
  moveWaypoint: 'ACTIVE: Move waypoint (W)',
  addRectKeepIn: 'ACTIVE: Area keep-in (S)',
  addRectKeepOut: 'ACTIVE: Area keep-out (F)',
  addPathKeepIn: 'ACTIVE: Path keep-in (D)',
  addPathKeepOut: 'ACTIVE: Path keep-out (G)',
  resizeConstraint: 'ACTIVE: Resize (A)',
  passthrough: 'ACTIVE: Passthrough (Esc)'
};

const MODE_HINTS = {
  addWaypoint: 'Click to add a waypoint. Release Q to exit.',
  moveWaypoint: 'Drag a waypoint to move it. Release W to exit.',
  addRectKeepIn: 'Drag to draw a keep-in area (green). Release S to exit.',
  addRectKeepOut: 'Drag to draw a keep-out area (red). Release F to exit.',
  addPathKeepIn: 'Click to add path points; release D to finalize corridor (green).',
  addPathKeepOut: 'Click to add path points; release G to finalize corridor (red).',
  resizeConstraint: 'Drag the edge of a constraint area to resize. Release A to exit.',
  passthrough: 'Design mode off — use the page normally.'
};

// Get current tab
async function getCurrentTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

// Send message to content script (throws if tab not ready or page not refreshed)
async function sendToContentScript(message) {
  const tab = await getCurrentTab();
  if (!tab?.id) {
    throw new Error('No active tab');
  }
  if (tab.url?.startsWith('chrome://') || tab.url?.startsWith('chrome-extension://')) {
    throw new Error('Cannot run on this page. Open a normal website (e.g. https://example.com).');
  }
  return chrome.tabs.sendMessage(tab.id, message);
}

// Update status
function updateStatus(message, type = '') {
  statusDiv.textContent = message;
  statusDiv.className = `status ${type}`;
}

// Update mode buttons and active badge / hint / contextual slider
function updateModeButtons(mode) {
  TOOL_BUTTONS.forEach(b => b?.classList?.remove('active'));
  const byMode = {
    addWaypoint: btnAddWaypoint,
    moveWaypoint: btnMoveWaypoint,
    addRectKeepIn: btnRectKeepIn,
    addRectKeepOut: btnRectKeepOut,
    addPathKeepIn: btnPathKeepIn,
    addPathKeepOut: btnPathKeepOut,
    resizeConstraint: btnResizeConstraint,
    passthrough: btnQuitDesign
  };
  if (byMode[mode]) byMode[mode]?.classList.add('active');

  activeBadge.textContent = ACTIVE_BADGE_LABELS[mode] || ACTIVE_BADGE_LABELS.passthrough;
  modeHint.textContent = MODE_HINTS[mode] || MODE_HINTS.passthrough;

  // Width slider: only visible when D (path keep-in) or G (path keep-out) is active
  const showSlider = mode === 'addPathKeepIn' || mode === 'addPathKeepOut';
  contextualSliderWrap.classList.remove('visible', 'hidden');
  contextualSliderWrap.classList.add(showSlider ? 'visible' : 'hidden');
}

async function setModeInPage(mode) {
  try {
    await sendToContentScript({ type: 'setMode', mode });
    currentMode = mode;
    updateModeButtons(mode);
    updateStatus(MODE_HINTS[mode] || '', '');
  } catch (err) {
    console.error('sendToContentScript failed', err);
    updateStatus('Refresh this page (F5 or Cmd+R), then try again.', 'error');
  }
}

btnAddWaypoint.addEventListener('click', () => setModeInPage('addWaypoint'));
btnMoveWaypoint.addEventListener('click', () => setModeInPage('moveWaypoint'));
btnRectKeepIn.addEventListener('click', () => setModeInPage('addRectKeepIn'));
btnRectKeepOut.addEventListener('click', () => setModeInPage('addRectKeepOut'));
btnPathKeepIn.addEventListener('click', () => setModeInPage('addPathKeepIn'));
btnPathKeepOut.addEventListener('click', () => setModeInPage('addPathKeepOut'));
btnResizeConstraint.addEventListener('click', () => setModeInPage('resizeConstraint'));
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

// Corridor width slider: value in px; send normalized to content script
function updateCorridorWidthLabel() {
  const px = parseInt(corridorWidthSlider.value, 10);
  corridorWidthValue.textContent = px + ' px';
}

async function onCorridorWidthChange() {
  updateCorridorWidthLabel();
  const px = parseInt(corridorWidthSlider.value, 10);
  try {
    const state = await sendToContentScript({ type: 'getState' });
    const w = state.screenWidth || screenWidth;
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
      updateStatus('Cleared all waypoints and constraints', 'success');
    } catch (err) {
      updateStatus('Refresh the page first, then try again.', 'error');
    }
  }
});

btnSimulate.addEventListener('click', async () => {
  if (waypointCount < 2) {
    updateStatus('Need at least 2 waypoints to simulate', 'error');
    return;
  }
  
  updateStatus('Running simulation...', '');
  btnSimulate.disabled = true;
  
  try {
    const state = await sendToContentScript({ type: 'getState' });
    const tab = await getCurrentTab();
    const cookies = await chrome.cookies.getAll({ url: tab.url });
    const viewportWidth = state.screenWidth || tab.width || window.innerWidth || 1920;
    const viewportHeight = state.screenHeight || tab.height || window.innerHeight || 1080;
    
    const taskConfig = {
      waypoints: state.waypoints.map(wp => [wp.pixelX, wp.pixelY]),
      screen_width: viewportWidth,
      screen_height: viewportHeight,
      constraints: {
        coordinate_system: 'normalized',
        default_margin: 0.005,
        regions: state.constraints.map(c => {
          const base = {
            constraint_type: c.constraintType === 'keep-in' ? 'keep_in' : 'keep_out',
            margin: 0.002,
            enabled: true
          };
          if (c.type === 'path' && c.path) {
            base.geometry = { type: 'path', path: c.path, width: c.width };
          } else {
            base.geometry = { type: c.type || 'rectangle', x: c.x, y: c.y, width: c.width, height: c.height };
          }
          return base;
        })
      }
    };
    
    const response = await fetch('http://localhost:8000/api/simulate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        task: taskConfig,
        cookies: cookies.map(c => ({
          name: c.name,
          value: c.value,
          domain: c.domain,
          path: c.path,
          secure: c.secure,
          httpOnly: c.httpOnly,
          sameSite: c.sameSite
        })),
        viewport: { width: viewportWidth, height: viewportHeight },
        url: tab.url
      })
    });
    
    if (!response.ok) throw new Error(`Server error: ${response.statusText}`);
    const result = await response.json();
    
    if (result.success && result.trajectory) {
      currentTrajectory = result.trajectory;
      trajectoryCount = currentTrajectory.length;
      trajectoryCountSpan.textContent = trajectoryCount;
      totalDuration = result.total_duration ?? (currentTrajectory.length > 0 ? currentTrajectory[currentTrajectory.length - 1][2] : 0);
      timelineTotal.textContent = `${totalDuration.toFixed(2)}s`;
      await sendToContentScript({ type: 'setTrajectory', trajectory: currentTrajectory });
      replaySection.style.display = 'block';
      updateStatus(`Simulation complete: ${trajectoryCount} points generated`, 'success');
    } else {
      throw new Error(result.error || 'Unknown error');
    }
  } catch (error) {
    console.error('Simulation error:', error);
    updateStatus(`Error: ${error.message}`, 'error');
  } finally {
    btnSimulate.disabled = false;
  }
});

btnReplay.addEventListener('click', async () => {
  if (currentTrajectory.length === 0) {
    updateStatus('No trajectory to replay', 'error');
    return;
  }
  timelineProgress.style.width = '0%';
  timelineHandle.style.left = '0%';
  timelineCurrent.textContent = '0.0s';
  isReplaying = true;
  btnReplay.disabled = true;
  btnStop.disabled = false;
  await sendToContentScript({ type: 'startReplay' });
  updateStatus('Replaying trajectory...', '');
});

btnStop.addEventListener('click', async () => {
  isReplaying = false;
  btnReplay.disabled = false;
  btnStop.disabled = true;
  await sendToContentScript({ type: 'stopReplay' });
  updateStatus('Replay stopped', '');
});

let isDragging = false;
timeline.addEventListener('mousedown', (e) => {
  if (currentTrajectory.length === 0) return;
  isDragging = true;
  updateTimelineFromEvent(e);
});
document.addEventListener('mousemove', (e) => {
  if (isDragging) updateTimelineFromEvent(e);
});
document.addEventListener('mouseup', () => { if (isDragging) isDragging = false; });

function updateTimelineFromEvent(e) {
  const rect = timeline.getBoundingClientRect();
  const x = e.clientX - rect.left;
  const progress = Math.max(0, Math.min(1, x / rect.width));
  seekToTime(progress * totalDuration);
}

function seekToTime(time) {
  if (currentTrajectory.length === 0) return;
  const progress = totalDuration > 0 ? time / totalDuration : 0;
  timelineProgress.style.width = `${progress * 100}%`;
  timelineHandle.style.left = `${progress * 100}%`;
  timelineCurrent.textContent = `${time.toFixed(2)}s`;
  sendToContentScript({ type: 'seekToTime', time });
}

// Listen for messages from content script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  switch (message.type) {
    case 'modeChanged':
      currentMode = message.mode;
      updateModeButtons(message.mode);
      break;
    case 'waypointAdded':
      waypointCount = message.count;
      waypointCountSpan.textContent = waypointCount;
      btnUndo.disabled = false;
      btnRedo.disabled = true;
      updateStatus(`Waypoint ${waypointCount} added`, 'success');
      break;
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
    case 'constraintAdded':
      constraintCount = message.count;
      constraintCountSpan.textContent = constraintCount;
      btnUndo.disabled = false;
      btnRedo.disabled = true;
      updateStatus(`Constraint ${constraintCount} added`, 'success');
      break;
    case 'constraintsCleared':
      constraintCount = 0;
      constraintCountSpan.textContent = '0';
      break;
    case 'trajectoryLoaded':
      trajectoryCount = message.count;
      trajectoryCountSpan.textContent = trajectoryCount;
      break;
    case 'replayProgress':
      if (!isDragging) {
        const progress = message.total > 0 ? message.current / message.total : 0;
        timelineProgress.style.width = `${progress * 100}%`;
        timelineHandle.style.left = `${progress * 100}%`;
        timelineCurrent.textContent = `${message.time.toFixed(2)}s`;
      }
      break;
    case 'replayComplete':
      isReplaying = false;
      btnReplay.disabled = false;
      btnStop.disabled = true;
      updateStatus('Replay complete', 'success');
      break;
    case 'replayStopped':
      isReplaying = false;
      btnReplay.disabled = false;
      btnStop.disabled = true;
      break;
  }
  sendResponse({ success: true });
  return true;
});

// Keyboard: Q, W, S, D, F, G, A = design modes; Esc = passthrough; Cmd+Z / Cmd+Shift+Z = undo/redo
document.addEventListener('keydown', (e) => {
  if (e.repeat) return;
  if (e.key === 'q' || e.key === 'Q') {
    e.preventDefault();
    setModeInPage('addWaypoint');
  } else if (e.key === 'w' || e.key === 'W') {
    e.preventDefault();
    setModeInPage('moveWaypoint');
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
  if (e.key === 'q' || e.key === 'Q' || e.key === 'w' || e.key === 'W' ||
      e.key === 's' || e.key === 'S' || e.key === 'd' || e.key === 'D' ||
      e.key === 'f' || e.key === 'F' || e.key === 'g' || e.key === 'G' ||
      e.key === 'a' || e.key === 'A') {
    e.preventDefault();
    setModeInPage('passthrough');
  }
});

// Initialize
(async () => {
  try {
    const state = await sendToContentScript({ type: 'getState' });
    if (state) {
      waypointCount = state.waypoints?.length || 0;
      constraintCount = state.constraints?.length || 0;
      trajectoryCount = state.trajectoryCount || 0;
      waypointCountSpan.textContent = waypointCount;
      constraintCountSpan.textContent = constraintCount;
      trajectoryCountSpan.textContent = trajectoryCount;
      currentMode = state.mode || 'passthrough';
      updateModeButtons(currentMode);
      btnUndo.disabled = !(state.canUndo);
      btnRedo.disabled = !(state.canRedo);
      screenWidth = state.screenWidth || screenWidth;
      if (state.pathDefaultWidth != null && state.screenWidth) {
        const px = Math.round(state.pathDefaultWidth * state.screenWidth);
        corridorWidthSlider.value = Math.max(5, Math.min(80, px));
        updateCorridorWidthLabel();
      }
    }
  } catch (_) {
    updateStatus('Refresh the webpage tab, then open this panel again.', 'error');
  }
})();
