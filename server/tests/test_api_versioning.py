"""Tests for API versioning (API-01): all endpoints under /api/v1/."""
import pytest
from fastapi.testclient import TestClient
from server.main import app

client = TestClient(app)


def test_v1_volumes_list():
    """GET /api/v1/volumes returns 200."""
    r = client.get("/api/v1/volumes")
    assert r.status_code == 200
    assert isinstance(r.json(), list)


def test_old_volumes_list_404():
    """GET /api/volumes (no v1) returns 404."""
    r = client.get("/api/volumes")
    assert r.status_code in (404, 405)


def test_v1_volume_metadata_404_missing():
    """GET /api/v1/volumes/999/metadata returns 404 for nonexistent volume."""
    r = client.get("/api/v1/volumes/999/metadata")
    assert r.status_code == 404


def test_old_volume_metadata_404():
    """GET /api/volumes/0/metadata (no v1) returns 404."""
    r = client.get("/api/volumes/0/metadata")
    assert r.status_code in (404, 405)


def test_v1_labels_get():
    """GET /api/v1/volumes/0/labels returns 200 (empty list for unknown volume)."""
    r = client.get("/api/v1/volumes/0/labels")
    assert r.status_code == 200


def test_old_labels_get_404():
    """GET /api/volumes/0/labels (no v1) returns 404."""
    r = client.get("/api/volumes/0/labels")
    assert r.status_code in (404, 405)


def test_v1_debug_paths_404_missing():
    """GET /api/v1/debug/volumes/999/paths returns 404 for nonexistent volume."""
    r = client.get("/api/v1/debug/volumes/999/paths")
    assert r.status_code == 404
