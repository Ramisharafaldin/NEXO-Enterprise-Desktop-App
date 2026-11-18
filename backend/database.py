"""
NEXO Enterprise Supply Chain Planning Platform
Local Embedded Columnar Database Layer (DuckDB)
Persists projects, items, periods, overrides, model settings, and configurations to disk.
"""

import os
import json
import uuid
import datetime
import math
import threading
from typing import Dict, List, Any, Optional
import duckdb
import pandas as pd

def clean_float(val: Any, default: float = 0.0) -> float:
    if val is None:
        return default
    try:
        f = float(val)
        if math.isnan(f) or math.isinf(f):
            return default
        return f
    except (ValueError, TypeError):
        return default

def clean_opt_float(val: Any) -> Optional[float]:
    if val is None:
        return None
    try:
        f = float(val)
        if math.isnan(f) or math.isinf(f):
            return None
        return f
    except (ValueError, TypeError):
        return None

DB_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "nexo_workspace.duckdb")
_LOCK = threading.Lock()

def get_connection():
    """Returns a DuckDB connection to the local database file."""
    return duckdb.connect(DB_PATH)

def close_db():
    """Flushes WAL to disk and cleanly closes any database resources."""
    with _LOCK:
        try:
            con = duckdb.connect(DB_PATH)
            con.execute("CHECKPOINT;")
            con.close()
        except Exception:
            pass

def init_db():
    """Initializes tables in DuckDB if they do not exist."""
    with _LOCK:
        con = get_connection()
        try:
            # 1. Projects table
            con.execute("""
                CREATE TABLE IF NOT EXISTS projects (
                    id VARCHAR PRIMARY KEY,
                    name VARCHAR NOT NULL,
                    description VARCHAR,
                    created_at VARCHAR,
                    updated_at VARCHAR,
                    dataset_name VARCHAR,
                    sku_count INTEGER DEFAULT 0,
                    status VARCHAR DEFAULT 'active'
                )
            """)

            # 2. Items table
            con.execute("""
                CREATE TABLE IF NOT EXISTS items (
                    id VARCHAR PRIMARY KEY,
                    project_id VARCHAR NOT NULL,
                    code VARCHAR NOT NULL,
                    description VARCHAR,
                    category VARCHAR,
                    location VARCHAR,
                    channel VARCHAR,
                    supplier VARCHAR,
                    dc VARCHAR,
                    bom_type VARCHAR,
                    sales_price DOUBLE DEFAULT 0.0,
                    purchase_price DOUBLE DEFAULT 0.0,
                    margin DOUBLE DEFAULT 0.0,
                    on_hand DOUBLE DEFAULT 0.0,
                    on_order DOUBLE DEFAULT 0.0,
                    backorders DOUBLE DEFAULT 0.0,
                    lead_time_days DOUBLE DEFAULT 30.0,
                    lead_time_variance_days DOUBLE DEFAULT 5.0,
                    order_cycle_days DOUBLE DEFAULT 30.0,
                    service_level DOUBLE DEFAULT 0.95,
                    min_batch DOUBLE DEFAULT 1.0,
                    batch_rounding DOUBLE DEFAULT 1.0,
                    shelf_life_days DOUBLE,
                    unit_cbm DOUBLE,
                    unit_weight_kg DOUBLE,
                    model_type VARCHAR DEFAULT 'auto',
                    replenishment_strategy VARCHAR DEFAULT 'periodic',
                    check_state VARCHAR DEFAULT 'checked',
                    approval_state VARCHAR DEFAULT 'unapproved',
                    notes VARCHAR,
                    abc_class VARCHAR,
                    xyz_class VARCHAR,
                    safety_stock DOUBLE DEFAULT 0.0,
                    reorder_point DOUBLE DEFAULT 0.0,
                    max_inventory DOUBLE DEFAULT 0.0,
                    order_now DOUBLE DEFAULT 0.0,
                    order_now_value DOUBLE DEFAULT 0.0,
                    days_of_supply DOUBLE DEFAULT 0.0,
                    projected_days_of_supply DOUBLE DEFAULT 0.0,
                    transfer_qty DOUBLE DEFAULT 0.0,
                    transfer_source VARCHAR,
                    is_stockout BOOLEAN DEFAULT FALSE,
                    stockout_date VARCHAR,
                    is_overstock BOOLEAN DEFAULT FALSE,
                    overstock_value DOUBLE DEFAULT 0.0,
                    is_dead_inventory BOOLEAN DEFAULT FALSE,
                    dead_inventory_value DOUBLE DEFAULT 0.0,
                    expected_write_off_value DOUBLE DEFAULT 0.0,
                    mape DOUBLE DEFAULT 0.0,
                    wmape DOUBLE DEFAULT 0.0,
                    accuracy DOUBLE DEFAULT 100.0,
                    mean_daily_demand DOUBLE DEFAULT 0.0,
                    demand_variance DOUBLE DEFAULT 0.0,
                    fitted_model_type VARCHAR DEFAULT 'auto',
                    updated_at VARCHAR
                )
            """)

            # 3. Periods table (time series actuals, forecasts, overrides)
            con.execute("""
                CREATE TABLE IF NOT EXISTS periods (
                    id VARCHAR PRIMARY KEY,
                    project_id VARCHAR NOT NULL,
                    item_id VARCHAR NOT NULL,
                    date VARCHAR NOT NULL,
                    actual DOUBLE DEFAULT 0.0,
                    forecast DOUBLE DEFAULT 0.0,
                    model DOUBLE DEFAULT 0.0,
                    conf_upper DOUBLE DEFAULT 0.0,
                    conf_lower DOUBLE DEFAULT 0.0,
                    override DOUBLE,
                    promotion DOUBLE DEFAULT 0.0
                )
            """)

            # 4. Forecast Overrides table (explicit tracking of manual +1..+12 adjustments)
            con.execute("""
                CREATE TABLE IF NOT EXISTS forecast_overrides (
                    id VARCHAR PRIMARY KEY,
                    project_id VARCHAR NOT NULL,
                    item_id VARCHAR NOT NULL,
                    date VARCHAR NOT NULL,
                    override_value DOUBLE,
                    updated_at VARCHAR
                )
            """)

            # 5. Model Settings table (explicit tracking of inspector settings per item/group)
            con.execute("""
                CREATE TABLE IF NOT EXISTS model_settings (
                    id VARCHAR PRIMARY KEY,
                    project_id VARCHAR NOT NULL,
                    item_id VARCHAR NOT NULL,
                    forecast_approach VARCHAR DEFAULT 'item',
                    model_type VARCHAR DEFAULT 'auto',
                    seasonality_pattern VARCHAR DEFAULT '12 periods',
                    service_level DOUBLE DEFAULT 0.95,
                    lead_time_days DOUBLE DEFAULT 30.0,
                    status VARCHAR DEFAULT 'active',
                    updated_at VARCHAR
                )
            """)

            # 6. Saved Filters table
            con.execute("""
                CREATE TABLE IF NOT EXISTS saved_filters (
                    id VARCHAR PRIMARY KEY,
                    project_id VARCHAR NOT NULL,
                    name VARCHAR NOT NULL,
                    condition_type VARCHAR DEFAULT 'and',
                    filter_column VARCHAR,
                    operator VARCHAR,
                    filter_value VARCHAR,
                    created_at VARCHAR
                )
            """)

            # 7. ERP Connections and Ingestion Logs tables
            _ensure_ingestion_and_erp_tables(con)

            # 8. In-Transition Shipments table
            con.execute("""
                CREATE TABLE IF NOT EXISTS in_transition (
                    id VARCHAR PRIMARY KEY,
                    project_id VARCHAR NOT NULL,
                    item_code VARCHAR NOT NULL,
                    order_no VARCHAR NOT NULL,
                    origin VARCHAR,
                    destination VARCHAR,
                    quantity DOUBLE DEFAULT 0.0,
                    eta_date VARCHAR,
                    carrier VARCHAR,
                    status VARCHAR DEFAULT 'in_transit'
                )
            """)

            # 9. App Settings table (global enterprise preferences & parameters)
            con.execute("""
                CREATE TABLE IF NOT EXISTS app_settings (
                    id VARCHAR PRIMARY KEY,
                    language VARCHAR DEFAULT 'en',
                    currency_code VARCHAR DEFAULT 'EGP',
                    currency_symbol VARCHAR DEFAULT 'ج.م',
                    currency_position VARCHAR DEFAULT 'after',
                    decimal_places INTEGER DEFAULT 2,
                    exchange_rate DOUBLE DEFAULT 1.0,
                    analysis_lookback_periods INTEGER DEFAULT 12,
                    forecast_horizon_periods INTEGER DEFAULT 12,
                    period_granularity VARCHAR DEFAULT 'monthly',
                    default_forecast_model VARCHAR DEFAULT 'auto',
                    default_service_level DOUBLE DEFAULT 0.95,
                    default_replenishment_policy VARCHAR DEFAULT 'periodic',
                    default_order_cycle_days DOUBLE DEFAULT 30.0,
                    default_lead_time_days DOUBLE DEFAULT 7.0,
                    overstock_threshold_days DOUBLE DEFAULT 90.0,
                    dead_stock_days DOUBLE DEFAULT 60.0,
                    abc_a_cutoff DOUBLE DEFAULT 80.0,
                    abc_b_cutoff DOUBLE DEFAULT 95.0,
                    xyz_x_cv DOUBLE DEFAULT 0.5,
                    xyz_y_cv DOUBLE DEFAULT 1.0,
                    updated_at VARCHAR
                )
            """)

            # Check if default project exists, if not seed sample data
            res = con.execute("SELECT COUNT(*) FROM projects").fetchone()
            if res and res[0] == 0:
                _seed_initial_project(con)

        finally:
            con.close()

def _seed_initial_project(con):
    """Populates DuckDB with the initial 10 enterprise SKUs and 24 monthly periods."""
    now_str = datetime.datetime.utcnow().isoformat()
    project_id = "proj_default_retail"
    project_name = "Retail Inventory Planning Example (Enterprise Benchmark)"
    dataset_name = "Retail Inventory Planning Example monthly.xlsx"

    con.execute("""
        INSERT INTO projects (id, name, description, created_at, updated_at, dataset_name, sku_count, status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    """, (
        project_id,
        project_name,
        "Enterprise retail benchmark dataset with 10 high-impact SKUs, multi-echelon DC routing, seasonal Holt-Winters, Croston intermittent demand, and dynamic ROP.",
        now_str,
        now_str,
        dataset_name,
        10,
        "active"
    ))

    # Raw SKU definitions matching sampleData.ts
    raw_skus = [
        {
            "id": "sku_1", "code": "004652-BLU", "desc": "Swimwear Mediterranean Blue [Seasonal Model]",
            "category": "Fashion / Summer Style", "loc": "WH-East (New Jersey)", "channel": "Direct Retail",
            "supplier": "Acme Apparel Ltd.", "dc": "Central Distribution Center", "bom": "finished",
            "price": 79.0, "cost": 28.5, "margin": 63.9, "on_hand": 120, "on_order": 350, "backorders": 15,
            "lt": 45, "lt_var": 7, "cycle": 30, "sl": 0.95, "moq": 100, "round": 50, "model": "seasonal",
            "strat": "periodic", "check": "checked", "app": "approved", "pattern": [40, 45, 80, 150, 280, 390, 450, 410, 220, 90, 50, 40]
        },
        {
            "id": "sku_2", "code": "562156-01", "desc": "Modern Oak Dining Table [Seasonal & Trend]",
            "category": "Consumer Goods / Furniture", "loc": "WH-East (New Jersey)", "channel": "Direct Retail",
            "supplier": "Nordic Craft Co.", "dc": "Central Distribution Center", "bom": "finished",
            "price": 450.0, "cost": 195.0, "margin": 56.7, "on_hand": 14, "on_order": 0, "backorders": 2,
            "lt": 60, "lt_var": 10, "cycle": 45, "sl": 0.98, "moq": 20, "round": 10, "model": "seasonal",
            "strat": "periodic", "check": "attention", "app": "unapproved", "pattern": [12, 14, 15, 18, 22, 25, 24, 28, 30, 35, 45, 52]
        },
        {
            "id": "sku_3", "code": "1866-MB", "desc": "Executive Ergonomic Desk [Linear Trend]",
            "category": "Consumer Goods / Furniture", "loc": "WH-West (San Francisco)", "channel": "Distributors",
            "supplier": "Nordic Craft Co.", "dc": "Central Distribution Center", "bom": "finished",
            "price": 320.0, "cost": 140.0, "margin": 56.3, "on_hand": 45, "on_order": 100, "backorders": 0,
            "lt": 40, "lt_var": 5, "cycle": 30, "sl": 0.95, "moq": 30, "round": 15, "model": "linear",
            "strat": "min_max", "check": "checked", "app": "approved", "pattern": [20, 22, 25, 28, 30, 34, 37, 40, 44, 48, 52, 56]
        },
        {
            "id": "sku_4", "code": "VB2166-150", "desc": "Vital Blue Multivitamin 150g [Seasonal]",
            "category": "Pharmacies & Healthcare", "loc": "WH-East (New Jersey)", "channel": "Direct Retail",
            "supplier": "BioHealth Pharma", "dc": "Central Distribution Center", "bom": "finished",
            "price": 24.5, "cost": 8.2, "margin": 66.5, "on_hand": 850, "on_order": 500, "backorders": 0,
            "lt": 20, "lt_var": 3, "cycle": 15, "sl": 0.99, "moq": 250, "round": 50, "model": "seasonal",
            "strat": "periodic", "check": "checked", "app": "approved", "pattern": [210, 230, 220, 205, 190, 180, 175, 185, 210, 240, 280, 310]
        },
        {
            "id": "sku_5", "code": "56213-P", "desc": "Belgian Milk Chocolate 200g Pack (12x) [Intermittent]",
            "category": "Food & Beverages / Chocolate", "loc": "WH-East (New Jersey)", "channel": "Supermarkets",
            "supplier": "ChocoDelight BV", "dc": "Central Distribution Center", "bom": "finished",
            "price": 42.0, "cost": 18.5, "margin": 55.9, "on_hand": 60, "on_order": 0, "backorders": 0,
            "lt": 30, "lt_var": 4, "cycle": 30, "sl": 0.95, "moq": 50, "round": 25, "model": "intermittent",
            "strat": "periodic", "check": "undecided", "app": "unapproved", "pattern": [0, 25, 0, 0, 40, 0, 0, 35, 0, 50, 0, 0]
        },
        {
            "id": "sku_6", "code": "056329-PW", "desc": "Natural Spring Bottled Water 500ml [Constant]",
            "category": "Food & Beverages / Water", "loc": "WH-West (San Francisco)", "channel": "Supermarkets",
            "supplier": "AquaPure Bottlers", "dc": "Central Distribution Center", "bom": "finished",
            "price": 1.25, "cost": 0.42, "margin": 66.4, "on_hand": 3400, "on_order": 5000, "backorders": 0,
            "lt": 14, "lt_var": 2, "cycle": 14, "sl": 0.95, "moq": 1000, "round": 500, "model": "constant",
            "strat": "min_max", "check": "checked", "app": "approved", "pattern": [850, 880, 890, 920, 950, 980, 1020, 1010, 940, 910, 870, 860]
        },
        {
            "id": "sku_7", "code": "C1020-BLK", "desc": "Architectural Concrete Block [Constant]",
            "category": "Building Materials", "loc": "Central Distribution Center", "channel": "Contractors",
            "supplier": "SolidBuild Industries", "dc": None, "bom": "finished",
            "price": 8.50, "cost": 3.10, "margin": 63.5, "on_hand": 1800, "on_order": 2000, "backorders": 0,
            "lt": 25, "lt_var": 5, "cycle": 30, "sl": 0.90, "moq": 500, "round": 250, "model": "constant",
            "strat": "periodic", "check": "checked", "app": "approved", "pattern": [300, 320, 350, 420, 450, 480, 460, 440, 380, 340, 310, 290]
        },
        {
            "id": "sku_8", "code": "45645-RP", "desc": "Retro Radio Player Silver [Preorder / New Launch]",
            "category": "Consumer Goods / Electronics", "loc": "WH-East (New Jersey)", "channel": "Direct Retail",
            "supplier": "Sonic Electronics Ltd.", "dc": "Central Distribution Center", "bom": "finished",
            "price": 120.0, "cost": 52.0, "margin": 56.6, "on_hand": 25, "on_order": 200, "backorders": 0,
            "lt": 60, "lt_var": 8, "cycle": 45, "sl": 0.95, "moq": 100, "round": 20, "model": "preorder",
            "strat": "periodic", "check": "attention", "app": "unapproved", "pattern": [0, 0, 0, 0, 0, 0, 0, 0, 15, 30, 55, 80]
        },
        {
            "id": "sku_9", "code": "OLD-990-DISC", "desc": "Legacy Analog Converter [Inactive / Discontinued]",
            "category": "Consumer Goods / Electronics", "loc": "WH-East (New Jersey)", "channel": "Direct Retail",
            "supplier": "Sonic Electronics Ltd.", "dc": None, "bom": "finished",
            "price": 45.0, "cost": 22.0, "margin": 51.1, "on_hand": 180, "on_order": 0, "backorders": 0,
            "lt": 90, "lt_var": 0, "cycle": 90, "sl": 0.80, "moq": 50, "round": 10, "model": "zero",
            "strat": "periodic", "check": "attention", "app": "unapproved", "pattern": [45, 30, 20, 10, 5, 2, 0, 0, 0, 0, 0, 0]
        },
        {
            "id": "sku_10", "code": "MAT-OAK-01", "desc": "Raw Timber Oak Planks (BOM Material for 562156-01)",
            "category": "Raw Materials / Timber", "loc": "Manufacturing Plant", "channel": "Internal Production",
            "supplier": "ForestProducts SA", "dc": None, "bom": "material",
            "price": 0.0, "cost": 45.0, "margin": 0.0, "on_hand": 35, "on_order": 60, "backorders": 0,
            "lt": 30, "lt_var": 4, "cycle": 30, "sl": 0.98, "moq": 50, "round": 10, "model": "auto",
            "strat": "periodic", "check": "checked", "app": "approved", "pattern": [24, 28, 30, 36, 44, 50, 48, 56, 60, 70, 90, 104]
        }
    ]

    hist_dates = [f"2025-{m:02d}" for m in range(1, 13)]
    future_dates = [f"2026-{m:02d}" for m in range(1, 7)]

    for sku in raw_skus:
        pattern = sku["pattern"]
        avg_sales = sum(pattern) / len(pattern)
        mean_daily = avg_sales / 30.0

        z = 1.645 if sku["sl"] == 0.95 else (2.054 if sku["sl"] >= 0.98 else 1.282)
        sigma_d = (avg_sales * 0.25) / 30.0
        ss = round(z * ((sku["lt"] * (sigma_d ** 2) + (mean_daily ** 2) * (sku["lt_var"] ** 2)) ** 0.5))
        rop = round(mean_daily * sku["lt"] + ss)
        order_now = max(0, rop - sku["on_hand"] - sku["on_order"] + sku["backorders"])
        if order_now > 0 and sku["moq"]:
            order_now = max(order_now, sku["moq"])
            if sku["round"] > 1:
                order_now = int(((order_now + sku["round"] - 1) // sku["round"]) * sku["round"])

        days_supply = round((sku["on_hand"] / mean_daily) if mean_daily > 0 else 999)
        order_val = order_now * sku["cost"]

        annual_val = avg_sales * 12 * sku["price"]
        abc = "A" if annual_val >= 25000 else ("B" if annual_val >= 8000 else "C")
        xyz = "X" if sku["model"] in ("constant", "linear") else ("Z" if sku["model"] in ("intermittent", "preorder") else "Y")

        con.execute("""
            INSERT INTO items (
                id, project_id, code, description, category, location, channel, supplier, dc, bom_type,
                sales_price, purchase_price, margin, on_hand, on_order, backorders,
                lead_time_days, lead_time_variance_days, order_cycle_days, service_level,
                min_batch, batch_rounding, model_type, replenishment_strategy,
                check_state, approval_state, abc_class, xyz_class,
                safety_stock, reorder_point, order_now, order_now_value, days_of_supply,
                accuracy, mean_daily_demand, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            sku["id"], project_id, sku["code"], sku["desc"], sku["category"], sku["loc"], sku["channel"], sku["supplier"], sku["dc"], sku["bom"],
            sku["price"], sku["cost"], sku["margin"], sku["on_hand"], sku["on_order"], sku["backorders"],
            sku["lt"], sku["lt_var"], sku["cycle"], sku["sl"],
            sku["moq"], sku["round"], sku["model"], sku["strat"],
            sku["check"], sku["app"], abc, xyz,
            ss, rop, order_now, order_val, days_supply,
            94.5, mean_daily, now_str
        ))

        # Seed model_settings
        con.execute("""
            INSERT INTO model_settings (id, project_id, item_id, forecast_approach, model_type, seasonality_pattern, service_level, lead_time_days, status, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (f"ms_{sku['id']}", project_id, sku["id"], "item", sku["model"], "12 periods", sku["sl"], sku["lt"], "active", now_str))

        # Insert historical periods
        for idx, d in enumerate(hist_dates):
            act = pattern[idx]
            con.execute("""
                INSERT INTO periods (id, project_id, item_id, date, actual, forecast, model, conf_upper, conf_lower, override, promotion)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, (f"per_{sku['id']}_{d}", project_id, sku["id"], d, act, act, act, round(act * 1.15), round(act * 0.85), None, 0.0))

        # Insert future forecast periods
        for idx, d in enumerate(future_dates):
            fc = round(pattern[idx % len(pattern)] * (1.05 if sku["model"] == "linear" else 1.0))
            con.execute("""
                INSERT INTO periods (id, project_id, item_id, date, actual, forecast, model, conf_upper, conf_lower, override, promotion)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, (f"per_{sku['id']}_{d}", project_id, sku["id"], d, 0.0, fc, fc, round(fc * 1.2), round(fc * 0.8), None, 0.0))

    # Seed in_transition shipments
    con.execute("""
        INSERT INTO in_transition (id, project_id, item_code, order_no, origin, destination, quantity, eta_date, carrier, status)
        VALUES
        ('tr_1', ?, '004652-BLU', 'PO-98421', 'Supplier (Port of Lisbon)', 'WH-East (New Jersey)', 350, '2026-03-25', 'Maersk Line', 'on_water'),
        ('tr_2', ?, '1866-MB', 'PO-98444', 'Supplier (Hamburg)', 'WH-West (San Francisco)', 100, '2026-03-18', 'Hapag-Lloyd', 'customs_clearance'),
        ('tr_3', ?, 'VB2166-150', 'PO-98480', 'Pharma Lab (Geneva)', 'WH-East (New Jersey)', 500, '2026-03-10', 'DHL Global Forwarding', 'in_transit')
    """, (project_id, project_id, project_id))

    # Seed saved filters
    con.execute("""
        INSERT INTO saved_filters (id, project_id, name, condition_type, filter_column, operator, filter_value, created_at)
        VALUES
        ('filt_1', ?, 'Stockout Risk Items', 'and', 'days_of_supply', '<', '30', ?),
        ('filt_2', ?, 'Class A High Value', 'and', 'abc_class', '=', 'A', ?),
        ('filt_3', ?, 'Lead Time > 40 Days', 'and', 'lead_time_days', '>', '40', ?)
    """, (project_id, now_str, project_id, now_str, project_id, now_str))


def list_projects() -> List[Dict[str, Any]]:
    """Returns all projects stored in DuckDB."""
    with _LOCK:
        con = get_connection()
        try:
            df = con.execute("SELECT id, name, description, created_at, updated_at, dataset_name, sku_count, status FROM projects ORDER BY updated_at DESC").fetchdf()
            return df.to_dict(orient="records")
        finally:
            con.close()

def get_project_by_id(project_id: str) -> Optional[Dict[str, Any]]:
    """Returns project metadata by id."""
    with _LOCK:
        con = get_connection()
        try:
            df = con.execute("SELECT * FROM projects WHERE id = ?", (project_id,)).fetchdf()
            if df.empty:
                return None
            return df.iloc[0].to_dict()
        finally:
            con.close()

def create_new_project(name: str, description: str = "", dataset_name: str = "") -> Dict[str, Any]:
    """Creates a new project in DuckDB."""
    project_id = f"proj_{uuid.uuid4().hex[:10]}"
    now_str = datetime.datetime.utcnow().isoformat()
    with _LOCK:
        con = get_connection()
        try:
            con.execute("""
                INSERT INTO projects (id, name, description, created_at, updated_at, dataset_name, sku_count, status)
                VALUES (?, ?, ?, ?, ?, ?, 0, 'active')
            """, (project_id, name, description, now_str, now_str, dataset_name))
            return {
                "id": project_id,
                "name": name,
                "description": description,
                "created_at": now_str,
                "updated_at": now_str,
                "dataset_name": dataset_name,
                "sku_count": 0,
                "status": "active"
            }
        finally:
            con.close()

def delete_project_by_id(project_id: str):
    """Deletes a project and all associated items, periods, overrides, and filters."""
    with _LOCK:
        con = get_connection()
        try:
            con.execute("DELETE FROM periods WHERE project_id = ?", (project_id,))
            con.execute("DELETE FROM forecast_overrides WHERE project_id = ?", (project_id,))
            con.execute("DELETE FROM model_settings WHERE project_id = ?", (project_id,))
            con.execute("DELETE FROM items WHERE project_id = ?", (project_id,))
            con.execute("DELETE FROM saved_filters WHERE project_id = ?", (project_id,))
            con.execute("DELETE FROM in_transition WHERE project_id = ?", (project_id,))
            con.execute("DELETE FROM projects WHERE id = ?", (project_id,))
        finally:
            con.close()

def get_project_items(project_id: str) -> List[Dict[str, Any]]:
    """Returns all items for a project, including periods and metrics."""
    with _LOCK:
        con = get_connection()
        try:
            items_df = con.execute("SELECT * FROM items WHERE project_id = ? ORDER BY code ASC", (project_id,)).fetchdf()
            if items_df.empty:
                return []

            periods_df = con.execute("SELECT * FROM periods WHERE project_id = ? ORDER BY date ASC", (project_id,)).fetchdf()
            
            # Group periods by item_id
            periods_by_item: Dict[str, List[Dict[str, Any]]] = {}
            if not periods_df.empty:
                for row in periods_df.to_dict(orient="records"):
                    iid = row["item_id"]
                    if iid not in periods_by_item:
                        periods_by_item[iid] = []
                    periods_by_item[iid].append({
                        "date": str(row["date"]),
                        "actual": clean_float(row["actual"], 0.0),
                        "forecast": clean_opt_float(row.get("forecast")),
                        "model": clean_opt_float(row.get("model")),
                        "confUpper": clean_opt_float(row.get("conf_upper")),
                        "confLower": clean_opt_float(row.get("conf_lower")),
                        "override": clean_opt_float(row.get("override")),
                        "promotion": clean_float(row.get("promotion"), 0.0)
                    })

            res = []
            for item in items_df.to_dict(orient="records"):
                iid = str(item["id"])
                item_dict = {
                    "id": str(item["id"]),
                    "code": str(item["code"]),
                    "description": str(item["description"] or ""),
                    "category": str(item["category"] or "General"),
                    "location": str(item["location"] or "Default WH"),
                    "channel": str(item["channel"] or "Direct"),
                    "supplier": str(item["supplier"] or "Default Supplier"),
                    "dc": str(item["dc"]) if item.get("dc") and pd.notna(item["dc"]) else None,
                    "bomType": str(item["bom_type"]) if item.get("bom_type") and pd.notna(item["bom_type"]) else None,
                    "salesPrice": clean_float(item.get("sales_price"), 0.0),
                    "purchasePrice": clean_float(item.get("purchase_price"), 0.0),
                    "margin": clean_float(item.get("margin"), 0.0),
                    "onHand": clean_float(item.get("on_hand"), 0.0),
                    "onOrder": clean_float(item.get("on_order"), 0.0),
                    "backorders": clean_float(item.get("backorders"), 0.0),
                    "leadTimeDays": clean_float(item.get("lead_time_days"), 30.0),
                    "leadTimeVarianceDays": clean_float(item.get("lead_time_variance_days"), 5.0),
                    "orderCycleDays": clean_float(item.get("order_cycle_days"), 30.0),
                    "serviceLevel": clean_float(item.get("service_level"), 0.95),
                    "minBatch": clean_float(item.get("min_batch"), 1.0),
                    "batchRounding": clean_float(item.get("batch_rounding"), 1.0),
                    "shelfLifeDays": clean_opt_float(item.get("shelf_life_days")),
                    "unitCbm": clean_opt_float(item.get("unit_cbm")),
                    "unitWeightKg": clean_opt_float(item.get("unit_weight_kg")),
                    "modelType": str(item.get("model_type") or "auto"),
                    "replenishmentStrategy": str(item.get("replenishment_strategy") or "periodic"),
                    "checkState": str(item.get("check_state") or "checked"),
                    "approvalState": str(item.get("approval_state") or "unapproved"),
                    "notes": str(item.get("notes") or ""),
                    "abcClass": str(item.get("abc_class") or "C"),
                    "xyzClass": str(item.get("xyz_class") or "Y"),
                    "safetyStock": clean_float(item.get("safety_stock"), 0.0),
                    "reorderPoint": clean_float(item.get("reorder_point"), 0.0),
                    "orderNow": clean_float(item.get("order_now"), 0.0),
                    "orderNowValue": clean_float(item.get("order_now_value"), 0.0),
                    "daysOfSupply": clean_float(item.get("days_of_supply"), 0.0),
                    "transferQty": clean_float(item.get("transfer_qty"), 0.0),
                    "transferSource": str(item["transfer_source"]) if item.get("transfer_source") and pd.notna(item["transfer_source"]) else None,
                    "accuracy": clean_float(item.get("accuracy"), 100.0),
                    "periods": periods_by_item.get(iid, [])
                }
                res.append(item_dict)
            return res
        finally:
            con.close()

def get_workspace(project_id: str) -> Dict[str, Any]:
    """Loads all items, overrides, settings, and filters for that project."""
    project = get_project_by_id(project_id)
    items = get_project_items(project_id)
    filters = get_saved_filters_for_project(project_id)
    transitions = get_in_transition_for_project(project_id)
    kpis = compute_project_kpis(project_id)
    return {
        "project": project,
        "items": items,
        "filters": filters,
        "transitions": transitions,
        "kpis": kpis
    }

def save_period_override(project_id: str, item_id: str, date: str, override_val: Optional[float]):
    """Persists an inline forecast override for a specific SKU period to DuckDB."""
    now_str = datetime.datetime.utcnow().isoformat()
    with _LOCK:
        con = get_connection()
        try:
            # 1. Update periods table
            row = con.execute("SELECT id FROM periods WHERE project_id = ? AND item_id = ? AND date = ?", (project_id, item_id, date)).fetchone()
            if row:
                if override_val is None:
                    con.execute("UPDATE periods SET override = NULL WHERE project_id = ? AND item_id = ? AND date = ?", (project_id, item_id, date))
                else:
                    con.execute("UPDATE periods SET override = ?, forecast = ? WHERE project_id = ? AND item_id = ? AND date = ?", (override_val, override_val, project_id, item_id, date))
            else:
                pid = f"per_{item_id}_{date}"
                con.execute("""
                    INSERT INTO periods (id, project_id, item_id, date, actual, forecast, model, override)
                    VALUES (?, ?, ?, ?, 0.0, ?, ?, ?)
                """, (pid, project_id, item_id, date, override_val or 0.0, override_val or 0.0, override_val))

            # 2. Update/upsert forecast_overrides table
            con.execute("DELETE FROM forecast_overrides WHERE project_id = ? AND item_id = ? AND date = ?", (project_id, item_id, date))
            if override_val is not None:
                foid = f"fo_{item_id}_{date}"
                con.execute("""
                    INSERT INTO forecast_overrides (id, project_id, item_id, date, override_value, updated_at)
                    VALUES (?, ?, ?, ?, ?, ?)
                """, (foid, project_id, item_id, date, override_val, now_str))

            # Update project updated_at timestamp
            con.execute("UPDATE projects SET updated_at = ? WHERE id = ?", (now_str, project_id))
        finally:
            con.close()

def update_item_parameters(project_id: str, item_id: str, updates: Dict[str, Any]):
    """Updates item parameters (modelType, strategy, lead times, service level, etc.) in DuckDB."""
    now_str = datetime.datetime.utcnow().isoformat()
    with _LOCK:
        con = get_connection()
        try:
            col_mapping = {
                "modelType": "model_type",
                "model_type": "model_type",
                "replenishmentStrategy": "replenishment_strategy",
                "replenishment_strategy": "replenishment_strategy",
                "leadTimeDays": "lead_time_days",
                "lead_time_days": "lead_time_days",
                "leadTimeVarianceDays": "lead_time_variance_days",
                "lead_time_variance_days": "lead_time_variance_days",
                "orderCycleDays": "order_cycle_days",
                "order_cycle_days": "order_cycle_days",
                "serviceLevel": "service_level",
                "service_level": "service_level",
                "minBatch": "min_batch",
                "min_batch": "min_batch",
                "batchRounding": "batch_rounding",
                "batch_rounding": "batch_rounding",
                "salesPrice": "sales_price",
                "sales_price": "sales_price",
                "purchasePrice": "purchase_price",
                "purchase_price": "purchase_price",
                "checkState": "check_state",
                "check_state": "check_state",
                "approvalState": "approval_state",
                "approval_state": "approval_state",
                "safetyStock": "safety_stock",
                "safety_stock": "safety_stock",
                "reorderPoint": "reorder_point",
                "reorder_point": "reorder_point",
                "orderNow": "order_now",
                "order_now": "order_now",
                "orderNowValue": "order_now_value",
                "order_now_value": "order_now_value",
                "daysOfSupply": "days_of_supply",
                "days_of_supply": "days_of_supply",
                "accuracy": "accuracy",
                "notes": "notes",
                "unitCbm": "unit_cbm",
                "unit_cbm": "unit_cbm",
                "unitWeightKg": "unit_weight_kg",
                "unit_weight_kg": "unit_weight_kg"
            }

            set_clauses = []
            vals = []
            for k, v in updates.items():
                if k in col_mapping:
                    db_col = col_mapping[k]
                    set_clauses.append(f"{db_col} = ?")
                    vals.append(v)

            if set_clauses:
                set_clauses.append("updated_at = ?")
                vals.append(now_str)
                vals.extend([project_id, item_id])

                sql = f"UPDATE items SET {', '.join(set_clauses)} WHERE project_id = ? AND id = ?"
                con.execute(sql, tuple(vals))

            # Upsert into model_settings if model_type or service_level or lead_time is present
            if any(k in updates for k in ("modelType", "model_type", "serviceLevel", "service_level", "leadTimeDays", "lead_time_days")):
                mtype = updates.get("modelType") or updates.get("model_type") or "auto"
                sl = clean_float(updates.get("serviceLevel") or updates.get("service_level"), 0.95)
                lt = clean_float(updates.get("leadTimeDays") or updates.get("lead_time_days"), 30.0)
                con.execute("DELETE FROM model_settings WHERE project_id = ? AND item_id = ?", (project_id, item_id))
                con.execute("""
                    INSERT INTO model_settings (id, project_id, item_id, forecast_approach, model_type, seasonality_pattern, service_level, lead_time_days, status, updated_at)
                    VALUES (?, ?, ?, 'item', ?, '12 periods', ?, ?, 'active', ?)
                """, (f"ms_{item_id}", project_id, item_id, mtype, sl, lt, now_str))

            con.execute("UPDATE projects SET updated_at = ? WHERE id = ?", (now_str, project_id))
        finally:
            con.close()

def get_saved_filters_for_project(project_id: str) -> List[Dict[str, Any]]:
    """Returns saved filters for a project."""
    with _LOCK:
        con = get_connection()
        try:
            df = con.execute("SELECT * FROM saved_filters WHERE project_id = ? ORDER BY created_at ASC", (project_id,)).fetchdf()
            return df.to_dict(orient="records") if not df.empty else []
        finally:
            con.close()

def add_saved_filter(project_id: str, name: str, col: str, op: str, val: str) -> Dict[str, Any]:
    """Adds a new filter to DuckDB."""
    fid = f"filt_{uuid.uuid4().hex[:8]}"
    now_str = datetime.datetime.utcnow().isoformat()
    with _LOCK:
        con = get_connection()
        try:
            con.execute("""
                INSERT INTO saved_filters (id, project_id, name, filter_column, operator, filter_value, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?)
            """, (fid, project_id, name, col, op, val, now_str))
            return {
                "id": fid,
                "project_id": project_id,
                "name": name,
                "filter_column": col,
                "operator": op,
                "filter_value": val,
                "created_at": now_str
            }
        finally:
            con.close()

def delete_filter_by_id(filter_id: str):
    """Deletes a filter by id."""
    with _LOCK:
        con = get_connection()
        try:
            con.execute("DELETE FROM saved_filters WHERE id = ?", (filter_id,))
        finally:
            con.close()

def get_in_transition_for_project(project_id: str) -> List[Dict[str, Any]]:
    """Returns shipments in transit."""
    with _LOCK:
        con = get_connection()
        try:
            df = con.execute("SELECT * FROM in_transition WHERE project_id = ?", (project_id,)).fetchdf()
            return df.to_dict(orient="records") if not df.empty else []
        finally:
            con.close()

def add_in_transition_record(project_id: str, record: Dict[str, Any]) -> Dict[str, Any]:
    """Adds a shipment to in_transition."""
    tid = f"tr_{uuid.uuid4().hex[:8]}"
    with _LOCK:
        con = get_connection()
        try:
            con.execute("""
                INSERT INTO in_transition (id, project_id, item_code, order_no, origin, destination, quantity, eta_date, carrier, status)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, (
                tid, project_id, record.get("item_code", ""), record.get("order_no", ""),
                record.get("origin", ""), record.get("destination", ""), float(record.get("quantity", 0)),
                record.get("eta_date", ""), record.get("carrier", ""), record.get("status", "in_transit")
            ))
            record["id"] = tid
            return record
        finally:
            con.close()

def bulk_upsert_in_transit(project_id: str, records: List[Dict[str, Any]], merge_mode: str = "merge") -> int:
    """Bulk upserts or replaces in-transit shipments in DuckDB."""
    with _LOCK:
        con = get_connection()
        try:
            if merge_mode == "replace":
                con.execute("DELETE FROM in_transition WHERE project_id = ?", (project_id,))
            count = 0
            for r in records:
                code = str(r.get("item_code", r.get("code", ""))).strip()
                ord_no = str(r.get("order_no", r.get("po_number", r.get("order", "")))).strip()
                if not code or not ord_no:
                    continue
                tid = f"tr_{uuid.uuid4().hex[:10]}"
                qty = clean_float(r.get("quantity", r.get("qty", 0.0)))
                eta = str(r.get("eta_date", r.get("eta", ""))).strip() or "2026-03-30"
                carrier = str(r.get("carrier", "Ocean Freight")).strip() or "Ocean Freight"
                status = str(r.get("status", "in_transit")).strip() or "in_transit"
                origin = str(r.get("origin", "Supplier Port")).strip() or "Supplier Port"
                dest = str(r.get("destination", "Main Warehouse")).strip() or "Main Warehouse"

                con.execute("""
                    INSERT INTO in_transition (
                        id, project_id, item_code, order_no, origin, destination, quantity, eta_date, carrier, status
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """, (tid, project_id, code, ord_no, origin, dest, qty, eta, carrier, status))
                count += 1
            return count
        finally:
            con.close()

def compute_project_kpis(project_id: str) -> Dict[str, Any]:
    """Computes real aggregate supply chain KPIs dynamically from DuckDB."""
    with _LOCK:
        con = get_connection()
        try:
            # Query aggregates from items
            row = con.execute("""
                SELECT 
                    COUNT(*) as total_skus,
                    SUM(on_hand * purchase_price) as total_inventory_value,
                    SUM(order_now * purchase_price) as total_order_value,
                    SUM(CASE WHEN days_of_supply > 90 THEN (days_of_supply - 90) * (purchase_price * mean_daily_demand) ELSE 0 END) as total_overstock,
                    SUM(CASE WHEN days_of_supply < 14 THEN (14 - days_of_supply) * (sales_price * mean_daily_demand) ELSE 0 END) as total_stockout_loss,
                    SUM(CASE WHEN model_type = 'zero' THEN on_hand * purchase_price ELSE 0 END) as total_dead_inv,
                    AVG(accuracy) as avg_accuracy,
                    AVG(days_of_supply) as avg_days_supply,
                    SUM(mean_daily_demand * 365 * sales_price) as projected_annual_revenue,
                    SUM(mean_daily_demand * 365 * purchase_price) as projected_annual_cogs
                FROM items
                WHERE project_id = ?
            """, (project_id,)).fetchone()

            total_skus = row[0] or 0
            inv_val = float(row[1] or 0)
            order_val = float(row[2] or 0)
            overstock_val = float(row[3] or 0)
            stockout_loss = float(row[4] or 0)
            dead_inv = float(row[5] or 0)
            avg_acc = float(row[6] or 0)
            avg_dos = float(row[7] or 0)
            revenue = float(row[8] or 0)
            cogs = float(row[9] or 0)

            margin_pct = ((revenue - cogs) / revenue * 100.0) if revenue > 0 else 0.0
            turns = (cogs / inv_val) if inv_val > 0 else 0.0

            return {
                "totalSkus": total_skus,
                "totalInventoryValue": round(inv_val, 2),
                "totalOrderValue": round(order_val, 2),
                "totalOverstockValue": round(overstock_val, 2),
                "totalStockoutLossValue": round(stockout_loss, 2),
                "totalDeadInventoryValue": round(dead_inv, 2),
                "overallForecastAccuracy": round(avg_acc, 1),
                "daysOfSupply": round(avg_dos, 1),
                "projectedAnnualRevenue": round(revenue, 2),
                "grossMarginPct": round(margin_pct, 1),
                "inventoryTurns": round(turns, 1),
                "carryingCostSavings": round(overstock_val * 0.22, 2), # 22% annual carrying cost benchmark
                "releasedCapital": round(overstock_val * 0.85, 2),
                "activeOrdersCount": con.execute("SELECT COUNT(*) FROM items WHERE project_id = ? AND order_now > 0", (project_id,)).fetchone()[0] or 0
            }
        finally:
            con.close()

def _ensure_settings_table(con):
    con.execute("""
        CREATE TABLE IF NOT EXISTS app_settings (
            id VARCHAR PRIMARY KEY,
            language VARCHAR DEFAULT 'en',
            currency_code VARCHAR DEFAULT 'EGP',
            currency_symbol VARCHAR DEFAULT 'ج.م',
            currency_position VARCHAR DEFAULT 'after',
            decimal_places INTEGER DEFAULT 2,
            exchange_rate DOUBLE DEFAULT 1.0,
            analysis_lookback_periods INTEGER DEFAULT 12,
            forecast_horizon_periods INTEGER DEFAULT 12,
            period_granularity VARCHAR DEFAULT 'monthly',
            default_forecast_model VARCHAR DEFAULT 'auto',
            default_service_level DOUBLE DEFAULT 0.95,
            default_replenishment_policy VARCHAR DEFAULT 'periodic',
            default_order_cycle_days DOUBLE DEFAULT 30.0,
            default_lead_time_days DOUBLE DEFAULT 7.0,
            overstock_threshold_days DOUBLE DEFAULT 90.0,
            dead_stock_days DOUBLE DEFAULT 60.0,
            abc_a_cutoff DOUBLE DEFAULT 80.0,
            abc_b_cutoff DOUBLE DEFAULT 95.0,
            xyz_x_cv DOUBLE DEFAULT 0.5,
            xyz_y_cv DOUBLE DEFAULT 1.0,
            updated_at VARCHAR
        )
    """)

def get_app_settings() -> Dict[str, Any]:
    """Retrieves persistent application settings from DuckDB."""
    with _LOCK:
        con = get_connection()
        try:
            _ensure_settings_table(con)
            row = con.execute("""
                SELECT 
                    language, currency_code, currency_symbol, currency_position,
                    decimal_places, exchange_rate, analysis_lookback_periods, forecast_horizon_periods,
                    period_granularity, default_forecast_model, default_service_level, default_replenishment_policy,
                    default_order_cycle_days, default_lead_time_days, overstock_threshold_days, dead_stock_days,
                    abc_a_cutoff, abc_b_cutoff, xyz_x_cv, xyz_y_cv, updated_at
                FROM app_settings
                WHERE id = 'global_settings'
            """).fetchone()

            if not row:
                now_str = datetime.datetime.utcnow().isoformat()
                con.execute("""
                    INSERT INTO app_settings (
                        id, language, currency_code, currency_symbol, currency_position,
                        decimal_places, exchange_rate, analysis_lookback_periods, forecast_horizon_periods,
                        period_granularity, default_forecast_model, default_service_level, default_replenishment_policy,
                        default_order_cycle_days, default_lead_time_days, overstock_threshold_days, dead_stock_days,
                        abc_a_cutoff, abc_b_cutoff, xyz_x_cv, xyz_y_cv, updated_at
                    ) VALUES (
                        'global_settings', 'en', 'EGP', 'ج.م', 'after',
                        2, 1.0, 12, 12,
                        'monthly', 'auto', 0.95, 'periodic',
                        30.0, 7.0, 90.0, 60.0,
                        80.0, 95.0, 0.5, 1.0, ?
                    )
                """, (now_str,))
                return {
                    "language": "en",
                    "currency_code": "EGP",
                    "currency_symbol": "ج.م",
                    "currency_position": "after",
                    "decimal_places": 2,
                    "exchange_rate": 1.0,
                    "analysis_lookback_periods": 12,
                    "forecast_horizon_periods": 12,
                    "period_granularity": "monthly",
                    "default_forecast_model": "auto",
                    "default_service_level": 0.95,
                    "default_replenishment_policy": "periodic",
                    "default_order_cycle_days": 30.0,
                    "default_lead_time_days": 7.0,
                    "overstock_threshold_days": 90.0,
                    "dead_stock_days": 60.0,
                    "abc_a_cutoff": 80.0,
                    "abc_b_cutoff": 95.0,
                    "xyz_x_cv": 0.5,
                    "xyz_y_cv": 1.0,
                    "updated_at": now_str
                }

            return {
                "language": row[0] or "en",
                "currency_code": row[1] or "EGP",
                "currency_symbol": row[2] or "ج.م",
                "currency_position": row[3] or "after",
                "decimal_places": int(row[4] if row[4] is not None else 2),
                "exchange_rate": clean_float(row[5], 1.0),
                "analysis_lookback_periods": int(row[6] if row[6] is not None else 12),
                "forecast_horizon_periods": int(row[7] if row[7] is not None else 12),
                "period_granularity": row[8] or "monthly",
                "default_forecast_model": row[9] or "auto",
                "default_service_level": clean_float(row[10], 0.95),
                "default_replenishment_policy": row[11] or "periodic",
                "default_order_cycle_days": clean_float(row[12], 30.0),
                "default_lead_time_days": clean_float(row[13], 7.0),
                "overstock_threshold_days": clean_float(row[14], 90.0),
                "dead_stock_days": clean_float(row[15], 60.0),
                "abc_a_cutoff": clean_float(row[16], 80.0),
                "abc_b_cutoff": clean_float(row[17], 95.0),
                "xyz_x_cv": clean_float(row[18], 0.5),
                "xyz_y_cv": clean_float(row[19], 1.0),
                "updated_at": row[20]
            }
        finally:
            con.close()

def save_app_settings(updates: Dict[str, Any]) -> Dict[str, Any]:
    """Updates persistent application settings in DuckDB."""
    with _LOCK:
        con = get_connection()
        try:
            _ensure_settings_table(con)
            # Ensure global_settings row exists
            current = con.execute("SELECT COUNT(*) FROM app_settings WHERE id = 'global_settings'").fetchone()[0]
            now_str = datetime.datetime.utcnow().isoformat()
            if current == 0:
                con.execute("""
                    INSERT INTO app_settings (
                        id, language, currency_code, currency_symbol, currency_position,
                        decimal_places, exchange_rate, analysis_lookback_periods, forecast_horizon_periods,
                        period_granularity, default_forecast_model, default_service_level, default_replenishment_policy,
                        default_order_cycle_days, default_lead_time_days, overstock_threshold_days, dead_stock_days,
                        abc_a_cutoff, abc_b_cutoff, xyz_x_cv, xyz_y_cv, updated_at
                    ) VALUES (
                        'global_settings', 'en', 'EGP', 'ج.م', 'after',
                        2, 1.0, 12, 12,
                        'monthly', 'auto', 0.95, 'periodic',
                        30.0, 7.0, 90.0, 60.0,
                        80.0, 95.0, 0.5, 1.0, ?
                    )
                """, (now_str,))

            allowed = {
                "language", "currency_code", "currency_symbol", "currency_position",
                "decimal_places", "exchange_rate", "analysis_lookback_periods", "forecast_horizon_periods",
                "period_granularity", "default_forecast_model", "default_service_level", "default_replenishment_policy",
                "default_order_cycle_days", "default_lead_time_days", "overstock_threshold_days", "dead_stock_days",
                "abc_a_cutoff", "abc_b_cutoff", "xyz_x_cv", "xyz_y_cv"
            }
            set_clauses = ["updated_at = ?"]
            params = [now_str]
            for k, v in updates.items():
                if k in allowed and v is not None:
                    set_clauses.append(f"{k} = ?")
                    params.append(v)

            params.append('global_settings')
            con.execute(f"UPDATE app_settings SET {', '.join(set_clauses)} WHERE id = ?", params)
        finally:
            con.close()
    return get_app_settings()

def _ensure_ingestion_and_erp_tables(con):
    """Creates ingestion_logs and erp_connections tables and ensures schema consistency."""
    con.execute("""
        CREATE TABLE IF NOT EXISTS ingestion_logs (
            id VARCHAR PRIMARY KEY,
            project_id VARCHAR NOT NULL,
            source_type VARCHAR NOT NULL,
            source_name VARCHAR NOT NULL,
            data_category VARCHAR NOT NULL,
            rows_processed INTEGER DEFAULT 0,
            status VARCHAR DEFAULT 'success',
            error_message VARCHAR,
            created_at VARCHAR
        )
    """)
    con.execute("""
        CREATE TABLE IF NOT EXISTS erp_connections (
            id VARCHAR PRIMARY KEY,
            project_id VARCHAR,
            name VARCHAR NOT NULL,
            source_type VARCHAR DEFAULT 'sql_server',
            server_host VARCHAR,
            database_name VARCHAR,
            auth_mode VARCHAR,
            username VARCHAR,
            password_enc VARCHAR,
            items_table VARCHAR,
            sales_table VARCHAR,
            inventory_table VARCHAR,
            bom_table VARCHAR,
            custom_sql VARCHAR,
            api_url VARCHAR,
            api_auth_header VARCHAR,
            last_sync_time VARCHAR,
            last_sync_status VARCHAR,
            created_at VARCHAR
        )
    """)
    # Add any missing columns to erp_connections if table already existed
    try:
        existing_cols = [c[1].lower() for c in con.execute("PRAGMA table_info('erp_connections')").fetchall()]
        needed = [
            ("project_id", "VARCHAR"),
            ("source_type", "VARCHAR DEFAULT 'sql_server'"),
            ("password_enc", "VARCHAR"),
            ("items_table", "VARCHAR"),
            ("sales_table", "VARCHAR"),
            ("inventory_table", "VARCHAR"),
            ("bom_table", "VARCHAR"),
            ("custom_sql", "VARCHAR"),
            ("api_url", "VARCHAR"),
            ("api_auth_header", "VARCHAR"),
            ("last_sync_status", "VARCHAR"),
            ("created_at", "VARCHAR")
        ]
        for col_name, col_type in needed:
            if col_name.lower() not in existing_cols:
                try:
                    con.execute(f"ALTER TABLE erp_connections ADD COLUMN {col_name} {col_type}")
                except Exception:
                    pass
    except Exception:
        pass

def add_ingestion_log(
    project_id: str,
    source_type: str,
    source_name: str,
    data_category: str,
    rows_processed: int = 0,
    status: str = "success",
    error_message: Optional[str] = None
) -> Dict[str, Any]:
    """Records an ingestion activity to the audit log."""
    log_id = f"log_{uuid.uuid4().hex[:12]}"
    now_str = datetime.datetime.utcnow().isoformat()
    with _LOCK:
        con = get_connection()
        try:
            _ensure_ingestion_and_erp_tables(con)
            con.execute("""
                INSERT INTO ingestion_logs (
                    id, project_id, source_type, source_name, data_category,
                    rows_processed, status, error_message, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, (
                log_id, project_id, source_type, source_name, data_category,
                rows_processed, status, error_message, now_str
            ))
            return {
                "id": log_id,
                "project_id": project_id,
                "source_type": source_type,
                "source_name": source_name,
                "data_category": data_category,
                "rows_processed": rows_processed,
                "status": status,
                "error_message": error_message,
                "created_at": now_str
            }
        finally:
            con.close()

def get_ingestion_logs(project_id: Optional[str] = None, limit: int = 50) -> List[Dict[str, Any]]:
    """Returns recent ingestion audit logs, optionally filtered by project_id."""
    with _LOCK:
        con = get_connection()
        try:
            _ensure_ingestion_and_erp_tables(con)
            if project_id and project_id != "all":
                df = con.execute("""
                    SELECT * FROM ingestion_logs
                    WHERE project_id = ?
                    ORDER BY created_at DESC
                    LIMIT ?
                """, (project_id, limit)).fetchdf()
            else:
                df = con.execute("""
                    SELECT * FROM ingestion_logs
                    ORDER BY created_at DESC
                    LIMIT ?
                """, (limit,)).fetchdf()
            return df.fillna("").to_dict(orient="records")
        finally:
            con.close()

def save_erp_connection(conn_dict: Dict[str, Any]) -> Dict[str, Any]:
    """Saves or updates an ERP or API connection profile."""
    conn_id = conn_dict.get("id") or f"conn_{uuid.uuid4().hex[:10]}"
    now_str = datetime.datetime.utcnow().isoformat()
    with _LOCK:
        con = get_connection()
        try:
            _ensure_ingestion_and_erp_tables(con)
            existing = con.execute("SELECT COUNT(*) FROM erp_connections WHERE id = ?", (conn_id,)).fetchone()[0]
            if existing > 0:
                con.execute("""
                    UPDATE erp_connections SET
                        name = ?,
                        project_id = ?,
                        source_type = ?,
                        server_host = ?,
                        database_name = ?,
                        auth_mode = ?,
                        username = ?,
                        items_table = ?,
                        sales_table = ?,
                        inventory_table = ?,
                        bom_table = ?,
                        custom_sql = ?,
                        api_url = ?,
                        api_auth_header = ?,
                        last_sync_time = ?,
                        last_sync_status = ?
                    WHERE id = ?
                """, (
                    conn_dict.get("name", "ERP Connection"),
                    conn_dict.get("project_id"),
                    conn_dict.get("source_type", "sql_server"),
                    conn_dict.get("server_host"),
                    conn_dict.get("database_name"),
                    conn_dict.get("auth_mode", "sql"),
                    conn_dict.get("username"),
                    conn_dict.get("items_table"),
                    conn_dict.get("sales_table"),
                    conn_dict.get("inventory_table"),
                    conn_dict.get("bom_table"),
                    conn_dict.get("custom_sql"),
                    conn_dict.get("api_url"),
                    conn_dict.get("api_auth_header"),
                    now_str,
                    conn_dict.get("last_sync_status", "active"),
                    conn_id
                ))
            else:
                con.execute("""
                    INSERT INTO erp_connections (
                        id, project_id, name, source_type, server_host, database_name,
                        auth_mode, username, items_table, sales_table,
                        inventory_table, bom_table, custom_sql, api_url,
                        api_auth_header, last_sync_time, last_sync_status, created_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """, (
                    conn_id,
                    conn_dict.get("project_id"),
                    conn_dict.get("name", "ERP Connection"),
                    conn_dict.get("source_type", "sql_server"),
                    conn_dict.get("server_host"),
                    conn_dict.get("database_name"),
                    conn_dict.get("auth_mode", "sql"),
                    conn_dict.get("username"),
                    conn_dict.get("items_table"),
                    conn_dict.get("sales_table"),
                    conn_dict.get("inventory_table"),
                    conn_dict.get("bom_table"),
                    conn_dict.get("custom_sql"),
                    conn_dict.get("api_url"),
                    conn_dict.get("api_auth_header"),
                    now_str,
                    conn_dict.get("last_sync_status", "active"),
                    now_str
                ))
            conn_dict["id"] = conn_id
            conn_dict["last_sync_time"] = now_str
            return conn_dict
        finally:
            con.close()

def get_erp_connections(project_id: Optional[str] = None) -> List[Dict[str, Any]]:
    """Returns saved ERP/API connection profiles."""
    with _LOCK:
        con = get_connection()
        try:
            _ensure_ingestion_and_erp_tables(con)
            if project_id and project_id != "all":
                df = con.execute("""
                    SELECT * FROM erp_connections
                    WHERE project_id = ? OR project_id IS NULL
                    ORDER BY last_sync_time DESC
                """, (project_id,)).fetchdf()
            else:
                df = con.execute("SELECT * FROM erp_connections ORDER BY last_sync_time DESC").fetchdf()
            return df.fillna("").to_dict(orient="records")
        finally:
            con.close()

def get_erp_connection(conn_id: str) -> Optional[Dict[str, Any]]:
    """Returns an ERP connection profile by id."""
    with _LOCK:
        con = get_connection()
        try:
            _ensure_ingestion_and_erp_tables(con)
            df = con.execute("SELECT * FROM erp_connections WHERE id = ?", (conn_id,)).fetchdf()
            if df.empty:
                return None
            return df.fillna("").iloc[0].to_dict()
        finally:
            con.close()

def upsert_items_and_periods(
    project_id: str,
    items_data: List[Dict[str, Any]],
    periods_data: Optional[List[Dict[str, Any]]] = None,
    merge_mode: str = "merge"
) -> Dict[str, Any]:
    """
    Upserts or replaces inventory items and historical/forecast periods in DuckDB.
    Calculates safety stock, reorder point, ABC/XYZ, and days of supply.
    """
    now_str = datetime.datetime.utcnow().isoformat()
    items_upserted = 0
    periods_upserted = 0

    with _LOCK:
        con = get_connection()
        try:
            if merge_mode == "replace":
                if items_data:
                    con.execute("DELETE FROM periods WHERE project_id = ?", (project_id,))
                    con.execute("DELETE FROM items WHERE project_id = ?", (project_id,))
                elif periods_data:
                    con.execute("DELETE FROM periods WHERE project_id = ?", (project_id,))

            # Build map of existing items {code: id}
            existing_rows = con.execute("SELECT id, code FROM items WHERE project_id = ?", (project_id,)).fetchall()
            existing_items_map = {row[1]: row[0] for row in existing_rows}

            for itm in items_data:
                code = str(itm.get("code", "")).strip()
                if not code:
                    continue

                desc = str(itm.get("description", "")).strip() or f"Item {code}"
                cat = str(itm.get("category", "")).strip() or "General"
                loc = str(itm.get("location", "")).strip() or "Main Warehouse"
                channel = str(itm.get("channel", "")).strip() or "Standard Channel"
                supplier = str(itm.get("supplier", "")).strip() or "Primary Supplier"
                price = clean_float(itm.get("sales_price", itm.get("price", 0.0)))
                cost = clean_float(itm.get("purchase_price", itm.get("cost", 0.0)))
                margin = round((price - cost) / price * 100 if price > 0 else 0.0, 1)
                on_hand = clean_float(itm.get("on_hand", itm.get("stock", 0.0)))
                on_order = clean_float(itm.get("on_order", 0.0))
                backorders = clean_float(itm.get("backorders", 0.0))
                lt = clean_float(itm.get("lead_time_days", itm.get("lt", 30.0)))
                lt_var = clean_float(itm.get("lead_time_variance_days", itm.get("lt_var", 5.0)))
                cycle = clean_float(itm.get("order_cycle_days", itm.get("cycle", 30.0)))
                sl = clean_float(itm.get("service_level", itm.get("sl", 0.95)))
                moq = clean_float(itm.get("min_batch", itm.get("moq", 1.0)))
                brou = clean_float(itm.get("batch_rounding", itm.get("round", 1.0)))
                model = str(itm.get("model_type", "auto"))
                strat = str(itm.get("replenishment_strategy", "periodic"))

                # Math calculations
                mean_daily = clean_float(itm.get("mean_daily_demand", 5.0))
                z = 2.054 if sl >= 0.98 else (1.645 if sl >= 0.95 else 1.282)
                sigma_d = mean_daily * 0.3
                ss = round(z * ((lt * (sigma_d ** 2) + (mean_daily ** 2) * (lt_var ** 2)) ** 0.5))
                rop = round(mean_daily * lt + ss)
                order_now = max(0.0, rop - on_hand - on_order + backorders)
                if order_now > 0 and moq > 1:
                    order_now = max(order_now, moq)
                if order_now > 0 and brou > 1:
                    order_now = math.ceil(order_now / brou) * brou
                order_val = order_now * cost
                dos = round(on_hand / mean_daily if mean_daily > 0 else 999.0)

                annual_val = mean_daily * 365 * price
                abc = "A" if annual_val >= 25000 else ("B" if annual_val >= 8000 else "C")
                xyz = "X" if model in ("constant", "linear") else ("Z" if model in ("intermittent", "preorder") else "Y")

                if code in existing_items_map:
                    item_id = existing_items_map[code]
                    con.execute("""
                        UPDATE items SET
                            description = ?, category = ?, location = ?, channel = ?, supplier = ?,
                            sales_price = ?, purchase_price = ?, margin = ?,
                            on_hand = ?, on_order = ?, backorders = ?,
                            lead_time_days = ?, lead_time_variance_days = ?, order_cycle_days = ?,
                            service_level = ?, min_batch = ?, batch_rounding = ?,
                            safety_stock = ?, reorder_point = ?, order_now = ?, order_now_value = ?,
                            days_of_supply = ?, abc_class = ?, xyz_class = ?, updated_at = ?
                        WHERE id = ?
                    """, (
                        desc, cat, loc, channel, supplier,
                        price, cost, margin,
                        on_hand, on_order, backorders,
                        lt, lt_var, cycle,
                        sl, moq, brou,
                        ss, rop, order_now, order_val,
                        dos, abc, xyz, now_str,
                        item_id
                    ))
                else:
                    item_id = f"{project_id}_{uuid.uuid4().hex[:8]}"
                    con.execute("""
                        INSERT INTO items (
                            id, project_id, code, description, category, location, channel, supplier,
                            sales_price, purchase_price, margin, on_hand, on_order, backorders,
                            lead_time_days, lead_time_variance_days, order_cycle_days, service_level,
                            min_batch, batch_rounding, model_type, replenishment_strategy,
                            check_state, approval_state, abc_class, xyz_class,
                            safety_stock, reorder_point, order_now, order_now_value, days_of_supply,
                            accuracy, mean_daily_demand, updated_at
                        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'checked', 'unapproved', ?, ?, ?, ?, ?, ?, ?, 95.0, ?, ?)
                    """, (
                        item_id, project_id, code, desc, cat, loc, channel, supplier,
                        price, cost, margin, on_hand, on_order, backorders,
                        lt, lt_var, cycle, sl,
                        moq, brou, model, strat,
                        abc, xyz, ss, rop, order_now, order_val, dos,
                        mean_daily, now_str
                    ))
                    existing_items_map[code] = item_id

                items_upserted += 1

            # Ingest periods if provided
            if periods_data:
                for per in periods_data:
                    code = str(per.get("code", "")).strip()
                    item_id = per.get("item_id") or existing_items_map.get(code)
                    if not item_id:
                        # Auto-create minimal item for this SKU if missing
                        if code:
                            item_id = f"{project_id}_{uuid.uuid4().hex[:8]}"
                            con.execute("""
                                INSERT INTO items (
                                    id, project_id, code, description, category, location,
                                    sales_price, purchase_price, on_hand, lead_time_days, updated_at
                                ) VALUES (?, ?, ?, ?, 'General', 'Main Warehouse', 100.0, 50.0, 50.0, 30.0, ?)
                            """, (item_id, project_id, code, f"Item {code}", now_str))
                            existing_items_map[code] = item_id
                        else:
                            continue

                    date_str = str(per.get("date", per.get("period", ""))).strip()
                    if not date_str:
                        continue

                    actual = clean_float(per.get("actual", per.get("qty_sold", 0.0)))
                    forecast = clean_opt_float(per.get("forecast"))
                    override = clean_opt_float(per.get("override"))
                    promotion = clean_float(per.get("promotion", 0.0))

                    # Check if period exists
                    existing_p = con.execute("SELECT id FROM periods WHERE project_id = ? AND item_id = ? AND date = ?", (project_id, item_id, date_str)).fetchone()
                    if existing_p:
                        con.execute("""
                            UPDATE periods SET
                                actual = ?, forecast = COALESCE(?, forecast),
                                override = COALESCE(?, override), promotion = ?
                            WHERE id = ?
                        """, (actual, forecast, override, promotion, existing_p[0]))
                    else:
                        pid = f"per_{uuid.uuid4().hex[:10]}"
                        con.execute("""
                            INSERT INTO periods (
                                id, project_id, item_id, date, actual, forecast, model,
                                conf_upper, conf_lower, override, promotion
                            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                        """, (
                            pid, project_id, item_id, date_str, actual,
                            forecast or actual, forecast or actual,
                            round((forecast or actual) * 1.15), round((forecast or actual) * 0.85),
                            override, promotion
                        ))
                    periods_upserted += 1

            # Update project SKU count & timestamp
            con.execute("""
                UPDATE projects SET
                    sku_count = (SELECT COUNT(*) FROM items WHERE project_id = ?),
                    updated_at = ?
                WHERE id = ?
            """, (project_id, now_str, project_id))

            return {
                "success": True,
                "project_id": project_id,
                "items_upserted": items_upserted,
                "periods_upserted": periods_upserted
            }
        finally:
            con.close()

