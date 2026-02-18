// Ghost cursor, trajectory playback, and click execution

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

function dispatchCursorEvents(x, y) {
  const currElement = document.elementFromPoint(x, y);
  const prevElement = state.replayPrevElement;

  const baseInit = { view: window, bubbles: true, cancelable: true, clientX: x, clientY: y };
  const noBubbleInit = { view: window, bubbles: false, cancelable: true, clientX: x, clientY: y };

  if (currElement !== prevElement) {
    if (prevElement && prevElement.isConnected) {
      prevElement.dispatchEvent(new PointerEvent('pointerout', baseInit));
      prevElement.dispatchEvent(new PointerEvent('pointerleave', noBubbleInit));
      prevElement.dispatchEvent(new MouseEvent('mouseout', baseInit));
      prevElement.dispatchEvent(new MouseEvent('mouseleave', noBubbleInit));
    }
    if (currElement) {
      currElement.dispatchEvent(new PointerEvent('pointerover', baseInit));
      currElement.dispatchEvent(new PointerEvent('pointerenter', noBubbleInit));
      currElement.dispatchEvent(new MouseEvent('mouseover', baseInit));
      currElement.dispatchEvent(new MouseEvent('mouseenter', noBubbleInit));
    }
    state.replayPrevElement = currElement;
  }

  if (currElement) {
    currElement.dispatchEvent(new PointerEvent('pointermove', baseInit));
    currElement.dispatchEvent(new MouseEvent('mousemove', baseInit));
  }

  if (state.useDebugger) {
    try {
      chrome.runtime.sendMessage({ type: 'debuggerMouseMove', x, y });
    } catch (_) {}
  }
}

function startReplay() {
  if (state.trajectory.length === 0) return;
  
  state.isReplaying = true;
  state.currentTrajectoryIndex = 0;
  state.replayStartTime = Date.now();
  state.replayPrevElement = null;
  
  const totalDuration = state.trajectory[state.trajectory.length - 1][2];
  
  function animate() {
    if (!state.isReplaying) return;
    
    const elapsed = (Date.now() - state.replayStartTime) / 1000;
    
    if (elapsed >= totalDuration) {
      const last = state.trajectory[state.trajectory.length - 1];
      showGhostCursor(last[0], last[1]);
      dispatchCursorEvents(last[0], last[1]);
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
    dispatchCursorEvents(x, y);
    
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
  if (state.replayPrevElement && state.replayPrevElement.isConnected) {
    const init = { view: window, bubbles: false, cancelable: true, clientX: 0, clientY: 0 };
    const initBubble = { view: window, bubbles: true, cancelable: true, clientX: 0, clientY: 0 };
    state.replayPrevElement.dispatchEvent(new PointerEvent('pointerout', initBubble));
    state.replayPrevElement.dispatchEvent(new PointerEvent('pointerleave', init));
    state.replayPrevElement.dispatchEvent(new MouseEvent('mouseout', initBubble));
    state.replayPrevElement.dispatchEvent(new MouseEvent('mouseleave', init));
  }
  state.replayPrevElement = null;
  hideGhostCursor();
  if (state.useDebugger) {
    try { chrome.runtime.sendMessage({ type: 'debuggerDetach' }); } catch (_) {}
  }
  try { chrome.runtime.sendMessage({ type: 'replayStopped' }); } catch (_) {}
}

function seekToTime(time) {
  if (state.trajectory.length === 0) return;
  
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
    dispatchCursorEvents(x, y);
  }
}

function executeClick(ct) {
  let el = null;
  let method = 'none';
  if (ct.selector) {
    try { el = document.querySelector(ct.selector); method = 'selector'; } catch (_) {}
  }
  if (!el && ct.xpath) {
    try {
      const xr = document.evaluate(ct.xpath, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
      el = xr.singleNodeValue;
      if (el) method = 'xpath';
    } catch (_) {}
  }
  if (!el) {
    el = document.elementFromPoint(ct.x, ct.y);
    if (el) method = 'elementFromPoint';
  }
  if (!el) {
    return { success: false, failureReason: 'element_not_found', method };
  }
  const opts = { view: window, bubbles: true, cancelable: true, clientX: ct.x, clientY: ct.y };
  try {
    el.dispatchEvent(new PointerEvent('pointerdown', opts));
    el.dispatchEvent(new MouseEvent('mousedown', opts));
    el.dispatchEvent(new PointerEvent('pointerup', opts));
    el.dispatchEvent(new MouseEvent('mouseup', opts));
    el.dispatchEvent(new MouseEvent('click', opts));
    return { success: true, method, tagName: el.tagName, href: el.href || null };
  } catch (err) {
    return { success: false, failureReason: 'click_intercepted', error: err.message, method };
  }
}
