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
3. **Design Mode**:
   - Click "Add Waypoints (W)" or press `W` key
   - Click on the page to add waypoints (blue dots)
   - Click "Add Constraints (C)" or press `C` key
   - Click and drag to draw constraint zones (green boxes)
4. **Run Simulation**: Click "Run Simulation" button
   - The extension sends the task configuration to the backend
   - Backend generates trajectory using `hcs_package`
   - Trajectory is returned and displayed
5. **Replay**: Use the replay controls to watch the ghost cursor (red dot) move along the trajectory
   - Drag the timeline scrubber to seek to specific times
   - The ghost cursor will trigger hover events on the webpage

## Keyboard Shortcuts

- `W` - Switch to Waypoint mode
- `C` - Switch to Constraint mode
- `Escape` - Switch to Passthrough mode (normal interaction)

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
- After clicking "Add Waypoints" or "Add Constraints", **click on the webpage itself** (not the side panel). A black bar at the top of the page will say "Click to add waypoints" or "Drag to draw constraint zone".
- You can press **W** or **C** from the side panel (with focus in the panel) to switch mode; then click on the webpage to draw.

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
