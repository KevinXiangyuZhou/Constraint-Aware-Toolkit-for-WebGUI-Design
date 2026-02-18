// Playback management and results rendering

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

var playbackAborted = false;

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
