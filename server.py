"""
FastAPI Backend Server for Cursor Trajectory Simulator

Handles simulation requests from the Chrome Extension and interfaces with hcs_package.
"""

import json
import tempfile
import os
from pathlib import Path
from typing import List, Dict, Any, Optional
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

# Import hcs_package
from hcs_package import CursorSimulator

app = FastAPI(title="Cursor Trajectory Simulator API")

# Enable CORS for Chrome Extension
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # In production, restrict to chrome-extension://
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# Request/Response models
class TaskConfig(BaseModel):
    waypoints: List[List[float]]
    screen_width: int
    screen_height: int
    constraints: Optional[Dict[str, Any]] = None


class Cookie(BaseModel):
    name: str
    value: str
    domain: str
    path: str = "/"
    secure: bool = False
    httpOnly: bool = False
    sameSite: Optional[str] = None


class Viewport(BaseModel):
    width: int
    height: int


class SimulateRequest(BaseModel):
    task: TaskConfig
    cookies: Optional[List[Cookie]] = None
    viewport: Viewport
    url: Optional[str] = None


class SimulateResponse(BaseModel):
    success: bool
    trajectory: Optional[List[List[float]]] = None
    timestamps: Optional[List[float]] = None
    total_duration: Optional[float] = None
    error: Optional[str] = None


@app.get("/")
async def root():
    return {
        "message": "Cursor Trajectory Simulator API",
        "version": "1.0.0",
        "endpoints": {
            "POST /api/simulate": "Generate cursor trajectory from task configuration"
        }
    }


@app.get("/health")
async def health():
    return {"status": "healthy"}


@app.post("/api/simulate", response_model=SimulateResponse)
async def simulate(request: SimulateRequest):
    """
    Generate a cursor trajectory from task configuration.
    
    Accepts waypoints, constraints, and viewport information from the Chrome Extension,
    creates a temporary task.json file, runs the hcs_package simulator, and returns
    the trajectory with timestamps.
    """
    try:
        # Validate waypoints
        if len(request.task.waypoints) < 2:
            raise HTTPException(
                status_code=400,
                detail="At least 2 waypoints are required"
            )
        
        # Create temporary task.json file
        task_data = {
            "waypoints": request.task.waypoints,
            "screen_width": request.task.screen_width,
            "screen_height": request.task.screen_height
        }
        
        # Add constraints if provided
        if request.task.constraints:
            task_data["constraints"] = request.task.constraints
        
        # Write to temporary file
        with tempfile.NamedTemporaryFile(
            mode='w',
            suffix='.json',
            delete=False
        ) as f:
            json.dump(task_data, f, indent=2)
            temp_task_file = f.name
        
        try:
            # Initialize simulator
            simulator = CursorSimulator()
            
            # Generate trajectory
            trajectory = simulator.generate_trajectory_with_waypoints(
                task_file=temp_task_file,
                use_optimal_path=True,
                return_timestamps=False  # We'll convert delays to timestamps ourselves
            )
            
            # Convert delays to timestamps and format for frontend
            cumulative_time = 0.0
            trajectory_with_timestamps = []
            timestamps = []
            
            for x, y, delay in trajectory:
                cumulative_time += delay
                trajectory_with_timestamps.append([float(x), float(y), float(cumulative_time)])
                timestamps.append(cumulative_time)
            
            total_duration = cumulative_time
            
            # Format trajectory as list of [x, y, timestamp] for frontend
            # Frontend can use timestamps directly or convert back to delays if needed
            trajectory_formatted = [
                [float(x), float(y), float(timestamp)]
                for x, y, timestamp in trajectory_with_timestamps
            ]
            
            return SimulateResponse(
                success=True,
                trajectory=trajectory_formatted,
                timestamps=timestamps,
                total_duration=total_duration
            )
            
        finally:
            # Clean up temporary file
            if os.path.exists(temp_task_file):
                os.unlink(temp_task_file)
                
    except FileNotFoundError as e:
        raise HTTPException(status_code=500, detail=f"Simulator error: {str(e)}")
    except ValueError as e:
        raise HTTPException(status_code=400, detail=f"Invalid input: {str(e)}")
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Internal server error: {str(e)}"
        )


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
