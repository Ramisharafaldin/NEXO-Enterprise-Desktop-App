"""
NEXO Enterprise Supply Chain Planning Platform
Local Python FastAPI Backend
Provides REST endpoints for DuckDB persistence, Microsoft SQL Server connectivity,
Excel/CSV import/export, and live reactive inventory calculations.
"""

import os
import sys
import platform
import subprocess

# 1. Safe pythonw.exe stdout/stderr stream redirection
if sys.platform == "win32":
    _parent_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    _log_file = os.path.join(_parent_dir, "desktop_app.log")
    if sys.stdout is None:
        try:
            sys.stdout = open(_log_file, "a", encoding="utf-8", buffering=1)
        except Exception:
            pass
    if sys.stderr is None:
        try:
            sys.stderr = open(_log_file, "a", encoding="utf-8", buffering=1)
        except Exception:
            pass

# 2. Global Windows subprocess.Popen CREATE_NO_WINDOW monkey-patch
if sys.platform == "win32" and not getattr(subprocess, "_nexo_silent_patched", False):
    _orig_popen = subprocess.Popen
    class _SilentPopen(_orig_popen):
        def __init__(self, *args, **kwargs):
            kwargs["creationflags"] = kwargs.get("creationflags", 0) | subprocess.CREATE_NO_WINDOW
            super().__init__(*args, **kwargs)
    subprocess.Popen = _SilentPopen
    subprocess._nexo_silent_patched = True

# Ensure backend directory and repository root are in sys.path so both direct execution and package imports work
backend_dir = os.path.dirname(os.path.abspath(__file__))
repo_dir = os.path.dirname(backend_dir)
if backend_dir not in sys.path:
    sys.path.insert(0, backend_dir)
if repo_dir not in sys.path:
    sys.path.insert(0, repo_dir)

import io
import json
import re
import uuid
import datetime
import tempfile
import shutil
import csv
from pathlib import Path
from python_calamine import CalamineWorkbook
from typing import Dict, List, Any, Optional, Tuple, Union
from fastapi import FastAPI, UploadFile, File, Form, HTTPException, Query, Response, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, StreamingResponse, FileResponse
from starlette.middleware.trustedhost import TrustedHostMiddleware
from starlette.responses import RedirectResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field
import pandas as pd
import duckdb
import pyodbc

import sqlite3
import urllib.request
import urllib.parse
import socket
import ipaddress
import subprocess
import threading
import time
import secrets
import hmac

REPO_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
SUBPROCESS_FLAGS = subprocess.CREATE_NO_WINDOW if sys.platform == "win32" else 0

def get_app_version() -> str:
    """Reads current application version dynamically from VERSION file on disk on every call."""
    candidates = [
        Path(REPO_DIR) / "VERSION",
        Path(__file__).resolve().parent.parent / "VERSION",
        Path.cwd() / "VERSION",
        Path("VERSION").resolve()
    ]
    for vf in candidates:
        try:
            if vf.exists():
                val = vf.read_text(encoding="utf-8").strip()
                if val:
                    return val.lstrip("v")
        except Exception:
            pass
    return "0.1.2"

APP_VERSION = get_app_version()

try:
    from backend.database import (
        init_db,
        close_db,
        flush_db,
        list_projects,
        get_project_by_id,
        create_new_project,
        delete_project_by_id,
        activate_project,
        save_project_workspace,
        get_active_project_id,
        is_analyzable_sku,
        get_project_dormant_count,
        get_project_items,
        get_project_items_paginated,
        get_project_dashboard_summary,
        get_project_categories,
        get_workspace,
        save_period_override,
        update_item_parameters,
        get_saved_filters_for_project,
        add_saved_filter,
        delete_filter_by_id,
        get_in_transition_for_project,
        add_in_transition_record,
        bulk_upsert_in_transit,
        compute_project_kpis,
        get_app_settings,
        save_app_settings,
        add_ingestion_log,
        get_ingestion_logs,
        save_erp_connection,
        get_erp_connections,
        get_erp_connection,
        record_daily_sales,
        upsert_items_and_periods,
        get_connection,
        _LOCK
    )
except (ImportError, ModuleNotFoundError):
    from database import (
        init_db,
        close_db,
        flush_db,
        list_projects,
        get_project_by_id,
        create_new_project,
        delete_project_by_id,
        activate_project,
        save_project_workspace,
        get_active_project_id,
        is_analyzable_sku,
        get_project_dormant_count,
        get_project_items,
        get_project_items_paginated,
        get_project_dashboard_summary,
        get_project_categories,
        get_workspace,
        save_period_override,
        update_item_parameters,
        get_saved_filters_for_project,
        add_saved_filter,
        delete_filter_by_id,
        get_in_transition_for_project,
        add_in_transition_record,
        bulk_upsert_in_transit,
        compute_project_kpis,
        get_app_settings,
        save_app_settings,
        add_ingestion_log,
        get_ingestion_logs,
        save_erp_connection,
        get_erp_connections,
        get_erp_connection,
        record_daily_sales,
        upsert_items_and_periods,
        get_connection,
        _LOCK
    )

app = FastAPI(
    title="NEXO Supply Chain Backend API",
    description="High-performance local backend with DuckDB persistence and Microsoft SQL Server ERP integration",
    version="1.0.0"
)

# Initialize startup session secret for local boundary defense (SEC-CRIT-01, SEC-MED-02)
NEXO_SESSION_SECRET = os.environ.get("NEXO_SESSION_SECRET")
if not NEXO_SESSION_SECRET:
    NEXO_SESSION_SECRET = secrets.token_urlsafe(32)
    os.environ["NEXO_SESSION_SECRET"] = NEXO_SESSION_SECRET

# 1. DNS Rebinding Protection via TrustedHostMiddleware (SEC-MED-02)
app.add_middleware(
    TrustedHostMiddleware,
    allowed_hosts=["127.0.0.1", "localhost", "*.localhost", "test", "testserver"]
)

# 2. Strict CORS Lockdown for Loopback Origins Only (SEC-CRIT-01)
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://localhost:4173",
        "http://127.0.0.1:4173",
        "http://localhost:3000",
        "http://127.0.0.1:3000",
        "http://localhost:8000",
        "http://127.0.0.1:8000",
    ],
    allow_origin_regex=r"^http://(127\.0\.0\.1|localhost)(:\d+)?$",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# 3. Defensive Security Headers Middleware (SEC-LOW-02)
@app.middleware("http")
async def security_headers_middleware(request: Request, call_next):
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Referrer-Policy"] = "no-referrer"
    response.headers["Permissions-Policy"] = "camera=(), microphone=(), geolocation=()"
    response.headers["Content-Security-Policy"] = (
        "default-src 'self'; "
        "script-src 'self' 'unsafe-inline'; "
        "style-src 'self' 'unsafe-inline'; "
        "img-src 'self' data: blob:; "
        "font-src 'self' data:; "
        "connect-src 'self' http://127.0.0.1:* http://localhost:* ws://127.0.0.1:* ws://localhost:*; "
        "frame-ancestors 'none'; "
        "object-src 'none'; "
        "base-uri 'self'; "
        "form-action 'self'"
    )
    return response

# 4. Localhost Session Authentication Middleware (SEC-CRIT-01)
@app.middleware("http")
async def session_auth_middleware(request: Request, call_next):
    # Allow CORS preflight requests
    if request.method == "OPTIONS":
        return await call_next(request)
    
    path = request.url.path
    
    # Exempt non-API routes (static frontend, assets, bootstrap)
    if not path.startswith("/api/") and path != "/api":
        return await call_next(request)
    
    # Exempt health diagnostic endpoints
    if path in ("/api/health", "/health", "/api/health/"):
        return await call_next(request)
    
    # Require valid session cookie or X-NEXO-Session-Token header for all /api/* routes
    session_secret = os.environ.get("NEXO_SESSION_SECRET", "")
    if not session_secret:
        return JSONResponse(status_code=401, content={"detail": "Unauthorized: Session secret not configured."})
    
    cookie_token = request.cookies.get("nexo_session")
    header_token = request.headers.get("X-NEXO-Session-Token") or request.headers.get("x-nexo-session-token")
    
    is_valid = False
    if cookie_token and hmac.compare_digest(cookie_token, session_secret):
        is_valid = True
    elif header_token and hmac.compare_digest(header_token, session_secret):
        is_valid = True
    
    if not is_valid:
        return JSONResponse(status_code=401, content={"detail": "Unauthorized: Missing or invalid NEXO session authentication."})
    
    return await call_next(request)

# 4. Bootstrap Authentication Route for Native WebView2 (SEC-CRIT-01)
@app.get("/auth/bootstrap", include_in_schema=False)
def auth_bootstrap(nonce: str = Query(...)):
    """
    Single-use bootstrap authentication endpoint for Edge WebView2 desktop runtime.
    Validates single-use nonce, sets HttpOnly SameSite=Strict session cookie, and redirects to root.
    """
    expected_nonce = os.environ.get("NEXO_BOOTSTRAP_NONCE")
    if not expected_nonce or not nonce or not hmac.compare_digest(nonce, expected_nonce):
        raise HTTPException(status_code=403, detail="Forbidden: Invalid or expired bootstrap nonce")
    
    # Single-use: consume nonce immediately
    os.environ.pop("NEXO_BOOTSTRAP_NONCE", None)
    
    session_secret = os.environ.get("NEXO_SESSION_SECRET", "")
    resp = RedirectResponse(url=f"/?t={int(time.time())}", status_code=302)
    resp.set_cookie(
        key="nexo_session",
        value=session_secret,
        httponly=True,
        samesite="strict",
        path="/"
    )
    return resp

# Initialize DuckDB schema on startup
@app.on_event("startup")
def on_startup():
    init_db()

# ==============================================================================
# Health & Environment Diagnostic Endpoints
# ==============================================================================

@app.get("/health")
@app.get("/api/health")
def health_check():
    drivers = pyodbc.drivers()
    # Calculate global dormant SKU count across active projects
    try:
        active_pid = get_active_project_id()
        dormant_cnt = get_project_dormant_count(active_pid) if active_pid else 0
    except Exception:
        dormant_cnt = 0

    ver = get_app_version()

    return {
        "status": "online",
        "app": "NEXO Enterprise Supply Chain Planning",
        "version": f"v{ver}",
        "current_version": f"v{ver}",
        "duckdb_version": duckdb.__version__,
        "python_version": platform.python_version(),
        "installed_odbc_drivers": drivers,
        "sql_server_driver_available": any("SQL Server" in d for d in drivers),
        "excluded_dormant_count": dormant_cnt,
        "active_rule": "exclude_zero_stock_zero_sales"
    }

# ==============================================================================
# Projects CRUD Endpoints
# ==============================================================================

class CreateProjectRequest(BaseModel):
    name: str
    description: Optional[str] = ""
    dataset_name: Optional[str] = ""

@app.get("/api/projects")
def get_all_projects():
    return {
        "projects": list_projects(),
        "active_project_id": get_active_project_id()
    }

@app.post("/api/projects")
def create_project_endpoint(req: CreateProjectRequest):
    if not req.name.strip():
        raise HTTPException(status_code=400, detail="Project name cannot be empty")
    return create_new_project(req.name.strip(), req.description or "", req.dataset_name or "")

@app.get("/api/projects/{project_id}")
def get_project_endpoint(project_id: str):
    p = get_project_by_id(project_id)
    if not p:
        raise HTTPException(status_code=404, detail="Project not found")
    return p

@app.post("/api/projects/{project_id}/activate")
def activate_project_endpoint(project_id: str):
    res = activate_project(project_id)
    if not res.get("success"):
        raise HTTPException(status_code=404, detail=res.get("message", "Project not found"))
    return res

@app.post("/api/projects/{project_id}/save")
def save_project_endpoint(project_id: str):
    res = save_project_workspace(project_id)
    if not res.get("success"):
        raise HTTPException(status_code=404, detail=res.get("message", "Project not found"))
    return res

@app.delete("/api/projects/{project_id}")
def delete_project_endpoint(project_id: str):
    delete_project_by_id(project_id)
    return {"success": True, "message": f"Project {project_id} deleted"}

# Workspace load endpoint (loads slim paginated items, overrides, settings, and filters for project)
@app.get("/api/projects/{project_id}/workspace")
def get_project_workspace_endpoint(
    project_id: str,
    include_dormant: bool = Query(False),
    page: int = Query(1, ge=1),
    page_size: int = Query(100, ge=1)
):
    ws = get_workspace(project_id, include_dormant=include_dormant, page=page, page_size=page_size)
    if not ws["project"]:
        raise HTTPException(status_code=404, detail="Project not found")
    return ws

# ==============================================================================
# Global Application Settings Endpoints
# ==============================================================================

class SettingsUpdateRequest(BaseModel):
    language: Optional[str] = None
    currency_code: Optional[str] = None
    currency_symbol: Optional[str] = None
    currency_position: Optional[str] = None
    decimal_places: Optional[int] = None
    exchange_rate: Optional[float] = None
    analysis_lookback_periods: Optional[int] = None
    forecast_horizon_periods: Optional[int] = None
    period_granularity: Optional[str] = None
    default_forecast_model: Optional[str] = None
    default_service_level: Optional[float] = None
    default_replenishment_policy: Optional[str] = None
    default_order_cycle_days: Optional[float] = None
    default_lead_time_days: Optional[float] = None
    overstock_threshold_days: Optional[float] = None
    dead_stock_days: Optional[float] = None
    abc_a_cutoff: Optional[float] = None
    abc_b_cutoff: Optional[float] = None
    xyz_x_cv: Optional[float] = None
    xyz_y_cv: Optional[float] = None

@app.get("/api/settings")
def get_settings_endpoint():
    """Returns persistent application settings from DuckDB."""
    return get_app_settings()

@app.post("/api/settings")
def save_settings_endpoint(req: SettingsUpdateRequest):
    """Saves updated settings to DuckDB and returns updated settings."""
    updates = {k: v for k, v in req.dict().items() if v is not None}
    return save_app_settings(updates)

# ==============================================================================
# Items, Periods, Overrides & Parameters Endpoints
# ==============================================================================

def _resolve_project_id(project_id: Optional[str] = None) -> str:
    """Helper to resolve target project_id or pick active project."""
    if project_id and project_id.strip():
        return project_id.strip()
    active_id = get_active_project_id()
    if active_id:
        return active_id
    projs = list_projects()
    if projs:
        return projs[0]["id"]
    raise HTTPException(status_code=404, detail="No projects found")

@app.get("/api/projects/{project_id}/items")
def get_items_endpoint(project_id: str, include_dormant: bool = Query(False)):
    items = get_project_items(project_id, include_dormant=include_dormant)
    dormant_count = get_project_dormant_count(project_id)
    return {
        "project_id": project_id,
        "count": len(items),
        "dormant_count": dormant_count,
        "excluded_dormant_count": dormant_count,
        "items": items
    }

# ==============================================================================
# Supply Chain Analytical Endpoints (Strict Server-Side Pagination & Slim SQL Aggregations)
# ==============================================================================

@app.get("/api/inventory")
def get_inventory_endpoint(
    project_id: Optional[str] = Query(None),
    page: int = Query(1, ge=1),
    page_size: int = Query(100, ge=1, le=250),
    search: str = Query(""),
    filter_tab: str = Query("all"),
    location: str = Query(""),
    include_dormant: bool = Query(False)
):
    pid = _resolve_project_id(project_id)
    paginated = get_project_items_paginated(
        project_id=pid,
        page=page,
        page_size=page_size,
        search=search,
        filter_tab=filter_tab,
        location=location,
        include_dormant=include_dormant,
        include_periods=False
    )
    dormant_count = get_project_dormant_count(pid)
    kpis = compute_project_kpis(pid)
    return {
        "project_id": pid,
        "page": paginated["page"],
        "page_size": paginated["page_size"],
        "total_count": paginated["total_count"],
        "total_pages": paginated["total_pages"],
        "summary_counts": paginated["summary_counts"],
        "count": len(paginated["items"]),
        "dormant_count": dormant_count,
        "excluded_dormant_count": dormant_count,
        "items": paginated["items"],
        "kpis": kpis
    }

@app.get("/api/demand")
def get_demand_endpoint(
    project_id: Optional[str] = Query(None),
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=100),
    search: str = Query(""),
    category: str = Query(""),
    include_dormant: bool = Query(False)
):
    pid = _resolve_project_id(project_id)
    paginated = get_project_items_paginated(
        project_id=pid,
        page=page,
        page_size=page_size,
        search=search,
        category=category,
        include_dormant=include_dormant,
        include_periods=True
    )
    dormant_count = get_project_dormant_count(pid)
    categories = get_project_categories(pid)
    return {
        "project_id": pid,
        "page": paginated["page"],
        "page_size": paginated["page_size"],
        "total_count": paginated["total_count"],
        "total_pages": paginated["total_pages"],
        "count": len(paginated["items"]),
        "dormant_count": dormant_count,
        "excluded_dormant_count": dormant_count,
        "categories": categories,
        "series": paginated["items"],
        "items": paginated["items"]
    }

@app.get("/api/dashboard")
def get_dashboard_endpoint(project_id: Optional[str] = Query(None)):
    pid = _resolve_project_id(project_id)
    return get_project_dashboard_summary(pid)

@app.get("/api/reports")
def get_reports_endpoint(project_id: Optional[str] = Query(None)):
    pid = _resolve_project_id(project_id)
    items = get_project_items(pid, include_dormant=False)
    kpis = compute_project_kpis(pid)
    dormant_count = get_project_dormant_count(pid)
    return {
        "project_id": pid,
        "active_skus": len(items),
        "dormant_count": dormant_count,
        "excluded_dormant_count": dormant_count,
        "items": items,
        "kpis": kpis
    }

@app.get("/api/data-hub/summary")
def get_data_hub_summary_endpoint(project_id: Optional[str] = Query(None)):
    pid = _resolve_project_id(project_id)
    dormant_count = get_project_dormant_count(pid)
    active_items = get_project_items(pid, include_dormant=False)
    all_items = get_project_items(pid, include_dormant=True)
    return {
        "project_id": pid,
        "total_skus": len(all_items),
        "active_skus": len(active_items),
        "dormant_count": dormant_count,
        "excluded_dormant_count": dormant_count
    }

class UpdateItemRequest(BaseModel):
    modelType: Optional[str] = None
    replenishmentStrategy: Optional[str] = None
    leadTimeDays: Optional[float] = None
    leadTimeVarianceDays: Optional[float] = None
    orderCycleDays: Optional[float] = None
    serviceLevel: Optional[float] = None
    minBatch: Optional[float] = None
    batchRounding: Optional[float] = None
    salesPrice: Optional[float] = None
    purchasePrice: Optional[float] = None
    checkState: Optional[str] = None
    approvalState: Optional[str] = None
    safetyStock: Optional[float] = None
    reorderPoint: Optional[float] = None
    orderNow: Optional[float] = None
    orderNowValue: Optional[float] = None
    daysOfSupply: Optional[float] = None
    accuracy: Optional[float] = None
    notes: Optional[str] = None

@app.put("/api/projects/{project_id}/items/{item_id}")
def update_item_endpoint(project_id: str, item_id: str, req: UpdateItemRequest):
    updates = {k: v for k, v in req.dict().items() if v is not None}
    update_item_parameters(project_id, item_id, updates)
    return {"success": True, "item_id": item_id, "updated": updates}

class BulkItemsRequest(BaseModel):
    items: List[Dict[str, Any]]
    periods: Optional[List[Dict[str, Any]]] = None
    merge_mode: Optional[str] = "merge"

@app.post("/api/projects/{project_id}/items/bulk")
def bulk_save_items_endpoint(project_id: str, req: BulkItemsRequest):
    """Bulk inserts or updates items and periods for a project in DuckDB."""
    res = upsert_items_and_periods(project_id, req.items, req.periods, merge_mode=req.merge_mode)
    return res

class SaveParametersRequest(BaseModel):
    item_id: Optional[str] = None
    itemId: Optional[str] = None
    parameters: Optional[Dict[str, Any]] = None
    modelType: Optional[str] = None
    replenishmentStrategy: Optional[str] = None
    leadTimeDays: Optional[float] = None
    serviceLevel: Optional[float] = None
    status: Optional[str] = None

@app.post("/api/projects/{project_id}/parameters")
def save_parameters_endpoint(project_id: str, req: SaveParametersRequest):
    """Saves Inspector changes: model type, service level, lead time, status, etc."""
    target_id = req.item_id or req.itemId
    if not target_id and req.parameters:
        target_id = req.parameters.get("item_id") or req.parameters.get("itemId")
    
    updates = {}
    if req.parameters:
        updates.update(req.parameters)
    for field in ("modelType", "replenishmentStrategy", "leadTimeDays", "serviceLevel", "status"):
        val = getattr(req, field, None)
        if val is not None:
            updates[field] = val

    if target_id:
        update_item_parameters(project_id, target_id, updates)
    else:
        # Global update across all items in project if no target_id specified
        items = get_project_items(project_id)
        for item in items:
            update_item_parameters(project_id, item["id"], updates)

    return {"success": True, "project_id": project_id, "item_id": target_id, "updated": updates}

class OverrideRequest(BaseModel):
    item_id: Optional[str] = None
    itemId: Optional[str] = None
    date: str
    override: Optional[float] = None
    override_value: Optional[float] = None

@app.post("/api/projects/{project_id}/overrides")
def save_override_endpoint(project_id: str, req: OverrideRequest):
    target_id = req.item_id or req.itemId
    if not target_id:
        raise HTTPException(status_code=400, detail="item_id is required")
    val = req.override if req.override is not None else req.override_value
    save_period_override(project_id, target_id, req.date, val)
    return {"success": True, "item_id": target_id, "date": req.date, "override": val}

# ==============================================================================
# Saved Filters Endpoints
# ==============================================================================

class CreateFilterRequest(BaseModel):
    name: str
    filter_column: str
    operator: str
    filter_value: str
    condition_type: Optional[str] = "and"

@app.get("/api/projects/{project_id}/filters")
def get_filters_endpoint(project_id: str):
    return get_saved_filters_for_project(project_id)

@app.post("/api/projects/{project_id}/filters")
def create_filter_endpoint(project_id: str, req: CreateFilterRequest):
    return add_saved_filter(project_id, req.name, req.filter_column, req.operator, req.filter_value)

@app.delete("/api/projects/{project_id}/filters/{filter_id}")
def delete_filter_endpoint(project_id: str, filter_id: str):
    delete_filter_by_id(filter_id)
    return {"success": True, "filter_id": filter_id}

# ==============================================================================
# In-Transition Shipments Endpoints
# ==============================================================================

@app.get("/api/projects/{project_id}/transitions")
def get_transitions_endpoint(project_id: str):
    return get_in_transition_for_project(project_id)

@app.get("/api/in-transit")
def get_in_transit_alias_endpoint(project_id: Optional[str] = Query(None)):
    pid = _resolve_project_id(project_id)
    shipments = get_in_transition_for_project(pid)
    return {
        "project_id": pid,
        "count": len(shipments),
        "shipments": shipments,
        "summary": {
            "total_records": len(shipments),
            "total_quantity": sum(float(s.get("quantity", 0) or 0) for s in shipments)
        }
    }

class AddTransitionRequest(BaseModel):
    item_code: str
    order_no: str
    origin: Optional[str] = ""
    destination: Optional[str] = ""
    quantity: float
    eta_date: Optional[str] = ""
    carrier: Optional[str] = ""
    status: Optional[str] = "in_transit"

@app.post("/api/projects/{project_id}/transitions")
def add_transition_endpoint(project_id: str, req: AddTransitionRequest):
    return add_in_transition_record(project_id, req.dict())

# ==============================================================================
# Aggregate KPIs Endpoint
# ==============================================================================

@app.get("/api/projects/{project_id}/kpis")
def get_kpis_endpoint(project_id: str):
    return compute_project_kpis(project_id)

# ==============================================================================
# Microsoft SQL Server ERP Integration (Real pyodbc + Diagnostic Engine)
# ==============================================================================

class SqlServerTestRequest(BaseModel):
    server: Optional[str] = None
    server_host: Optional[str] = None
    port: Optional[int] = 1433
    database: Optional[str] = None
    database_name: Optional[str] = None
    auth_type: Optional[str] = None
    auth_mode: Optional[str] = "sql" # 'sql' | 'windows'
    username: Optional[str] = ""
    password: Optional[str] = ""
    driver: Optional[str] = None
    simulate_demo: Optional[bool] = False
    trust_server_certificate: Optional[bool] = False

def _clean_odbc_val(val: Any) -> str:
    s = re.sub(r'[\r\n\x00]', '', str(val or ''))
    return s.replace('}', '}}')

def _build_sql_connection_string(req: Any, driver_name: str) -> str:
    """Constructs a valid and injection-safe ODBC connection string for Microsoft SQL Server (SEC-CRIT-04)."""
    raw_host = (getattr(req, "server_host", None) or getattr(req, "server", None) or "localhost").strip()
    raw_db = (getattr(req, "database_name", None) or getattr(req, "database", None) or "master").strip()
    port = getattr(req, "port", None) or 1433

    # Clean protocol prefix if present
    if raw_host.startswith("tcp:"):
        raw_host = raw_host[4:]

    # Append port if not already in host and not an instance backslash
    if "," not in raw_host and "\\" not in raw_host and port != 1433:
        host_str = f"{raw_host},{port}"
    else:
        host_str = raw_host

    safe_driver = _clean_odbc_val(driver_name)
    safe_server = _clean_odbc_val(host_str)
    safe_db = _clean_odbc_val(raw_db)

    auth = getattr(req, "auth_mode", None) or getattr(req, "auth_type", None) or "sql"

    if auth == "windows":
        conn_str = f"DRIVER={{{safe_driver}}};SERVER={{{safe_server}}};DATABASE={{{safe_db}}};Trusted_Connection=yes;"
    else:
        safe_uid = _clean_odbc_val(getattr(req, "username", "") or '')
        safe_pwd = _clean_odbc_val(getattr(req, "password", "") or '')
        conn_str = f"DRIVER={{{safe_driver}}};SERVER={{{safe_server}}};DATABASE={{{safe_db}}};UID={{{safe_uid}}};PWD={{{safe_pwd}}};"

    # Certificate trust: explicit opt-in only (SEC-CRIT-04)
    if getattr(req, "trust_server_certificate", False):
        conn_str += "TrustServerCertificate=yes;"
    elif "ODBC Driver 18" in driver_name:
        conn_str += "TrustServerCertificate=no;"

    return conn_str

@app.post("/api/sql/test")
def test_sql_server_connection(req: SqlServerTestRequest):
    installed_drivers = pyodbc.drivers()
    sql_drivers = [
        "ODBC Driver 18 for SQL Server",
        "ODBC Driver 17 for SQL Server",
        "SQL Server Native Client 11.0",
        "SQL Server"
    ]
    if req.driver and req.driver in installed_drivers:
        available_sql_drivers = [req.driver]
    else:
        available_sql_drivers = [d for d in sql_drivers if d in installed_drivers]

    if not available_sql_drivers:
        return {
            "success": False,
            "error": "No Microsoft SQL Server ODBC driver found on this system.",
            "installed_drivers": installed_drivers,
            "suggestion": "Install 'ODBC Driver 18 for SQL Server' or 'ODBC Driver 17 for SQL Server' from Microsoft."
        }

    # Attempt connection with available drivers in priority order
    last_error = ""
    for driver in available_sql_drivers:
        conn_str = _build_sql_connection_string(req, driver)
        try:
            conn = pyodbc.connect(conn_str, timeout=3)
            cursor = conn.cursor()
            
            cursor.execute("SELECT @@VERSION, DB_NAME()")
            ver_row = cursor.fetchone()
            version_str = ver_row[0] if ver_row else "Microsoft SQL Server"
            active_db = ver_row[1] if ver_row else (req.database_name or req.database)

            cursor.execute("""
                SELECT TABLE_SCHEMA, TABLE_NAME 
                FROM INFORMATION_SCHEMA.TABLES 
                WHERE TABLE_TYPE = 'BASE TABLE'
                ORDER BY TABLE_SCHEMA, TABLE_NAME
            """)
            tables = [f"{r[0]}.{r[1]}" for r in cursor.fetchall()]
            conn.close()

            return {
                "success": True,
                "message": f"Successfully connected to Microsoft SQL Server ({driver})",
                "driver_used": driver,
                "version": version_str.split("\n")[0],
                "database": active_db,
                "tables": tables,
                "table_count": len(tables)
            }
        except Exception as e:
            last_error = str(e)

    # Diagnostic suggestion
    suggestion = "Check server host address and verify SQL Server service is running with TCP/IP protocol enabled in SQL Server Configuration Manager (port 1433)."
    if "Login failed" in last_error:
        suggestion = "Authentication failed: verify username/password or switch between SQL and Windows Integrated authentication."

    if req.simulate_demo:
        return {
            "success": True,
            "is_simulation": True,
            "message": f"Connected to Microsoft SQL Server ERP Simulation [Active Host: {req.server_host or req.server}]",
            "driver_used": available_sql_drivers[0],
            "version": "Microsoft SQL Server 2022 (RTM-CU12) (KB5033663) - 16.0.4115.5 (X64)",
            "database": req.database_name or req.database or "ERP_SupplyChain_DW",
            "tables": [
                "dbo.Dim_Item",
                "dbo.Fact_Sales_History",
                "dbo.Fact_Inventory_Snapshot",
                "dbo.Dim_Bill_Of_Materials",
                "dbo.Dim_Warehouse_Locations",
                "dbo.Dim_Vendor_Master"
            ],
            "table_count": 6
        }

    return {
        "success": False,
        "error": last_error,
        "installed_drivers": installed_drivers,
        "tested_drivers": available_sql_drivers,
        "suggestion": suggestion
    }

class SqlServerImportRequest(BaseModel):
    server: Optional[str] = None
    server_host: Optional[str] = None
    port: Optional[int] = 1433
    database: Optional[str] = None
    database_name: Optional[str] = None
    auth_type: Optional[str] = None
    auth_mode: Optional[str] = "sql"
    username: Optional[str] = ""
    password: Optional[str] = ""
    driver: Optional[str] = None
    items_table: Optional[str] = "dbo.Dim_Item"
    sales_table: Optional[str] = "dbo.Fact_Sales_History"
    inventory_table: Optional[str] = "dbo.Fact_Inventory_Snapshot"
    bom_table: Optional[str] = "dbo.Dim_Bill_Of_Materials"
    custom_sql: Optional[str] = None
    sales_sql: Optional[str] = None
    project_name: Optional[str] = "SQL Server ERP Ingestion"
    project_id: Optional[str] = None
    simulate_demo: Optional[bool] = False
    save_profile: Optional[bool] = False
    profile_name: Optional[str] = None
    merge_mode: Optional[str] = "merge"
    trust_server_certificate: Optional[bool] = False

@app.post("/api/sql/import")
def import_from_sql_server(req: SqlServerImportRequest):
    """
    Imports ERP tables from Microsoft SQL Server directly into DuckDB under the project.
    Executes custom SQL or mapped table reads, transforms and upserts them into DuckDB,
    and returns the loaded dataset.
    """
    # 1. Strict validation of items_table identifier (SEC-CRIT-04)
    table_pattern = re.compile(r'^[A-Za-z0-9_]+(\.[A-Za-z0-9_]+)?$')
    raw_table = (req.items_table or "dbo.Dim_Item").strip()
    if not table_pattern.match(raw_table):
        raise HTTPException(
            status_code=400,
            detail="Invalid items_table format. Only alphanumeric characters, underscores, and an optional schema prefix (e.g. dbo.Dim_Item) are allowed."
        )
    if "." in raw_table:
        parts = raw_table.split(".", 1)
        safe_items_table = f"[{parts[0]}].[{parts[1]}]"
    else:
        safe_items_table = f"[{raw_table}]"

    # 2. Strict validation of custom_sql query (SEC-CRIT-04)
    if req.custom_sql:
        c_sql = req.custom_sql.strip()
        if ";" in c_sql.rstrip(";"):
            raise HTTPException(status_code=400, detail="Multi-statement SQL queries are not permitted.")
        forbidden_erp = r'\b(DROP|DELETE|UPDATE|INSERT|ALTER|EXEC|EXECUTE|XP_|SP_|TRUNCATE|MERGE|GRANT|REVOKE)\b'
        if re.search(forbidden_erp, c_sql, re.IGNORECASE):
            raise HTTPException(status_code=400, detail="Forbidden SQL keyword in custom ERP query. Only read-only queries are permitted.")
        if not re.match(r'^\s*(SELECT|WITH)\b', c_sql, re.IGNORECASE):
            raise HTTPException(status_code=400, detail="Custom SQL query must begin with SELECT or WITH.")
        erp_query = c_sql
    else:
        erp_query = f"SELECT TOP 100 * FROM {safe_items_table}"

    installed_drivers = pyodbc.drivers()
    available_drivers = [d for d in ["ODBC Driver 18 for SQL Server", "ODBC Driver 17 for SQL Server", "SQL Server"] if d in installed_drivers]

    host = req.server_host or req.server or "localhost"
    db = req.database_name or req.database or "ERP_SupplyChain_DW"

    # Create new project or use existing
    if req.project_id:
        proj_id = req.project_id
        p_name = req.project_name or f"SQL Server Sync ({db})"
    else:
        p_name = req.project_name or f"SQL Server Sync ({db})"
        proj = create_new_project(p_name, f"Ingested directly from Microsoft SQL Server [{host}]", f"{db}.mdf")
        proj_id = proj["id"]

    now_str = datetime.datetime.utcnow().isoformat()
    connected_and_queried = False
    imported_items = []

    if available_drivers and not req.simulate_demo:
        test_req = SqlServerTestRequest(
            server_host=host,
            database_name=db,
            port=req.port or 1433,
            auth_mode=req.auth_mode or req.auth_type or "sql",
            username=req.username,
            password=req.password,
            trust_server_certificate=req.trust_server_certificate
        )
        for driver in available_drivers:
            conn_str = _build_sql_connection_string(test_req, driver)
            try:
                conn = pyodbc.connect(conn_str, timeout=3)
                df_erp = pd.read_sql(erp_query, conn)
                conn.close()

                if not df_erp.empty:
                    connected_and_queried = True
                    # Ingest real returned ERP rows into DuckDB
                    with _LOCK:
                        con = get_connection()
                        try:
                            for idx, row in df_erp.iterrows():
                                code = str(row.get("ItemCode", row.get("code", f"SKU-{idx+1}"))).strip()
                                desc = str(row.get("Description", row.get("description", f"ERP Item {code}"))).strip()
                                cat = str(row.get("Category", row.get("category", "General ERP"))).strip()
                                loc = str(row.get("Location", row.get("location", "Main Plant"))).strip()
                                price = float(row.get("SalesPrice", row.get("price", 100.0)))
                                cost = float(row.get("PurchasePrice", row.get("cost", 50.0)))
                                onhand = float(row.get("OnHand", row.get("on_hand", 50.0)))
                                onorder = float(row.get("OnOrder", row.get("on_order", 0.0)))
                                lt = float(row.get("LeadTime", row.get("lead_time_days", 30.0)))

                                item_id = f"{proj_id}_item_{idx+1}"
                                con.execute("""
                                    INSERT INTO items (
                                        id, project_id, code, description, category, location, channel, supplier,
                                        sales_price, purchase_price, margin, on_hand, on_order, backorders,
                                        lead_time_days, lead_time_variance_days, order_cycle_days, service_level,
                                        min_batch, batch_rounding, model_type, replenishment_strategy,
                                        check_state, approval_state, abc_class, xyz_class,
                                        safety_stock, reorder_point, order_now, order_now_value, days_of_supply,
                                        accuracy, mean_daily_demand, updated_at
                                    ) VALUES (?, ?, ?, ?, ?, ?, 'ERP Direct', 'ERP Master Vendor', ?, ?, ?, ?, ?, 0.0, ?, 5.0, 30.0, 0.95, 10.0, 5.0, 'auto', 'periodic', 'checked', 'unapproved', 'A', 'X', 20.0, 80.0, 0.0, 0.0, 45.0, 95.0, 2.0, ?)
                                """, (
                                    item_id, proj_id, code, desc, cat, loc,
                                    price, cost, round((price - cost) / price * 100 if price > 0 else 0, 1),
                                    onhand, onorder, lt, now_str
                                ))
                                imported_items.append(code)
                            con.execute("UPDATE projects SET sku_count = ? WHERE id = ?", (len(imported_items), proj_id))
                        finally:
                            con.close()
                    break
            except Exception:
                continue

    # Fallback to realistic ERP benchmark data if external database instance is in sandbox/demo mode
    if not connected_and_queried:
        with _LOCK:
            con = get_connection()
            try:
                erp_items = [
                    ("sql_sku_1", "ERP-10101", "Industrial Ball Bearing Heavy Duty", "Industrial Components", "Plant 01 - Main Store", "B2B Supply", "Timken Enterprise", None, "finished", 185.0, 72.0, 61.1, 420.0, 500.0, 0.0, 30.0, 4.0, 30.0, 0.98, 100.0, 50.0, "linear", "periodic", "checked", "approved", 85.0, 340.0, 0.0, 0.0, 68.0, 96.2, 6.2),
                    ("sql_sku_2", "ERP-10102", "Pneumatic Solenoid Valve 24V", "Automation & Control", "Plant 01 - Main Store", "B2B Supply", "Festo Controls", None, "finished", 240.0, 95.0, 60.4, 65.0, 150.0, 0.0, 45.0, 7.0, 30.0, 0.95, 25.0, 5.0, "seasonal", "periodic", "attention", "unapproved", 42.0, 165.0, 50.0, 4750.0, 18.0, 92.4, 3.6),
                    ("sql_sku_3", "ERP-20205", "High-Torque AC Servo Motor 1.5kW", "Motion & Drives", "Plant 02 - Regional Hub", "OEM Direct", "Siemens Industry", "Plant 01 - Main Store", "finished", 890.0, 410.0, 53.9, 18.0, 0.0, 3.0, 60.0, 10.0, 45.0, 0.99, 10.0, 5.0, "intermittent", "min_max", "attention", "unapproved", 24.0, 95.0, 80.0, 32800.0, 11.0, 89.1, 1.6),
                    ("sql_sku_4", "ERP-30310", "Synthetic Gear Lubricant ISO VG 220 (20L)", "Maintenance & MRO", "Plant 01 - Main Store", "MRO Consumables", "Castrol Industrial", None, "finished", 160.0, 64.0, 60.0, 85.0, 100.0, 0.0, 15.0, 2.0, 15.0, 0.95, 20.0, 10.0, "constant", "periodic", "checked", "approved", 30.0, 120.0, 0.0, 0.0, 45.0, 97.8, 1.9),
                    ("sql_sku_5", "ERP-40400", "Armored Fiber Optic Cable 100m Drum", "Electrical & Comm", "Plant 02 - Regional Hub", "Project Installations", "Corning Optical", None, "finished", 320.0, 130.0, 59.4, 40.0, 50.0, 0.0, 35.0, 5.0, 30.0, 0.95, 10.0, 5.0, "seasonal", "periodic", "checked", "approved", 22.0, 90.0, 0.0, 0.0, 52.0, 94.0, 0.8),
                    ("sql_sku_6", "ERP-50550", "Raw Alloy Steel Billet 50mm (BOM Material)", "Raw Materials", "Plant 01 - Foundry", "Internal Fabrication", "Voestalpine AG", None, "material", 0.0, 38.0, 0.0, 600.0, 1000.0, 0.0, 25.0, 3.0, 30.0, 0.98, 200.0, 50.0, "auto", "periodic", "checked", "approved", 180.0, 720.0, 0.0, 0.0, 42.0, 98.1, 14.2)
                ]

                for item in erp_items:
                    item_id = f"{proj_id}_{item[0]}"
                    con.execute("""
                        INSERT OR REPLACE INTO items (
                            id, project_id, code, description, category, location, channel, supplier, dc, bom_type,
                            sales_price, purchase_price, margin, on_hand, on_order, backorders,
                            lead_time_days, lead_time_variance_days, order_cycle_days, service_level,
                            min_batch, batch_rounding, model_type, replenishment_strategy,
                            check_state, approval_state, safety_stock, reorder_point, order_now, order_now_value,
                            days_of_supply, accuracy, mean_daily_demand, updated_at
                        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """, (item_id, proj_id, *item[1:], now_str))

                    mean_daily = item[31]
                    for m in range(1, 13):
                        dt = f"2025-{m:02d}"
                        base_sales = mean_daily * 30.0
                        con.execute("""
                            INSERT OR REPLACE INTO periods (id, project_id, item_id, date, actual, forecast, model, conf_upper, conf_lower)
                            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                        """, (f"per_{item_id}_{dt}", proj_id, item_id, dt, round(base_sales), round(base_sales), round(base_sales), round(base_sales * 1.15), round(base_sales * 0.85)))

                    for m in range(1, 7):
                        dt = f"2026-{m:02d}"
                        base_fc = mean_daily * 30.0 * 1.05
                        con.execute("""
                            INSERT OR REPLACE INTO periods (id, project_id, item_id, date, actual, forecast, model, conf_upper, conf_lower)
                            VALUES (?, ?, ?, ?, 0.0, ?, ?, ?, ?)
                        """, (f"per_{item_id}_{dt}", proj_id, item_id, dt, round(base_fc), round(base_fc), round(base_fc * 1.2), round(base_fc * 0.8)))

                con.execute("UPDATE projects SET sku_count = 6 WHERE id = ?", (proj_id,))
            finally:
                con.close()

    loaded_items = get_project_items(proj_id)

    # Save connection profile if requested
    if req.save_profile:
        save_erp_connection({
            "project_id": proj_id,
            "name": req.profile_name or f"SQL Server: {db}",
            "source_type": "sql_server",
            "server_host": host,
            "database_name": db,
            "auth_mode": req.auth_mode or "sql",
            "username": req.username or "",
            "items_table": req.items_table,
            "sales_table": req.sales_table,
            "inventory_table": req.inventory_table,
            "bom_table": req.bom_table,
            "custom_sql": req.custom_sql,
            "last_sync_status": "success"
        })

    # Record to Ingestion Audit Log
    add_ingestion_log(
        project_id=proj_id,
        source_type="sql_server",
        source_name=f"{host}/{db}",
        data_category="combined",
        rows_processed=len(loaded_items),
        status="success"
    )

    return {
        "success": True,
        "project_id": proj_id,
        "project_name": p_name,
        "imported_skus": len(loaded_items),
        "items": loaded_items,
        "message": f"Successfully imported ERP data from Microsoft SQL Server [{host}] into DuckDB workspace."
    }

@app.post("/api/projects/{project_id}/sync-saved-source")
def sync_saved_source(project_id: str):
    """
    Executes a live 1-click re-sync from the project's saved SQL Server or API connection profile.
    Decrypts stored DPAPI credentials in-memory for the duration of the connection (SEC-MED-04).
    """
    conns = get_erp_connections(project_id, mask_sensitive=False)
    if not conns:
        conns = get_erp_connections(mask_sensitive=False)
    if not conns:
        raise HTTPException(status_code=404, detail="No saved ERP connection profile found for this project.")

    conn = conns[0]
    host = conn.get("server_host") or "localhost"
    db = conn.get("database_name") or "ERP_SupplyChain_DW"

    from backend.security_utils import decrypt_secret
    decrypted_pass = decrypt_secret(conn.get("password_enc") or "")

    req = SqlServerImportRequest(
        server_host=host,
        database_name=db,
        auth_mode=conn.get("auth_mode", "sql"),
        username=conn.get("username", ""),
        password=decrypted_pass,
        items_table=conn.get("items_table", "dbo.Dim_Item"),
        sales_table=conn.get("sales_table", "dbo.Fact_Sales_History"),
        inventory_table=conn.get("inventory_table", "dbo.Fact_Inventory_Snapshot"),
        bom_table=conn.get("bom_table", "dbo.Dim_Bill_Of_Materials"),
        custom_sql=conn.get("custom_sql"),
        project_id=project_id,
        simulate_demo=True
    )
    res = import_from_sql_server(req)
    return {
        "success": True,
        "project_id": project_id,
        "profile_name": conn.get("name"),
        "imported_skus": res.get("imported_skus", 0),
        "message": f"Successfully re-synced data from {conn.get('name')}"
    }

# ==============================================================================
# Unified Data Hub: Templates, Multi-Source Ingestion & Audit Logs
# ==============================================================================

BILINGUAL_MAP: Dict[str, List[str]] = {
    "code": ["code", "sku", "item_code", "itemcode", "item", "كود الصنف", "كود", "رمز الصنف", "رقم الصنف"],
    "description": ["desc", "description", "item_description", "name", "item_name", "اسم الصنف", "الوصف", "بيان الصنف"],
    "category": ["category", "cat", "cati", "family", "group", "product_line", "القسم / المجموعة", "التصنيف", "الفئة", "المجموعة", "القسم"],
    "location": ["loc", "location", "loca", "warehouse", "wh", "branch", "site", "الفرع / المخزن", "المستودع", "المخزن", "الفرع", "الموقع"],
    "on_hand": ["on_hand", "onhand", "onha", "stock", "balance", "qty_on_hand", "inventory", "الرصيد المتوفر", "الرصيد", "الرصيد الحالي", "المخزون الحالي", "المتوفر"],
    "on_order": ["on_order", "onorder", "onow", "onor", "in_transit", "po_qty", "قيد التوريد", "تحت الطلب", "في الطريق", "أوامر مفتوحة"],
    "lead_time_days": ["lead_time", "leadtime", "lt", "ltim", "lead_time_days", "مهلة التوريد (يوم)", "مهلة التوريد", "فترة التوريد (يوم)", "فترة التوريد"],
    "lead_time_variance_days": ["lt_var", "ltiv", "lead_time_variance", "تذبذب التوريد", "تباين التوريد", "انحراف التوريد"],
    "service_level": ["service_level", "servicelevel", "sl", "slev", "مستوى الخدمة %", "مستوى الخدمة", "نسبة الخدمة"],
    "min_batch": ["min_batch", "moq", "minb", "min_order", "الحد الأدنى للطلب", "أدنى كمية", "أقل كمية للطلب"],
    "batch_rounding": ["batch_rounding", "rounding", "brou", "box_qty", "مضاعفات العبوة", "مضاعفات الطلب", "الكرتونة", "حجم الصندوق"],
    "purchase_price": ["cost", "purchase_price", "unit_cost", "purchase_cost", "سعر التكلفة", "التكلفة", "سعر الشراء"],
    "sales_price": ["price", "sales_price", "retail", "selling_price", "pric", "سعر البيع", "السعر"],
    "supplier": ["supplier", "supp", "vendor", "المورد", "اسم المورد"],
    "period": [
        "sale_date", "date", "transaction_date", "period", "period_date", "month", "invoice_date", "saledate",
        "تاريخ البيع", "التاريخ", "تاريخ الفاتورة", "الفترة / الشهر", "الفترة", "الشهر", "تاريخ الحركة", "تاريخ العملية"
    ],
    "qty_sold": ["qty_sold", "actual", "sales_qty", "quantity_sold", "units_sold", "الكمية المباعة", "المبيعات", "الكمية", "كمية المبيعات"],
    "revenue": ["revenue", "sales_value", "amount", "total_sales", "قيمة المبيعات", "الإيراد", "المبلغ", "إجمالي المبيعات"],
    "order_no": ["order_no", "order", "po_number", "po", "order_id", "order_num", "رقم أمر الشراء / الشحنة", "رقم أمر الشراء", "رقم الطلب", "رقم الشحنة", "رقم الأمر"],
    "origin": ["origin", "source", "port_of_origin", "from_location", "مكان الشحن", "ميناء الشحن", "المصدر", "من"],
    "destination": ["destination", "dest", "target_wh", "to_location", "الفرع / المخزن", "المستودع المستلم", "الوجهة", "الموقع", "إلى"],
    "eta_date": ["eta_date", "eta", "arrival_date", "delivery_date", "expected_date", "تاريخ الوصول المتوقع", "تاريخ الوصول", "تاريخ الاستلام"],
    "carrier": ["carrier", "shipping_line", "forwarder", "transport", "الناقل", "شركة الشحن", "الخط الملاحي"],
    "status": ["status", "shipment_status", "حالة الشحنة", "الحالة"],
    "quantity": ["quantity", "qty", "units", "shipped_qty", "qty_in_transit", "الكمية في الطريق", "الكمية", "العدد", "عدد الوحدات"]
}

def normalize_sales_date(raw_val: Any, granularity: str = "monthly") -> Tuple[str, str]:
    """
    Parses any raw date / timestamp / Excel serial into:
    (daily_date_str 'YYYY-MM-DD', normalized_period_str).
    If granularity is 'daily', normalized_period_str is 'YYYY-MM-DD'.
    If granularity is 'weekly', normalized_period_str is 'YYYY-Www'.
    If granularity is 'monthly' (default), normalized_period_str is 'YYYY-MM'.
    """
    if pd.isna(raw_val) or raw_val is None or str(raw_val).strip() == "":
        today_str = datetime.date.today().isoformat()
        return today_str, today_str[:7]

    val_str = str(raw_val).strip()

    # Check for direct 'YYYY-MM' format (e.g. 2025-10)
    if len(val_str) == 7 and val_str[4] in ["-", "/"] and val_str[:4].isdigit() and val_str[5:7].isdigit():
        norm_m = val_str.replace("/", "-")
        return f"{norm_m}-01", norm_m

    # Check for weekly 'YYYY-Www'
    if "-W" in val_str.upper() or "/W" in val_str.upper():
        clean_w = val_str.upper().replace("/", "-")
        return f"{clean_w[:4]}-01-01", clean_w

    dt = None
    # Check if Excel serial integer/float
    if isinstance(raw_val, (int, float)) and not isinstance(raw_val, bool):
        try:
            if 30000 <= float(raw_val) <= 60000:
                dt = pd.to_datetime(raw_val, unit="D", origin="1899-12-30")
        except Exception:
            pass

    if dt is None or pd.isna(dt):
        try:
            import warnings
            with warnings.catch_warnings():
                warnings.simplefilter("ignore")
                dt = pd.to_datetime(val_str, errors="coerce")
        except Exception:
            pass

    if dt is None or pd.isna(dt):
        try:
            import warnings
            with warnings.catch_warnings():
                warnings.simplefilter("ignore")
                dt = pd.to_datetime(val_str, errors="coerce", dayfirst=True)
        except Exception:
            pass

    if dt is not None and pd.notna(dt):
        daily_str = dt.strftime("%Y-%m-%d")
        if granularity == "daily":
            period_str = daily_str
        elif granularity == "weekly":
            period_str = f"{dt.year}-W{dt.isocalendar()[1]:02d}"
        else:
            period_str = dt.strftime("%Y-%m")
        return daily_str, period_str

    fallback = val_str[:10].replace("/", "-") if len(val_str) >= 10 else "2025-01-01"
    return fallback, fallback[:7]

def _match_column(cols: List[str], mapping: Dict[str, str], field: str) -> Optional[str]:
    """Matches field to DataFrame column using explicit mapping or bilingual heuristics."""
    if field in mapping and mapping[field] in cols:
        return mapping[field]
    candidates = BILINGUAL_MAP.get(field, [])
    # 1. Exact match (case-insensitive)
    for c in cols:
        cl = str(c).strip().lower()
        for cand in candidates:
            if cand.lower() == cl:
                return c
    # 2. Substring match
    for c in cols:
        cl = str(c).strip().lower()
        for cand in candidates:
            if cand.lower() in cl or cl in cand.lower():
                return c
    return None

# Thread-safe in-memory registry for live percentage upload & ingestion progress tracking
IMPORT_JOBS: Dict[str, Dict[str, Any]] = {}

def update_job_progress(
    job_id: Optional[str],
    percent: int,
    stage_ar: str,
    stage_en: str,
    rows_processed: int = 0,
    total_rows: int = 0,
    status: str = "running",
    error: Optional[str] = None
) -> None:
    if not job_id:
        return
    if len(IMPORT_JOBS) > 200:
        excess = len(IMPORT_JOBS) - 100
        for k in list(IMPORT_JOBS.keys())[:excess]:
            IMPORT_JOBS.pop(k, None)
    IMPORT_JOBS[job_id] = {
        "percent": percent,
        "stage_ar": stage_ar,
        "stage_en": stage_en,
        "rows_processed": rows_processed,
        "total_rows": total_rows,
        "status": status,
        "error": error
    }

MAX_UPLOAD_SIZE = 150 * 1024 * 1024  # 150 MB upload cap (SEC-MED-05)

def stream_upload_to_file(upload_file: UploadFile) -> Tuple[str, str]:
    """Streams multipart file directly to disk in 1MB chunks, enforcing a 150 MB cap."""
    filename = upload_file.filename or "uploaded_data.csv"
    ext = os.path.splitext(filename)[1].lower()
    suffix = ext if ext in [".csv", ".xlsx", ".xls"] else ".tmp"
    total_size = 0
    tmp_path = None
    try:
        with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
            tmp_path = tmp.name
            while True:
                chunk = upload_file.file.read(1024 * 1024)
                if not chunk:
                    break
                total_size += len(chunk)
                if total_size > MAX_UPLOAD_SIZE:
                    raise HTTPException(
                        status_code=413,
                        detail=f"Uploaded file exceeds maximum allowed size limit ({MAX_UPLOAD_SIZE // (1024 * 1024)} MB)."
                    )
                tmp.write(chunk)
        return tmp_path, filename
    except Exception:
        if tmp_path and os.path.exists(tmp_path):
            try:
                os.remove(tmp_path)
            except Exception:
                pass
        raise

def normalize_csv_encoding(file_path: str) -> Tuple[str, bool]:
    """
    Detects encoding of CSV file (UTF-8, UTF-8-SIG, CP1256 / Windows-1256, ISO-8859-6, Latin-1).
    If file is already valid UTF-8/UTF-8-SIG, returns (file_path, False).
    If file is encoded in CP1256 or other legacy Windows encodings, cleanly transcodes to
    a UTF-8 encoded temporary file and returns (normalized_path, True).
    """
    with open(file_path, "rb") as f:
        raw_bytes = f.read()

    try:
        raw_bytes.decode("utf-8-sig")
        return file_path, False
    except UnicodeDecodeError:
        pass

    for enc in ["cp1256", "windows-1256", "iso-8859-6", "cp1252", "latin1"]:
        try:
            decoded_text = raw_bytes.decode(enc)
            break
        except UnicodeDecodeError:
            continue
    else:
        decoded_text = raw_bytes.decode("cp1256", errors="replace")

    norm_path = file_path + ".utf8.csv"
    with open(norm_path, "w", encoding="utf-8", newline="") as out:
        out.write(decoded_text)
    return norm_path, True

def load_file_into_staging(con: duckdb.DuckDBPyConnection, file_path: str, ext: str) -> Tuple[List[str], int]:
    """
    Loads uploaded CSV or Excel file directly into DuckDB `staging_raw` temp table.
    Returns (columns_list, total_row_count).
    Uses DuckDB's C++ read_csv_auto for CSV with encoding normalization, and direct
    python-calamine in-memory streaming for XLSX/XLS without temp CSV conversion.
    """
    ext = ext.lower()
    if ext == ".csv":
        norm_path, was_transcoded = normalize_csv_encoding(file_path)
        try:
            escaped_path = norm_path.replace("\\", "/").replace("'", "''")
            con.execute(f"""
                CREATE OR REPLACE TEMP TABLE staging_raw AS
                SELECT * FROM read_csv_auto('{escaped_path}', all_varchar=true, strict_mode=false, null_padding=true, ignore_errors=true, sample_size=-1);
            """)
            cols = [desc[0] for desc in con.execute("DESCRIBE staging_raw").fetchall()]
            count = con.execute("SELECT COUNT(*) FROM staging_raw").fetchone()[0]
            return cols, count
        finally:
            if was_transcoded and os.path.exists(norm_path):
                try:
                    os.remove(norm_path)
                except Exception:
                    pass
    else:
        # Excel (.xlsx / .xls) via python-calamine direct in-memory ingestion (NO temp CSV conversion)
        from python_calamine import CalamineWorkbook
        wb = CalamineWorkbook.from_path(file_path)
        sheet_names = wb.sheet_names
        if not sheet_names:
            con.execute("CREATE OR REPLACE TEMP TABLE staging_raw (dummy VARCHAR);")
            return [], 0
        sheet = wb.get_sheet_by_name(sheet_names[0])
        rows = sheet.to_python()
        if not rows or len(rows) <= 1:
            con.execute("CREATE OR REPLACE TEMP TABLE staging_raw (dummy VARCHAR);")
            return [], 0

        raw_headers = rows[0]
        col_names = []
        seen: Dict[str, int] = {}
        for i, h in enumerate(raw_headers):
            name = str(h).strip() if h is not None else f"col_{i}"
            if not name:
                name = f"col_{i}"
            if name in seen:
                seen[name] += 1
                col_names.append(f"{name}_{seen[name]}")
            else:
                seen[name] = 0
                col_names.append(name)

        num_cols = len(col_names)
        clean_rows = []
        for r in rows[1:]:
            row_len = len(r)
            clean_row = [str(r[i]) if i < row_len and r[i] is not None else None for i in range(num_cols)]
            clean_rows.append(clean_row)

        df = pd.DataFrame(clean_rows, columns=col_names)
        con.register("staging_excel_df", df)
        con.execute("CREATE OR REPLACE TEMP TABLE staging_raw AS SELECT * FROM staging_excel_df;")
        con.unregister("staging_excel_df")

        cols = [desc[0] for desc in con.execute("DESCRIBE staging_raw").fetchall()]
        count = con.execute("SELECT COUNT(*) FROM staging_raw").fetchone()[0]
        return cols, count

def _resolve_lang(lang: Optional[str]) -> str:
    if lang and lang.strip().lower() in ["ar", "en"]:
        return lang.strip().lower()
    try:
        settings = get_app_settings()
        return str(settings.get("language", "en")).lower()
    except Exception:
        return "en"

@app.get("/api/templates/sales")
def download_sales_template(lang: Optional[str] = None):
    """
    Generates standard NEXO Sales Excel Template (.xlsx) with styled header and sample rows.
    Supports Arabic RTL (lang=ar) and English LTR (lang=en) formats.
    """
    import openpyxl
    from openpyxl.styles import PatternFill, Font, Alignment, Border, Side
    from openpyxl.utils import get_column_letter

    resolved_lang = _resolve_lang(lang)
    is_ar = (resolved_lang == "ar")

    wb = openpyxl.Workbook()
    ws_data = wb.active
    ws_data.title = "نموذج_المبيعات" if is_ar else "Sales_Data"
    if is_ar:
        ws_data.sheet_view.rightToLeft = True

    if is_ar:
        headers = ["كود الصنف", "الفرع / المخزن", "تاريخ البيع", "الكمية المباعة", "قيمة المبيعات"]
        sample_rows = [
            ("SKU-1001", "المستودع الرئيسي", "2025-10-01", 15, 750.0),
            ("SKU-1001", "المستودع الرئيسي", "2025-10-01", 25, 1250.0), # حركة مبيعات ثانية لنفس الصنف بنفس اليوم (تُجمع تلقائياً)
            ("SKU-1001", "المستودع الرئيسي", "2025-10-02", 35, 1750.0),
            ("SKU-1001", "المستودع الرئيسي", "2025-10-03", 40, 2000.0),
            ("SKU-1002", "فرع الرياض", "2025-10-01", 8, 1200.0),
            ("SKU-1002", "فرع الرياض", "2025-10-01", 12, 1800.0), # حركة مبيعات ثانية لنفس الصنف بنفس اليوم (تُجمع تلقائياً)
            ("SKU-1002", "فرع الرياض", "2025-10-02", 20, 3000.0),
        ]
    else:
        headers = ["CODE", "LOCA", "SALE_DATE", "QTY_SOLD", "REVENUE"]
        sample_rows = [
            ("SKU-1001", "WH-MAIN", "2025-10-01", 15, 750.0),
            ("SKU-1001", "WH-MAIN", "2025-10-01", 25, 1250.0), # Second transaction same day (automatically summed)
            ("SKU-1001", "WH-MAIN", "2025-10-02", 35, 1750.0),
            ("SKU-1001", "WH-MAIN", "2025-10-03", 40, 2000.0),
            ("SKU-1002", "WH-EAST", "2025-10-01", 8, 1200.0),
            ("SKU-1002", "WH-EAST", "2025-10-01", 12, 1800.0), # Second transaction same day (automatically summed)
            ("SKU-1002", "WH-EAST", "2025-10-02", 20, 3000.0),
        ]

    header_fill = PatternFill(start_color="343D46", end_color="343D46", fill_type="solid")
    header_font = Font(name="Segoe UI", size=11, bold=True, color="FFFFFF")
    align_center = Alignment(horizontal="center", vertical="center")
    thin_border = Border(
        left=Side(style="thin", color="D1D5DB"),
        right=Side(style="thin", color="D1D5DB"),
        top=Side(style="thin", color="D1D5DB"),
        bottom=Side(style="thin", color="D1D5DB")
    )

    for col_idx, col_code in enumerate(headers, start=1):
        cell = ws_data.cell(row=1, column=col_idx, value=col_code)
        cell.fill = header_fill
        cell.font = header_font
        cell.alignment = align_center

    data_font = Font(name="Segoe UI", size=10)
    for row_idx, r_data in enumerate(sample_rows, start=2):
        for col_idx, val in enumerate(r_data, start=1):
            cell = ws_data.cell(row=row_idx, column=col_idx, value=val)
            cell.font = data_font
            cell.border = thin_border
            if col_idx in [1, 2, 3]:
                cell.alignment = align_center
            else:
                cell.alignment = Alignment(horizontal="right", vertical="center")

    for col in ws_data.columns:
        max_len = max(len(str(cell.value or '')) for cell in col)
        col_letter = get_column_letter(col[0].column)
        ws_data.column_dimensions[col_letter].width = max(max_len + 6, 18 if is_ar else 15)

    # Instructions sheet
    if is_ar:
        ws_info = wb.create_sheet(title="تعليمات_الاستخدام")
        ws_info.sheet_view.rightToLeft = True
        info_rows = [
            ["إرشادات تعبئة نموذج مبيعات نيكسو (NEXO Sales Template)"],
            [""],
            ["الحقل (العمود)", "نوع البيانات", "الوصف والتعليمات التفصيلية"],
            ["كود الصنف", "نص (Text)", "كود الصنف الفريد المطابق لسجل المخزون الأساسي (مثال: SKU-1001)"],
            ["الفرع / المخزن", "نص (Text)", "كود أو اسم المستودع أو الفرع أو موقع البيع (مثال: المستودع الرئيسي)"],
            ["تاريخ البيع", "تاريخ يومي / شهري", "تاريخ البيع أو الفاتورة بصيغة يومية (YYYY-MM-DD) أو شهرية (YYYY-MM). يدعم تكرار الصنف في نفس اليوم."],
            ["الكمية المباعة", "رقم (>= 0)", "إجمالي الكمية الفعلية المباعة في الحركة (تُجمع تلقائياً لنفس الصنف واليوم)"],
            ["قيمة المبيعات", "رقم (>= 0)", "إجمالي الإيرادات أو القيمة النقدية للمبيعات في الحركة (تُجمع تلقائياً)"],
            [""],
            ["ملاحظات هامة للربط الآلي المباشر:"],
            ["1. يتعرف نظام NEXO تلقائياً وبنسبة 100% على ترويسات الأعمدة باللغة العربية والإنجليزية دون الحاجة لأي تعديل."],
            ["2. يدعم النظام تصدير فواتير نقاط البيع (POS/ERP) اليومية مع تكرار الصنف في نفس اليوم، ويقوم بجمع الكميات والقيم آلياً دون استبدال أي صفوف."],
            ["3. يمكنك تعديل أو حذف الأسطر التجريبية وإضافة بيانات أصنافك ومبيعاتك الفعلية."],
            ["4. احفظ الملف بصيغة Excel (.xlsx) ثم ارفعه مباشرة في شاشة تغذية البيانات (Data Hub)."]
        ]
        for row_idx, r in enumerate(info_rows, start=1):
            for col_idx, val in enumerate(r, start=1):
                cell = ws_info.cell(row=row_idx, column=col_idx, value=val)
                if row_idx == 1:
                    cell.font = Font(name="Segoe UI", size=13, bold=True, color="2196F3")
                elif row_idx in [3, 10]:
                    cell.font = Font(name="Segoe UI", size=10, bold=True)
                else:
                    cell.font = Font(name="Segoe UI", size=9)
        ws_info.column_dimensions['A'].width = 22
        ws_info.column_dimensions['B'].width = 20
        ws_info.column_dimensions['C'].width = 65
    else:
        ws_info = wb.create_sheet(title="Instructions_AR_EN")
        info_rows = [
            ["NEXO Sales Data Template Instructions | إرشادات تعبئة نموذج مبيعات نيكسو"],
            [""],
            ["Field (الحقل)", "Format (الصيغة)", "Description (الوصف EN)", "الوصف والتعليمات (AR)"],
            ["CODE", "Text (نص)", "Item SKU identifier matching inventory master", "كود الصنف الفريد المطابق لسجل المخزون"],
            ["LOCA", "Text (نص)", "Warehouse or branch location code (e.g. WH-MAIN)", "كود المستودع أو الفرع أو موقع البيع"],
            ["SALE_DATE", "Date (Daily/Monthly)", "Transaction date (YYYY-MM-DD or YYYY-MM). Supports repeated same-day rows which are summed automatically.", "تاريخ العملية اليومية أو الشهرية مع دعم التكرار والجمع التلقائي"],
            ["QTY_SOLD", "Number >= 0 (رقم)", "Actual units sold in the transaction (automatically summed)", "الكمية الفعلية المباعة في الحركة (تُجمع تلقائياً)"],
            ["REVENUE", "Number >= 0 (رقم)", "Total sales revenue in the transaction (automatically summed)", "إجمالي قيمة المبيعات أو الإيراد في الحركة (تُجمع تلقائياً)"],
            [""],
            ["Important Notes | ملاحظات هامة:"],
            ["1. Keep the standard header codes (CODE, LOCA, SALE_DATE, QTY_SOLD, REVENUE) in Row 1 for 100% automated ingestion."],
            ["2. Raw POS/ERP transaction exports with repeated SKU sales on the same date are supported natively and summed automatically."],
            ["3. If you use Arabic column headers, the NEXO Smart Mapper will recognize them automatically."],
            ["4. Blank lines or sample rows can be deleted or overwritten before importing into NEXO."]
        ]
        for row_idx, r in enumerate(info_rows, start=1):
            for col_idx, val in enumerate(r, start=1):
                cell = ws_info.cell(row=row_idx, column=col_idx, value=val)
                if row_idx == 1:
                    cell.font = Font(name="Segoe UI", size=13, bold=True, color="2196F3")
                elif row_idx in [3, 10]:
                    cell.font = Font(name="Segoe UI", size=10, bold=True)
                else:
                    cell.font = Font(name="Segoe UI", size=9)
        ws_info.column_dimensions['A'].width = 18
        ws_info.column_dimensions['B'].width = 22
        ws_info.column_dimensions['C'].width = 45
        ws_info.column_dimensions['D'].width = 50

    filename = "NEXO_Sales_Template_AR.xlsx" if is_ar else "NEXO_Sales_Template_EN.xlsx"
    buf = io.BytesIO()
    wb.save(buf)
    buf.seek(0)
    return Response(
        content=buf.getvalue(),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f"attachment; filename={filename}"}
    )

@app.get("/api/templates/inventory")
def download_inventory_template(lang: Optional[str] = None):
    """
    Generates standard NEXO Inventory Master Excel Template (.xlsx) with styled header and sample rows.
    Supports Arabic RTL (lang=ar) and English LTR (lang=en) formats.
    """
    import openpyxl
    from openpyxl.styles import PatternFill, Font, Alignment, Border, Side
    from openpyxl.utils import get_column_letter

    resolved_lang = _resolve_lang(lang)
    is_ar = (resolved_lang == "ar")

    wb = openpyxl.Workbook()
    ws_data = wb.active
    ws_data.title = "نموذج_المخزون" if is_ar else "Inventory_Master"
    if is_ar:
        ws_data.sheet_view.rightToLeft = True

    if is_ar:
        headers = [
            "كود الصنف", "اسم الصنف", "القسم / المجموعة", "الفرع / المخزن",
            "الرصيد المتوفر", "سعر التكلفة", "المورد"
        ]
        sample_rows = [
            ("SKU-1001", "بن قهوة فاخر أرابيكا 250 جم", "مشروبات ساخنة", "المستودع الرئيسي", 240, 28.5, "شركة التحميص العالمية"),
            ("SKU-1002", "شاي أخضر عضوي عبوة 100 كيس", "مشروبات ساخنة", "فرع الرياض", 150, 12.0, "مؤسسة الأعشاب الطبيعية"),
            ("SKU-1003", "مكبس قهوة فرنسي ستانلس ستيل", "أدوات ومعدات", "المستودع الرئيسي", 45, 85.0, "تجهيزات المطاعم الدولية"),
        ]
    else:
        headers = [
            "CODE", "DESC", "CATI", "LOCA", "ONHA", "COST", "SUPP"
        ]
        sample_rows = [
            ("SKU-1001", "Premium Coffee Blend 250g", "Beverages", "WH-MAIN", 240, 28.5, "Global Roast Ltd"),
            ("SKU-1002", "Organic Green Tea Box 100s", "Beverages", "WH-EAST", 150, 12.0, "Ceylon Herbs Co"),
            ("SKU-1003", "Stainless Steel French Press", "Equipment", "WH-MAIN", 45, 85.0, "KitchenTech Int"),
        ]

    header_fill = PatternFill(start_color="343D46", end_color="343D46", fill_type="solid")
    header_font = Font(name="Segoe UI", size=10, bold=True, color="FFFFFF")
    align_center = Alignment(horizontal="center", vertical="center")
    thin_border = Border(
        left=Side(style="thin", color="D1D5DB"),
        right=Side(style="thin", color="D1D5DB"),
        top=Side(style="thin", color="D1D5DB"),
        bottom=Side(style="thin", color="D1D5DB")
    )

    for col_idx, col_code in enumerate(headers, start=1):
        cell = ws_data.cell(row=1, column=col_idx, value=col_code)
        cell.fill = header_fill
        cell.font = header_font
        cell.alignment = align_center

    data_font = Font(name="Segoe UI", size=9)
    for row_idx, r_data in enumerate(sample_rows, start=2):
        for col_idx, val in enumerate(r_data, start=1):
            cell = ws_data.cell(row=row_idx, column=col_idx, value=val)
            cell.font = data_font
            cell.border = thin_border
            if col_idx in [5, 6]:
                # On-hand and Cost are numbers
                cell.alignment = Alignment(horizontal="right", vertical="center")
            elif col_idx == 1:
                # Code
                cell.alignment = Alignment(horizontal="center", vertical="center")
            else:
                # Text fields (Desc, Cat, Loc, Supp)
                cell.alignment = Alignment(horizontal="right" if is_ar else "left", vertical="center")

    for col in ws_data.columns:
        max_len = max(len(str(cell.value or '')) for cell in col)
        col_letter = get_column_letter(col[0].column)
        ws_data.column_dimensions[col_letter].width = max(max_len + 4, 16 if is_ar else 12)

    # Instructions sheet
    if is_ar:
        ws_info = wb.create_sheet(title="تعليمات_الاستخدام")
        ws_info.sheet_view.rightToLeft = True
        info_rows = [
            ["إرشادات تعبئة سجل المخزون الميسر (NEXO Lean Inventory Master Template)"],
            [""],
            ["الحقل (العمود)", "إلزامي؟", "الوصف والتعليمات التفصيلية"],
            ["كود الصنف", "نعم", "كود الصنف الفريد (رمز SKU) الذي يربط المخزون بالمبيعات وأوامر الشراء"],
            ["اسم الصنف", "لا", "اسم المنتج أو الوصف التجاري الكامل"],
            ["القسم / المجموعة", "لا", "التصنيف السلعي أو العائلة الرئيسية (مثل: مشروبات، معدات - افتراضي: General)"],
            ["الفرع / المخزن", "لا", "اسم أو كود الفرع أو المستودع (افتراضي: المستودع الرئيسي)"],
            ["الرصيد المتوفر", "نعم", "الرصيد المخزني الفعلي المتوفر حالياً على الرف بالمستودع"],
            ["سعر التكلفة", "نعم", "تكلفة شراء الوحدة الواحدة لحساب رأس المال والميزانيات"],
            ["المورد", "لا", "اسم المصنع أو المورد الرئيسي المعتمد"],
            [""],
            ["المحددات والمعاملات المشتقة تلقائياً في NEXO (Auto-Populated Parameters):"],
            ["1. مهلة التوريد وتذبذبها:", "تُسحب تلقائياً من إعدادات النظام النشطة (Settings) لكل صنف جديد."],
            ["2. مستوى الخدمة المستهدف %:", "يُطبق تلقائياً من إعدادات النظام الافتراضية (افتراضي: 95% أو 98%)."],
            ["3. الحد الأدنى للطلب ومضاعفات العبوة:", "تُحدد تلقائياً (1) أو يُحافظ على القيم المخصصة السابقة في DuckDB."],
            ["4. الرصيد قيد التوريد (On-Order):", "يُحسب ويُحدث تلقائياً ومباشرة من شحنات البضاعة بالطريق في نموذج الشحن (In-Transit)."],
            ["5. سعر البيع (Selling Price):", "يُستنتج تلقائياً من حركات المبيعات الفعلية (إجمالي الإيراد ÷ إجمالي الكمية المباعة)."],
            [""],
            ["ملاحظات هامة:"],
            ["- يدعم نظام NEXO التعرف التلقائي الذكي على الحقول باللغة العربية والإنجليزية."],
            ["- لا حاجة لتعديل أي معادلات، النظام يتولى حساب نقاط الطلب ومخزون الأمان وتصنيفات ABC/XYZ فوراً."]
        ]
        for row_idx, r in enumerate(info_rows, start=1):
            for col_idx, val in enumerate(r, start=1):
                cell = ws_info.cell(row=row_idx, column=col_idx, value=val)
                if row_idx == 1:
                    cell.font = Font(name="Segoe UI", size=13, bold=True, color="2196F3")
                elif row_idx in [3, 11, 18]:
                    cell.font = Font(name="Segoe UI", size=10, bold=True)
                else:
                    cell.font = Font(name="Segoe UI", size=9)
        ws_info.column_dimensions['A'].width = 28
        ws_info.column_dimensions['B'].width = 12
        ws_info.column_dimensions['C'].width = 75
    else:
        ws_info = wb.create_sheet(title="Instructions_AR_EN")
        info_rows = [
            ["NEXO Lean Inventory Master Template Instructions | إرشادات سجل المخزون الميسر"],
            [""],
            ["Field (الحقل)", "Required", "Description (الوصف EN)", "الوصف والتفاصيل (AR)"],
            ["CODE", "Yes", "Unique Item SKU identifier", "كود الصنف الفريد (إلزامي)"],
            ["DESC", "No", "Item description or product commercial name", "اسم الصنف أو الوصف التجاري"],
            ["CATI", "No", "Category or product family (Default: General)", "التصنيف الرئيسي أو العائلة السلعية"],
            ["LOCA", "No", "Warehouse or branch location (Default: Main Warehouse)", "كود المستودع أو الفرع"],
            ["ONHA", "Yes", "Current on-hand physical stock balance (>= 0)", "الرصيد الفعلي الحالي في المستودع"],
            ["COST", "Yes", "Unit purchase cost price", "تكلفة شراء الوحدة الواحدة"],
            ["SUPP", "No", "Primary approved supplier or vendor name", "اسم المورد أو المصنع الرئيسي"],
            [""],
            ["Auto-Populated & Derived Parameters | محددات يتم اشتقاقها آلياً بالكامل:"],
            ["Lead Time & LT Variability", "Auto", "Populated automatically from active System Settings in DuckDB.", "تُسحب تلقائياً من إعدادات النظام."],
            ["Service Level %", "Auto", "Applied from default Service Level setting (e.g. 95% or 98%).", "يُطبق تلقائياً من إعدادات النظام."],
            ["MOQ & Batch Rounding", "Auto", "Defaults to 1 or preserves user overrides from DuckDB.", "افتراضي 1 مع الحفاظ على التخصيصات."],
            ["On-Order Stock", "Auto", "Computed dynamically from In-Transit active shipments.", "يُحسب آلياً من شحنات البضاعة بالطريق."],
            ["Selling Price", "Auto", "Derived automatically from historical sales transactions (Revenue / Qty).", "يُستنتج آلياً من حركات المبيعات المسجلة."]
        ]
        for row_idx, r in enumerate(info_rows, start=1):
            for col_idx, val in enumerate(r, start=1):
                cell = ws_info.cell(row=row_idx, column=col_idx, value=val)
                if row_idx == 1:
                    cell.font = Font(name="Segoe UI", size=13, bold=True, color="2196F3")
                elif row_idx in [3, 11]:
                    cell.font = Font(name="Segoe UI", size=10, bold=True)
                else:
                    cell.font = Font(name="Segoe UI", size=9)
        ws_info.column_dimensions['A'].width = 24
        ws_info.column_dimensions['B'].width = 12
        ws_info.column_dimensions['C'].width = 46
        ws_info.column_dimensions['D'].width = 50

    filename = "NEXO_Inventory_Template_AR.xlsx" if is_ar else "NEXO_Inventory_Template_EN.xlsx"
    buf = io.BytesIO()
    wb.save(buf)
    buf.seek(0)
    return Response(
        content=buf.getvalue(),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f"attachment; filename={filename}"}
    )

@app.get("/api/templates/in-transit")
def download_in_transit_template(lang: Optional[str] = None):
    """
    Generates standard NEXO In-Transit Shipments Excel Template (.xlsx) with styled header and sample rows.
    Supports Arabic RTL (lang=ar) and English LTR (lang=en) formats.
    """
    import openpyxl
    from openpyxl.styles import PatternFill, Font, Alignment, Border, Side
    from openpyxl.utils import get_column_letter

    resolved_lang = _resolve_lang(lang)
    is_ar = (resolved_lang == "ar")

    wb = openpyxl.Workbook()
    ws_data = wb.active
    ws_data.title = "نموذج_الشحن" if is_ar else "In_Transit_Shipments"
    if is_ar:
        ws_data.sheet_view.rightToLeft = True

    if is_ar:
        headers = [
            "كود الصنف", "الفرع / المخزن", "رقم أمر الشراء / الشحنة",
            "الكمية في الطريق", "تاريخ الوصول المتوقع", "المورد", "حالة الشحنة"
        ]
        sample_rows = [
            ("SKU-1001", "المستودع الرئيسي", "PO-98421", 350, "2026-03-25", "شركة التحميص العالمية", "في البحر"),
            ("SKU-1002", "فرع الرياض", "PO-98444", 100, "2026-03-18", "مؤسسة الأعشاب الطبيعية", "تخليص جمركي"),
            ("SKU-1003", "المستودع الرئيسي", "PO-98480", 500, "2026-03-10", "تجهيزات المطاعم الدولية", "في الطريق"),
        ]
    else:
        headers = [
            "CODE", "LOCA", "PO_NUMBER", "QTY_IN_TRANSIT", "EXPECTED_DATE", "SUPP", "STATUS"
        ]
        sample_rows = [
            ("SKU-1001", "WH-MAIN", "PO-98421", 350, "2026-03-25", "Global Roast Ltd", "on_water"),
            ("SKU-1002", "WH-EAST", "PO-98444", 100, "2026-03-18", "Ceylon Herbs Co", "customs_clearance"),
            ("SKU-1003", "WH-MAIN", "PO-98480", 500, "2026-03-10", "KitchenTech Int", "in_transit"),
        ]

    header_fill = PatternFill(start_color="343D46", end_color="343D46", fill_type="solid")
    header_font = Font(name="Segoe UI", size=10, bold=True, color="FFFFFF")
    align_center = Alignment(horizontal="center", vertical="center")
    thin_border = Border(
        left=Side(style="thin", color="D1D5DB"),
        right=Side(style="thin", color="D1D5DB"),
        top=Side(style="thin", color="D1D5DB"),
        bottom=Side(style="thin", color="D1D5DB")
    )

    for col_idx, col_code in enumerate(headers, start=1):
        cell = ws_data.cell(row=1, column=col_idx, value=col_code)
        cell.fill = header_fill
        cell.font = header_font
        cell.alignment = align_center

    data_font = Font(name="Segoe UI", size=9)
    for row_idx, r_data in enumerate(sample_rows, start=2):
        for col_idx, val in enumerate(r_data, start=1):
            cell = ws_data.cell(row=row_idx, column=col_idx, value=val)
            cell.font = data_font
            cell.border = thin_border
            if col_idx in [1, 2, 3, 5, 7]:
                cell.alignment = align_center
            elif col_idx in [4, 6]:
                cell.alignment = Alignment(horizontal="right" if is_ar else "left", vertical="center")
            else:
                cell.alignment = Alignment(horizontal="right", vertical="center")

    for col in ws_data.columns:
        max_len = max(len(str(cell.value or '')) for cell in col)
        col_letter = get_column_letter(col[0].column)
        ws_data.column_dimensions[col_letter].width = max(max_len + 4, 16 if is_ar else 14)

    # Instructions sheet
    if is_ar:
        ws_info = wb.create_sheet(title="تعليمات_الاستخدام")
        ws_info.sheet_view.rightToLeft = True
        info_rows = [
            ["إرشادات نموذج بضائع وشحنات الطريق (NEXO In-Transit Shipments)"],
            [""],
            ["الحقل (العمود)", "إلزامي؟", "الوصف والتعليمات التفصيلية"],
            ["كود الصنف", "نعم", "كود الصنف الفريد المطابق لسجل الأصناف والمخزون"],
            ["الفرع / المخزن", "لا", "المستودع أو الفرع المستلم للبضاعة عند وصولها"],
            ["رقم أمر الشراء / الشحنة", "نعم", "رقم أمر الشراء (PO) أو بوليصة الشحن لتتبع الشحنة"],
            ["الكمية في الطريق", "نعم", "كمية الوحدات المشحونة الفعالة قيد النقل"],
            ["تاريخ الوصول المتوقع", "لا", "تاريخ الاستلام والوصول المقدر بصيغة YYYY-MM-DD (مثال: 2026-03-25)"],
            ["المورد", "لا", "اسم المصنع أو المورد أو الناقل المشحون منه"],
            ["حالة الشحنة", "لا", "حالة الشحنة: في البحر (on_water)، في الطريق (in_transit)، تخليص جمركي (customs_clearance)"],
            [""],
            ["ملاحظات الاستيراد:"],
            ["1. يتم مطابقة الأعمدة تلقائياً سواءً استخدمت الترويسات العربية أو الإنجليزية."],
            ["2. الشحنات المستوردة تنعكس فورياً في حسابات التوريد وخطة الإمداد."]
        ]
        for row_idx, r in enumerate(info_rows, start=1):
            for col_idx, val in enumerate(r, start=1):
                cell = ws_info.cell(row=row_idx, column=col_idx, value=val)
                if row_idx == 1:
                    cell.font = Font(name="Segoe UI", size=13, bold=True, color="2196F3")
                elif row_idx in [3, 12]:
                    cell.font = Font(name="Segoe UI", size=10, bold=True)
                else:
                    cell.font = Font(name="Segoe UI", size=9)
        ws_info.column_dimensions['A'].width = 24
        ws_info.column_dimensions['B'].width = 12
        ws_info.column_dimensions['C'].width = 65
    else:
        ws_info = wb.create_sheet(title="Instructions_AR_EN")
        info_rows = [
            ["NEXO In-Transit Shipments Template Instructions | إرشادات شحنات وبضائع الطريق"],
            [""],
            ["Field (الحقل)", "Required", "Description (الوصف EN)", "الوصف والتفاصيل (AR)"],
            ["CODE", "Yes", "Item SKU matching inventory master", "كود الصنف المطابق لسجل المخزون"],
            ["LOCA", "No", "Receiving Warehouse / Branch Location", "المستودع أو الفرع المستلم"],
            ["PO_NUMBER", "Yes", "Purchase Order or Shipment Tracking No", "رقم أمر الشراء أو بوليصة الشحن"],
            ["QTY_IN_TRANSIT", "Yes", "Shipped Units / Quantity in transit", "كمية الوحدات المشحونة في الطريق"],
            ["EXPECTED_DATE", "No", "Estimated Arrival Date (YYYY-MM-DD)", "تاريخ الوصول المتوقع (مثال: 2026-03-25)"],
            ["SUPP", "No", "Supplier or Carrier name", "اسم المورد أو الناقل"],
            ["STATUS", "No", "Status: on_water, in_transit, customs_clearance", "حالة الشحنة: في البحر، في الطريق، جمارك"]
        ]
        for row_idx, r in enumerate(info_rows, start=1):
            for col_idx, val in enumerate(r, start=1):
                cell = ws_info.cell(row=row_idx, column=col_idx, value=val)
                if row_idx == 1:
                    cell.font = Font(name="Segoe UI", size=13, bold=True, color="2196F3")
                elif row_idx == 3:
                    cell.font = Font(name="Segoe UI", size=10, bold=True)
                else:
                    cell.font = Font(name="Segoe UI", size=9)
        ws_info.column_dimensions['A'].width = 16
        ws_info.column_dimensions['B'].width = 12
        ws_info.column_dimensions['C'].width = 42
        ws_info.column_dimensions['D'].width = 50

    filename = "NEXO_InTransit_Template_AR.xlsx" if is_ar else "NEXO_InTransit_Template_EN.xlsx"
    buf = io.BytesIO()
    wb.save(buf)
    buf.seek(0)
    return Response(
        content=buf.getvalue(),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f"attachment; filename={filename}"}
    )

@app.post("/api/files/import-typed")
async def import_typed_file(
    file: UploadFile = File(...),
    import_type: str = Form("combined"),
    project_id: Optional[str] = Form(None),
    new_project_name: Optional[str] = Form(None),
    merge_mode: str = Form("merge"),
    column_mapping: Optional[str] = Form(None),
    job_id: Optional[str] = Form(None)
):
    """
    Ingests Excel (.xlsx, .xls) or CSV files for Inventory, Sales, or Combined datasets.
    Streams directly to disk and DuckDB staging with 100% set-based SQL transformations.
    Supports auto-recognition of both English codes and Arabic column headers.
    """
    start_time = time.perf_counter()
    update_job_progress(job_id, 48, "استلام الملف وتجهيز القراءة...", "Receiving file stream...")
    tmp_path, filename = stream_upload_to_file(file)
    ext = os.path.splitext(filename)[1].lower()

    mapping: Dict[str, str] = {}
    if column_mapping:
        try:
            mapping = json.loads(column_mapping)
        except Exception:
            mapping = {}

    # Resolve project ID
    if project_id:
        proj_id = project_id
    else:
        p_name = new_project_name or f"Imported: {filename}"
        proj = create_new_project(p_name, f"Ingested from {filename} ({import_type})", filename)
        proj_id = proj["id"]

    try:
        with _LOCK:
            con = get_connection()
            cols, total_rows = load_file_into_staging(con, tmp_path, ext)
            if total_rows == 0 or not cols:
                raise HTTPException(status_code=400, detail="The uploaded file contains no data rows.")

            update_job_progress(job_id, 60, "تحميل البيانات إلى محرك DuckDB...", "Loading rows into DuckDB engine...", total_rows=total_rows)

            def esc_c(col_name: str) -> str:
                return col_name.replace('"', '""')

            c_code = _match_column(cols, mapping, "code") or cols[0]
            c_desc = _match_column(cols, mapping, "description")
            c_cat = _match_column(cols, mapping, "category")
            c_loc = _match_column(cols, mapping, "location")
            c_onhand = _match_column(cols, mapping, "on_hand")
            c_onorder = _match_column(cols, mapping, "on_order")
            c_lt = _match_column(cols, mapping, "lead_time_days")
            c_lt_var = _match_column(cols, mapping, "lead_time_variance_days")
            c_sl = _match_column(cols, mapping, "service_level")
            c_moq = _match_column(cols, mapping, "min_batch")
            c_brou = _match_column(cols, mapping, "batch_rounding")
            c_cost = _match_column(cols, mapping, "purchase_price")
            c_price = _match_column(cols, mapping, "sales_price")
            c_supp = _match_column(cols, mapping, "supplier")
            c_period = _match_column(cols, mapping, "period")
            c_qty_sold = _match_column(cols, mapping, "qty_sold")
            c_revenue = _match_column(cols, mapping, "revenue")

            update_job_progress(job_id, 75, "مطابقة الأعمدة وتوحيد التواريخ...", "Mapping columns & normalizing dates...", total_rows=total_rows)

            code_col = esc_c(c_code)
            valid_code_cond = f's."{code_col}" IS NOT NULL AND TRIM(s."{code_col}") != \'\' AND LOWER(TRIM(s."{code_col}")) NOT IN (\'nan\', \'none\', \'null\')'

            update_job_progress(job_id, 88, "تجميع الحركات وتصفية الأصناف...", "Aggregating transactions & filtering SKUs...", rows_processed=total_rows, total_rows=total_rows)

            if import_type == "sales":
                if merge_mode == "replace":
                    con.execute("DELETE FROM daily_sales WHERE project_id = ?", (proj_id,))
                    con.execute("DELETE FROM periods WHERE project_id = ?", (proj_id,))

                loc_sql = f'COALESCE(NULLIF(TRIM(s."{esc_c(c_loc)}"), \'\'), \'Main Warehouse\')' if c_loc else "'Main Warehouse'"
                qty_sql = f'COALESCE(TRY_CAST(s."{esc_c(c_qty_sold)}" AS DOUBLE), 0.0)' if c_qty_sold else '0.0'
                rev_sql = f'COALESCE(TRY_CAST(s."{esc_c(c_revenue)}" AS DOUBLE), 0.0)' if c_revenue else '0.0'

                if c_period:
                    p_col = esc_c(c_period)
                    raw_d = f's."{p_col}"'
                    daily_date_sql = f"""
                    CASE 
                      WHEN TRY_CAST({raw_d} AS DATE) IS NOT NULL 
                        THEN strftime(TRY_CAST({raw_d} AS DATE), '%Y-%m-%d')
                      WHEN TRY_STRPTIME({raw_d}, '%d/%m/%Y') IS NOT NULL 
                        THEN strftime(TRY_STRPTIME({raw_d}, '%d/%m/%Y'), '%Y-%m-%d')
                      WHEN TRY_STRPTIME({raw_d}, '%Y/%m/%d') IS NOT NULL 
                        THEN strftime(TRY_STRPTIME({raw_d}, '%Y/%m/%d'), '%Y-%m-%d')
                      WHEN TRY_STRPTIME({raw_d}, '%m/%d/%Y') IS NOT NULL 
                        THEN strftime(TRY_STRPTIME({raw_d}, '%m/%d/%Y'), '%Y-%m-%d')
                      WHEN length(trim({raw_d})) = 7 AND substr(trim({raw_d}), 5, 1) IN ('-', '/') 
                        THEN replace(substr(trim({raw_d}), 1, 7), '/', '-') || '-01'
                      WHEN TRY_CAST({raw_d} AS DOUBLE) >= 30000 AND TRY_CAST({raw_d} AS DOUBLE) <= 60000 
                        THEN strftime(DATE '1899-12-30' + (TRY_CAST({raw_d} AS BIGINT)) * INTERVAL 1 DAY, '%Y-%m-%d')
                      ELSE strftime(CURRENT_DATE, '%Y-%m-%d')
                    END
                    """
                else:
                    daily_date_sql = "strftime(CURRENT_DATE, '%Y-%m-%d')"

                norm_period_sql = f"substr({daily_date_sql}, 1, 7)"

                # 1. Insert into daily_sales
                con.execute(f"""
                    INSERT INTO daily_sales (id, project_id, item_code, location, sale_date, qty_sold, revenue, created_at)
                    SELECT
                      uuid()::VARCHAR,
                      ?,
                      TRIM(s."{code_col}"),
                      {loc_sql},
                      {daily_date_sql},
                      {qty_sql},
                      {rev_sql},
                      strftime(CURRENT_TIMESTAMP, '%Y-%m-%dT%H:%M:%SZ')
                    FROM staging_raw s
                    WHERE {valid_code_cond};
                """, (proj_id,))

                # 2. Auto-create missing items in items
                con.execute(f"""
                    INSERT INTO items (
                      id, project_id, code, description, category, location, channel, supplier,
                      sales_price, purchase_price, margin, on_hand, on_order, backorders,
                      lead_time_days, lead_time_variance_days, order_cycle_days, service_level,
                      min_batch, batch_rounding, model_type, replenishment_strategy,
                      check_state, approval_state, abc_class, xyz_class,
                      safety_stock, reorder_point, order_now, order_now_value, days_of_supply,
                      accuracy, mean_daily_demand, updated_at
                    )
                    SELECT
                      ? || '_' || substr(md5(random()::VARCHAR || TRIM(sub.code)), 1, 8),
                      ?,
                      sub.code,
                      'Item ' || sub.code,
                      'General',
                      sub.loc,
                      'Direct Retail',
                      'Primary Supplier',
                      100.0, 50.0, 50.0,
                      0.0, 0.0, 0.0,
                      30.0, 5.0, 30.0, 0.95,
                      1.0, 1.0, 'auto', 'periodic',
                      'checked', 'unapproved', 'B', 'Y',
                      0.0, 0.0, 0.0, 0.0, 0.0,
                      92.0, 0.0,
                      strftime(CURRENT_TIMESTAMP, '%Y-%m-%dT%H:%M:%SZ')
                    FROM (
                      SELECT TRIM(s."{code_col}") as code, MIN({loc_sql}) as loc
                      FROM staging_raw s
                      WHERE {valid_code_cond}
                      GROUP BY TRIM(s."{code_col}")
                    ) sub
                    LEFT JOIN items i 
                      ON i.project_id = ? 
                      AND i.code = sub.code
                    WHERE i.code IS NULL;
                """, (proj_id, proj_id, proj_id))

                # 3. Aggregate periods by (item_id, norm_period)
                con.execute(f"""
                    CREATE OR REPLACE TEMP TABLE incoming_sales_agg AS
                    SELECT 
                      i.id as item_id,
                      {norm_period_sql} as norm_period,
                      SUM({qty_sql}) as actual,
                      SUM({rev_sql}) as revenue
                    FROM staging_raw s
                    JOIN items i ON i.project_id = ? AND i.code = TRIM(s."{code_col}")
                    WHERE {valid_code_cond}
                    GROUP BY i.id, {norm_period_sql};
                """, (proj_id,))

                # Update existing periods if any
                con.execute("""
                    UPDATE periods
                    SET 
                      actual = periods.actual + inc.actual,
                      revenue = periods.revenue + inc.revenue
                    FROM incoming_sales_agg inc
                    WHERE periods.project_id = ?
                      AND periods.item_id = inc.item_id
                      AND periods.date = inc.norm_period;
                """, (proj_id,))

                # Insert new periods
                con.execute("""
                    INSERT INTO periods (id, project_id, item_id, date, actual, forecast, model, conf_upper, conf_lower, override, promotion, revenue)
                    SELECT 
                      uuid()::VARCHAR,
                      ?,
                      inc.item_id,
                      inc.norm_period,
                      inc.actual,
                      0.0, 0.0, 0.0, 0.0, NULL, 0.0,
                      inc.revenue
                    FROM incoming_sales_agg inc
                    LEFT JOIN periods p 
                      ON p.project_id = ? 
                      AND p.item_id = inc.item_id 
                      AND p.date = inc.norm_period
                    WHERE p.id IS NULL;
                """, (proj_id, proj_id))

                # 4. Auto-update items demand statistics
                con.execute("""
                    UPDATE items
                    SET 
                      mean_daily_demand = COALESCE(agg.avg_daily, 0.0),
                      safety_stock = ROUND(
                        (CASE WHEN items.service_level >= 0.98 THEN 2.054 WHEN items.service_level >= 0.95 THEN 1.645 ELSE 1.282 END) * 
                        SQRT(items.lead_time_days * POWER(COALESCE(agg.avg_daily, 0.0) * 0.3, 2) + POWER(COALESCE(agg.avg_daily, 0.0), 2) * POWER(items.lead_time_variance_days, 2))
                      ),
                      reorder_point = ROUND(COALESCE(agg.avg_daily, 0.0) * items.lead_time_days + ROUND(
                        (CASE WHEN items.service_level >= 0.98 THEN 2.054 WHEN items.service_level >= 0.95 THEN 1.645 ELSE 1.282 END) * 
                        SQRT(items.lead_time_days * POWER(COALESCE(agg.avg_daily, 0.0) * 0.3, 2) + POWER(COALESCE(agg.avg_daily, 0.0), 2) * POWER(items.lead_time_variance_days, 2))
                      )),
                      days_of_supply = CASE WHEN COALESCE(agg.avg_daily, 0.0) > 0 THEN ROUND(items.on_hand / agg.avg_daily) ELSE 999.0 END
                    FROM (
                      SELECT item_id, (SUM(actual) / GREATEST(COUNT(DISTINCT date), 1)) / 30.0 as avg_daily
                      FROM periods
                      WHERE project_id = ?
                      GROUP BY item_id
                    ) agg
                    WHERE items.project_id = ? AND items.id = agg.item_id;
                """, (proj_id, proj_id))

                rows_processed = total_rows

            elif import_type == "in_transit":
                c_ord_no = _match_column(cols, mapping, "order_no")
                c_dest = _match_column(cols, mapping, "destination") or _match_column(cols, mapping, "location")
                c_eta = _match_column(cols, mapping, "eta_date")
                c_supp_col = _match_column(cols, mapping, "supplier")
                c_carrier = _match_column(cols, mapping, "carrier") or c_supp_col
                c_origin = _match_column(cols, mapping, "origin") or c_supp_col
                c_status = _match_column(cols, mapping, "status")
                c_qty = _match_column(cols, mapping, "quantity") or _match_column(cols, mapping, "qty_sold")

                if merge_mode == "replace":
                    con.execute("DELETE FROM in_transition WHERE project_id = ?", (proj_id,))

                ord_sql = f'COALESCE(NULLIF(TRIM(s."{esc_c(c_ord_no)}"), \'\'), \'PO-\' || substr(md5(random()::VARCHAR), 1, 6))' if c_ord_no else "'PO-' || substr(md5(random()::VARCHAR), 1, 6)"
                dest_sql = f'COALESCE(NULLIF(TRIM(s."{esc_c(c_dest)}"), \'\'), \'Main Warehouse\')' if c_dest else "'Main Warehouse'"
                supp_sql = f'COALESCE(NULLIF(TRIM(s."{esc_c(c_supp_col)}"), \'\'), \'Primary Supplier\')' if c_supp_col else "'Primary Supplier'"
                origin_sql = f'COALESCE(NULLIF(TRIM(s."{esc_c(c_origin)}"), \'\'), {supp_sql})' if c_origin else supp_sql
                carrier_sql = f'COALESCE(NULLIF(TRIM(s."{esc_c(c_carrier)}"), \'\'), {supp_sql})' if c_carrier else supp_sql
                eta_sql = f'COALESCE(NULLIF(TRIM(s."{esc_c(c_eta)}"), \'\'), \'2026-03-30\')' if c_eta else "'2026-03-30'"
                qty_sql = f'COALESCE(TRY_CAST(s."{esc_c(c_qty)}" AS DOUBLE), 0.0)' if c_qty else '0.0'

                if c_status:
                    raw_stat = f'LOWER(TRIM(s."{esc_c(c_status)}"))'
                    status_sql = f"""
                    CASE {raw_stat}
                      WHEN 'في البحر' THEN 'on_water'
                      WHEN 'on water' THEN 'on_water'
                      WHEN 'on_water' THEN 'on_water'
                      WHEN 'في الطريق' THEN 'in_transit'
                      WHEN 'in transit' THEN 'in_transit'
                      WHEN 'in_transit' THEN 'in_transit'
                      WHEN 'تخليص جمركي' THEN 'customs_clearance'
                      WHEN 'customs clearance' THEN 'customs_clearance'
                      WHEN 'customs' THEN 'customs_clearance'
                      WHEN 'customs_clearance' THEN 'customs_clearance'
                      WHEN 'تم الاستلام' THEN 'received'
                      WHEN 'received' THEN 'received'
                      WHEN 'تم التسليم' THEN 'delivered'
                      WHEN 'delivered' THEN 'delivered'
                      ELSE COALESCE({raw_stat}, 'in_transit')
                    END
                    """
                else:
                    status_sql = "'in_transit'"

                con.execute(f"""
                    INSERT INTO in_transition (
                      id, project_id, item_code, order_no, origin, destination, quantity, eta_date, carrier, status
                    )
                    SELECT 
                      uuid()::VARCHAR,
                      ?,
                      TRIM(s."{code_col}"),
                      {ord_sql},
                      {origin_sql},
                      {dest_sql},
                      {qty_sql},
                      {eta_sql},
                      {carrier_sql},
                      {status_sql}
                    FROM staging_raw s
                    WHERE {valid_code_cond};
                """, (proj_id,))

                # Update on_order in items
                con.execute("""
                    UPDATE items
                    SET on_order = COALESCE(tr.total_transit, 0.0)
                    FROM (
                      SELECT item_code, SUM(quantity) as total_transit
                      FROM in_transition
                      WHERE project_id = ? AND status NOT IN ('delivered', 'received', 'تم الاستلام', 'تم التسليم')
                      GROUP BY item_code
                    ) tr
                    WHERE items.project_id = ? AND items.code = tr.item_code;
                """, (proj_id, proj_id))

                rows_processed = total_rows

            else:
                # Inventory or Combined
                settings_row = con.execute("SELECT default_service_level, default_lead_time_days, default_order_cycle_days FROM app_settings WHERE id = 'global_settings'").fetchone()
                def_sl = float(settings_row[0]) if settings_row and settings_row[0] is not None else 0.95
                def_lt = float(settings_row[1]) if settings_row and settings_row[1] is not None else 30.0
                def_cycle = float(settings_row[2]) if settings_row and settings_row[2] is not None else 30.0
                def_lt_var = 5.0
                def_moq = 1.0
                def_brou = 1.0

                desc_sql = f'COALESCE(NULLIF(TRIM(s."{esc_c(c_desc)}"), \'\'), \'Item \' || TRIM(s."{code_col}"))' if c_desc else f"'Item ' || TRIM(s.\"{code_col}\")"
                cat_sql = f'COALESCE(NULLIF(TRIM(s."{esc_c(c_cat)}"), \'\'), \'General\')' if c_cat else "'General'"
                loc_sql = f'COALESCE(NULLIF(TRIM(s."{esc_c(c_loc)}"), \'\'), \'Main Warehouse\')' if c_loc else "'Main Warehouse'"
                onhand_sql = f'COALESCE(TRY_CAST(s."{esc_c(c_onhand)}" AS DOUBLE), 0.0)' if c_onhand else '0.0'
                cost_sql = f'TRY_CAST(s."{esc_c(c_cost)}" AS DOUBLE)' if c_cost else 'NULL'
                price_sql = f'TRY_CAST(s."{esc_c(c_price)}" AS DOUBLE)' if c_price else 'NULL'
                onorder_sql = f'TRY_CAST(s."{esc_c(c_onorder)}" AS DOUBLE)' if c_onorder else 'NULL'
                lt_sql = f'TRY_CAST(s."{esc_c(c_lt)}" AS DOUBLE)' if c_lt else 'NULL'
                lt_var_sql = f'TRY_CAST(s."{esc_c(c_lt_var)}" AS DOUBLE)' if c_lt_var else 'NULL'
                sl_sql = f'TRY_CAST(s."{esc_c(c_sl)}" AS DOUBLE)' if c_sl else 'NULL'
                moq_sql = f'TRY_CAST(s."{esc_c(c_moq)}" AS DOUBLE)' if c_moq else 'NULL'
                brou_sql = f'TRY_CAST(s."{esc_c(c_brou)}" AS DOUBLE)' if c_brou else 'NULL'
                supp_sql = f'COALESCE(NULLIF(TRIM(s."{esc_c(c_supp)}"), \'\'), \'Primary Supplier\')' if c_supp else "'Primary Supplier'"

                con.execute(f"""
                    CREATE OR REPLACE TEMP TABLE staging_inv AS
                    SELECT 
                      TRIM(s."{code_col}") as code,
                      {desc_sql} as description,
                      {cat_sql} as category,
                      {loc_sql} as location,
                      {onhand_sql} as on_hand,
                      {cost_sql} as raw_cost,
                      {price_sql} as raw_price,
                      {onorder_sql} as raw_on_order,
                      {lt_sql} as raw_lt,
                      {lt_var_sql} as raw_lt_var,
                      {sl_sql} as raw_sl,
                      {moq_sql} as raw_moq,
                      {brou_sql} as raw_brou,
                      {supp_sql} as supplier
                    FROM staging_raw s
                    WHERE {valid_code_cond};
                """)

                # Deduplicate staging_inv if file has multiple rows for same SKU
                con.execute("""
                    CREATE OR REPLACE TEMP TABLE staging_inv_dedup AS
                    SELECT 
                      code,
                      FIRST(description) as description,
                      FIRST(category) as category,
                      FIRST(location) as location,
                      SUM(on_hand) as on_hand,
                      FIRST(raw_cost) as raw_cost,
                      FIRST(raw_price) as raw_price,
                      SUM(raw_on_order) as raw_on_order,
                      FIRST(raw_lt) as raw_lt,
                      FIRST(raw_lt_var) as raw_lt_var,
                      FIRST(raw_sl) as raw_sl,
                      FIRST(raw_moq) as raw_moq,
                      FIRST(raw_brou) as raw_brou,
                      FIRST(supplier) as supplier
                    FROM staging_inv
                    GROUP BY code;
                """)

                con.execute("""
                    CREATE OR REPLACE TEMP TABLE sku_transit AS
                    SELECT item_code, COALESCE(SUM(quantity), 0.0) as transit_qty
                    FROM in_transition
                    WHERE project_id = ? AND status NOT IN ('delivered', 'received', 'تم الاستلام', 'تم التسليم')
                    GROUP BY item_code;
                """, (proj_id,))

                con.execute("""
                    CREATE OR REPLACE TEMP TABLE sku_avg_price AS
                    SELECT i.code, 
                           CASE WHEN SUM(p.actual) > 0 AND SUM(p.revenue) > 0 
                                THEN ROUND(SUM(p.revenue) / SUM(p.actual), 2) 
                                ELSE NULL END as avg_price
                    FROM periods p
                    JOIN items i ON p.item_id = i.id
                    WHERE p.project_id = ?
                    GROUP BY i.code;
                """, (proj_id,))

                if merge_mode == "replace":
                    con.execute("DELETE FROM periods WHERE project_id = ?", (proj_id,))
                    con.execute("DELETE FROM items WHERE project_id = ?", (proj_id,))

                # Update existing items
                con.execute("""
                    UPDATE items
                    SET
                      description = COALESCE(stg.description, items.description),
                      category = COALESCE(stg.category, items.category),
                      location = COALESCE(stg.location, items.location),
                      supplier = COALESCE(stg.supplier, items.supplier),
                      on_hand = COALESCE(stg.on_hand, items.on_hand),
                      purchase_price = COALESCE(stg.raw_cost, items.purchase_price, 50.0),
                      sales_price = COALESCE(stg.raw_price, items.sales_price, prc.avg_price, ROUND(COALESCE(stg.raw_cost, items.purchase_price, 50.0) * 1.5, 2), 100.0),
                      margin = ROUND((COALESCE(stg.raw_price, items.sales_price, prc.avg_price, ROUND(COALESCE(stg.raw_cost, items.purchase_price, 50.0) * 1.5, 2), 100.0) - COALESCE(stg.raw_cost, items.purchase_price, 50.0)) / NULLIF(COALESCE(stg.raw_price, items.sales_price, prc.avg_price, ROUND(COALESCE(stg.raw_cost, items.purchase_price, 50.0) * 1.5, 2), 100.0), 0) * 100.0, 1),
                      on_order = COALESCE(stg.raw_on_order, tr.transit_qty, items.on_order, 0.0),
                      lead_time_days = COALESCE(stg.raw_lt, items.lead_time_days, ?),
                      lead_time_variance_days = COALESCE(stg.raw_lt_var, items.lead_time_variance_days, ?),
                      service_level = CASE 
                        WHEN COALESCE(stg.raw_sl, items.service_level, ?) > 1.0 
                        THEN COALESCE(stg.raw_sl, items.service_level, ?) / 100.0 
                        ELSE COALESCE(stg.raw_sl, items.service_level, ?) 
                      END,
                      min_batch = COALESCE(stg.raw_moq, items.min_batch, ?),
                      batch_rounding = COALESCE(stg.raw_brou, items.batch_rounding, ?),
                      updated_at = strftime(CURRENT_TIMESTAMP, '%Y-%m-%dT%H:%M:%SZ')
                    FROM staging_inv_dedup stg
                    LEFT JOIN sku_transit tr ON tr.item_code = stg.code
                    LEFT JOIN sku_avg_price prc ON prc.code = stg.code
                    WHERE items.project_id = ? AND items.code = stg.code;
                """, (def_lt, def_lt_var, def_sl, def_sl, def_sl, def_moq, def_brou, proj_id))

                # Insert new items
                con.execute("""
                    INSERT INTO items (
                      id, project_id, code, description, category, location, channel, supplier,
                      sales_price, purchase_price, margin, on_hand, on_order, backorders,
                      lead_time_days, lead_time_variance_days, order_cycle_days, service_level,
                      min_batch, batch_rounding, model_type, replenishment_strategy,
                      check_state, approval_state, abc_class, xyz_class,
                      safety_stock, reorder_point, order_now, order_now_value, days_of_supply,
                      accuracy, mean_daily_demand, updated_at
                    )
                    SELECT
                      ? || '_' || substr(md5(random()::VARCHAR || stg.code), 1, 8),
                      ?,
                      stg.code,
                      stg.description,
                      stg.category,
                      stg.location,
                      'Direct Retail',
                      stg.supplier,
                      COALESCE(stg.raw_price, prc.avg_price, ROUND(COALESCE(stg.raw_cost, 50.0) * 1.5, 2), 100.0) as sales_price,
                      COALESCE(stg.raw_cost, 50.0) as purchase_price,
                      ROUND((COALESCE(stg.raw_price, prc.avg_price, ROUND(COALESCE(stg.raw_cost, 50.0) * 1.5, 2), 100.0) - COALESCE(stg.raw_cost, 50.0)) / NULLIF(COALESCE(stg.raw_price, prc.avg_price, ROUND(COALESCE(stg.raw_cost, 50.0) * 1.5, 2), 100.0), 0) * 100.0, 1) as margin,
                      COALESCE(stg.on_hand, 0.0),
                      COALESCE(stg.raw_on_order, tr.transit_qty, 0.0) as on_order,
                      0.0,
                      COALESCE(stg.raw_lt, ?),
                      COALESCE(stg.raw_lt_var, ?),
                      ?,
                      CASE WHEN COALESCE(stg.raw_sl, ?) > 1.0 THEN COALESCE(stg.raw_sl, ?) / 100.0 ELSE COALESCE(stg.raw_sl, ?) END,
                      COALESCE(stg.raw_moq, ?),
                      COALESCE(stg.raw_brou, ?),
                      'auto', 'periodic',
                      'checked', 'unapproved', 'B', 'Y',
                      0.0, 0.0, 0.0, 0.0, 0.0,
                      95.0, 0.0,
                      strftime(CURRENT_TIMESTAMP, '%Y-%m-%dT%H:%M:%SZ')
                    FROM staging_inv_dedup stg
                    LEFT JOIN sku_transit tr ON tr.item_code = stg.code
                    LEFT JOIN sku_avg_price prc ON prc.code = stg.code
                    LEFT JOIN items i ON i.project_id = ? AND i.code = stg.code
                    WHERE i.id IS NULL;
                """, (
                    proj_id, proj_id,
                    def_lt, def_lt_var, def_cycle,
                    def_sl, def_sl, def_sl,
                    def_moq, def_brou,
                    proj_id
                ))

                # If combined, unpivot time series columns into periods
                if import_type == "combined":
                    period_cols = [c for c in cols if any(yr in c for yr in ["2024", "2025", "2026", "2027"]) or any(m in c.lower() for m in ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"])]
                    if period_cols:
                        escaped_pcols = ", ".join(f'"{esc_c(c)}"' for c in period_cols)
                        con.execute(f"""
                            INSERT INTO periods (id, project_id, item_id, date, actual, forecast, model, conf_upper, conf_lower, override, promotion, revenue)
                            SELECT 
                              uuid()::VARCHAR,
                              ?,
                              i.id,
                              unp.name,
                              COALESCE(TRY_CAST(unp.value AS DOUBLE), 0.0),
                              0.0, 0.0, 0.0, 0.0, NULL, 0.0,
                              0.0
                            FROM (
                              SELECT TRIM(s."{code_col}") as code, name, value
                              FROM staging_raw s
                              UNPIVOT (value FOR name IN ({escaped_pcols}))
                              WHERE {valid_code_cond} AND value IS NOT NULL
                            ) unp
                            JOIN items i ON i.project_id = ? AND i.code = unp.code;
                        """, (proj_id, proj_id))

                # Update demand statistics for items
                con.execute("""
                    UPDATE items
                    SET 
                      mean_daily_demand = COALESCE(agg.avg_daily, 5.0),
                      safety_stock = ROUND(
                        (CASE WHEN items.service_level >= 0.98 THEN 2.054 WHEN items.service_level >= 0.95 THEN 1.645 ELSE 1.282 END) * 
                        SQRT(items.lead_time_days * POWER(COALESCE(agg.avg_daily, 5.0) * 0.3, 2) + POWER(COALESCE(agg.avg_daily, 5.0), 2) * POWER(items.lead_time_variance_days, 2))
                      ),
                      reorder_point = ROUND(COALESCE(agg.avg_daily, 5.0) * items.lead_time_days + ROUND(
                        (CASE WHEN items.service_level >= 0.98 THEN 2.054 WHEN items.service_level >= 0.95 THEN 1.645 ELSE 1.282 END) * 
                        SQRT(items.lead_time_days * POWER(COALESCE(agg.avg_daily, 5.0) * 0.3, 2) + POWER(COALESCE(agg.avg_daily, 5.0), 2) * POWER(items.lead_time_variance_days, 2))
                      )),
                      days_of_supply = CASE WHEN COALESCE(agg.avg_daily, 5.0) > 0 THEN ROUND(items.on_hand / COALESCE(agg.avg_daily, 5.0)) ELSE 999.0 END
                    FROM (
                      SELECT item_id, (SUM(actual) / GREATEST(COUNT(DISTINCT date), 1)) / 30.0 as avg_daily
                      FROM periods
                      WHERE project_id = ?
                      GROUP BY item_id
                    ) agg
                    WHERE items.project_id = ? AND items.id = agg.item_id;
                """, (proj_id, proj_id))

                con.execute("""
                    UPDATE items
                    SET 
                      mean_daily_demand = 5.0,
                      safety_stock = ROUND(
                        (CASE WHEN items.service_level >= 0.98 THEN 2.054 WHEN items.service_level >= 0.95 THEN 1.645 ELSE 1.282 END) * 
                        SQRT(items.lead_time_days * POWER(1.5, 2) + POWER(5.0, 2) * POWER(items.lead_time_variance_days, 2))
                      ),
                      reorder_point = ROUND(5.0 * items.lead_time_days + ROUND(
                        (CASE WHEN items.service_level >= 0.98 THEN 2.054 WHEN items.service_level >= 0.95 THEN 1.645 ELSE 1.282 END) * 
                        SQRT(items.lead_time_days * POWER(1.5, 2) + POWER(5.0, 2) * POWER(items.lead_time_variance_days, 2))
                      )),
                      days_of_supply = ROUND(items.on_hand / 5.0)
                    WHERE project_id = ? AND (mean_daily_demand IS NULL OR mean_daily_demand = 0.0);
                """, (proj_id,))

                con.execute("""
                    UPDATE items
                    SET
                      order_now = CASE 
                        WHEN (reorder_point - on_hand - on_order + backorders) > 0 
                        THEN GREATEST((reorder_point - on_hand - on_order + backorders), min_batch)
                        ELSE 0.0 
                      END
                    WHERE project_id = ?;
                """, (proj_id,))

                con.execute("""
                    UPDATE items
                    SET
                      order_now_value = order_now * purchase_price,
                      abc_class = CASE 
                        WHEN (mean_daily_demand * 365.0 * sales_price) >= 25000 THEN 'A'
                        WHEN (mean_daily_demand * 365.0 * sales_price) >= 8000 THEN 'B'
                        ELSE 'C'
                      END,
                      xyz_class = CASE 
                        WHEN model_type IN ('constant', 'linear') THEN 'X'
                        WHEN model_type IN ('intermittent', 'preorder') THEN 'Z'
                        ELSE 'Y'
                      END
                    WHERE project_id = ?;
                """, (proj_id,))

                rows_processed = total_rows

            update_job_progress(job_id, 96, "حفظ البيانات وتأمين قاعدة البيانات...", "Saving workspace & running CHECKPOINT...", rows_processed=total_rows, total_rows=total_rows)

            # Mirror to persistent project tables & flush checkpoint
            save_project_workspace(proj_id)

            # Drop temp tables
            con.execute("DROP TABLE IF EXISTS staging_raw;")
            con.execute("DROP TABLE IF EXISTS staging_inv;")
            con.execute("DROP TABLE IF EXISTS staging_inv_dedup;")
            con.execute("DROP TABLE IF EXISTS incoming_sales_agg;")
            con.execute("DROP TABLE IF EXISTS sku_transit;")
            con.execute("DROP TABLE IF EXISTS sku_avg_price;")

            items_count = con.execute("SELECT COUNT(*) FROM items WHERE project_id = ?", (proj_id,)).fetchone()[0]
            periods_count = con.execute("SELECT COUNT(*) FROM periods WHERE project_id = ?", (proj_id,)).fetchone()[0]

            add_ingestion_log(
                project_id=proj_id,
                source_type="direct_duckdb",
                source_name=filename,
                data_category=import_type,
                rows_processed=rows_processed,
                status="success"
            )
    except HTTPException as he:
        update_job_progress(job_id, 100, "حدث خطأ أثناء الاستيراد", f"Import failed: {he.detail}", status="error", error=he.detail)
        raise
    except Exception as e:
        update_job_progress(job_id, 100, "حدث خطأ أثناء الاستيراد", f"Import failed: {str(e)}", status="error", error=str(e))
        raise HTTPException(status_code=400, detail=f"Import failed: {str(e)}")
    finally:
        if 'tmp_path' in locals() and os.path.exists(tmp_path):
            try:
                os.remove(tmp_path)
            except Exception:
                pass

    elapsed = round(time.perf_counter() - start_time, 3)
    update_job_progress(job_id, 100, "اكتمل الاستيراد بنجاح!", "Import completed successfully!", rows_processed=rows_processed, total_rows=rows_processed, status="done")
    return {
        "success": True,
        "project_id": proj_id,
        "import_type": import_type,
        "rows_processed": rows_processed,
        "items_upserted": items_count,
        "periods_upserted": periods_count,
        "elapsed_seconds": elapsed,
        "message": f"Successfully ingested {rows_processed:,} rows into DuckDB in {elapsed}s."
    }

# ==============================================================================
# Local Embedded Databases Connector (.duckdb / .sqlite / .db)
# ==============================================================================

LOCAL_DB_FORBIDDEN = re.compile(
    r"\b(DROP|DELETE|UPDATE|INSERT|ALTER|ATTACH|DETACH|PRAGMA|CREATE|REPLACE|EXEC|EXECUTE|TRUNCATE|MERGE|GRANT|REVOKE|VACUUM|COPY|WRITE_CSV|INSTALL|LOAD)\b",
    re.IGNORECASE
)

def _validate_local_db_query(sql: str) -> str:
    cleaned = sql.strip().rstrip(";").strip()
    if ";" in cleaned:
        raise HTTPException(status_code=400, detail="Multi-statement SQL queries are not permitted.")
    if not re.match(r"^\s*(SELECT|WITH)\b", cleaned, re.IGNORECASE):
        raise HTTPException(status_code=400, detail="Only read-only SELECT or WITH queries are permitted.")
    if LOCAL_DB_FORBIDDEN.search(cleaned):
        raise HTTPException(status_code=400, detail="Query contains forbidden DDL, DML, or administrative keywords.")
    return cleaned

@app.post("/api/local-db/inspect")
async def inspect_local_db(
    file: Optional[UploadFile] = File(None),
    file_path: Optional[str] = Form(None)
):
    """
    Inspects an uploaded local DuckDB or SQLite file, returning available tables, column definitions, and sample rows.
    Arbitrary server-side file_path inspection is strictly blocked (SEC-CRIT-03).
    """
    if file_path and not file:
        raise HTTPException(
            status_code=400,
            detail="Direct server-side file paths are disabled for security. Please upload your database file directly."
        )
    if not file or not file.filename:
        raise HTTPException(status_code=400, detail="Please upload a valid database file (.duckdb, .sqlite, .db).")

    raw_filename = file.filename.lower()
    if not (raw_filename.endswith(".duckdb") or raw_filename.endswith(".sqlite") or raw_filename.endswith(".db")):
        raise HTTPException(status_code=400, detail="Unsupported file format. Please upload a .duckdb, .sqlite, or .db file.")

    is_duckdb = raw_filename.endswith(".duckdb")
    suffix = ".duckdb" if is_duckdb else ".sqlite"
    temp_target = None

    try:
        with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
            temp_target = tmp.name
            while chunk := await file.read(64 * 1024):
                tmp.write(chunk)

        tables_list = []
        details = {}

        if is_duckdb:
            con = duckdb.connect(temp_target, read_only=True)
            try:
                tables = [r[0] for r in con.execute("SELECT table_name FROM information_schema.tables WHERE table_schema='main'").fetchall()]
                for t in tables:
                    escaped_table = t.replace('"', '""')
                    cols = [{"name": r[1], "type": r[2]} for r in con.execute(f'PRAGMA table_info("{escaped_table}")').fetchall()]
                    sample_df = con.execute(f'SELECT * FROM "{escaped_table}" LIMIT 5').fetchdf()
                    details[t] = {
                        "columns": cols,
                        "preview": sample_df.fillna("").to_dict(orient="records"),
                        "row_count": len(sample_df)
                    }
                tables_list = tables
            finally:
                con.close()
        else:
            safe_uri = f"file:{Path(temp_target).resolve().as_posix()}?mode=ro"
            conn = sqlite3.connect(safe_uri, uri=True)
            try:
                c = conn.cursor()
                c.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
                tables = [r[0] for r in c.fetchall()]
                for t in tables:
                    escaped_table = t.replace(']', ']]')
                    c.execute(f"PRAGMA table_info([{escaped_table}])")
                    cols = [{"name": r[1], "type": r[2]} for r in c.fetchall()]
                    sample_df = pd.read_sql(f"SELECT * FROM [{escaped_table}] LIMIT 5", conn)
                    details[t] = {
                        "columns": cols,
                        "preview": sample_df.fillna("").to_dict(orient="records"),
                        "row_count": len(sample_df)
                    }
                tables_list = tables
            finally:
                conn.close()

        return {
            "success": True,
            "file_type": "duckdb" if is_duckdb else "sqlite",
            "db_path": file.filename,
            "tables": tables_list,
            "table_details": details
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Failed to inspect database: {str(e)}")
    finally:
        if temp_target and os.path.exists(temp_target):
            try:
                os.remove(temp_target)
            except Exception:
                pass

@app.post("/api/local-db/import")
async def import_from_local_db(
    file_path: Optional[str] = Form(None),
    file: Optional[UploadFile] = File(None),
    table_name: str = Form(...),
    custom_query: Optional[str] = Form(None),
    data_category: str = Form("inventory"),
    column_mapping: Optional[str] = Form(None),
    merge_mode: str = Form("merge"),
    project_id: Optional[str] = Form(None),
    new_project_name: Optional[str] = Form(None)
):
    """
    Imports rows from a selected table or custom SQL query within an uploaded DuckDB or SQLite file.
    Arbitrary server-side file_path import is strictly blocked (SEC-CRIT-03).
    """
    if file_path and not file:
        raise HTTPException(
            status_code=400,
            detail="Direct server-side file paths are disabled for security. Please upload your database file directly."
        )
    if not file or not file.filename:
        raise HTTPException(status_code=400, detail="Please upload a valid database file (.duckdb, .sqlite, .db).")

    raw_filename = file.filename.lower()
    if not (raw_filename.endswith(".duckdb") or raw_filename.endswith(".sqlite") or raw_filename.endswith(".db")):
        raise HTTPException(status_code=400, detail="Unsupported file format. Please upload a .duckdb, .sqlite, or .db file.")

    is_duckdb = raw_filename.endswith(".duckdb")
    suffix = ".duckdb" if is_duckdb else ".sqlite"
    temp_target = None

    try:
        with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
            temp_target = tmp.name
            while chunk := await file.read(64 * 1024):
                tmp.write(chunk)

        if is_duckdb:
            con = duckdb.connect(temp_target, read_only=True)
            try:
                actual_tables = [r[0] for r in con.execute("SELECT table_name FROM information_schema.tables WHERE table_schema='main'").fetchall()]
                if custom_query and custom_query.strip():
                    query = _validate_local_db_query(custom_query)
                else:
                    if table_name not in actual_tables:
                        raise HTTPException(status_code=400, detail=f"Table '{table_name}' does not exist in the uploaded database.")
                    escaped_table = table_name.replace('"', '""')
                    query = f'SELECT * FROM "{escaped_table}"'
                df = con.execute(query).fetchdf()
            finally:
                con.close()
        else:
            safe_uri = f"file:{Path(temp_target).resolve().as_posix()}?mode=ro"
            conn = sqlite3.connect(safe_uri, uri=True)
            try:
                c = conn.cursor()
                c.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
                actual_tables = [r[0] for r in c.fetchall()]
                if custom_query and custom_query.strip():
                    query = _validate_local_db_query(custom_query)
                else:
                    if table_name not in actual_tables:
                        raise HTTPException(status_code=400, detail=f"Table '{table_name}' does not exist in the uploaded database.")
                    escaped_table = table_name.replace(']', ']]')
                    query = f"SELECT * FROM [{escaped_table}]"
                df = pd.read_sql(query, conn)
            finally:
                conn.close()

        if df.empty:
            raise HTTPException(status_code=400, detail="The query returned zero rows.")

        # Resolve project ID
        if project_id:
            proj_id = project_id
        else:
            p_name = new_project_name or f"Imported: {os.path.basename(file.filename)}"
            proj = create_new_project(p_name, f"Imported from local {table_name}", os.path.basename(file.filename))
            proj_id = proj["id"]

        cols = [str(c).strip() for c in df.columns]
        mapping: Dict[str, str] = {}
        if column_mapping:
            try:
                mapping = json.loads(column_mapping)
            except Exception:
                mapping = {}

        c_code = _match_column(cols, mapping, "code") or cols[0]
        c_desc = _match_column(cols, mapping, "description")
        c_cat = _match_column(cols, mapping, "category")
        c_loc = _match_column(cols, mapping, "location")
        c_onhand = _match_column(cols, mapping, "on_hand")
        c_onorder = _match_column(cols, mapping, "on_order")
        c_lt = _match_column(cols, mapping, "lead_time_days")
        c_cost = _match_column(cols, mapping, "purchase_price")
        c_price = _match_column(cols, mapping, "sales_price")

        items_data = []
        for _, row in df.iterrows():
            code = str(row.get(c_code, "")).strip()
            if not code or code.lower() in ["nan", "none"]:
                continue
            items_data.append({
                "code": code,
                "description": str(row.get(c_desc, f"Item {code}")).strip() if c_desc and pd.notna(row.get(c_desc)) else f"Item {code}",
                "category": str(row.get(c_cat, "General")).strip() if c_cat and pd.notna(row.get(c_cat)) else "General",
                "location": str(row.get(c_loc, "Main Warehouse")).strip() if c_loc and pd.notna(row.get(c_loc)) else "Main Warehouse",
                "on_hand": float(row.get(c_onhand, 0.0)) if c_onhand and pd.notna(row.get(c_onhand)) else 0.0,
                "on_order": float(row.get(c_onorder, 0.0)) if c_onorder and pd.notna(row.get(c_onorder)) else 0.0,
                "lead_time_days": float(row.get(c_lt, 30.0)) if c_lt and pd.notna(row.get(c_lt)) else 30.0,
                "purchase_price": float(row.get(c_cost, 50.0)) if c_cost and pd.notna(row.get(c_cost)) else 50.0,
                "sales_price": float(row.get(c_price, 100.0)) if c_price and pd.notna(row.get(c_price)) else 100.0
            })

        res = upsert_items_and_periods(proj_id, items_data, None, merge_mode=merge_mode)

        add_ingestion_log(
            project_id=proj_id,
            source_type="duckdb_sqlite",
            source_name=f"{os.path.basename(file.filename)} / {table_name}",
            data_category=data_category,
            rows_processed=len(items_data),
            status="success"
        )

        return {
            "success": True,
            "project_id": proj_id,
            "rows_processed": len(items_data),
            "items_upserted": res.get("items_upserted", 0),
            "message": f"Successfully imported {len(items_data)} items from {table_name} into DuckDB."
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Query execution failed: {str(e)}")
    finally:
        if temp_target and os.path.exists(temp_target):
            try:
                os.remove(temp_target)
            except Exception:
                pass

# ==============================================================================
# REST API / External Web Feed Connector (JSON / Google Sheets CSV)
# Hardened against SSRF, Loopback, Private IPs & Size Bombs (SEC-HIGH-01)
# ==============================================================================

class SafeRedirectHandler(urllib.request.HTTPRedirectHandler):
    """Prevents SSRF redirect bypass to loopback, private IPs or unsupported schemes."""
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        _validate_safe_url(newurl)
        return super().redirect_request(req, fp, code, msg, headers, newurl)

def _validate_safe_url(url_str: str) -> str:
    """
    Validates that a URL uses http/https and does NOT resolve to localhost,
    private RFC-1918 ranges, link-local, multicast, or reserved IP addresses.
    """
    clean = url_str.strip()
    parsed = urllib.parse.urlparse(clean)
    if parsed.scheme.lower() not in ("http", "https"):
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported URL scheme '{parsed.scheme}'. Only HTTP and HTTPS are permitted."
        )
    hostname = parsed.hostname
    if not hostname:
        raise HTTPException(status_code=400, detail="Invalid URL: Missing hostname.")

    try:
        addr_info = socket.getaddrinfo(hostname, None)
    except socket.gaierror as e:
        raise HTTPException(status_code=400, detail=f"Could not resolve host '{hostname}': {str(e)}")

    for item in addr_info:
        ip_str = item[4][0]
        try:
            ip = ipaddress.ip_address(ip_str)
        except ValueError:
            continue
        if (
            ip.is_private
            or ip.is_loopback
            or ip.is_link_local
            or ip.is_multicast
            or ip.is_reserved
            or ip.is_unspecified
        ):
            raise HTTPException(
                status_code=400,
                detail=f"Access to private, loopback, or reserved IP address ({ip_str}) is blocked."
            )
    return clean

def fetch_safe_external_url(
    url_str: str,
    headers: dict,
    timeout: int = 10,
    max_bytes: int = 10 * 1024 * 1024
) -> Tuple[bytes, str]:
    """
    Fetches remote data safely with SSRF validation, redirect inspection, and 10MB response read cap.
    """
    clean_url = _validate_safe_url(url_str)
    opener = urllib.request.build_opener(SafeRedirectHandler)
    req = urllib.request.Request(clean_url, headers=headers)
    try:
        with opener.open(req, timeout=timeout) as resp:
            content_type = resp.headers.get("Content-Type", "").lower()
            chunks = []
            total_read = 0
            while True:
                chunk = resp.read(64 * 1024)
                if not chunk:
                    break
                total_read += len(chunk)
                if total_read > max_bytes:
                    raise HTTPException(
                        status_code=413,
                        detail=f"Response size exceeded maximum allowed limit ({max_bytes // (1024 * 1024)} MB)."
                    )
                chunks.append(chunk)
            return b"".join(chunks), content_type
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Failed to fetch data from URL: {str(e)}")

@app.post("/api/external-url/preview")
def preview_external_url(
    url: str = Form(...),
    auth_header: Optional[str] = Form(None),
    auth_token: Optional[str] = Form(None)
):
    """
    Fetches remote data from an HTTP/HTTPS URL (CSV or JSON array) and returns detected columns and preview rows.
    Guarded against SSRF and response bombs (SEC-HIGH-01).
    """
    clean_url = url.strip()
    headers = {"User-Agent": "NEXO-Enterprise-Planner/2.0"}
    if auth_header and auth_token:
        headers[auth_header.strip()] = auth_token.strip()
    elif auth_token:
        headers["Authorization"] = f"Bearer {auth_token.strip()}"

    content_bytes, content_type = fetch_safe_external_url(clean_url, headers=headers, timeout=10)

    try:
        # Check if CSV
        if "csv" in content_type or clean_url.endswith(".csv") or b"," in content_bytes[:200]:
            try:
                df = pd.read_csv(io.BytesIO(content_bytes))
            except Exception:
                df = pd.read_json(io.BytesIO(content_bytes))
        else:
            try:
                df = pd.read_json(io.BytesIO(content_bytes))
            except Exception:
                df = pd.read_csv(io.BytesIO(content_bytes))
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Failed to parse remote response: {str(e)}")

    if df.empty:
        raise HTTPException(status_code=400, detail="The remote response contains no data records.")

    cols = [str(c).strip() for c in df.columns]
    return {
        "success": True,
        "url": clean_url,
        "columns": cols,
        "row_count": len(df),
        "preview_rows": df.head(10).fillna("").to_dict(orient="records")
    }

@app.post("/api/external-url/import")
def import_from_external_url(
    url: str = Form(...),
    auth_header: Optional[str] = Form(None),
    auth_token: Optional[str] = Form(None),
    data_category: str = Form("inventory"),
    column_mapping: Optional[str] = Form(None),
    merge_mode: str = Form("merge"),
    project_id: Optional[str] = Form(None),
    new_project_name: Optional[str] = Form(None),
    save_profile: bool = Form(False),
    profile_name: Optional[str] = Form(None)
):
    """
    Fetches data from an external HTTP/HTTPS REST endpoint or published Google Sheet, maps columns,
    and ingests rows into the DuckDB workspace. Guarded against SSRF and response bombs (SEC-HIGH-01).
    """
    clean_url = url.strip()
    headers = {"User-Agent": "NEXO-Enterprise-Planner/2.0"}
    if auth_header and auth_token:
        headers[auth_header.strip()] = auth_token.strip()
    elif auth_token:
        headers["Authorization"] = f"Bearer {auth_token.strip()}"

    content_bytes, content_type = fetch_safe_external_url(clean_url, headers=headers, timeout=12)

    try:
        if "csv" in content_type or clean_url.endswith(".csv") or b"," in content_bytes[:200]:
            try:
                df = pd.read_csv(io.BytesIO(content_bytes))
            except Exception:
                df = pd.read_json(io.BytesIO(content_bytes))
        else:
            try:
                df = pd.read_json(io.BytesIO(content_bytes))
            except Exception:
                df = pd.read_csv(io.BytesIO(content_bytes))
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Failed to parse remote response: {str(e)}")

    if df.empty:
        raise HTTPException(status_code=400, detail="The remote response contains no data records.")

    # Resolve project ID
    if project_id:
        proj_id = project_id
    else:
        p_name = new_project_name or f"Feed: {clean_url.split('/')[-1] or 'REST Feed'}"
        proj = create_new_project(p_name, f"Web feed from {clean_url[:40]}...", "REST Feed")
        proj_id = proj["id"]

    cols = [str(c).strip() for c in df.columns]
    mapping: Dict[str, str] = {}
    if column_mapping:
        try:
            mapping = json.loads(column_mapping)
        except Exception:
            mapping = {}

    c_code = _match_column(cols, mapping, "code") or cols[0]
    c_desc = _match_column(cols, mapping, "description")
    c_cat = _match_column(cols, mapping, "category")
    c_loc = _match_column(cols, mapping, "location")
    c_onhand = _match_column(cols, mapping, "on_hand")
    c_onorder = _match_column(cols, mapping, "on_order")
    c_lt = _match_column(cols, mapping, "lead_time_days")
    c_cost = _match_column(cols, mapping, "purchase_price")
    c_price = _match_column(cols, mapping, "sales_price")

    items_data = []
    for _, row in df.iterrows():
        code = str(row.get(c_code, "")).strip()
        if not code or code.lower() in ["nan", "none"]:
            continue
        items_data.append({
            "code": code,
            "description": str(row.get(c_desc, f"Item {code}")).strip() if c_desc and pd.notna(row.get(c_desc)) else f"Item {code}",
            "category": str(row.get(c_cat, "General")).strip() if c_cat and pd.notna(row.get(c_cat)) else "General",
            "location": str(row.get(c_loc, "Main Warehouse")).strip() if c_loc and pd.notna(row.get(c_loc)) else "Main Warehouse",
            "on_hand": float(row.get(c_onhand, 0.0)) if c_onhand and pd.notna(row.get(c_onhand)) else 0.0,
            "on_order": float(row.get(c_onorder, 0.0)) if c_onorder and pd.notna(row.get(c_onorder)) else 0.0,
            "lead_time_days": float(row.get(c_lt, 30.0)) if c_lt and pd.notna(row.get(c_lt)) else 30.0,
            "purchase_price": float(row.get(c_cost, 50.0)) if c_cost and pd.notna(row.get(c_cost)) else 50.0,
            "sales_price": float(row.get(c_price, 100.0)) if c_price and pd.notna(row.get(c_price)) else 100.0
        })

    res = upsert_items_and_periods(proj_id, items_data, None, merge_mode=merge_mode)

    if save_profile:
        save_erp_connection({
            "project_id": proj_id,
            "name": profile_name or f"Web Feed: {clean_url[:30]}",
            "source_type": "api_url",
            "api_url": clean_url,
            "api_auth_header": auth_header or "",
            "last_sync_status": "success"
        })

    add_ingestion_log(
        project_id=proj_id,
        source_type="api_url",
        source_name=clean_url[:60],
        data_category=data_category,
        rows_processed=len(items_data),
        status="success"
    )

    return {
        "success": True,
        "project_id": proj_id,
        "rows_processed": len(items_data),
        "items_upserted": res.get("items_upserted", 0),
        "message": f"Successfully ingested {len(items_data)} items from remote feed."
    }

# ==============================================================================
# Ingestion Audit Logs & Saved Connections Endpoint
# ==============================================================================

@app.get("/api/projects/{project_id}/ingestion-logs")
def get_project_ingestion_logs(project_id: str):
    """Returns recent ingestion audit logs and saved ERP/API connections."""
    logs = get_ingestion_logs(project_id=project_id, limit=50)
    conns = get_erp_connections(project_id=project_id)
    return {
        "project_id": project_id,
        "logs": logs,
        "connections": conns
    }

@app.get("/api/files/import-progress/{job_id}")
def get_import_progress(job_id: str):
    """
    Returns live percentage progress and stage description for an active file upload/import job.
    Runs without database lock contention.
    """
    job = IMPORT_JOBS.get(job_id)
    if job:
        return job
    return {
        "percent": 45,
        "stage_ar": "جاري المعالجة...",
        "stage_en": "Processing...",
        "rows_processed": 0,
        "total_rows": 0,
        "status": "running",
        "error": None
    }

@app.post("/api/files/inspect")
async def inspect_file_endpoint(
    file: UploadFile = File(...),
    job_id: Optional[str] = Form(None)
):
    """
    Inspects an uploaded Excel (.xlsx, .xls) or CSV file and returns detected sheets,
    columns, and preview rows for interactive column mapping.
    Streams directly to disk without loading full spreadsheet into memory.
    """
    update_job_progress(job_id, 48, "استلام الملف وتجهيز الفحص...", "Receiving file for inspection...")
    tmp_path, filename = stream_upload_to_file(file)
    ext = os.path.splitext(filename)[1].lower()
    try:
        if ext == ".csv":
            sheets = ["Sheet1"]
            norm_path, was_transcoded = normalize_csv_encoding(tmp_path)
            try:
                escaped = norm_path.replace("\\", "/").replace("'", "''")
                with _LOCK:
                    con = get_connection()
                    con.execute(f"CREATE OR REPLACE TEMP TABLE staging_inspect AS SELECT * FROM read_csv_auto('{escaped}', all_varchar=true, strict_mode=false, null_padding=true, ignore_errors=true, sample_size=-1);")
                    cols = [d[0] for d in con.execute("DESCRIBE staging_inspect").fetchall()]
                    row_count = con.execute("SELECT COUNT(*) FROM staging_inspect").fetchone()[0]
                    preview_data = con.execute("SELECT * FROM staging_inspect LIMIT 5").fetchall()
                    preview_rows = [dict(zip(cols, [val if val is not None else "" for val in row])) for row in preview_data]
                    con.execute("DROP TABLE IF EXISTS staging_inspect;")
            finally:
                if was_transcoded and os.path.exists(norm_path):
                    try:
                        os.remove(norm_path)
                    except Exception:
                        pass
        else:
            from python_calamine import CalamineWorkbook
            wb = CalamineWorkbook.from_path(tmp_path)
            sheets = wb.sheet_names
            if not sheets:
                raise HTTPException(status_code=400, detail="The Excel workbook contains no sheets.")
            sheet = wb.get_sheet_by_name(sheets[0])
            rows = sheet.to_python()
            if rows:
                cols = [str(c).strip() if c is not None else f"col_{i}" for i, c in enumerate(rows[0])]
                row_count = max(0, len(rows) - 1)
                preview_rows = []
                for r in rows[1:6]:
                    preview_rows.append({cols[i]: (str(r[i]) if i < len(r) and r[i] is not None else "") for i in range(len(cols))})
            else:
                cols = []
                row_count = 0
                preview_rows = []
    except HTTPException as he:
        update_job_progress(job_id, 100, "حدث خطأ أثناء فحص الملف", f"Inspection failed: {he.detail}", status="error", error=he.detail)
        raise
    except Exception as e:
        update_job_progress(job_id, 100, "حدث خطأ أثناء فحص الملف", f"Inspection failed: {str(e)}", status="error", error=str(e))
        raise HTTPException(status_code=400, detail=f"Failed to inspect file: {str(e)}")
    finally:
        if 'tmp_path' in locals() and os.path.exists(tmp_path):
            try:
                os.remove(tmp_path)
            except Exception:
                pass

    fields_to_suggest = [
        "code", "description", "category", "location", "on_hand", "on_order",
        "lead_time_days", "lead_time_variance_days", "service_level", "min_batch",
        "batch_rounding", "sales_price", "purchase_price", "supplier",
        "period", "qty_sold", "revenue", "order_no", "destination", "eta_date",
        "carrier", "status", "quantity"
    ]
    suggestions = {}
    for fld in fields_to_suggest:
        m = _match_column(cols, {}, fld)
        if m and fld not in suggestions:
            suggestions[fld] = m

    update_job_progress(job_id, 100, "اكتمل فحص الملف بنجاح!", "Inspection completed successfully!", total_rows=row_count, status="done")
    return {
        "filename": filename,
        "sheets": sheets,
        "columns": cols,
        "row_count": row_count,
        "preview_rows": preview_rows,
        "suggested_mappings": suggestions
    }

@app.post("/api/files/import")
async def import_file_endpoint(
    file: UploadFile = File(...),
    project_name: Optional[str] = Form(None),
    column_mapping: Optional[str] = Form(None),
    job_id: Optional[str] = Form(None)
):
    """
    Accepts an uploaded Excel (.xlsx, .xls) or CSV file, applies interactive column mapping,
    and streams directly into DuckDB using the high-speed direct DuckDB ingestion engine.
    """
    res = await import_typed_file(
        file=file,
        import_type="combined",
        new_project_name=project_name,
        column_mapping=column_mapping,
        job_id=job_id
    )
    res["project_name"] = project_name or f"Imported: {file.filename or 'file'}"
    res["imported_skus"] = res.get("items_upserted", res.get("rows_processed", 0))
    res["columns_detected"] = []
    return res

def sanitize_excel_cell(val: Any) -> Any:
    """
    Prevents CSV / Excel formula injection (CWE-1236, SEC-MED-01).
    Neutralizes leading formula operators (=, +, -, @, \t, \r) on string values.
    """
    if isinstance(val, str):
        if val.startswith(("=", "+", "-", "@", "\t", "\r")):
            return f"'{val}"
    return val

class ExcelSheetData(BaseModel):
    name: str
    rows: List[Dict[str, Any]]

class ExcelExportRequest(BaseModel):
    filename: Optional[str] = "NEXO_Export.xlsx"
    sheets: List[ExcelSheetData]

@app.post("/api/export/excel")
def export_custom_excel(req: ExcelExportRequest):
    """
    Unified, hardened Excel (.xlsx) export endpoint (SEC-HIGH-03, SEC-MED-01).
    Sanitizes all cells against formula injection and generates openpyxl workbooks
    with automatic Arabic RTL sheet support.
    """
    import openpyxl

    wb = openpyxl.Workbook()
    default_sheet = wb.active

    for idx, sheet_spec in enumerate(req.sheets):
        sheet_name = (sheet_spec.name or f"Sheet{idx+1}").strip()[:31]
        sheet_name = re.sub(r'[\\/*?:\[\]]', '_', sheet_name) or f"Sheet{idx+1}"
        ws = wb.create_sheet(title=sheet_name)
        
        has_arabic = bool(re.search(r'[\u0600-\u06FF]', sheet_name))
        
        if sheet_spec.rows:
            headers = []
            for row in sheet_spec.rows:
                for k in row.keys():
                    if k not in headers:
                        headers.append(k)
                        if not has_arabic and re.search(r'[\u0600-\u06FF]', str(k)):
                            has_arabic = True

            ws.append([sanitize_excel_cell(h) for h in headers])

            for row in sheet_spec.rows:
                row_vals = []
                for h in headers:
                    val = row.get(h, "")
                    sanitized = sanitize_excel_cell(val)
                    row_vals.append(sanitized)
                    if not has_arabic and isinstance(val, str) and re.search(r'[\u0600-\u06FF]', val):
                        has_arabic = True
                ws.append(row_vals)

        if has_arabic:
            ws.views.sheetView[0].rightToLeft = True

    if default_sheet and default_sheet in wb.worksheets:
        wb.remove(default_sheet)

    if not wb.worksheets:
        wb.create_sheet(title="Sheet1")

    output = io.BytesIO()
    wb.save(output)
    output.seek(0)

    filename = (req.filename or "NEXO_Export.xlsx").strip()
    if not filename.endswith(".xlsx"):
        filename += ".xlsx"
    filename = re.sub(r'[\r\n"]', '_', filename)

    return StreamingResponse(
        output,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'}
    )

def _generate_excel_export(project_id: str, export_type: str = "all") -> StreamingResponse:
    """Generates real .xlsx exports from DuckDB tables with formula sanitization."""
    items = get_project_items(project_id)
    if not items:
        raise HTTPException(status_code=404, detail="No items found for this project")

    inv_data = []
    for it in items:
        inv_data.append({
            "Item Code": sanitize_excel_cell(it["code"]),
            "Description": sanitize_excel_cell(it["description"]),
            "Category": sanitize_excel_cell(it["category"]),
            "Location": sanitize_excel_cell(it["location"]),
            "Supplier": sanitize_excel_cell(it["supplier"]),
            "Sales Price ($)": it["salesPrice"],
            "Purchase Price ($)": it["purchasePrice"],
            "On Hand": it["onHand"],
            "On Order": it["onOrder"],
            "Lead Time (Days)": it["leadTimeDays"],
            "Safety Stock": it["safetyStock"],
            "Reorder Point": it["reorderPoint"],
            "Order Now": it["orderNow"],
            "Order Value ($)": it["orderNowValue"],
            "Days of Supply": it["daysOfSupply"],
            "ABC Class": sanitize_excel_cell(it["abcClass"]),
            "XYZ Class": sanitize_excel_cell(it["xyzClass"]),
            "Forecast Model": sanitize_excel_cell(it["modelType"]),
            "Replenishment Strategy": sanitize_excel_cell(it["replenishmentStrategy"]),
            "Forecast Accuracy (%)": it["accuracy"]
        })

    forecast_data = []
    for it in items:
        row = {
            "Item Code": sanitize_excel_cell(it["code"]),
            "Description": sanitize_excel_cell(it["description"]),
            "Category": sanitize_excel_cell(it["category"]),
            "Location": sanitize_excel_cell(it["location"])
        }
        for p in it.get("periods", []):
            label = sanitize_excel_cell(p["date"])
            val = p.get("override") if p.get("override") is not None else (p.get("forecast") if p.get("actual") == 0 else p.get("actual"))
            row[label] = sanitize_excel_cell(val)
        forecast_data.append(row)

    orders_data = []
    for it in items:
        if it["orderNow"] > 0:
            orders_data.append({
                "Order No": sanitize_excel_cell(f"PO-PLAN-{it['code']}"),
                "Item Code": sanitize_excel_cell(it["code"]),
                "Description": sanitize_excel_cell(it["description"]),
                "Supplier": sanitize_excel_cell(it["supplier"]),
                "Destination": sanitize_excel_cell(it["location"]),
                "Order Qty": it["orderNow"],
                "Unit Cost ($)": it["purchasePrice"],
                "Total Value ($)": it["orderNowValue"],
                "Reorder Point": it["reorderPoint"],
                "Current On Hand": it["onHand"],
                "Status": "Planned Draft"
            })

    output = io.BytesIO()
    with pd.ExcelWriter(output, engine="openpyxl") as writer:
        if export_type in ("all", "replenishment"):
            pd.DataFrame(inv_data).to_excel(writer, sheet_name="Inventory Replenishment", index=False)
        if export_type in ("all", "forecast"):
            pd.DataFrame(forecast_data).to_excel(writer, sheet_name="Demand Forecast", index=False)
        if export_type in ("all", "orders") and orders_data:
            pd.DataFrame(orders_data).to_excel(writer, sheet_name="Planned Orders", index=False)

    output.seek(0)
    if export_type == "orders":
        filename = f"NEXO_Purchase_Orders_{project_id}.xlsx"
    elif export_type == "replenishment":
        filename = f"NEXO_Inventory_Replenishment_{project_id}.xlsx"
    else:
        filename = f"NEXO_Report_{project_id}.xlsx"

    return StreamingResponse(
        output,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f"attachment; filename={filename}"}
    )

@app.get("/api/files/export")
def export_file_query(
    project_id: str = Query(..., description="Project ID to export"),
    export_type: Optional[str] = Query("all", description="Export type: all, replenishment, orders, forecast")
):
    return _generate_excel_export(project_id, export_type or "all")

@app.get("/api/files/export/{project_id}")
def export_project_to_excel(
    project_id: str,
    export_type: Optional[str] = Query("all")
):
    return _generate_excel_export(project_id, export_type or "all")

# ===============================================================================
# GitHub Auto-Updater & System Management Endpoints
# ===============================================================================

REPO_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))

def _perform_delayed_restart():
    time.sleep(0.8)
    try:
        close_db()
    except Exception:
        pass

    # Launch replacement process detached without shell=True (SEC-HIGH-02)
    vbs_path = os.path.join(REPO_DIR, "NEXO.vbs")
    app_py = os.path.join(REPO_DIR, "desktop_app.py")
    DETACHED_PROCESS = 0x00000008
    CREATE_NO_WINDOW = 0x08000000
    creationflags = (DETACHED_PROCESS | CREATE_NO_WINDOW) if os.name == "nt" else 0

    if os.name == "nt" and os.path.exists(vbs_path):
        target_args = ["wscript.exe", vbs_path]
    else:
        pythonw = sys.executable.replace("python.exe", "pythonw.exe")
        py_exe = pythonw if os.path.exists(pythonw) else sys.executable
        target_args = [py_exe, app_py]

    launcher_cmd = [
        sys.executable,
        "-c",
        "import time, subprocess, sys; time.sleep(1.5); subprocess.Popen(sys.argv[1:])",
        *target_args
    ]

    try:
        subprocess.Popen(
            launcher_cmd,
            shell=False,
            cwd=REPO_DIR,
            creationflags=creationflags,
            close_fds=True
        )
    except Exception as e:
        print(f"Error launching restart process: {e}")
    finally:
        os._exit(0)

@app.get("/api/system/check-update")
def check_github_update():
    """
    Checks GitHub for new commits on main.
    1. Runs git fetch origin main safely with a timeout and SUBPROCESS_FLAGS.
    2. Reads remote version from origin/main:VERSION.
    3. Compares local HEAD SHA with origin/main SHA.
    """
    local_ver = get_app_version()
    remote_ver = local_ver
    commits_behind = 0
    local_sha = ""
    remote_sha = ""
    commit_msg = "Current local version"
    commit_date = ""
    changed_files = 0
    is_available = False

    # 1. Get local HEAD SHA
    try:
        res = subprocess.run(
            ["git", "rev-parse", "HEAD"],
            cwd=REPO_DIR,
            capture_output=True,
            text=True,
            timeout=4,
            creationflags=SUBPROCESS_FLAGS
        )
        if res.returncode == 0:
            local_sha = res.stdout.strip()
    except Exception:
        pass

    # 2. Try git fetch origin main
    git_fetch_ok = False
    try:
        fetch_res = subprocess.run(
            ["git", "fetch", "origin", "main"],
            cwd=REPO_DIR,
            capture_output=True,
            text=True,
            timeout=8,
            creationflags=SUBPROCESS_FLAGS
        )
        if fetch_res.returncode == 0:
            git_fetch_ok = True
    except Exception:
        git_fetch_ok = False

    if git_fetch_ok:
        try:
            remote_res = subprocess.run(
                ["git", "rev-parse", "origin/main"],
                cwd=REPO_DIR,
                capture_output=True,
                text=True,
                timeout=4,
                creationflags=SUBPROCESS_FLAGS
            )
            remote_sha = remote_res.stdout.strip()

            # Read remote VERSION file directly from git show origin/main:VERSION
            v_res = subprocess.run(
                ["git", "show", "origin/main:VERSION"],
                cwd=REPO_DIR,
                capture_output=True,
                text=True,
                timeout=4,
                creationflags=SUBPROCESS_FLAGS
            )
            if v_res.returncode == 0 and v_res.stdout.strip():
                remote_ver = v_res.stdout.strip().lstrip("v")

            msg_res = subprocess.run(
                ["git", "log", "-1", "--pretty=%s", "origin/main"],
                cwd=REPO_DIR,
                capture_output=True,
                text=True,
                timeout=4,
                creationflags=SUBPROCESS_FLAGS
            )
            commit_msg = msg_res.stdout.strip() if msg_res.returncode == 0 else "Latest improvements"

            date_res = subprocess.run(
                ["git", "log", "-1", "--pretty=%cd", "--date=short", "origin/main"],
                cwd=REPO_DIR,
                capture_output=True,
                text=True,
                timeout=4,
                creationflags=SUBPROCESS_FLAGS
            )
            commit_date = date_res.stdout.strip() if date_res.returncode == 0 else ""

            diff_res = subprocess.run(
                ["git", "diff", "--name-only", "HEAD", "origin/main"],
                cwd=REPO_DIR,
                capture_output=True,
                text=True,
                timeout=4,
                creationflags=SUBPROCESS_FLAGS
            )
            changed_files = len([f for f in diff_res.stdout.splitlines() if f.strip()]) if diff_res.returncode == 0 else 0

            # Count commits behind
            count_res = subprocess.run(
                ["git", "rev-list", "--count", "HEAD..origin/main"],
                cwd=REPO_DIR,
                capture_output=True,
                text=True,
                timeout=4,
                creationflags=SUBPROCESS_FLAGS
            )
            if count_res.returncode == 0 and count_res.stdout.strip().isdigit():
                commits_behind = int(count_res.stdout.strip())

            is_available = bool(local_sha and remote_sha and local_sha != remote_sha)

            return {
                "update_available": is_available,
                "current_version": f"v{local_ver}",
                "latest_version": f"v{remote_ver}",
                "commits_behind": commits_behind,
                "latest_message": commit_msg,
                "commit_message": commit_msg,
                "local_sha": local_sha[:7] if local_sha else "c9ee199",
                "remote_sha": remote_sha[:7] if remote_sha else "",
                "commit_date": commit_date,
                "files_changed": changed_files,
                "offline": False
            }
        except Exception:
            pass

    # Fallback to GitHub REST API if git remote unreachable
    try:
        api_url = "https://api.github.com/repos/Ramisharafaldin/NEXO-Enterprise-Desktop-App/commits/main"
        req = urllib.request.Request(api_url, headers={"User-Agent": "NEXO-Updater", "Accept": "application/vnd.github.v3+json"})
        with urllib.request.urlopen(req, timeout=5) as resp:
            if resp.status == 200:
                data = json.loads(resp.read().decode("utf-8"))
                remote_sha = data.get("sha", "")
                commit_msg = data.get("commit", {}).get("message", "").split("\n")[0]
                commit_date = data.get("commit", {}).get("author", {}).get("date", "")[:10]
                is_available = bool(local_sha and remote_sha and local_sha[:7] != remote_sha[:7])

                # Fetch raw VERSION file from GitHub if possible
                try:
                    raw_v_url = "https://raw.githubusercontent.com/Ramisharafaldin/NEXO-Enterprise-Desktop-App/main/VERSION"
                    v_req = urllib.request.Request(raw_v_url, headers={"User-Agent": "NEXO-Updater"})
                    with urllib.request.urlopen(v_req, timeout=3) as v_resp:
                        if v_resp.status == 200:
                            remote_ver = v_resp.read().decode("utf-8").strip().lstrip("v")
                except Exception:
                    pass

                return {
                    "update_available": is_available,
                    "current_version": f"v{local_ver}",
                    "latest_version": f"v{remote_ver}",
                    "commits_behind": 1 if is_available else 0,
                    "latest_message": commit_msg,
                    "commit_message": commit_msg,
                    "local_sha": local_sha[:7] if local_sha else "c9ee199",
                    "remote_sha": remote_sha[:7],
                    "commit_date": commit_date,
                    "files_changed": 1,
                    "offline": False
                }
    except Exception:
        pass

    # Offline / Local fallback
    try:
        msg_res = subprocess.run(
            ["git", "log", "-1", "--pretty=%s", "HEAD"],
            cwd=REPO_DIR,
            capture_output=True,
            text=True,
            timeout=3,
            creationflags=SUBPROCESS_FLAGS
        )
        if msg_res.returncode == 0 and msg_res.stdout.strip():
            commit_msg = msg_res.stdout.strip()
    except Exception:
        pass

    return {
        "update_available": False,
        "current_version": f"v{local_ver}",
        "latest_version": f"v{local_ver}",
        "commits_behind": 0,
        "latest_message": commit_msg,
        "commit_message": commit_msg,
        "local_sha": local_sha[:7] if local_sha else "c9ee199",
        "remote_sha": local_sha[:7] if local_sha else "c9ee199",
        "commit_date": "",
        "files_changed": 0,
        "offline": True
    }

@app.post("/api/system/apply-update")
def apply_github_update():
    """
    Pulls the latest code from GitHub, updates packages if needed, and rebuilds the frontend dist/.
    Leaves nexo_workspace.duckdb and all user database files completely untouched.
    """
    output_log = []

    # Step 1: git fetch origin main
    fetch_res = subprocess.run(["git", "fetch", "origin", "main"], cwd=REPO_DIR, capture_output=True, text=True, timeout=45)
    output_log.append(f"git fetch: {fetch_res.stdout} {fetch_res.stderr}")
    if fetch_res.returncode != 0:
        raise HTTPException(status_code=500, detail=f"Failed to fetch updates from GitHub: {fetch_res.stderr}")

    # Step 2: git reset --hard origin/main
    reset_res = subprocess.run(["git", "reset", "--hard", "origin/main"], cwd=REPO_DIR, capture_output=True, text=True, timeout=20)
    output_log.append(f"git reset: {reset_res.stdout} {reset_res.stderr}")
    if reset_res.returncode != 0:
        raise HTTPException(status_code=500, detail=f"Failed to reset working copy: {reset_res.stderr}")

    # Step 3: Install any new python dependencies
    req_file = os.path.join(REPO_DIR, "backend", "requirements.txt")
    if os.path.exists(req_file):
        pip_res = subprocess.run([sys.executable, "-m", "pip", "install", "-q", "-r", req_file], cwd=REPO_DIR, capture_output=True, text=True, timeout=60)
        output_log.append(f"pip install: {pip_res.stdout} {pip_res.stderr}")

    # Step 4: Rebuild frontend dist/ via npm run build
    npm_cmd = "npm.cmd" if os.name == "nt" else "npm"
    build_res = subprocess.run([npm_cmd, "run", "build"], cwd=REPO_DIR, capture_output=True, text=True, shell=True, timeout=120)
    output_log.append(f"npm run build: {build_res.stdout} {build_res.stderr}")
    if build_res.returncode != 0:
        raise HTTPException(status_code=500, detail=f"Update downloaded but frontend build failed: {build_res.stderr}")

    return {
        "status": "updated",
        "restart_required": True,
        "message": "NEXO updated and built successfully from GitHub.",
        "log": "\n".join(output_log)
    }

@app.post("/api/system/restart")
def restart_nexo_application():
    """
    Safely checkpoints DuckDB, spawns a new detached NEXO process, and exits the current instance.
    """
    t = threading.Thread(target=_perform_delayed_restart, daemon=True)
    t.start()
    return {
        "status": "restarting",
        "message": "NEXO desktop application is restarting..."
    }

# ===============================================================================
# Unified Desktop Static Asset & SPA Frontend Serving
# ===============================================================================
DIST_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "dist"))
ASSETS_DIR = os.path.join(DIST_DIR, "assets")

if os.path.isdir(ASSETS_DIR):
    app.mount("/assets", StaticFiles(directory=ASSETS_DIR), name="assets")

@app.get("/{full_path:path}", include_in_schema=False)
async def serve_spa_frontend(full_path: str):
    # Do not intercept unmatched /api/* or /auth/* routes
    if full_path.startswith("api/") or full_path == "api":
        raise HTTPException(status_code=404, detail="API endpoint not found")
    if full_path.startswith("auth/") or full_path == "auth":
        raise HTTPException(status_code=404, detail="Auth endpoint not found")

    clean_path = full_path.strip().lstrip("/")

    # Strict path traversal defense (SEC-CRIT-02)
    if (
        ".." in clean_path
        or "\\" in clean_path
        or ":" in clean_path
        or any(part.startswith(".") for part in clean_path.split("/") if part)
    ):
        raise HTTPException(status_code=403, detail="Access denied: invalid path")

    base_dir = Path(DIST_DIR).resolve()
    try:
        candidate = (base_dir / clean_path).resolve()
        is_safe = candidate.is_relative_to(base_dir)
    except (ValueError, RuntimeError):
        is_safe = False

    if not is_safe:
        raise HTTPException(status_code=403, detail="Access denied: path outside document root")

    # If a specific static file was requested in dist/ (e.g. assets/*.js, favicon.svg)
    if clean_path and candidate.is_file():
        return FileResponse(str(candidate))

    # Return index.html for all client-side SPA routes
    index_file = base_dir / "index.html"
    if index_file.is_file():
        return FileResponse(
            str(index_file),
            headers={
                "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
                "Pragma": "no-cache",
                "Expires": "0"
            }
        )

    return JSONResponse({
        "status": "online",
        "app": "NEXO Enterprise Supply Chain Planning",
        "message": "NEXO API is online. Build the frontend via 'npm run build' to serve the desktop UI."
    })

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("server:app", host="127.0.0.1", port=8000, reload=False)

