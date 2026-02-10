# Chrome Extension-based Usability Simulator - Setup Guide

This guide will help you set up and run the Chrome Extension-based Usability Simulator.

## Architecture Overview

- **Frontend**: Chrome Extension with content script overlay and side panel
- **Backend**: FastAPI server running on `localhost:8000`
- **Simulator**: `hcs_package` for generating human-like cursor trajectories

## Prerequisites

1. Python 3.8+ with virtual environment `hcs-env` (already set up)
2. Chrome browser
3. Node.js (optional, for development)

## Setup Steps

### 1. Install Backend Dependencies

Activate the virtual environment and install FastAPI dependencies:

```bash
source hcs-env/bin/activate
pip install -r requirements.txt
```

### 2. Start the Backend Server

```bash
source hcs-env/bin/activate
python server.py
```

The server will start on `http://localhost:8000`

You can test it by visiting:
- `http://localhost:8000/` - API info
- `http://localhost:8000/health` - Health check

### 3. Load the Chrome Extension

1. Open Chrome and navigate to `chrome://extensions/`
2. Enable "Developer mode" (toggle in top right)
3. Click "Load unpacked"
4. Select the project root directory (`Constraint-Aware-Toolkit-for-WebGUI-Design`)
5. The extension should appear in your extensions list

### 4. Use the Extension

1. **Open Side Panel**: Click the extension icon in the toolbar, or right-click the icon and select "Open side panel"
2. **Navigate to a website**: Go to any website you want to test (e.g., a site with cascading menus)
3. **Design Mode** (hold key to enter mode; release to exit):
   - **Q** – Add waypoint: click on the page to add waypoints (blue dots)
   - **W** – Move waypoint: drag a waypoint to move it
   - **S** – Rectangle keep-in: drag to draw a green constraint zone
   - **D** – Rectangle keep-out: drag to draw a red constraint zone
   - **F** – Path keep-in: click to add path points; release F to finalize green corridor
   - **G** – Path keep-out: click to add path points; release G to finalize red corridor
   - **A** – Resize: drag the edge of a constraint area to resize
   - **Esc** – Passthrough (quit design mode)
   - **⌘Z** / **⌘⇧Z** – Undo / Redo last waypoint or constraint
4. **Run Simulation**: Click "Run Simulation" button
   - The extension sends the task configuration to the backend
   - Backend generates trajectory using `hcs_package`
   - Trajectory is returned and displayed
5. **Replay**: Use the replay controls to watch the ghost cursor (red dot) move along the trajectory
   - Drag the timeline scrubber to seek to specific times
   - The ghost cursor will trigger hover events on the webpage

## Keyboard Shortcuts

- **Q** – Add waypoint (hold, then click to add; release to exit)
- **W** – Move waypoint (hold, then drag a waypoint; release to exit)
- **S** – Rectangle keep-in (hold, drag to draw; release to exit)
- **D** – Rectangle keep-out (hold, drag to draw; release to exit)
- **F** – Path keep-in (hold, click to add path points; release to finalize)
- **G** – Path keep-out (hold, click to add path points; release to finalize)
- **A** – Resize constraint (hold, drag edge of constraint; release to exit)
- **Escape** – Passthrough mode (normal interaction)
- **⌘Z** / **⌘⇧Z** – Undo / Redo last waypoint or constraint

## File Structure

```
.
├── manifest.json          # Chrome extension manifest
├── content.js            # Content script (overlay, modes, replay)
├── content.css           # Styles for overlay elements
├── sidepanel.html        # Side panel UI
├── sidepanel.js          # Side panel controller
├── background.js         # Background service worker
├── server.py             # FastAPI backend server
├── requirements.txt      # Python backend dependencies
├── hcs_package/         # Cursor simulator package
└── hcs-env/             # Python virtual environment
```

## API Endpoints

### POST `/api/simulate`

Generates a cursor trajectory from task configuration.

**Request Body:**
```json
{
  "task": {
    "waypoints": [[100, 200], [300, 250], [500, 300]],
    "screen_width": 1920,
    "screen_height": 1080,
    "constraints": {
      "coordinate_system": "normalized",
      "default_margin": 0.005,
      "regions": [...]
    }
  },
  "cookies": [...],
  "viewport": {
    "width": 1920,
    "height": 1080
  },
  "url": "https://example.com"
}
```

**Response:**
```json
{
  "success": true,
  "trajectory": [[x, y, timestamp], ...],
  "timestamps": [...],
  "total_duration": 2.5
}
```

## Troubleshooting

### "Refresh this page" or waypoints/constraints not drawing
- **You must refresh the webpage tab (F5 or Cmd+R) after installing or reloading the extension.** Content scripts only run in tabs that were loaded after the extension was active.
- After choosing a tool (e.g. "Waypoint" or "Rect keep in"), **click on the webpage itself** (not the side panel). A hint at the top of the page shows the current action.
- You can press **Q**, **W**, **S**, **D**, **F**, **G**, or **A** (with focus on the page or side panel) to enter that mode; hold the key while drawing, then release to exit.

### Backend not responding
- Check that the server is running: `curl http://localhost:8000/health`
- Check that `hcs-env` is activated and dependencies are installed
- Check server logs for errors

### Extension not loading
- Make sure all files are in the project root
- Check Chrome's extension error page: `chrome://extensions/` → click "Errors" button
- Verify `manifest.json` is valid JSON

### Trajectory not generating
- Ensure at least 2 waypoints are added
- Check browser console (F12) for errors
- Check backend server logs
- Verify `hcs_package` is installed in the virtual environment

### Ghost cursor not appearing
- Make sure trajectory was generated successfully
- Check that replay mode is active
- Verify overlay canvas is created (check DOM)

## Development Notes

- The extension uses Chrome Extension Manifest V3
- Content script runs on all pages (`<all_urls>`)
- Side panel provides the control interface
- Backend uses temporary files for task.json (cleaned up automatically)
- Trajectory format: `[x, y, timestamp]` where timestamp is cumulative in seconds

## Next Steps (Optional Enhancements)

- Add Playwright headless browser verification
- Add trajectory export/import
- Add constraint snapping to DOM elements
- Add waypoint editing/deletion
- Add multiple trajectory comparison
- Add performance metrics
