"""WebSocket endpoint and ConnectionManager for real-time event broadcast."""

from __future__ import annotations

import json

from fastapi import APIRouter, WebSocket, WebSocketDisconnect


class ConnectionManager:
    """Manages active WebSocket connections and broadcasts events."""

    def __init__(self):
        self.active_connections: list[WebSocket] = []

    async def connect(self, websocket: WebSocket) -> None:
        """Accept a WebSocket connection and track it."""
        await websocket.accept()
        self.active_connections.append(websocket)

    def disconnect(self, websocket: WebSocket) -> None:
        """Remove a WebSocket connection from tracking."""
        if websocket in self.active_connections:
            self.active_connections.remove(websocket)

    async def broadcast(self, message: dict) -> None:
        """Send a JSON message to all connected clients.

        Silently removes connections that have gone stale.
        """
        payload = json.dumps(message)
        dead: list[WebSocket] = []
        for conn in self.active_connections:
            try:
                await conn.send_text(payload)
            except Exception:
                dead.append(conn)
        for conn in dead:
            self.active_connections.remove(conn)


# Module-level singleton
manager = ConnectionManager()

ws_router = APIRouter()


@ws_router.websocket("/api/v1/ws")
async def websocket_endpoint(websocket: WebSocket):
    """WebSocket endpoint for real-time volume catalog events."""
    await manager.connect(websocket)
    try:
        while True:
            # Keep connection alive; we don't process incoming messages
            await websocket.receive_text()
    except WebSocketDisconnect:
        manager.disconnect(websocket)
