"""Tests for WebSocket ConnectionManager and endpoint."""

from __future__ import annotations

import pytest
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.testclient import TestClient

from server.api.ws import ConnectionManager, manager, ws_router


def _make_app() -> FastAPI:
    app = FastAPI()
    app.include_router(ws_router)
    return app


def test_ws_connect():
    """WebSocket client can connect to /api/v1/ws and stay connected."""
    app = _make_app()
    client = TestClient(app)
    with client.websocket_connect("/api/v1/ws") as ws:
        assert ws is not None


def test_volume_added_broadcast():
    """Connected WebSocket clients receive volume_added broadcast."""
    app = FastAPI()
    test_manager = ConnectionManager()

    @app.websocket("/test/ws")
    async def test_ws_endpoint(websocket: WebSocket):
        await test_manager.connect(websocket)
        try:
            msg = {"type": "volume_added", "data": {"id": "test1", "name": "Test Volume"}}
            await test_manager.broadcast(msg)
            # Keep alive so client can read
            while True:
                await websocket.receive_text()
        except WebSocketDisconnect:
            test_manager.disconnect(websocket)

    client = TestClient(app)
    with client.websocket_connect("/test/ws") as ws:
        received = ws.receive_json()

    assert received["type"] == "volume_added"
    assert received["data"]["id"] == "test1"


def test_volume_removed_broadcast():
    """Connected WebSocket clients receive volume_removed broadcast."""
    app = FastAPI()
    test_manager = ConnectionManager()

    @app.websocket("/test/ws2")
    async def test_ws_endpoint2(websocket: WebSocket):
        await test_manager.connect(websocket)
        try:
            msg = {"type": "volume_removed", "data": {"id": "vol42"}}
            await test_manager.broadcast(msg)
            while True:
                await websocket.receive_text()
        except WebSocketDisconnect:
            test_manager.disconnect(websocket)

    client = TestClient(app)
    with client.websocket_connect("/test/ws2") as ws:
        received = ws.receive_json()

    assert received["type"] == "volume_removed"
    assert received["data"]["id"] == "vol42"


def test_connection_manager_disconnect():
    """ConnectionManager properly removes disconnected clients."""
    mgr = ConnectionManager()
    assert len(mgr.active_connections) == 0
