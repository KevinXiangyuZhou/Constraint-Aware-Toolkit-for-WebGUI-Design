// Experiment engine — config building, simulation, experiment runner
// ====== Experiment Engine ======

var expTasksChecks = document.getElementById('exp-tasks-checks');
var expPersonasChecks = document.getElementById('exp-personas-checks');
var expRunsInput = document.getElementById('exp-runs');
var resultsSection = document.getElementById('results-section');
var resultsTree = document.getElementById('results-tree');

// Experiment results state
var experimentResults = []; // array of { taskId, taskName, sims: [{ personaId, personaName, personaCfg, rounds: [{ seed, status, trajectory, duration, error }], expanded }], expanded }
var playingRoundRef = null; // { taskIdx, simIdx, roundIdx } or null
var experimentRunning = false;

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

  // If the last waypoint is a click, pass its tolerance radius so the simulator
  // uses the same end-target radius as replay (50px default)
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
