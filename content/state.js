// Cursor Trajectory Simulator - Content Script
// State, constants, and utility functions

console.log("Cursor Simulator: Content script loaded");

// Hit-test radius for waypoints and constraint handles (pixels)
var WAYPOINT_HIT_RADIUS = 14;
var CONSTRAINT_EDGE_MARGIN = 12;

// State management
var state = {
  mode: 'passthrough', // 'passthrough', 'addWaypoint', 'moveWaypoint', 'addRectKeepIn', 'addRectKeepOut', 'addPathKeepIn', 'addPathKeepOut', 'resizeConstraint', 'replay'
  waypoints: [],
  constraints: [],
  trajectory: [],
  currentTrajectoryIndex: 0,
  isReplaying: false,
  replayStartTime: null,
  overlay: null,
  canvas: null,
  ctx: null,
  ghostCursor: null,
  constraintStart: null,
  constraintCurrent: null,
  screenWidth: window.innerWidth,
  screenHeight: window.innerHeight,
  // Move waypoint
  draggingWaypointIndex: null,
  // Resize constraint: index, handle, and at mousedown: { mx, my, x, y, w, h } (pixels)
  resizingConstraintIndex: null,
  resizingHandle: null,
  resizeStart: null,
  // Ordered items (waypoints + constraints in creation order)
  items: [],
  nextItemId: 1,
  // Undo/redo
  undoStack: [],
  redoStack: [],
  // Cursor position (capture element before overlay when entering design mode)
  lastMouseX: 0,
  lastMouseY: 0,
  // Path constraint (F/G): waypoints for current path, preview cursor, default width (normalized), type for next path
  pathWaypoints: [],
  pathPreviewCursor: null,
  pathDefaultWidth: 0.02,
  pathConstraintType: 'keep-in',
  // Replay: track previous element for enter/leave event pairs
  replayPrevElement: null,
  // Replay: use chrome.debugger API for CSS :hover (causes "started debugging" banner)
  useDebugger: false
};

// Generate unique item IDs
function generateItemId() {
  return 'item-' + (state.nextItemId++);
}

// URL helpers for cross-page filtering
function currentPageUrl() {
  return window.location.href.split('#')[0];
}
function pageUrlMatches(itemPageUrl) {
  if (!itemPageUrl) return true;
  return itemPageUrl.split('#')[0] === currentPageUrl();
}

// Rebuild waypoints/constraints arrays from items list
function syncStateFromItems() {
  state.waypoints = [];
  state.constraints = [];
  for (const item of state.items) {
    if (item.type === 'waypoint' || item.type === 'waypoint_click') {
      if (!pageUrlMatches(item.data.pageUrl)) continue;
      item.data.pixelX = item.data.x * state.screenWidth;
      item.data.pixelY = item.data.y * state.screenHeight;
      item.data._isClick = item.type === 'waypoint_click';
      state.waypoints.push(item.data);
    } else if (item.type === 'constraint') {
      if (!pageUrlMatches(item.data.pageUrl)) continue;
      item.data._enabled = item.enabled !== false;
      state.constraints.push(item.data);
    }
  }
}

// Notify side panel about items change
function notifyItemsChanged() {
  try {
    const cleanItems = state.items.map(i => {
      const copy = { id: i.id, type: i.type, enabled: i.enabled, data: { ...i.data } };
      delete copy.data._enabled;
      return copy;
    });
    chrome.runtime.sendMessage({
      type: 'itemsChanged',
      items: cleanItems,
      waypointCount: state.waypoints.length,
      constraintCount: state.constraints.filter(c => c._enabled !== false).length
    });
  } catch (_) {}
}
