// Side Panel Controller for Cursor Simulator

let currentMode = 'passthrough';
let waypointCount = 0;
let constraintCount = 0;
let trajectoryCount = 0;
let currentTrajectory = [];
let totalDuration = 0;
let isReplaying = false;

// DOM elements
const btnAddWaypoint = document.getElementById('btn-add-waypoint');
const btnMoveWaypoint = document.getElementById('btn-move-waypoint');
const btnAddConstraint = document.getElementById('btn-add-constraint');
const btnAddPathConstraint = document.getElementById('btn-add-path-constraint');
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

// Update mode buttons
function updateModeButtons(mode) {
  [btnAddWaypoint, btnMoveWaypoint, btnAddConstraint, btnAddPathConstraint, btnResizeConstraint, btnQuitDesign].forEach(b => b?.classList?.remove('active'));
  if (mode === 'addWaypoint') btnAddWaypoint?.classList.add('active');
  else if (mode === 'moveWaypoint') btnMoveWaypoint?.classList.add('active');
  else if (mode === 'addConstraint') btnAddConstraint?.classList.add('active');
  else if (mode === 'addPathConstraint') btnAddPathConstraint?.classList.add('active');
  else if (mode === 'resizeConstraint') btnResizeConstraint?.classList.add('active');
  else btnQuitDesign?.classList.add('active');
}

// Event listeners — hold key for design mode; release key to quit
const MODE_HINTS = {
  addWaypoint: 'Hold Q, then click on the page to add waypoints',
  moveWaypoint: 'Hold W, then drag a waypoint to move it',
  addConstraint: 'Hold A, then drag on the page to draw a constraint',
  addPathConstraint: 'Hold D, click to add path points; release D to finish corridor',
  resizeConstraint: 'Hold S, then drag a constraint or path waypoint to resize',
  passthrough: 'Design mode off — use the page normally'
};

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
btnAddConstraint.addEventListener('click', () => setModeInPage('addConstraint'));
btnAddPathConstraint.addEventListener('click', () => setModeInPage('addPathConstraint'));
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
    // Get current state
    const state = await sendToContentScript({ type: 'getState' });
    
    // Get current tab info
    const tab = await getCurrentTab();
    
    // Get cookies for the current domain
    const cookies = await chrome.cookies.getAll({ url: tab.url });
    
    // Get viewport dimensions from the content script state
    const viewportWidth = state.screenWidth || tab.width || window.innerWidth || 1920;
    const viewportHeight = state.screenHeight || tab.height || window.innerHeight || 1080;
    
    // Prepare task configuration
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
    
    // Send to backend
    const response = await fetch('http://localhost:8000/api/simulate', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
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
        viewport: {
          width: viewportWidth,
          height: viewportHeight
        },
        url: tab.url
      })
    });
    
    if (!response.ok) {
      throw new Error(`Server error: ${response.statusText}`);
    }
    
    const result = await response.json();
    
    if (result.success && result.trajectory) {
      currentTrajectory = result.trajectory;
      trajectoryCount = currentTrajectory.length;
      trajectoryCountSpan.textContent = trajectoryCount;
      
      // Get total duration from backend response (last timestamp)
      // Trajectory format: [x, y, timestamp]
      if (result.total_duration) {
        totalDuration = result.total_duration;
      } else if (currentTrajectory.length > 0) {
        // Fallback: use last timestamp
        totalDuration = currentTrajectory[currentTrajectory.length - 1][2];
      } else {
        totalDuration = 0;
      }
      timelineTotal.textContent = `${totalDuration.toFixed(2)}s`;
      
      // Send trajectory to content script
      await sendToContentScript({
        type: 'setTrajectory',
        trajectory: currentTrajectory
      });
      
      // Show replay section
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
  
  // Reset timeline to the beginning
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

// Timeline scrubbing
let isDragging = false;

timeline.addEventListener('mousedown', (e) => {
  if (currentTrajectory.length === 0) return;
  isDragging = true;
  updateTimelineFromEvent(e);
});

document.addEventListener('mousemove', (e) => {
  if (isDragging) {
    updateTimelineFromEvent(e);
  }
});

document.addEventListener('mouseup', () => {
  if (isDragging) {
    isDragging = false;
  }
});

function updateTimelineFromEvent(e) {
  const rect = timeline.getBoundingClientRect();
  const x = e.clientX - rect.left;
  const progress = Math.max(0, Math.min(1, x / rect.width));
  const time = progress * totalDuration;
  
  seekToTime(time);
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

// Keyboard: hold Q/W/A/S for design mode; release to quit. Escape = quit. Cmd+Z = undo/redo
document.addEventListener('keydown', (e) => {
  if (e.repeat) return; // avoid re-sending setMode on key repeat so drags aren't cancelled
  if (e.key === 'q' || e.key === 'Q') {
    e.preventDefault();
    setModeInPage('addWaypoint');
  } else if (e.key === 'w' || e.key === 'W') {
    e.preventDefault();
    setModeInPage('moveWaypoint');
  } else if (e.key === 'a' || e.key === 'A') {
    e.preventDefault();
    setModeInPage('addConstraint');
  } else if (e.key === 's' || e.key === 'S') {
    e.preventDefault();
    setModeInPage('resizeConstraint');
  } else if (e.key === 'd' || e.key === 'D') {
    e.preventDefault();
    setModeInPage('addPathConstraint');
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
  // Release Q/W/A/S → quit design mode
  if (e.key === 'q' || e.key === 'Q' || e.key === 'w' || e.key === 'W' ||
      e.key === 'a' || e.key === 'A' || e.key === 's' || e.key === 'S' ||
      e.key === 'd' || e.key === 'D') {
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
    }
  } catch (_) {
    updateStatus('Refresh the webpage tab, then open this panel again.', 'error');
  }
})();
