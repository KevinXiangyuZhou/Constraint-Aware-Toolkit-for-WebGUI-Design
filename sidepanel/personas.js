// User Personas — data, mapping, UI, persistence

var BUILTIN_PERSONAS = {
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

var NC_BASE = [0.20, 0.020];

var PARAM_RANGES = {
  desired_speed:   { min: 0.10,  max: 0.30,  scale: 'linear' },
  progress_weight: { min: 1e-8,  max: 1e-5,  scale: 'log' },
  Th:              { min: 0.10,  max: 0.50,  scale: 'linear' },
  jerk_weight:     { min: 1e-7,  max: 1e-4,  scale: 'log' },
  nc_scale_smooth: { min: 2.0,   max: 0.5,   scale: 'linear' },
  wall_weight:     { min: 10,    max: 100,   scale: 'log' },
  contour_weight:  { min: 0.1,   max: 100,   scale: 'log' },
  forearm:         { min: 0.20,  max: 0.40,  scale: 'linear' }
};

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

function fmtParam(val) {
  if (Math.abs(val) < 0.001) return val.toExponential(1);
  if (Math.abs(val) >= 1000) return val.toExponential(1);
  if (Math.abs(val) < 1) return val.toFixed(3);
  return val.toFixed(2);
}

var personas = [];
var activePersonaId = null;
var nextCustomPersonaNumber = 1;

function generatePersonaId() {
  return 'persona-' + Date.now() + '-' + Math.random().toString(36).substr(2, 6);
}

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

function getActivePersonaConfig() {
  const p = personas.find(pp => pp.id === activePersonaId);
  return p ? p.config : BUILTIN_PERSONAS.office_worker;
}

function setSliderLevels(levels) {
  sliderPredictiveness.value = levels.predictiveness;
  sliderConstraint.value = levels.constraint;
  sliderSpeed.value = levels.speed;
  sliderSmoothness.value = levels.smoothness;
  sliderArm.value = levels.arm;
  updateAllTooltips();
}

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

function renderPersonaSelect() {
  personaSelect.innerHTML = '';
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

function selectPersona(id) {
  activePersonaId = id;
  const p = personas.find(pp => pp.id === id);
  if (p) {
    const levels = levelsFromConfig(p.config);
    setSliderLevels(levels);
  }
  renderPersonaSelect();
}

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

function onSliderChange() {
  const activeP = personas.find(p => p.id === activePersonaId);
  if (activeP && activeP.builtin) {
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

personaSelect.addEventListener('change', () => {
  selectPersona(personaSelect.value);
  saveCustomPersonas();
});

btnAddPersona.addEventListener('click', () => duplicateActivePersona());

[sliderPredictiveness, sliderConstraint, sliderSpeed, sliderSmoothness, sliderArm].forEach(sl => {
  sl.addEventListener('input', onSliderChange);
});
