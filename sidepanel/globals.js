// Side Panel Controller — Global state, DOM refs, and utility functions

if (typeof lucide !== 'undefined') {
  lucide.createIcons();
}

var currentMode = 'passthrough';
var waypointCount = 0;
var constraintCount = 0;
var isReplaying = false;
var screenWidth = 1920;

var tasks = [];
var activeTaskId = null;
var nextTaskNumber = 1;

// DOM elements
var btnAddWaypoint = document.getElementById('btn-add-waypoint');
var btnMoveWaypoint = document.getElementById('btn-move-waypoint');
var btnRectKeepIn = document.getElementById('btn-rect-keep-in');
var btnRectKeepOut = document.getElementById('btn-rect-keep-out');
var btnPathKeepIn = document.getElementById('btn-path-keep-in');
var btnPathKeepOut = document.getElementById('btn-path-keep-out');
var btnResizeConstraint = document.getElementById('btn-resize-constraint');
var btnAddClick = document.getElementById('btn-add-click');
var btnQuitDesign = document.getElementById('btn-quit-design');
var btnUndo = document.getElementById('btn-undo');
var btnRedo = document.getElementById('btn-redo');
var btnSimulate = document.getElementById('btn-simulate');
var btnClear = document.getElementById('btn-clear');
var statusDiv = document.getElementById('status');
var waypointCountSpan = document.getElementById('waypoint-count');
var constraintCountSpan = document.getElementById('constraint-count');
var activeBadge = document.getElementById('active-badge');
var modeHint = document.getElementById('mode-hint');
var contextualSliderWrap = document.getElementById('contextual-slider-wrap');
var corridorWidthSlider = document.getElementById('corridor-width-slider');
var corridorWidthValue = document.getElementById('corridor-width-value');
var btnAddTask = document.getElementById('btn-add-task');
var tasksListEl = document.getElementById('tasks-list');
var personaSelect = document.getElementById('persona-select');
var btnAddPersona = document.getElementById('btn-add-persona');
var sliderPredictiveness = document.getElementById('slider-predictiveness');
var sliderConstraint = document.getElementById('slider-constraint');
var sliderSpeed = document.getElementById('slider-speed');
var sliderSmoothness = document.getElementById('slider-smoothness');
var sliderArm = document.getElementById('slider-arm');
var tooltipPredictiveness = document.getElementById('tooltip-predictiveness');
var tooltipConstraint = document.getElementById('tooltip-constraint');
var tooltipSpeed = document.getElementById('tooltip-speed');
var tooltipSmoothness = document.getElementById('tooltip-smoothness');
var tooltipArm = document.getElementById('tooltip-arm');

var TOOL_BUTTONS = [
  btnAddWaypoint,
  btnMoveWaypoint,
  btnRectKeepIn,
  btnRectKeepOut,
  btnPathKeepIn,
  btnPathKeepOut,
  btnResizeConstraint,
  btnAddClick,
  btnQuitDesign
];

var ACTIVE_BADGE_LABELS = {
  addWaypoint: 'ACTIVE: Add waypoint (Q)',
  moveWaypoint: 'ACTIVE: Move waypoint (W)',
  addClickWaypoint: 'ACTIVE: Click waypoint (E)',
  addRectKeepIn: 'ACTIVE: Area keep-in (S)',
  addRectKeepOut: 'ACTIVE: Area keep-out (F)',
  addPathKeepIn: 'ACTIVE: Path keep-in (D)',
  addPathKeepOut: 'ACTIVE: Path keep-out (G)',
  resizeConstraint: 'ACTIVE: Resize (A)',
  passthrough: 'ACTIVE: Passthrough (Esc)'
};

var SP_MODE_HINTS = {
  addWaypoint: 'Click to add a waypoint. Release Q to exit.',
  moveWaypoint: 'Drag a waypoint to move it. Release W to exit.',
  addClickWaypoint: 'Click on an element to add a click waypoint. Release E to exit.',
  addRectKeepIn: 'Drag to draw a keep-in area (blue). Release S to exit.',
  addRectKeepOut: 'Drag to draw a keep-out area (red). Release F to exit.',
  addPathKeepIn: 'Click to add path points; release D to finalize corridor (blue).',
  addPathKeepOut: 'Click to add path points; release G to finalize corridor (red).',
  resizeConstraint: 'Drag the edge of a constraint area to resize. Release A to exit.',
  passthrough: 'Design mode off — use the page normally.'
};

async function getCurrentTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

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

function updateStatus(message, type = '') {
  statusDiv.textContent = message;
  statusDiv.className = `status ${type}`;
}

function updateModeButtons(mode) {
  TOOL_BUTTONS.forEach(b => b?.classList?.remove('active'));
  const byMode = {
    addWaypoint: btnAddWaypoint,
    moveWaypoint: btnMoveWaypoint,
    addClickWaypoint: btnAddClick,
    addRectKeepIn: btnRectKeepIn,
    addRectKeepOut: btnRectKeepOut,
    addPathKeepIn: btnPathKeepIn,
    addPathKeepOut: btnPathKeepOut,
    resizeConstraint: btnResizeConstraint,
    passthrough: btnQuitDesign
  };
  if (byMode[mode]) byMode[mode]?.classList.add('active');

  activeBadge.textContent = ACTIVE_BADGE_LABELS[mode] || ACTIVE_BADGE_LABELS.passthrough;
  modeHint.textContent = SP_MODE_HINTS[mode] || SP_MODE_HINTS.passthrough;

  const showSlider = mode === 'addPathKeepIn' || mode === 'addPathKeepOut';
  contextualSliderWrap.classList.remove('visible', 'hidden');
  contextualSliderWrap.classList.add(showSlider ? 'visible' : 'hidden');
}

async function setModeInPage(mode) {
  try {
    await sendToContentScript({ type: 'setMode', mode });
    currentMode = mode;
    updateModeButtons(mode);
    updateStatus(SP_MODE_HINTS[mode] || '', '');
  } catch (err) {
    console.error('sendToContentScript failed', err);
    updateStatus('Refresh this page (F5 or Cmd+R), then try again.', 'error');
  }
}
