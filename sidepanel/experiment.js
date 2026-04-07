// Experiment engine — config building, simulation, experiment runner
// ====== Experiment Engine ======

var expTasksChecks = document.getElementById('exp-tasks-checks');
var expPersonasChecks = document.getElementById('exp-personas-checks');
var expRunsInput = document.getElementById('exp-runs');
var resultsSection = document.getElementById('results-section');
var resultsTree = document.getElementById('results-tree');

// Experiment results state
// Array of { taskId, taskName, sims: [{ personaId, personaName, personaCfg, rounds: [{ seed, status, stepResults, trajectory, duration, error }], expanded }], expanded }
var experimentResults = [];
var playingRoundRef = null; // { taskIdx, simIdx, roundIdx } or null
var experimentRunning = false;

// Deterministic seeding: produce unique seeds per (experiment, task, persona, round)
function makeSeed(expSeed, taskIndex, personaIndex, roundIndex) {
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

// Build task config from a step's items. Returns { taskConfig, clickMap }.
function buildStepConfig(stepItems, viewportW, viewportH) {
  const allWaypoints = stepItems.filter(i => i.type === 'waypoint' || i.type === 'waypoint_click');
  const constraints = stepItems.filter(i => i.type === 'constraint' && i.enabled !== false);

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
        pageUrl: w.data.pageUrl || '',
        gotoUrl: w.data.gotoUrl || null
      });
    }
  });

  // If the last waypoint is a click, pass its tolerance radius
  const lastWp = allWaypoints.length > 0 ? allWaypoints[allWaypoints.length - 1] : null;
  const clickRadiusPx = (lastWp && lastWp.type === 'waypoint_click')
    ? (lastWp.data.toleranceRadiusPx || 50) : null;

  const taskConfig = {
    waypoints: allWaypoints.map(w => [w.data.pixelX || w.data.x * viewportW, w.data.pixelY || w.data.y * viewportH]),
    screen_width: viewportW,
    screen_height: viewportH,
    click_target_radius_px: clickRadiusPx,
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

// Check trajectory for constraint violations.
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

  // Validate tasks have steps with waypoints
  for (const tid of selTaskIds) {
    const t = tasks.find(tt => tt.id === tid);
    if (!t || !t.steps || t.steps.length === 0) {
      updateStatus(`Task "${t?.name}" has no steps`, 'error');
      return;
    }
    for (const step of t.steps) {
      const wpCount = step.items.filter(i => i.type === 'waypoint' || i.type === 'waypoint_click').length;
      if (wpCount < 1) {
        updateStatus(`"${t.name}" / "${step.name}" needs at least 1 waypoint`, 'error');
        return;
      }
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
            error: null,
            stepResults: []
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

  // Build flat list of all round jobs to run in parallel
  const jobs = [];
  for (let ti = 0; ti < experimentResults.length; ti++) {
    const taskRes = experimentResults[ti];
    const taskData = tasks.find(tt => tt.id === taskRes.taskId);
    if (!taskData) continue;
    for (let si = 0; si < taskRes.sims.length; si++) {
      const sim = taskRes.sims[si];
      for (let ri = 0; ri < sim.rounds.length; ri++) {
        jobs.push({ taskData, sim, round: sim.rounds[ri], stepIdx: 0 });
      }
    }
  }

  // Run a single round (all its steps sequentially)
  async function runRound(job) {
    const { taskData, sim, round } = job;
    round.status = 'running';
    round.clickResults = [];
    round.stepResults = [];

    let allTrajectoryPoints = [];
    let totalDuration = 0;
    let failed = false;

    for (let stepIdx = 0; stepIdx < taskData.steps.length; stepIdx++) {
      const step = taskData.steps[stepIdx];
      const { taskConfig, clickMap } = buildStepConfig(step.items, viewportW, viewportH);

      if (taskConfig.waypoints.length < 1) {
        round.stepResults.push({
          stepId: step.id, stepName: step.name,
          trajectory: [], clickMap, duration: 0,
          violations: { violated: false, count: 0 }
        });
        continue;
      }

      try {
        const result = await runSingleSim(
          taskConfig, sim.personaCfg, round.seed + stepIdx,
          cookies, { width: viewportW, height: viewportH }, tabUrl
        );
        if (result.success && result.trajectory) {
          const traj = result.trajectory;
          const dur = result.total_duration ?? (traj.length > 0 ? traj[traj.length - 1][2] : 0);
          round.stepResults.push({
            stepId: step.id, stepName: step.name,
            trajectory: traj, clickMap, duration: dur,
            violations: checkViolations(traj, taskConfig)
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
    }

    round.trajectory = allTrajectoryPoints;
    round.duration = totalDuration;
    round.violations = {
      violated: round.stepResults.some(s => s.violations?.violated),
      count: round.stepResults.reduce((sum, s) => sum + (s.violations?.count || 0), 0)
    };
    round.status = failed ? 'error' : 'done';
  }

  // Launch all rounds in parallel, update UI periodically
  const uiInterval = setInterval(renderResults, 500);
  await Promise.all(jobs.map(job => runRound(job)));
  clearInterval(uiInterval);

  experimentRunning = false;
  btnSimulate.disabled = false;
  renderResults();
  updateStatus('Experiment complete', 'success');
});
