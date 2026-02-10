# Quick Start Guide

## 1. Start the Backend Server

```bash
source hcs-env/bin/activate
python server.py
```

Server runs on `http://localhost:8000`

## 2. Load Chrome Extension

1. Open `chrome://extensions/`
2. Enable "Developer mode"
3. Click "Load unpacked"
4. Select this directory

## 3. Use the Extension

1. Click extension icon → Open side panel
2. Navigate to a website
3. Press `W` → Click to add waypoints
4. Press `C` → Drag to add constraints
5. Click "Run Simulation"
6. Use replay controls to watch ghost cursor

## Keyboard Shortcuts

- `W` - Waypoint mode
- `C` - Constraint mode  
- `Escape` - Passthrough mode

## Troubleshooting

**Server not starting?**
- Check: `source hcs-env/bin/activate && pip list | grep fastapi`
- Install: `pip install -r requirements.txt`

**Extension not loading?**
- Check Chrome console: `chrome://extensions/` → Errors
- Verify all files exist: `manifest.json`, `content.js`, `sidepanel.html`, etc.

**Simulation fails?**
- Need at least 2 waypoints
- Check browser console (F12) for errors
- Check server terminal for backend errors
