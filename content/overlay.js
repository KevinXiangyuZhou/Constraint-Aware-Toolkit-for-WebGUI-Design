// Overlay DOM, geometry utilities, and rendering

function createOverlay() {
  if (state.screenWidth !== window.innerWidth || state.screenHeight !== window.innerHeight) {
    state.screenWidth = window.innerWidth;
    state.screenHeight = window.innerHeight;
  }
  if (state.overlay) return;
  
  const overlay = document.createElement('div');
  overlay.id = 'cursor-simulator-overlay';
  overlay.style.pointerEvents = 'none';
  overlay.style.width = '100vw';
  overlay.style.height = '100vh';
  overlay.style.position = 'fixed';
  overlay.style.top = '0';
  overlay.style.left = '0';
  overlay.style.zIndex = '2147483647';
  document.body.appendChild(overlay);
  
  const canvas = document.createElement('canvas');
  canvas.id = 'cursor-simulator-canvas';
  canvas.width = state.screenWidth;
  canvas.height = state.screenHeight;
  canvas.style.width = '100%';
  canvas.style.height = '100%';
  canvas.style.pointerEvents = 'none';
  overlay.appendChild(canvas);
  
  const ctx = canvas.getContext('2d');
  
  state.overlay = overlay;
  state.canvas = canvas;
  state.ctx = ctx;
  
  const ghostCursor = document.createElement('div');
  ghostCursor.className = 'ghost-cursor';
  ghostCursor.style.display = 'none';
  overlay.appendChild(ghostCursor);
  state.ghostCursor = ghostCursor;
  
  window.addEventListener('resize', () => {
    state.screenWidth = window.innerWidth;
    state.screenHeight = window.innerHeight;
    if (state.canvas) {
      state.canvas.width = state.screenWidth;
      state.canvas.height = state.screenHeight;
      renderOverlay();
    }
  });
}

function removeOverlay() {
  if (state.overlay) {
    state.overlay.remove();
    state.overlay = null;
    state.canvas = null;
    state.ctx = null;
    state.ghostCursor = null;
  }
}

// Left perpendicular to segment (ax,ay)->(bx,by), normalized (90° CCW)
function leftPerp(ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const len = Math.hypot(dx, dy) || 1;
  return { x: -dy / len, y: dx / len };
}

// Build connected corridor polygon from path points and halfWidth.
function buildCorridorPolygon(pathPx, halfWidthPx) {
  const n = pathPx.length;
  if (n < 2) return [];
  const toX = (p) => (Array.isArray(p) ? p[0] : p.x);
  const toY = (p) => (Array.isArray(p) ? p[1] : p.y);
  const left = [];
  const right = [];
  for (let i = 0; i < n; i++) {
    const px = toX(pathPx[i]), py = toY(pathPx[i]);
    let nx, ny;
    if (i === 0) {
      const perp = leftPerp(px, py, toX(pathPx[1]), toY(pathPx[1]));
      nx = perp.x; ny = perp.y;
    } else if (i === n - 1) {
      const perp = leftPerp(toX(pathPx[i - 1]), toY(pathPx[i - 1]), px, py);
      nx = perp.x; ny = perp.y;
    } else {
      const perpPrev = leftPerp(toX(pathPx[i - 1]), toY(pathPx[i - 1]), px, py);
      const perpNext = leftPerp(px, py, toX(pathPx[i + 1]), toY(pathPx[i + 1]));
      let sx = perpPrev.x + perpNext.x, sy = perpPrev.y + perpNext.y;
      const slen = Math.hypot(sx, sy);
      if (slen < 1e-6) { nx = perpPrev.x; ny = perpPrev.y; }
      else { nx = sx / slen; ny = sy / slen; }
    }
    left.push(px + halfWidthPx * nx, py + halfWidthPx * ny);
    right.push(px - halfWidthPx * nx, py - halfWidthPx * ny);
  }
  const rightReversed = [];
  for (let i = right.length - 2; i >= 0; i -= 2) rightReversed.push(right[i], right[i + 1]);
  return [...left, ...rightReversed];
}

function drawCorridorPolygon(ctx, pathPx, halfWidthPx) {
  const poly = buildCorridorPolygon(pathPx, halfWidthPx);
  if (poly.length < 6) return;
  ctx.beginPath();
  ctx.moveTo(poly[0], poly[1]);
  for (let i = 2; i < poly.length; i += 2) ctx.lineTo(poly[i], poly[i + 1]);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
}

function drawCorridorSegment(ctx, x1, y1, x2, y2, halfWidthPx) {
  const perp = leftPerp(x1, y1, x2, y2);
  const ax = x1 + perp.x * halfWidthPx, ay = y1 + perp.y * halfWidthPx;
  const bx = x1 - perp.x * halfWidthPx, by = y1 - perp.y * halfWidthPx;
  const cx = x2 - perp.x * halfWidthPx, cy = y2 - perp.y * halfWidthPx;
  const dx = x2 + perp.x * halfWidthPx, dy = y2 + perp.y * halfWidthPx;
  ctx.beginPath();
  ctx.moveTo(ax, ay);
  ctx.lineTo(dx, dy);
  ctx.lineTo(cx, cy);
  ctx.lineTo(bx, by);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
}

function renderOverlay() {
  if (!state.ctx || !state.canvas) return;
  
  const ctx = state.ctx;
  ctx.clearRect(0, 0, state.canvas.width, state.canvas.height);
  
  // Draw waypoints (regular + click, with separate numbering)
  let wpNum = 0, clickNum = 0;
  state.waypoints.forEach((wp, index) => {
    const x = wp.pixelX;
    const y = wp.pixelY;
    const isClick = wp._isClick;
    const color = isClick ? '#a855f7' : '#3b82f6';

    if (isClick) clickNum++; else wpNum++;
    
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(x, y, 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'white';
    ctx.lineWidth = 2;
    ctx.stroke();

    if (isClick) {
      const toleranceRadius = Math.max(11, Number(wp.toleranceRadiusPx) || 0);
      ctx.strokeStyle = '#a855f7';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([3, 2]);
      ctx.beginPath();
      ctx.arc(x, y, toleranceRadius, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    
    ctx.fillStyle = 'white';
    ctx.font = '12px Arial';
    const label = isClick ? ('C' + clickNum) : ('' + wpNum);
    ctx.fillText(label, x + 10, y - 10);
    
    if (index > 0) {
      const prev = state.waypoints[index - 1];
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.setLineDash([5, 5]);
      ctx.beginPath();
      ctx.moveTo(prev.pixelX, prev.pixelY);
      ctx.lineTo(x, y);
      ctx.stroke();
      ctx.setLineDash([]);
    }
  });
  
  // Draw constraints
  state.constraints.forEach((constraint) => {
    const isDisabled = constraint._enabled === false;
    if (isDisabled) ctx.globalAlpha = 0.3;
    ctx.strokeStyle = constraint.constraintType === 'keep-in' ? '#3b82f6' : '#ef4444';
    ctx.fillStyle = constraint.constraintType === 'keep-in' ? 'rgba(59, 130, 246, 0.15)' : 'rgba(239, 68, 68, 0.15)';
    ctx.setLineDash([5, 5]);
    ctx.lineWidth = 2;
    if (constraint.type === 'path' && constraint.path && constraint.path.length >= 2) {
      const halfW = (constraint.width * state.screenWidth) / 2;
      const pathPx = constraint.path.map(([nx, ny]) => [nx * state.screenWidth, ny * state.screenHeight]);
      drawCorridorPolygon(ctx, pathPx, halfW);
      ctx.setLineDash([]);
      const dotColor = constraint.constraintType === 'keep-out' ? '#ef4444' : '#3b82f6';
      constraint.path.forEach(([nx, ny]) => {
        const px = nx * state.screenWidth, py = ny * state.screenHeight;
        ctx.fillStyle = dotColor;
        ctx.beginPath();
        ctx.arc(px, py, 4, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = 'white';
        ctx.lineWidth = 1;
        ctx.stroke();
      });
    } else {
      const x = constraint.x * state.screenWidth;
      const y = constraint.y * state.screenHeight;
      const width = constraint.width * state.screenWidth;
      const height = constraint.height * state.screenHeight;
      ctx.fillRect(x, y, width, height);
      ctx.strokeRect(x, y, width, height);
      ctx.setLineDash([]);
    }
    if (isDisabled) ctx.globalAlpha = 1.0;
  });
  
  // Draw path constraint preview
  if ((state.mode === 'addPathKeepIn' || state.mode === 'addPathKeepOut') && state.pathWaypoints.length > 0) {
    const pts = state.pathWaypoints;
    const halfW = (state.pathDefaultWidth * state.screenWidth) / 2;
    const isKeepOut = state.pathConstraintType === 'keep-out';
    ctx.strokeStyle = isKeepOut ? '#ef4444' : '#3b82f6';
    ctx.fillStyle = isKeepOut ? 'rgba(239, 68, 68, 0.15)' : 'rgba(59, 130, 246, 0.15)';
    ctx.setLineDash([3, 3]);
    ctx.lineWidth = 2;
    const pathPx = pts.map((p) => ({ x: p.pixelX, y: p.pixelY }));
    if (state.pathPreviewCursor) pathPx.push(state.pathPreviewCursor);
    if (pathPx.length >= 2) {
      drawCorridorPolygon(ctx, pathPx, halfW);
      for (let i = 0; i < pathPx.length - 1; i++) {
        const a = pathPx[i], b = pathPx[i + 1];
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
      }
    }
    ctx.setLineDash([]);
    pts.forEach((p) => {
      ctx.fillStyle = isKeepOut ? '#ef4444' : '#3b82f6';
      ctx.beginPath();
      ctx.arc(p.pixelX, p.pixelY, 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = 'white';
      ctx.lineWidth = 2;
      ctx.stroke();
    });
  }
  
  // Draw current rectangle constraint being drawn
  if (state.constraintStart && state.constraintCurrent) {
    const start = state.constraintStart;
    const current = state.constraintCurrent;
    const x = Math.min(start.x, current.x);
    const y = Math.min(start.y, current.y);
    const width = Math.abs(current.x - start.x);
    const height = Math.abs(current.y - start.y);
    const isKeepOut = state.mode === 'addRectKeepOut';
    ctx.strokeStyle = isKeepOut ? '#ef4444' : '#3b82f6';
    ctx.fillStyle = isKeepOut ? 'rgba(239, 68, 68, 0.1)' : 'rgba(59, 130, 246, 0.1)';
    ctx.setLineDash([5, 5]);
    ctx.lineWidth = 2;
    ctx.fillRect(x, y, width, height);
    ctx.strokeRect(x, y, width, height);
    ctx.setLineDash([]);
  }
}
