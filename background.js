// Background Service Worker for Cursor Simulator Extension

// Open side panel when extension icon is clicked
chrome.action.onClicked.addListener((tab) => {
  chrome.sidePanel.open({ windowId: tab.windowId });
});

// Set side panel as default
chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setOptions({
    path: 'sidepanel.html',
    enabled: true
  });
});

// ── chrome.debugger API for CSS :hover during replay ────────────────────
// Tracks which tabs have the debugger attached.
const debuggerAttached = new Set();

// Clean up when debugger is detached externally (user closes DevTools bar, etc.)
chrome.debugger.onDetach.addListener((source) => {
  if (source.tabId) debuggerAttached.delete(source.tabId);
});

async function ensureDebuggerAttached(tabId) {
  if (debuggerAttached.has(tabId)) return;
  await chrome.debugger.attach({ tabId }, '1.3');
  debuggerAttached.add(tabId);
}

async function detachDebugger(tabId) {
  if (!debuggerAttached.has(tabId)) return;
  try {
    await chrome.debugger.detach({ tabId });
  } catch (_) {}
  debuggerAttached.delete(tabId);
}

// Listen for messages from content script / side panel
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'debuggerMouseMove') {
    const tabId = sender.tab?.id;
    if (!tabId) { sendResponse({ success: false }); return true; }
    (async () => {
      try {
        await ensureDebuggerAttached(tabId);
        await chrome.debugger.sendCommand({ tabId }, 'Input.dispatchMouseEvent', {
          type: 'mouseMoved',
          x: message.x,
          y: message.y
        });
        sendResponse({ success: true });
      } catch (err) {
        console.error('debuggerMouseMove error', err);
        sendResponse({ success: false, error: err.message });
      }
    })();
    return true; // keep channel open for async response
  }

  if (message.type === 'debuggerDetach') {
    const tabId = sender.tab?.id;
    if (tabId) {
      detachDebugger(tabId).then(() => sendResponse({ success: true }));
    } else {
      sendResponse({ success: false });
    }
    return true;
  }
});
