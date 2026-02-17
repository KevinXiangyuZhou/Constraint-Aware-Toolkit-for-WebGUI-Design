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

// Task management
let tasks = [];
let activeTaskId = null;
let nextTaskNumber = 1;

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
const toggleDebugger = document.getElementById('toggle-debugger');
const btnAddTask = document.getElementById('btn-add-task');
const tasksListEl = document.getElementById('tasks-list');
const personaSelect = document.getElementById('persona-select');
const btnAddPersona = document.getElementById('btn-add-persona');
const sliderPredictiveness = document.getElementById('slider-predictiveness');
const sliderConstraint = document.getElementById('slider-constraint');
const sliderSpeed = document.getElementById('slider-speed');
const sliderSmoothness = document.getElementById('slider-smoothness');
const sliderArm = document.getElementById('slider-arm');
const tooltipPredictiveness = document.getElementById('tooltip-predictiveness');
const tooltipConstraint = document.getElementById('tooltip-constraint');
const tooltipSpeed = document.getElementById('tooltip-speed');
const tooltipSmoothness = document.getElementById('tooltip-smoothness');
const tooltipArm = document.getElementById('tooltip-arm');

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
  addRectKeepIn: 'Drag to draw a keep-in area (blue). Release S to exit.',
  addRectKeepOut: 'Drag to draw a keep-out area (red). Release F to exit.',
  addPathKeepIn: 'Click to add path points; release D to finalize corridor (blue).',
  addPathKeepOut: 'Click to add path points; release G to finalize corridor (red).',
  resizeConstraint: 'Drag the edge of a constraint area to resize. Release A to exit.',
  passthrough: 'Design mode off — use the page normally.'
};

// Get current tab
async function getCurrentTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

// Send message to content script
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

// ====== User Personas ======

// Predefined persona data (embedded from hcs_package/src/user_configurations)
const BUILTIN_PERSONAS = {
  office_worker: {
    name: 'Office Worker',
    _description: 'Office worker — balanced speed and precision, everyday desktop use',
    Tp: 0.05, Th: 0.30, nc: [0.20, 0.020], forearm: 0.35,
    planner_weights: { jerk: 5e-06, progress: 3e-07, wall: 50, contour: 10, lag: 1.0, desired_speed: 0.20 }
  },
  gamer: {
    name: 'Gamer',
    _description: 'Gamer / Power user — fast, precise, long planning horizon',
    Tp: 0.05, Th: 0.50, nc: [0.10, 0.010], forearm: 0.36,
    planner_weights: { jerk: 1e-06, progress: 5e-06, wall: 20, contour: 10, lag: 1.0, desired_speed: 0.30 }
  },
  novice: {
    name: 'Novice',
    _description: 'Novice computer user — slow, over-cautious',
    Tp: 0.05, Th: 0.20, nc: [0.26, 0.026], forearm: 0.34,
    planner_weights: { jerk: 3e-05, progress: 3e-08, wall: 80, contour: 30, lag: 3.0, desired_speed: 0.12 }
  },
  fatigued: {
    name: 'Fatigued',
    _description: 'Fatigued user — reduced speed, elevated noise',
    Tp: 0.05, Th: 0.20, nc: [0.30, 0.030], forearm: 0.35,
    planner_weights: { jerk: 2e-06, progress: 1e-07, wall: 50, contour: 5, lag: 0.5, desired_speed: 0.15 }
  },
  young_children: {
    name: 'Young Children',
    _description: 'Young children — slow, imprecise, small hand',
    Tp: 0.05, Th: 0.15, nc: [0.36, 0.036], forearm: 0.22,
    planner_weights: { jerk: 3e-07, progress: 3e-08, wall: 15, contour: 3, lag: 0.3, desired_speed: 0.12 }
  },
  motor_impaired: {
    name: 'Motor Impaired',
    _description: 'Motor impairment — very slow, high noise, cautious near walls',
    Tp: 0.05, Th: 0.15, nc: [0.40, 0.040], forearm: 0.35,
    planner_weights: { jerk: 1e-07, progress: 1e-08, wall: 100, contour: 50, lag: 5.0, desired_speed: 0.10 }
  }
};

// Noise base vector: nc_scale multiplies these
const NC_BASE = [0.20, 0.020];

// Parameter ranges for slider mapping
const PARAM_RANGES = {
  desired_speed:   { min: 0.10,  max: 0.30,  scale: 'linear' },
  progress_weight: { min: 1e-8,  max: 1e-5,  scale: 'log' },
  Th:              { min: 0.10,  max: 0.50,  scale: 'linear' },
  jerk_weight:     { min: 1e-7,  max: 1e-4,  scale: 'log' },
  nc_scale_smooth: { min: 2.0,   max: 0.5,   scale: 'linear' },  // inverse: higher level = less noise
  wall_weight:     { min: 10,    max: 100,   scale: 'log' },
  contour_weight:  { min: 0.1,   max: 100,   scale: 'log' },
  forearm:         { min: 0.20,  max: 0.40,  scale: 'linear' }
};

// Mapping helpers
function linearMap(level, min, max) {
  const u = (level - 1) / 9;
  return min + u * (max - min);
}
function logMap(level, min, max) {
  const u = (level - 1) / 9;
  return Math.pow(10, Math.log10(min) + u * (Math.log10(max) - Math.log10(min)));
}
function paramFromLevel(level, paramName) {
  const r = PARAM_RANGES[paramName];
  return r.scale === 'log' ? logMap(level, r.min, r.max) : linearMap(level, r.min, r.max);
}

// Inverse mapping: value -> level (1-10)
function linearInv(value, min, max) {
  const u = (value - min) / (max - min);
  return Math.round(1 + 9 * Math.max(0, Math.min(1, u)));
}
function logInv(value, min, max) {
  const u = (Math.log10(value) - Math.log10(min)) / (Math.log10(max) - Math.log10(min));
  return Math.round(1 + 9 * Math.max(0, Math.min(1, u)));
}
function levelFromParam(value, paramName) {
  const r = PARAM_RANGES[paramName];
  return r.scale === 'log' ? logInv(value, r.min, r.max) : linearInv(value, r.min, r.max);
}

// Format parameter value for tooltip
function fmtParam(val) {
  if (Math.abs(val) < 0.001) return val.toExponential(1);
  if (Math.abs(val) >= 1000) return val.toExponential(1);
  if (Math.abs(val) < 1) return val.toFixed(3);
  return val.toFixed(2);
}

// Slider characteristic -> underlying parameters
// Predictiveness: Th
// Constraint Awareness: wall_weight + contour_weight (+ derived lag_weight)
// Speed: desired_speed + progress_weight
// Smoothness: nc (inverse) + jerk_weight
// Arm Length: forearm

// Persona state
let personas = []; // { id, name, builtin, config: { Th, nc, forearm, planner_weights: {...} } }
let activePersonaId = null;
let nextCustomPersonaNumber = 1;

function generatePersonaId() {
  return 'persona-' + Date.now() + '-' + Math.random().toString(36).substr(2, 6);
}

// Extract slider levels from a persona config
function levelsFromConfig(config) {
  const pw = config.planner_weights;
  const nc_scale = config.nc[0] / NC_BASE[0];
  return {
    predictiveness: levelFromParam(config.Th, 'Th'),
    constraint: Math.round(
      (levelFromParam(pw.wall, 'wall_weight') + levelFromParam(pw.contour, 'contour_weight')) / 2
    ),
    speed: Math.round(
      (levelFromParam(pw.desired_speed, 'desired_speed') + levelFromParam(pw.progress, 'progress_weight')) / 2
    ),
    smoothness: Math.round(
      (levelFromParam(pw.jerk, 'jerk_weight') + levelFromParam(nc_scale, 'nc_scale_smooth')) / 2
    ),
    arm: levelFromParam(config.forearm, 'forearm')
  };
}

// Build a full config from current slider levels
function configFromLevels(predLvl, constrLvl, speedLvl, smoothLvl, armLvl) {
  const Th = paramFromLevel(predLvl, 'Th');
  const wall = paramFromLevel(constrLvl, 'wall_weight');
  const contour = paramFromLevel(constrLvl, 'contour_weight');
  const lag = 0.1 * contour;
  const desired_speed = paramFromLevel(speedLvl, 'desired_speed');
  const progress = paramFromLevel(speedLvl, 'progress_weight');
  const jerk = paramFromLevel(smoothLvl, 'jerk_weight');
  const nc_scale = paramFromLevel(smoothLvl, 'nc_scale_smooth');
  const forearm = paramFromLevel(armLvl, 'forearm');
  return {
    Tp: 0.05,
    Th,
    nc: [nc_scale * NC_BASE[0], nc_scale * NC_BASE[1]],
    forearm,
    planner_weights: { jerk, progress, wall, contour, lag, desired_speed }
  };
}

// Get the active persona's full config (for simulation)
function getActivePersonaConfig() {
  const p = personas.find(pp => pp.id === activePersonaId);
  return p ? p.config : BUILTIN_PERSONAS.office_worker;
}

// Update slider UI from levels
function setSliderLevels(levels) {
  sliderPredictiveness.value = levels.predictiveness;
  sliderConstraint.value = levels.constraint;
  sliderSpeed.value = levels.speed;
  sliderSmoothness.value = levels.smoothness;
  sliderArm.value = levels.arm;
  updateAllTooltips();
}

// Update tooltip text for all sliders
function updateAllTooltips() {
  const pL = parseInt(sliderPredictiveness.value);
  const cL = parseInt(sliderConstraint.value);
  const sL = parseInt(sliderSpeed.value);
  const mL = parseInt(sliderSmoothness.value);
  const aL = parseInt(sliderArm.value);

  const th = paramFromLevel(pL, 'Th');
  tooltipPredictiveness.textContent = `Th=${fmtParam(th)}s`;

  const wl = paramFromLevel(cL, 'wall_weight');
  const ct = paramFromLevel(cL, 'contour_weight');
  tooltipConstraint.textContent = `wall=${fmtParam(wl)}, contour=${fmtParam(ct)}, lag=${fmtParam(0.1*ct)}`;

  const ds = paramFromLevel(sL, 'desired_speed');
  const pw = paramFromLevel(sL, 'progress_weight');
  tooltipSpeed.textContent = `desired_speed=${fmtParam(ds)}, progress=${fmtParam(pw)}`;

  const jk = paramFromLevel(mL, 'jerk_weight');
  const ns = paramFromLevel(mL, 'nc_scale_smooth');
  tooltipSmoothness.textContent = `jerk=${fmtParam(jk)}, nc=[${fmtParam(ns*NC_BASE[0])}, ${fmtParam(ns*NC_BASE[1])}]`;

  const fa = paramFromLevel(aL, 'forearm');
  tooltipArm.textContent = `forearm=${fmtParam(fa)}`;
}

// Populate the <select> dropdown
function renderPersonaSelect() {
  personaSelect.innerHTML = '';

  // Builtin group
  const builtinGroup = document.createElement('optgroup');
  builtinGroup.label = 'Built-in';
  personas.filter(p => p.builtin).forEach(p => {
    const opt = document.createElement('option');
    opt.value = p.id;
    opt.textContent = p.name;
    if (p.id === activePersonaId) opt.selected = true;
    builtinGroup.appendChild(opt);
  });
  personaSelect.appendChild(builtinGroup);

  // Custom group (only if any exist)
  const customPersonas = personas.filter(p => !p.builtin);
  if (customPersonas.length > 0) {
    const customGroup = document.createElement('optgroup');
    customGroup.label = 'Custom';
    customPersonas.forEach(p => {
      const opt = document.createElement('option');
      opt.value = p.id;
      opt.textContent = p.name;
      if (p.id === activePersonaId) opt.selected = true;
      customGroup.appendChild(opt);
    });
    personaSelect.appendChild(customGroup);
  }
}

// Select a persona by id
function selectPersona(id) {
  activePersonaId = id;
  const p = personas.find(pp => pp.id === id);
  if (p) {
    const levels = levelsFromConfig(p.config);
    setSliderLevels(levels);
  }
  renderPersonaSelect();
}

// Create a custom persona from the current active one
function duplicateActivePersona() {
  const src = personas.find(p => p.id === activePersonaId);
  if (!src) return;
  const name = 'Custom Persona ' + nextCustomPersonaNumber++;
  const newP = {
    id: generatePersonaId(),
    name,
    builtin: false,
    config: JSON.parse(JSON.stringify(src.config))
  };
  personas.push(newP);
  selectPersona(newP.id);
  saveCustomPersonas();
}

// Handle slider change: if active persona is builtin, auto-duplicate first
function onSliderChange() {
  const activeP = personas.find(p => p.id === activePersonaId);
  if (activeP && activeP.builtin) {
    // Auto-duplicate to custom
    const name = 'Custom Persona ' + nextCustomPersonaNumber++;
    const newP = {
      id: generatePersonaId(),
      name,
      builtin: false,
      config: JSON.parse(JSON.stringify(activeP.config))
    };
    personas.push(newP);
    activePersonaId = newP.id;
    renderPersonaSelect();
  }

  const pL = parseInt(sliderPredictiveness.value);
  const cL = parseInt(sliderConstraint.value);
  const sL = parseInt(sliderSpeed.value);
  const mL = parseInt(sliderSmoothness.value);
  const aL = parseInt(sliderArm.value);

  const newConfig = configFromLevels(pL, cL, sL, mL, aL);
  const activeP2 = personas.find(p => p.id === activePersonaId);
  if (activeP2) {
    activeP2.config = newConfig;
  }

  updateAllTooltips();
  saveCustomPersonas();
}

// Persistence: save/load custom personas to chrome.storage.local
async function saveCustomPersonas() {
  const custom = personas.filter(p => !p.builtin).map(p => ({
    id: p.id, name: p.name, config: p.config
  }));
  try {
    await chrome.storage.local.set({
      customPersonas: custom,
      activePersonaId,
      nextCustomPersonaNumber
    });
  } catch (_) {}
}

async function loadCustomPersonas() {
  try {
    const data = await chrome.storage.local.get(['customPersonas', 'activePersonaId', 'nextCustomPersonaNumber']);
    if (data.nextCustomPersonaNumber) {
      nextCustomPersonaNumber = data.nextCustomPersonaNumber;
    }
    if (data.customPersonas && Array.isArray(data.customPersonas)) {
      data.customPersonas.forEach(cp => {
        personas.push({ id: cp.id, name: cp.name, builtin: false, config: cp.config });
      });
    }
    if (data.activePersonaId && personas.some(p => p.id === data.activePersonaId)) {
      return data.activePersonaId;
    }
  } catch (_) {}
  return null;
}

// Initialize personas
function initBuiltinPersonas() {
  for (const [key, data] of Object.entries(BUILTIN_PERSONAS)) {
    personas.push({
      id: 'builtin-' + key,
      name: data.name,
      builtin: true,
      config: {
        Tp: data.Tp,
        Th: data.Th,
        nc: [...data.nc],
        forearm: data.forearm,
        planner_weights: { ...data.planner_weights }
      }
    });
  }
}

// Wire up persona events
personaSelect.addEventListener('change', () => {
  selectPersona(personaSelect.value);
  saveCustomPersonas();
});

btnAddPersona.addEventListener('click', () => duplicateActivePersona());

[sliderPredictiveness, sliderConstraint, sliderSpeed, sliderSmoothness, sliderArm].forEach(sl => {
  sl.addEventListener('input', onSliderChange);
});

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
  activeTaskId = task.id;

  try {
    await sendToContentScript({
      type: 'loadTaskState',
      items: [],
      undoStack: [],
      redoStack: []
    });
    updateCountsFromState({ waypoints: [], constraints: [] });
    btnUndo.disabled = true;
    btnRedo.disabled = true;
  } catch (_) {}

  renderTasksList();
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
      activeTaskId = task.id;
      try {
        await sendToContentScript({
          type: 'loadTaskState',
          items: [],
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

// Debugger toggle
toggleDebugger.addEventListener('change', async () => {
  try {
    await sendToContentScript({ type: 'setUseDebugger', enabled: toggleDebugger.checked });
  } catch (_) {}
});

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

btnSimulate.addEventListener('click', async () => {
  if (waypointCount < 2) {
    updateStatus('Need at least 2 waypoints to simulate', 'error');
    return;
  }

  updateStatus('Running simulation...', '');
  btnSimulate.disabled = true;

  try {
    const st = await sendToContentScript({ type: 'getState' });
    const tab = await getCurrentTab();
    const cookies = await chrome.cookies.getAll({ url: tab.url });
    const viewportWidth = st.screenWidth || tab.width || window.innerWidth || 1920;
    const viewportHeight = st.screenHeight || tab.height || window.innerHeight || 1080;

    // Only include enabled constraints
    const enabledConstraints = st.constraints.filter(c => c._enabled !== false);

    const taskConfig = {
      waypoints: st.waypoints.map(wp => [wp.pixelX, wp.pixelY]),
      screen_width: viewportWidth,
      screen_height: viewportHeight,
      constraints: {
        coordinate_system: 'normalized',
        default_margin: 0.005,
        regions: enabledConstraints.map(c => {
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

    // Build persona config for the server
    const personaCfg = getActivePersonaConfig();

    const response = await fetch('http://localhost:8000/api/simulate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        task: taskConfig,
        user_config: personaCfg,
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

// ====== Message Listener ======

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  switch (message.type) {
    case 'modeChanged':
      currentMode = message.mode;
      updateModeButtons(message.mode);
      break;
    case 'itemAdded': {
      const task = tasks.find(t => t.id === activeTaskId);
      if (task) {
        task.items.push(message.item);
      }
      waypointCount = message.waypointCount ?? waypointCount;
      constraintCount = message.constraintCount ?? constraintCount;
      waypointCountSpan.textContent = waypointCount;
      constraintCountSpan.textContent = constraintCount;
      btnUndo.disabled = false;
      btnRedo.disabled = true;
      const typeLabel = message.item?.type === 'waypoint' ? 'Waypoint' : 'Constraint';
      updateStatus(`${typeLabel} added`, 'success');
      renderTasksList();
      break;
    }
    case 'itemsChanged': {
      const task = tasks.find(t => t.id === activeTaskId);
      if (task) {
        task.items = message.items || [];
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

// ====== Keyboard Shortcuts ======

document.addEventListener('keydown', (e) => {
  if (e.repeat) return;
  // Don't process shortcuts when editing task names
  if (document.activeElement?.classList?.contains('task-name-input')) return;

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
  if (document.activeElement?.classList?.contains('task-name-input')) return;

  if (e.key === 'q' || e.key === 'Q' || e.key === 'w' || e.key === 'W' ||
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

  // Create default "Task 1" and set as active
  const defaultTask = createTask();
  activeTaskId = defaultTask.id;
  renderTasksList();

  try {
    const st = await sendToContentScript({ type: 'getState' });
    if (st) {
      waypointCount = st.waypoints?.length || 0;
      constraintCount = st.constraints?.length || 0;
      trajectoryCount = st.trajectoryCount || 0;
      waypointCountSpan.textContent = waypointCount;
      constraintCountSpan.textContent = constraintCount;
      trajectoryCountSpan.textContent = trajectoryCount;
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
      // Sync existing items into the default task
      if (st.items && st.items.length > 0) {
        defaultTask.items = st.items;
        defaultTask.undoStack = st.undoStack || [];
        defaultTask.redoStack = st.redoStack || [];
        renderTasksList();
      }
    }
  } catch (_) {
    updateStatus('Refresh the webpage tab, then open this panel again.', 'error');
  }
})();
