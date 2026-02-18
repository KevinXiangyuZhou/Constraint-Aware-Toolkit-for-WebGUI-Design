// Side Panel Controller for Cursor Simulator

// Initialize Lucide icons (replaces <i data-lucide="..."> with SVG)
if (typeof lucide !== 'undefined') {
  lucide.createIcons();
}

let currentMode = 'passthrough';
let waypointCount = 0;
let constraintCount = 0;
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
const btnAddClick = document.getElementById('btn-add-click');
const btnQuitDesign = document.getElementById('btn-quit-design');
const btnUndo = document.getElementById('btn-undo');
const btnRedo = document.getElementById('btn-redo');
const btnSimulate = document.getElementById('btn-simulate');
const btnClear = document.getElementById('btn-clear');
const statusDiv = document.getElementById('status');
const waypointCountSpan = document.getElementById('waypoint-count');
const constraintCountSpan = document.getElementById('constraint-count');
const activeBadge = document.getElementById('active-badge');
const modeHint = document.getElementById('mode-hint');
const contextualSliderWrap = document.getElementById('contextual-slider-wrap');
const corridorWidthSlider = document.getElementById('corridor-width-slider');
const corridorWidthValue = document.getElementById('corridor-width-value');
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
  btnAddClick,
  btnQuitDesign
];

const ACTIVE_BADGE_LABELS = {
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

const MODE_HINTS = {
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
  renderExpChecks();
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

let gotoItemCounter = 0;
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

// ====== Experiment Engine ======

const expTasksChecks = document.getElementById('exp-tasks-checks');
const expPersonasChecks = document.getElementById('exp-personas-checks');
const expRunsInput = document.getElementById('exp-runs');
const resultsSection = document.getElementById('results-section');
const resultsTree = document.getElementById('results-tree');

// Experiment results state
let experimentResults = []; // array of { taskId, taskName, sims: [{ personaId, personaName, personaCfg, rounds: [{ seed, status, trajectory, duration, error }], expanded }], expanded }
let playingRoundRef = null; // { taskIdx, simIdx, roundIdx } or null
let experimentRunning = false;

// Deterministic seeding: produce unique seeds per (experiment, task, persona, round)
function makeSeed(expSeed, taskIndex, personaIndex, roundIndex) {
  // Simple deterministic formula that guarantees unique seeds for all combos
  // Use prime multipliers to avoid collisions
  return ((expSeed % 100000) * 1000000 + taskIndex * 10000 + personaIndex * 100 + roundIndex + 1) % 2147483647;
}

// Render experiment checkboxes
function renderExpChecks() {
  expTasksChecks.innerHTML = '';
  tasks.forEach(t => {
    const label = document.createElement('label');
    label.className = 'exp-check-item';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = true;
    cb.dataset.taskId = t.id;
    label.appendChild(cb);
    label.appendChild(document.createTextNode(t.name));
    expTasksChecks.appendChild(label);
  });

  expPersonasChecks.innerHTML = '';
  personas.forEach(p => {
    const label = document.createElement('label');
    label.className = 'exp-check-item';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = p.id === activePersonaId;
    cb.dataset.personaId = p.id;
    label.appendChild(cb);
    label.appendChild(document.createTextNode(p.name));
    expPersonasChecks.appendChild(label);
  });
}

// All / None selection buttons
document.getElementById('exp-tasks-all').addEventListener('click', () => {
  expTasksChecks.querySelectorAll('input[type="checkbox"]').forEach(cb => { cb.checked = true; });
});
document.getElementById('exp-tasks-none').addEventListener('click', () => {
  expTasksChecks.querySelectorAll('input[type="checkbox"]').forEach(cb => { cb.checked = false; });
});
document.getElementById('exp-personas-all').addEventListener('click', () => {
  expPersonasChecks.querySelectorAll('input[type="checkbox"]').forEach(cb => { cb.checked = true; });
});
document.getElementById('exp-personas-none').addEventListener('click', () => {
  expPersonasChecks.querySelectorAll('input[type="checkbox"]').forEach(cb => { cb.checked = false; });
});

// Build task config from a task's saved items. Returns { taskConfig, clickMap }.
// clickMap: array of { waypointIndex, itemId, selector, xpath, x, y, dwellMs, toleranceRadiusPx, pageUrl }
function buildTaskConfig(taskData, viewportW, viewportH) {
  const allWaypoints = taskData.items.filter(i => i.type === 'waypoint' || i.type === 'waypoint_click');
  const constraints = taskData.items.filter(i => i.type === 'constraint' && i.enabled !== false);

  const clickMap = [];
  allWaypoints.forEach((w, idx) => {
    if (w.type === 'waypoint_click') {
      clickMap.push({
        waypointIndex: idx,
        itemId: w.id,
        selector: w.data.selector || '',
        xpath: w.data.xpath || '',
        x: w.data.pixelX || w.data.x * viewportW,
        y: w.data.pixelY || w.data.y * viewportH,
        dwellMs: w.data.dwellMs || 200,
        toleranceRadiusPx: w.data.toleranceRadiusPx || 10,
        pageUrl: w.data.pageUrl || ''
      });
    }
  });

  const taskConfig = {
    waypoints: allWaypoints.map(w => [w.data.pixelX || w.data.x * viewportW, w.data.pixelY || w.data.y * viewportH]),
    screen_width: viewportW,
    screen_height: viewportH,
    constraints: {
      coordinate_system: 'normalized',
      default_margin: 0.005,
      regions: constraints.map(c => {
        const d = c.data;
        const base = {
          constraint_type: d.constraintType === 'keep-in' ? 'keep_in' : 'keep_out',
          margin: 0.002,
          enabled: true
        };
        if (d.type === 'path' && d.path) {
          base.geometry = { type: 'path', path: d.path, width: d.width };
        } else {
          base.geometry = { type: d.type || 'rectangle', x: d.x, y: d.y, width: d.width, height: d.height };
        }
        return base;
      })
    }
  };
  return { taskConfig, clickMap };
}

// Split a task's items into per-page groups at goto boundaries.
// Each group has its own taskConfig, clickMap, and allWaypoints for independent simulation.
function buildPageGroups(taskData, viewportW, viewportH) {
  const groups = [];
  let currentGroup = null;

  for (const item of taskData.items) {
    if (item.type === 'goto') {
      currentGroup = { gotoUrl: item.data.url, items: [] };
      groups.push(currentGroup);
    } else if (currentGroup) {
      currentGroup.items.push(item);
    } else {
      currentGroup = { gotoUrl: null, items: [item] };
      groups.push(currentGroup);
    }
  }

  return groups.map(g => {
    const { taskConfig, clickMap } = buildTaskConfig({ items: g.items }, viewportW, viewportH);
    return { gotoUrl: g.gotoUrl, taskConfig, clickMap, allWaypoints: taskConfig.waypoints };
  });
}

// Check trajectory for constraint violations.
// Returns { violated: boolean, count: number } where count = number of trajectory points violating any constraint.
function checkViolations(trajectory, taskConfig) {
  if (!trajectory || !taskConfig.constraints?.regions) return { violated: false, count: 0 };
  const W = taskConfig.screen_width;
  const H = taskConfig.screen_height;
  let count = 0;
  for (const [px, py] of trajectory) {
    const nx = px / W, ny = py / H;
    for (const region of taskConfig.constraints.regions) {
      const g = region.geometry;
      if (!g) continue;
      const inside = isInsideRegion(nx, ny, g);
      if (region.constraint_type === 'keep_in' && !inside) { count++; break; }
      if (region.constraint_type === 'keep_out' && inside) { count++; break; }
    }
  }
  return { violated: count > 0, count };
}

function isInsideRegion(nx, ny, g) {
  if (g.type === 'rectangle') {
    return nx >= g.x && nx <= g.x + g.width && ny >= g.y && ny <= g.y + g.height;
  }
  if (g.type === 'path' && g.path && g.path.length >= 2) {
    const halfW = (g.width || 0.02) / 2;
    for (let i = 0; i < g.path.length - 1; i++) {
      const [ax, ay] = g.path[i], [bx, by] = g.path[i + 1];
      const dx = bx - ax, dy = by - ay;
      const len = Math.hypot(dx, dy) || 1;
      const t = Math.max(0, Math.min(1, ((nx - ax) * dx + (ny - ay) * dy) / (len * len)));
      const projX = ax + t * dx, projY = ay + t * dy;
      if (Math.hypot(nx - projX, ny - projY) <= halfW) return true;
    }
    return false;
  }
  return false;
}

// Run a single simulation call
async function runSingleSim(taskConfig, personaCfg, seed, cookies, viewport, url) {
  // Embed the seed directly into the persona config so it's guaranteed to reach the simulator
  const cfgWithSeed = {
    ...personaCfg,
    random_seed: seed
  };
  const response = await fetch('http://localhost:8000/api/simulate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      task: taskConfig,
      user_config: cfgWithSeed,
      random_seed: seed,
      cookies,
      viewport,
      url
    })
  });
  if (!response.ok) throw new Error(`Server error: ${response.statusText}`);
  return response.json();
}

// Main experiment runner
btnSimulate.addEventListener('click', async () => {
  // Collect selected tasks and personas
  const selTaskIds = [...expTasksChecks.querySelectorAll('input:checked')].map(cb => cb.dataset.taskId);
  const selPersonaIds = [...expPersonasChecks.querySelectorAll('input:checked')].map(cb => cb.dataset.personaId);
  const runsPerConfig = Math.max(1, parseInt(expRunsInput.value) || 1);

  if (selTaskIds.length === 0) { updateStatus('Select at least one task', 'error'); return; }
  if (selPersonaIds.length === 0) { updateStatus('Select at least one persona', 'error'); return; }

  // Ensure all tasks have saved state
  await saveActiveTaskState();

  // Validate tasks have waypoints
  for (const tid of selTaskIds) {
    const t = tasks.find(tt => tt.id === tid);
    const wpCount = t ? t.items.filter(i => i.type === 'waypoint').length : 0;
    if (wpCount < 2) {
      updateStatus(`Task "${t?.name}" needs at least 2 waypoints`, 'error');
      return;
    }
  }

  const experimentSeed = Date.now();
  experimentRunning = true;
  btnSimulate.disabled = true;
  updateStatus('Running experiment...', '');

  // Build results structure
  experimentResults = selTaskIds.map((tid, ti) => {
    const t = tasks.find(tt => tt.id === tid);
    return {
      taskId: tid,
      taskName: t?.name || tid,
      expanded: true,
      sims: selPersonaIds.map((pid, si) => {
        const p = personas.find(pp => pp.id === pid);
        return {
          personaId: pid,
          personaName: p?.name || pid,
          personaCfg: p ? JSON.parse(JSON.stringify(p.config)) : {},
          expanded: true,
          rounds: Array.from({ length: runsPerConfig }, (_, ri) => ({
            seed: makeSeed(experimentSeed, ti, si, ri),
            status: 'pending',
            trajectory: null,
            duration: null,
            error: null
          }))
        };
      })
    };
  });

  resultsSection.style.display = 'block';
  renderResults();

  // Gather common data
  let cookies = [];
  let viewportW = 1920, viewportH = 1080, tabUrl = '';
  try {
    const tab = await getCurrentTab();
    cookies = (await chrome.cookies.getAll({ url: tab.url })).map(c => ({
      name: c.name, value: c.value, domain: c.domain, path: c.path,
      secure: c.secure, httpOnly: c.httpOnly, sameSite: c.sameSite
    }));
    const st = await sendToContentScript({ type: 'getState' });
    viewportW = st?.screenWidth || tab.width || 1920;
    viewportH = st?.screenHeight || tab.height || 1080;
    tabUrl = tab.url;
  } catch (_) {}

  // Execute all simulations sequentially — per-page simulation
  for (let ti = 0; ti < experimentResults.length; ti++) {
    const taskRes = experimentResults[ti];
    const taskData = tasks.find(tt => tt.id === taskRes.taskId);
    if (!taskData) continue;
    const pageGroups = buildPageGroups(taskData, viewportW, viewportH);

    for (let si = 0; si < taskRes.sims.length; si++) {
      const sim = taskRes.sims[si];
      sim.pageGroups = pageGroups;

      for (let ri = 0; ri < sim.rounds.length; ri++) {
        const round = sim.rounds[ri];
        round.status = 'running';
        round.clickResults = [];
        round.pageJumps = [];
        round.pageTrajectories = [];
        renderResults();

        let allTrajectoryPoints = [];
        let totalDuration = 0;
        let failed = false;

        for (let pgIdx = 0; pgIdx < pageGroups.length; pgIdx++) {
          const pg = pageGroups[pgIdx];
          if (pg.taskConfig.waypoints.length < 2) {
            round.pageTrajectories.push({
              gotoUrl: pg.gotoUrl, trajectory: [], clickMap: pg.clickMap,
              allWaypoints: pg.allWaypoints, duration: 0,
              violations: { violated: false, count: 0 }
            });
            continue;
          }
          try {
            const result = await runSingleSim(
              pg.taskConfig, sim.personaCfg, round.seed + pgIdx,
              cookies, { width: viewportW, height: viewportH }, tabUrl
            );
            if (result.success && result.trajectory) {
              const traj = result.trajectory;
              const dur = result.total_duration ?? (traj.length > 0 ? traj[traj.length - 1][2] : 0);
              round.pageTrajectories.push({
                gotoUrl: pg.gotoUrl, trajectory: traj, clickMap: pg.clickMap,
                allWaypoints: pg.allWaypoints, duration: dur,
                violations: checkViolations(traj, pg.taskConfig)
              });
              allTrajectoryPoints.push(...traj);
              totalDuration += dur;
            } else {
              failed = true;
              round.error = result.error || 'Unknown error';
              break;
            }
          } catch (err) {
            failed = true;
            round.error = err.message;
            break;
          }
          renderResults();
        }

        round.trajectory = allTrajectoryPoints;
        round.duration = totalDuration;
        round.violations = {
          violated: round.pageTrajectories.some(p => p.violations?.violated),
          count: round.pageTrajectories.reduce((s, p) => s + (p.violations?.count || 0), 0)
        };
        round.status = failed ? 'error' : 'done';
        renderResults();
      }
    }
  }

  experimentRunning = false;
  btnSimulate.disabled = false;
  updateStatus('Experiment complete', 'success');
});

// ====== Playback Management ======

// Split a trajectory into segments at click waypoint positions.
// clickMap entries have waypointIndex, but we need to map to trajectory point indices.
// We find the trajectory point closest to each click waypoint's (x, y).
function buildSegmentPlan(trajectory, clickMap) {
  if (!clickMap || clickMap.length === 0) {
    return [{ trajectory, clickTarget: null }];
  }

  // Find trajectory split points for each click waypoint
  const splitIndices = [];
  for (const cm of clickMap) {
    let bestIdx = -1, bestDist = Infinity;
    for (let i = 0; i < trajectory.length; i++) {
      const d = Math.hypot(trajectory[i][0] - cm.x, trajectory[i][1] - cm.y);
      if (d < bestDist) { bestDist = d; bestIdx = i; }
    }
    if (bestIdx >= 0) splitIndices.push({ idx: bestIdx, cm });
  }
  splitIndices.sort((a, b) => a.idx - b.idx);

  const segments = [];
  let start = 0;
  for (const { idx, cm } of splitIndices) {
    const end = Math.min(idx + 1, trajectory.length);
    const slice = trajectory.slice(start, end);
    const t0 = slice.length > 0 ? slice[0][2] : 0;
    const rebased = slice.map(([x, y, t]) => [x, y, t - t0]);
    segments.push({
      trajectory: rebased,
      clickTarget: { x: cm.x, y: cm.y, dwellMs: cm.dwellMs, toleranceRadiusPx: cm.toleranceRadiusPx, selector: cm.selector, xpath: cm.xpath, itemId: cm.itemId }
    });
    start = end;
  }
  // Remaining trajectory after last click
  if (start < trajectory.length) {
    const slice = trajectory.slice(start);
    const t0 = slice.length > 0 ? slice[0][2] : 0;
    const rebased = slice.map(([x, y, t]) => [x, y, t - t0]);
    segments.push({ trajectory: rebased, clickTarget: null });
  }
  return segments;
}

// Wait for a message of a given type from content script, with timeout
function waitForMessage(type, timeoutMs = 30000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      chrome.runtime.onMessage.removeListener(handler);
      reject(new Error('timeout'));
    }, timeoutMs);
    function handler(msg, sender, sendResponse) {
      if (msg.type === type) {
        clearTimeout(timer);
        chrome.runtime.onMessage.removeListener(handler);
        resolve(msg);
      }
      if (sendResponse) sendResponse({ success: true });
      return true;
    }
    chrome.runtime.onMessage.addListener(handler);
  });
}

// Wait for the active tab to finish loading (after navigation)
function waitForTabLoad(timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(handler);
      reject(new Error('navigation_timeout'));
    }, timeoutMs);
    function handler(tabId, changeInfo) {
      if (changeInfo.status === 'complete') {
        getCurrentTab().then(tab => {
          if (tab && tab.id === tabId) {
            clearTimeout(timer);
            chrome.tabs.onUpdated.removeListener(handler);
            resolve(tab.url);
          }
        });
      }
    }
    chrome.tabs.onUpdated.addListener(handler);
  });
}

let playbackAborted = false;

async function sendTaskItemsWithRetry(items, maxRetries = 5, delayMs = 400) {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      await sendToContentScript({ type: 'loadTaskState', items, undoStack: [], redoStack: [] });
      return true;
    } catch (_) {
      await new Promise(r => setTimeout(r, delayMs));
    }
  }
  return false;
}

async function playRound(taskIdx, simIdx, roundIdx) {
  const sim = experimentResults[taskIdx]?.sims[simIdx];
  const round = sim?.rounds[roundIdx];
  if (!round || !round.pageTrajectories || round.pageTrajectories.length === 0) return;

  if (playingRoundRef) { await stopPlayback(); }

  playingRoundRef = { taskIdx, simIdx, roundIdx };
  isReplaying = true;
  playbackAborted = false;
  renderResults();

  const replayTaskData = tasks.find(tt => tt.id === experimentResults[taskIdx]?.taskId);
  round.clickResults = [];
  round.pageJumps = [];
  const tab = await getCurrentTab();
  if (tab?.url) round.pageJumps.push(tab.url);

  for (let pgIdx = 0; pgIdx < round.pageTrajectories.length; pgIdx++) {
    if (playbackAborted) break;
    const pg = round.pageTrajectories[pgIdx];

    // Navigate to the page group's URL if needed
    if (pg.gotoUrl) {
      const curTab = await getCurrentTab();
      const targetUrl = pg.gotoUrl.split('#')[0];
      const currentUrl = curTab?.url?.split('#')[0] || '';
      if (targetUrl && targetUrl !== currentUrl) {
        try {
          await chrome.tabs.update(curTab.id, { url: pg.gotoUrl });
          const newUrl = await waitForTabLoad(15000);
          if (newUrl) round.pageJumps.push(newUrl);
          // Wait for content script re-injection + page rendering
          await new Promise(r => setTimeout(r, 1000));
        } catch (navErr) {
          console.error('Page group navigation error:', navErr);
          break;
        }
      }
    }

    // Send task items so the overlay shows the current page's items
    if (replayTaskData) {
      await sendTaskItemsWithRetry(replayTaskData.items);
    }

    // Allow the page to settle before starting segment replay
    await new Promise(r => setTimeout(r, 500));

    if (pg.trajectory.length === 0) continue;

    // Build segment plan for this page group's trajectory
    const segments = buildSegmentPlan(pg.trajectory, pg.clickMap || []);

    for (let segIdx = 0; segIdx < segments.length; segIdx++) {
      if (playbackAborted) break;
      const seg = segments[segIdx];
      if (seg.trajectory.length === 0 && !seg.clickTarget) continue;

      try {
        if (seg.clickTarget) {
          await sendToContentScript({ type: 'loadReplaySegment', trajectory: seg.trajectory, clickTarget: seg.clickTarget });
          const clickMsg = await waitForMessage('clickFired', 30000);
          const result = clickMsg.result || {};
          const preUrl = (await getCurrentTab())?.url || '';
          round.clickResults.push({
            waypointId: seg.clickTarget.itemId,
            success: result.success,
            preClickUrl: preUrl,
            postClickUrl: preUrl,
            loadDurationMs: 0,
            failureReason: result.failureReason || null
          });

          if (result.success) {
            const navStart = Date.now();
            try {
              const newUrl = await waitForTabLoad(15000);
              const loadDuration = Date.now() - navStart;
              const lastClick = round.clickResults[round.clickResults.length - 1];
              lastClick.postClickUrl = newUrl;
              lastClick.loadDurationMs = loadDuration;
              if (newUrl !== preUrl) round.pageJumps.push(newUrl);
              // Wait for content script re-injection + page rendering
              await new Promise(r => setTimeout(r, 1000));

              // Send task items so the new page's overlay shows its items
              if (newUrl !== preUrl && replayTaskData) {
                await sendTaskItemsWithRetry(replayTaskData.items);
                await new Promise(r => setTimeout(r, 500));
              }
            } catch (navErr) {
              if (navErr.message === 'navigation_timeout') {
                const lastClick = round.clickResults[round.clickResults.length - 1];
                lastClick.failureReason = 'navigation_timeout';
              }
            }
          }
        } else {
          await sendToContentScript({ type: 'loadReplaySegment', trajectory: seg.trajectory });
          await waitForMessage('segmentComplete', 60000);
        }
      } catch (err) {
        console.error('Segment playback error:', err);
        break;
      }
      renderResults();
    }
  }

  // Clean up: hide ghost cursor and stop replay state in content script
  try { await sendToContentScript({ type: 'stopReplay' }); } catch (_) {}
  playingRoundRef = null;
  isReplaying = false;
  renderResults();
}

async function stopPlayback() {
  playbackAborted = true;
  if (!playingRoundRef) return;
  try {
    await sendToContentScript({ type: 'stopReplay' });
  } catch (_) {}
  playingRoundRef = null;
  isReplaying = false;
  renderResults();
}

// ====== Results Rendering ======

function renderResults() {
  resultsTree.innerHTML = '';
  if (experimentResults.length === 0) return;

  experimentResults.forEach((taskRes, ti) => {
    const taskEl = document.createElement('div');
    taskEl.className = 'res-task';

    const taskHeader = document.createElement('div');
    taskHeader.className = 'res-task-header';
    const tExpIcon = document.createElement('span');
    tExpIcon.className = 'expand-icon' + (taskRes.expanded ? ' expanded' : '');
    tExpIcon.textContent = '\u25B6';
    taskHeader.appendChild(tExpIcon);
    taskHeader.appendChild(document.createTextNode(taskRes.taskName));
    taskHeader.addEventListener('click', () => { taskRes.expanded = !taskRes.expanded; renderResults(); });
    taskEl.appendChild(taskHeader);

    if (taskRes.expanded) {
      taskRes.sims.forEach((sim, si) => {
        const simEl = document.createElement('div');
        simEl.className = 'res-sim';

        const simHeader = document.createElement('div');
        simHeader.className = 'res-sim-header';
        const sExpIcon = document.createElement('span');
        sExpIcon.className = 'expand-icon' + (sim.expanded ? ' expanded' : '');
        sExpIcon.textContent = '\u25B6';
        simHeader.appendChild(sExpIcon);
        simHeader.appendChild(document.createTextNode(sim.personaName));

        // Completion badge
        const doneCount = sim.rounds.filter(r => r.status === 'done').length;
        const errCount = sim.rounds.filter(r => r.status === 'error').length;
        const badge = document.createElement('span');
        badge.style.cssText = 'font-size:10px;color:#737373;margin-left:auto;';
        badge.textContent = `${doneCount}/${sim.rounds.length}`;
        if (errCount > 0) badge.textContent += ` (${errCount} failed)`;
        simHeader.appendChild(badge);

        simHeader.addEventListener('click', () => { sim.expanded = !sim.expanded; renderResults(); });
        simEl.appendChild(simHeader);

        if (sim.expanded) {
          // Aggregated metrics
          const completedRounds = sim.rounds.filter(r => r.status === 'done' && r.duration != null);
          if (completedRounds.length > 0) {
            const times = completedRounds.map(r => r.duration);
            const avgTime = times.reduce((a, b) => a + b, 0) / times.length;

            // Constraint violations
            const violatingRoundIndices = [];
            sim.rounds.forEach((r, ri) => {
              if (r.status === 'done' && r.violations && r.violations.violated) {
                violatingRoundIndices.push(ri + 1);
              }
            });
            const violationRate = completedRounds.length > 0
              ? (violatingRoundIndices.length / completedRounds.length * 100).toFixed(0)
              : 0;

            const info = document.createElement('div');
            info.className = 'res-sim-info';
            let html = `<span class="metric-label">Avg time:</span> <span class="metric-val">${avgTime.toFixed(2)}s</span>`;
            html += `<br><span class="metric-label">Completed:</span> <span class="metric-val">${doneCount}/${sim.rounds.length}</span>`;
            if (errCount > 0) html += ` <span class="metric-warn">(${errCount} failed)</span>`;
            html += `<br><span class="metric-label">Violations:</span> `;
            if (violatingRoundIndices.length === 0) {
              html += `<span class="metric-val">None</span>`;
            } else {
              html += `<span class="metric-warn">${violationRate}% — check Round${violatingRoundIndices.length > 1 ? 's' : ''} ${violatingRoundIndices.join(', ')}</span>`;
            }
            // Click failure aggregation
            const allClickResults = sim.rounds.flatMap(r => r.clickResults || []);
            if (allClickResults.length > 0) {
              const clickFails = allClickResults.filter(c => !c.success).length;
              html += `<br><span class="metric-label">Clicks:</span> `;
              if (clickFails === 0) {
                html += `<span class="metric-val">${allClickResults.length} OK</span>`;
              } else {
                html += `<span class="metric-warn">${clickFails}/${allClickResults.length} failed</span>`;
              }
            }

            info.innerHTML = html;
            simEl.appendChild(info);
          }

          // Round entries
          sim.rounds.forEach((round, ri) => {
            const rowEl = document.createElement('div');
            rowEl.className = 'res-round';

            const isPlaying = playingRoundRef && playingRoundRef.taskIdx === ti && playingRoundRef.simIdx === si && playingRoundRef.roundIdx === ri;

            const labelEl = document.createElement('span');
            labelEl.className = 'res-round-label';
            labelEl.textContent = 'Round ' + (ri + 1);
            labelEl.title = 'Seed: ' + round.seed;
            rowEl.appendChild(labelEl);

            const barEl = document.createElement('div');
            barEl.className = 'res-round-bar';
            const fillEl = document.createElement('div');
            fillEl.className = 'res-round-bar-fill';
            if (round.status === 'done') { fillEl.classList.add('done'); fillEl.style.width = '100%'; }
            else if (round.status === 'running') { fillEl.classList.add('running'); fillEl.style.width = '60%'; }
            else if (round.status === 'error') { fillEl.classList.add('error'); fillEl.style.width = '100%'; }
            else { fillEl.style.width = '0%'; }
            barEl.appendChild(fillEl);
            rowEl.appendChild(barEl);

            const timeEl = document.createElement('span');
            timeEl.className = 'res-round-time';
            timeEl.textContent = round.duration != null ? round.duration.toFixed(1) + 's' : '';
            rowEl.appendChild(timeEl);

            const playBtn = document.createElement('button');
            playBtn.className = 'res-round-play' + (isPlaying ? ' playing' : '');
            playBtn.textContent = isPlaying ? '\u25A0 Stop' : '\u25B6 Play';
            playBtn.disabled = !round.trajectory;
            playBtn.addEventListener('click', () => {
              if (isPlaying) { stopPlayback(); }
              else { playRound(ti, si, ri); }
            });
            rowEl.appendChild(playBtn);

            simEl.appendChild(rowEl);

            // Show click results and page jumps for this round
            if (round.clickResults && round.clickResults.length > 0) {
              const clickInfo = document.createElement('div');
              clickInfo.style.cssText = 'padding:2px 0 2px 68px;font-size:10px;color:#737373;';
              const failures = round.clickResults.filter(c => !c.success);
              if (failures.length > 0) {
                clickInfo.innerHTML = '<span style="color:#fbbf24;">\u26A0 ' + failures.length + ' click(s) failed: ' + failures.map(f => f.failureReason || 'unknown').join(', ') + '</span>';
              } else {
                clickInfo.textContent = '\u2713 ' + round.clickResults.length + ' click(s) OK';
                clickInfo.style.color = '#86efac';
              }
              simEl.appendChild(clickInfo);
            }
            if (round.pageJumps && round.pageJumps.length > 1) {
              const jumpEl = document.createElement('div');
              jumpEl.style.cssText = 'padding:1px 0 3px 68px;font-size:9px;color:#525252;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
              jumpEl.title = round.pageJumps.join(' → ');
              const shortUrls = round.pageJumps.map(u => { try { return new URL(u).pathname; } catch (_) { return u; } });
              jumpEl.textContent = shortUrls.join(' → ');
              simEl.appendChild(jumpEl);
            }
          });
        }

        taskEl.appendChild(simEl);
      });
    }

    resultsTree.appendChild(taskEl);
  });
}

// ====== Message Listener ======

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  switch (message.type) {
    case 'contentScriptReady': {
      // During replay, send the replay task's items (not the active task)
      let itemsToSend = null;
      if (playingRoundRef) {
        const replayTask = tasks.find(t => t.id === experimentResults[playingRoundRef.taskIdx]?.taskId);
        if (replayTask) itemsToSend = replayTask.items;
      }
      if (!itemsToSend) {
        const task = tasks.find(t => t.id === activeTaskId);
        if (task) itemsToSend = task.items;
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
      const addedType = message.item?.type;
      const typeLabel = addedType === 'waypoint' ? 'Waypoint' : addedType === 'waypoint_click' ? 'Click waypoint' : addedType === 'goto' ? 'Go-to' : 'Constraint';
      updateStatus(`${typeLabel} added`, 'success');
      renderTasksList();
      renderExpChecks();
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
  // Don't process shortcuts when editing task names
  if (document.activeElement?.classList?.contains('task-name-input')) return;

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

  // Create default "Task 1" and set as active
  const defaultTask = createTask();
  await insertInitialGoto(defaultTask);
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
      // Sync existing items into the default task (preserve the goto we just inserted)
      if (st.items && st.items.length > 0) {
        const gotoItems = defaultTask.items.filter(i => i.type === 'goto');
        defaultTask.items = [...gotoItems, ...st.items];
        defaultTask.undoStack = st.undoStack || [];
        defaultTask.redoStack = st.redoStack || [];
        renderTasksList();
      }
    }
  } catch (_) {
    updateStatus('Refresh the webpage tab, then open this panel again.', 'error');
  }

  renderExpChecks();
})();
