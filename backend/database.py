"""
NEXO Enterprise Supply Chain Planning Platform
Local Embedded Columnar Database Layer (DuckDB)
Persists projects, items, periods, overrides, model settings, and configurations to disk.
"""

import os
from pathlib import Path
import json
import uuid
import datetime
import math
import re
import threading
from typing import Dict, List, Any, Optional, Tuple
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

BASE_DIR = Path(__file__).resolve().parent
DEFAULT_DB_PATH = str(BASE_DIR / "nexo_workspace.duckdb")

def get_db_path() -> str:
    return os.environ.get("NEXO_DB_PATH", DEFAULT_DB_PATH)

DB_PATH = get_db_path()
_LOCK = threading.RLock()

class DuckDBResilientConnection:
    """
    Wrapper around DuckDBPyConnection that safely normalizes query parameters,
    such as removing unsupported pseudo-parameters like strict_mode=false
    so read_csv_auto calls execute cleanly in DuckDB without binder errors.
    """
    def __init__(self, raw_con):
        self._con = raw_con

    def execute(self, query, *args, **kwargs):
        if isinstance(query, str) and "strict_mode" in query:
            query = re.sub(r'\s*strict_mode\s*=\s*(?:false|true)\s*,?', '', query, flags=re.IGNORECASE)
            query = re.sub(r',\s*\)', ')', query)
        return self._con.execute(query, *args, **kwargs)

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc_val, exc_tb):
        if hasattr(self._con, "__exit__"):
            return self._con.__exit__(exc_type, exc_val, exc_tb)

    def __getattr__(self, name):
        return getattr(self._con, name)

def get_connection():
    """Returns a DuckDB connection to the local database file with memory cap and performance pragmas."""
    con = duckdb.connect(get_db_path())
    try:
        con.execute("SET memory_limit='512MB';")
        con.execute("SET preserve_insertion_order=false;")
    except Exception:
        pass
    return DuckDBResilientConnection(con)

def flush_db():
    """Forces DuckDB WAL changes to be flushed immediately to disk via CHECKPOINT."""
    with _LOCK:
        try:
            con = duckdb.connect(get_db_path())
            con.execute("CHECKPOINT;")
            con.close()
        except Exception:
            pass

def close_db():
    """Flushes WAL to disk and cleanly closes any database resources."""
    flush_db()

def _ensure_projects_table(con):
    con.execute("""
        CREATE TABLE IF NOT EXISTS projects (
            id VARCHAR PRIMARY KEY,
            name VARCHAR NOT NULL,
            description VARCHAR,
            granularity VARCHAR DEFAULT 'monthly',
            currency_code VARCHAR DEFAULT 'EGP',
            item_count INTEGER DEFAULT 0,
            sku_count INTEGER DEFAULT 0,
            created_at VARCHAR,
            updated_at VARCHAR,
            dataset_name VARCHAR,
            status VARCHAR DEFAULT 'active'
        )
    """)
    existing_cols = [c[1].lower() for c in con.execute("PRAGMA table_info('projects')").fetchall()]
    if "granularity" not in existing_cols:
        try:
            con.execute("ALTER TABLE projects ADD COLUMN granularity VARCHAR DEFAULT 'monthly'")
        except Exception:
            pass
    if "currency_code" not in existing_cols:
        try:
            con.execute("ALTER TABLE projects ADD COLUMN currency_code VARCHAR DEFAULT 'EGP'")
        except Exception:
            pass
    if "item_count" not in existing_cols:
        try:
            con.execute("ALTER TABLE projects ADD COLUMN item_count INTEGER DEFAULT 0")
        except Exception:
            pass

def _ensure_persistent_project_tables(con):
    con.execute("""
        CREATE TABLE IF NOT EXISTS project_items (
            project_id VARCHAR,
            code VARCHAR,
            description VARCHAR,
            category VARCHAR,
            location VARCHAR,
            on_hand DOUBLE DEFAULT 0.0,
            on_order DOUBLE DEFAULT 0.0,
            lead_time DOUBLE DEFAULT 30.0,
            lt_variability DOUBLE DEFAULT 5.0,
            service_level DOUBLE DEFAULT 0.95,
            moq DOUBLE DEFAULT 1.0,
            batch_rounding DOUBLE DEFAULT 1.0,
            cost DOUBLE DEFAULT 0.0,
            price DOUBLE DEFAULT 0.0,
            supplier VARCHAR,
            PRIMARY KEY (project_id, code, location)
        )
    """)
    con.execute("""
        CREATE TABLE IF NOT EXISTS project_periods (
            project_id VARCHAR,
            code VARCHAR,
            location VARCHAR,
            period VARCHAR,
            qty_sold DOUBLE DEFAULT 0.0,
            revenue DOUBLE DEFAULT 0.0,
            PRIMARY KEY (project_id, code, location, period)
        )
    """)
    con.execute("""
        CREATE TABLE IF NOT EXISTS project_in_transit (
            project_id VARCHAR,
            id VARCHAR,
            code VARCHAR,
            location VARCHAR,
            po_number VARCHAR,
            qty_in_transit DOUBLE DEFAULT 0.0,
            expected_date VARCHAR,
            supplier VARCHAR,
            status VARCHAR
        )
    """)

def init_db():
    """Initializes tables in DuckDB if they do not exist, anchoring state to disk."""
    with _LOCK:
        con = get_connection()
        try:
            # 1. Projects and persistent multi-project tables
            _ensure_projects_table(con)
            _ensure_persistent_project_tables(con)
            _ensure_settings_table(con)

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
                    promotion DOUBLE DEFAULT 0.0,
                    revenue DOUBLE DEFAULT 0.0
                )
            """)

            # Ensure revenue column exists if periods was created earlier
            existing_p_cols = [c[1].lower() for c in con.execute("PRAGMA table_info('periods')").fetchall()]
            if "revenue" not in existing_p_cols:
                try:
                    con.execute("ALTER TABLE periods ADD COLUMN revenue DOUBLE DEFAULT 0.0")
                except Exception:
                    pass

            # Daily sales staging and transactional log (zero detail loss)
            con.execute("""
                CREATE TABLE IF NOT EXISTS daily_sales (
                    id VARCHAR PRIMARY KEY,
                    project_id VARCHAR NOT NULL,
                    item_code VARCHAR NOT NULL,
                    location VARCHAR,
                    sale_date VARCHAR NOT NULL,
                    qty_sold DOUBLE DEFAULT 0.0,
                    revenue DOUBLE DEFAULT 0.0,
                    created_at VARCHAR
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

            # 9. Ensure App Settings table
            _ensure_settings_table(con)

            # Check if initial template seeding was done; never wipe or overwrite user projects
            seed_row = con.execute("SELECT initial_seed_done FROM app_settings WHERE id = 'global_settings'").fetchone()
            seed_done = seed_row[0] if seed_row and seed_row[0] else 'false'
            if str(seed_done).lower() != 'true':
                proj_count = con.execute("SELECT COUNT(*) FROM projects").fetchone()[0]
                if proj_count == 0:
                    _seed_initial_project(con)
                con.execute("UPDATE app_settings SET initial_seed_done = 'true' WHERE id = 'global_settings'")
            
            con.execute("CHECKPOINT;")

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

    # Mirror into persistent project tables (project_items, project_periods, project_in_transit)
    con.execute("DELETE FROM project_items WHERE project_id = ?", (project_id,))
    con.execute("""
        INSERT INTO project_items (
            project_id, code, description, category, location, on_hand, on_order,
            lead_time, lt_variability, service_level, moq, batch_rounding, cost, price, supplier
        )
        SELECT 
            project_id, code, description, category, location, on_hand, on_order,
            lead_time_days, lead_time_variance_days, service_level, min_batch, batch_rounding,
            purchase_price, sales_price, supplier
        FROM items
        WHERE project_id = ?
    """, (project_id,))

    con.execute("DELETE FROM project_periods WHERE project_id = ?", (project_id,))
    con.execute("""
        INSERT INTO project_periods (
            project_id, code, location, period, qty_sold, revenue
        )
        SELECT 
            p.project_id, i.code, i.location, p.date, p.actual, p.revenue
        FROM periods p
        JOIN items i ON p.item_id = i.id
        WHERE p.project_id = ?
    """, (project_id,))

    con.execute("DELETE FROM project_in_transit WHERE project_id = ?", (project_id,))
    con.execute("""
        INSERT INTO project_in_transit (
            project_id, id, code, location, po_number, qty_in_transit, expected_date, supplier, status
        )
        SELECT 
            project_id, id, item_code, destination, order_no, quantity, eta_date, carrier, status
        FROM in_transition
        WHERE project_id = ?
    """, (project_id,))

    # Update app_settings active_project_id and mark initial seed done
    con.execute("UPDATE app_settings SET active_project_id = ?, initial_seed_done = 'true' WHERE id = 'global_settings'", (project_id,))
    con.execute("CHECKPOINT;")


def get_active_project_id() -> str:
    """Returns active project id from app_settings, falling back to first project or default."""
    with _LOCK:
        con = get_connection()
        try:
            row = con.execute("SELECT active_project_id FROM app_settings WHERE id = 'global_settings'").fetchone()
            if row and row[0]:
                p_id = str(row[0])
                chk = con.execute("SELECT id FROM projects WHERE id = ?", (p_id,)).fetchone()
                if chk:
                    return p_id
            first = con.execute("SELECT id FROM projects ORDER BY updated_at DESC LIMIT 1").fetchone()
            if first and first[0]:
                return str(first[0])
            return "proj_default_retail"
        except Exception:
            return "proj_default_retail"
        finally:
            con.close()

def set_active_project_id(project_id: str):
    """Sets active_project_id in app_settings and flushes immediately with CHECKPOINT."""
    with _LOCK:
        con = get_connection()
        try:
            con.execute("UPDATE app_settings SET active_project_id = ? WHERE id = 'global_settings'", (project_id,))
            con.execute("CHECKPOINT;")
        finally:
            con.close()

def list_projects() -> List[Dict[str, Any]]:
    """Returns all projects stored in DuckDB with live item_count and active state."""
    with _LOCK:
        con = get_connection()
        try:
            active_pid = get_active_project_id()
            df = con.execute("""
                SELECT 
                    p.id, p.name, p.description, 
                    COALESCE(p.granularity, 'monthly') as granularity,
                    COALESCE(p.currency_code, 'EGP') as currency_code,
                    COALESCE(p.item_count, p.sku_count, 0) as item_count,
                    COALESCE(p.sku_count, p.item_count, 0) as sku_count,
                    p.created_at, p.updated_at, p.dataset_name, p.status
                FROM projects p
                ORDER BY p.updated_at DESC
            """).fetchdf()
            projs = df.to_dict(orient="records")
            for p in projs:
                p["is_active"] = (p["id"] == active_pid)
                # Compute live item_count (analyzable items)
                cnt_row = con.execute("""
                    SELECT COUNT(*)
                    FROM items i
                    LEFT JOIN (
                        SELECT item_id, COALESCE(SUM(actual), 0.0) as total_sales
                        FROM periods
                        WHERE project_id = ?
                        GROUP BY item_id
                    ) s ON i.id = s.item_id
                    WHERE i.project_id = ?
                      AND (COALESCE(i.on_hand, 0) > 0 OR COALESCE(s.total_sales, 0) > 0)
                """, (p["id"], p["id"])).fetchone()
                cnt = cnt_row[0] if cnt_row else 0
                if cnt > 0:
                    p["item_count"] = cnt
                    p["sku_count"] = cnt
            return projs
        finally:
            con.close()

def get_project_by_id(project_id: str) -> Optional[Dict[str, Any]]:
    """Returns project metadata by id."""
    with _LOCK:
        con = get_connection()
        try:
            df = con.execute("""
                SELECT 
                    id, name, description,
                    COALESCE(granularity, 'monthly') as granularity,
                    COALESCE(currency_code, 'EGP') as currency_code,
                    COALESCE(item_count, sku_count, 0) as item_count,
                    COALESCE(sku_count, item_count, 0) as sku_count,
                    created_at, updated_at, dataset_name, status
                FROM projects WHERE id = ?
            """, (project_id,)).fetchdf()
            if df.empty:
                return None
            return df.iloc[0].to_dict()
        finally:
            con.close()

def create_new_project(name: str, description: str = "", dataset_name: str = "") -> Dict[str, Any]:
    """Creates a new project in DuckDB, sets it as active, and immediately checkpoints."""
    project_id = f"proj_{uuid.uuid4().hex[:10]}"
    now_str = datetime.datetime.utcnow().isoformat()
    with _LOCK:
        # Snapshot previous active project if exists
        prev_active = get_active_project_id()
        if prev_active and prev_active != project_id:
            try:
                save_project_workspace(prev_active)
            except Exception:
                pass

        con = get_connection()
        try:
            con.execute("""
                INSERT INTO projects (id, name, description, granularity, currency_code, item_count, sku_count, created_at, updated_at, dataset_name, status)
                VALUES (?, ?, ?, 'monthly', 'EGP', 0, 0, ?, ?, ?, 'active')
            """, (project_id, name, description, now_str, now_str, dataset_name))

            # Ensure active working tables and persistent tables are clear for this fresh project
            con.execute("DELETE FROM periods WHERE project_id = ?", (project_id,))
            con.execute("DELETE FROM items WHERE project_id = ?", (project_id,))
            con.execute("DELETE FROM in_transition WHERE project_id = ?", (project_id,))
            con.execute("DELETE FROM daily_sales WHERE project_id = ?", (project_id,))
            con.execute("DELETE FROM project_items WHERE project_id = ?", (project_id,))
            con.execute("DELETE FROM project_periods WHERE project_id = ?", (project_id,))
            con.execute("DELETE FROM project_in_transit WHERE project_id = ?", (project_id,))
            con.execute("DELETE FROM saved_filters WHERE project_id = ?", (project_id,))

            # Set active_project_id in app_settings
            con.execute("UPDATE app_settings SET active_project_id = ? WHERE id = 'global_settings'", (project_id,))
            con.execute("CHECKPOINT;")

            return {
                "id": project_id,
                "name": name,
                "description": description,
                "created_at": now_str,
                "updated_at": now_str,
                "dataset_name": dataset_name,
                "granularity": "monthly",
                "currency_code": "EGP",
                "item_count": 0,
                "sku_count": 0,
                "status": "active"
            }
        finally:
            con.close()

def save_project_workspace(project_id: str) -> Dict[str, Any]:
    """
    Copies active workspace rows (items, periods, in_transition) into project_items,
    project_periods, project_in_transit for project_id, updates item_count & updated_at,
    sets active_project_id in app_settings, and calls flush_db().
    """
    now_str = datetime.datetime.utcnow().isoformat()
    with _LOCK:
        con = get_connection()
        try:
            # 1. Sync items into project_items
            con.execute("DELETE FROM project_items WHERE project_id = ?", (project_id,))
            con.execute("""
                INSERT INTO project_items (
                    project_id, code, description, category, location, on_hand, on_order,
                    lead_time, lt_variability, service_level, moq, batch_rounding, cost, price, supplier
                )
                SELECT 
                    project_id, code, description, category, location, on_hand, on_order,
                    lead_time_days, lead_time_variance_days, service_level, min_batch, batch_rounding,
                    purchase_price, sales_price, supplier
                FROM items
                WHERE project_id = ?
            """, (project_id,))

            # 2. Sync periods into project_periods
            con.execute("DELETE FROM project_periods WHERE project_id = ?", (project_id,))
            con.execute("""
                INSERT INTO project_periods (
                    project_id, code, location, period, qty_sold, revenue
                )
                SELECT 
                    p.project_id, i.code, i.location, p.date, p.actual, p.revenue
                FROM periods p
                JOIN items i ON p.item_id = i.id
                WHERE p.project_id = ?
            """, (project_id,))

            # 3. Sync in_transition into project_in_transit
            con.execute("DELETE FROM project_in_transit WHERE project_id = ?", (project_id,))
            con.execute("""
                INSERT INTO project_in_transit (
                    project_id, id, code, location, po_number, qty_in_transit, expected_date, supplier, status
                )
                SELECT 
                    project_id, id, item_code, destination, order_no, quantity, eta_date, carrier, status
                FROM in_transition
                WHERE project_id = ?
            """, (project_id,))

            # 4. Live count of analyzable items
            count_row = con.execute("""
                SELECT COUNT(*)
                FROM items i
                LEFT JOIN (
                    SELECT item_id, COALESCE(SUM(actual), 0.0) as total_sales
                    FROM periods
                    WHERE project_id = ?
                    GROUP BY item_id
                ) s ON i.id = s.item_id
                WHERE i.project_id = ?
                  AND (COALESCE(i.on_hand, 0) > 0 OR COALESCE(s.total_sales, 0) > 0)
            """, (project_id, project_id)).fetchone()
            item_cnt = count_row[0] if count_row else 0

            con.execute("""
                UPDATE projects SET
                    item_count = ?,
                    sku_count = ?,
                    updated_at = ?
                WHERE id = ?
            """, (item_cnt, item_cnt, now_str, project_id))

            con.execute("UPDATE app_settings SET active_project_id = ? WHERE id = 'global_settings'", (project_id,))
            con.execute("CHECKPOINT;")

            return {
                "success": True,
                "project_id": project_id,
                "item_count": item_cnt,
                "updated_at": now_str,
                "message": f"Project {project_id} saved and checkpointed to DuckDB successfully."
            }
        finally:
            con.close()

def activate_project(project_id: str) -> Dict[str, Any]:
    """
    Sets project_id as active_project_id in app_settings, restores items/periods from
    project_items/project_periods if items table is empty for this project,
    updates updated_at timestamp, and flushes to disk with flush_db().
    """
    now_str = datetime.datetime.utcnow().isoformat()
    with _LOCK:
        # Snapshot previous active project first
        prev_active = get_active_project_id()
        if prev_active and prev_active != project_id:
            try:
                save_project_workspace(prev_active)
            except Exception:
                pass

        con = get_connection()
        try:
            # Check if project exists
            p = con.execute("SELECT id, name FROM projects WHERE id = ?", (project_id,)).fetchone()
            if not p:
                raise ValueError(f"Project {project_id} does not exist")

            # Check if active working table `items` has data for this project
            items_count = con.execute("SELECT COUNT(*) FROM items WHERE project_id = ?", (project_id,)).fetchone()[0]
            if items_count == 0:
                # Check if project_items has data to restore
                pi_count = con.execute("SELECT COUNT(*) FROM project_items WHERE project_id = ?", (project_id,)).fetchone()[0]
                if pi_count > 0:
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
                            project_id || '_' || code, project_id, code, description, category, location, 'Direct', supplier,
                            price, cost, ROUND((price - cost)/NULLIF(price, 0)*100, 1), on_hand, on_order, 0.0,
                            lead_time, lt_variability, 30.0, service_level,
                            moq, batch_rounding, 'auto', 'periodic',
                            'checked', 'unapproved', 'C', 'Y',
                            0.0, 0.0, 0.0, 0.0, 0.0,
                            95.0, 5.0, ?
                        FROM project_items
                        WHERE project_id = ?
                    """, (now_str, project_id))

                    con.execute("""
                        INSERT INTO periods (
                            id, project_id, item_id, date, actual, forecast, model, conf_upper, conf_lower, override, promotion, revenue
                        )
                        SELECT
                            'per_' || i.id || '_' || pp.period, pp.project_id, i.id, pp.period, pp.qty_sold, pp.qty_sold, pp.qty_sold,
                            ROUND(pp.qty_sold * 1.15), ROUND(pp.qty_sold * 0.85), NULL, 0.0, pp.revenue
                        FROM project_periods pp
                        JOIN items i ON pp.project_id = i.project_id AND pp.code = i.code AND pp.location = i.location
                        WHERE pp.project_id = ?
                    """, (project_id,))

            con.execute("UPDATE projects SET updated_at = ? WHERE id = ?", (now_str, project_id))
            con.execute("UPDATE app_settings SET active_project_id = ? WHERE id = 'global_settings'", (project_id,))
            con.execute("CHECKPOINT;")

            return {
                "success": True,
                "project_id": project_id,
                "active_project_id": project_id,
                "message": f"Project {project_id} activated successfully."
            }
        finally:
            con.close()

def delete_project_by_id(project_id: str):
    """Deletes a project and all associated items, periods, overrides, and filters."""
    with _LOCK:
        con = get_connection()
        try:
            con.execute("DELETE FROM project_periods WHERE project_id = ?", (project_id,))
            con.execute("DELETE FROM project_items WHERE project_id = ?", (project_id,))
            con.execute("DELETE FROM project_in_transit WHERE project_id = ?", (project_id,))
            con.execute("DELETE FROM periods WHERE project_id = ?", (project_id,))
            con.execute("DELETE FROM forecast_overrides WHERE project_id = ?", (project_id,))
            con.execute("DELETE FROM model_settings WHERE project_id = ?", (project_id,))
            con.execute("DELETE FROM items WHERE project_id = ?", (project_id,))
            con.execute("DELETE FROM saved_filters WHERE project_id = ?", (project_id,))
            con.execute("DELETE FROM in_transition WHERE project_id = ?", (project_id,))
            con.execute("DELETE FROM daily_sales WHERE project_id = ?", (project_id,))
            con.execute("DELETE FROM projects WHERE id = ?", (project_id,))

            curr_active = con.execute("SELECT active_project_id FROM app_settings WHERE id = 'global_settings'").fetchone()
            if curr_active and curr_active[0] == project_id:
                next_p = con.execute("SELECT id FROM projects ORDER BY updated_at DESC LIMIT 1").fetchone()
                next_id = next_p[0] if next_p else "proj_default_retail"
                con.execute("UPDATE app_settings SET active_project_id = ? WHERE id = 'global_settings'", (next_id,))

            con.execute("CHECKPOINT;")
        finally:
            con.close()

def is_analyzable_sku(on_hand: Any, total_sales: Any) -> bool:
    """Core supply chain analytical filter: SKU is active/analyzable if on_hand > 0 OR total_sales > 0."""
    try:
        oh = float(on_hand) if on_hand is not None else 0.0
    except (ValueError, TypeError):
        oh = 0.0
    try:
        ts = float(total_sales) if total_sales is not None else 0.0
    except (ValueError, TypeError):
        ts = 0.0
    return (oh > 0.0) or (ts > 0.0)

def get_project_dormant_count(project_id: str) -> int:
    """Returns the count of dormant SKUs (on_hand <= 0 AND total sales <= 0) in DuckDB."""
    with _LOCK:
        con = get_connection()
        try:
            row = con.execute("""
                SELECT COUNT(*)
                FROM items i
                LEFT JOIN (
                    SELECT item_id, COALESCE(SUM(actual), 0.0) as total_sales
                    FROM periods
                    WHERE project_id = ?
                    GROUP BY item_id
                ) p ON i.id = p.item_id
                WHERE i.project_id = ?
                  AND COALESCE(i.on_hand, 0) <= 0
                  AND COALESCE(p.total_sales, 0) <= 0
            """, (project_id, project_id)).fetchone()
            return int(row[0]) if row and row[0] is not None else 0
        finally:
            con.close()

def get_project_items(project_id: str, include_dormant: bool = False) -> List[Dict[str, Any]]:
    """Returns all analyzable items for a project, excluding dormant SKUs (0 stock & 0 sales) unless include_dormant=True."""
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
                item_periods = periods_by_item.get(iid, [])
                total_sales = sum(clean_float(p.get("actual"), 0.0) for p in item_periods)
                on_hand = clean_float(item.get("on_hand"), 0.0)
                is_active = is_analyzable_sku(on_hand, total_sales)

                # Strict Analytical Exclusion Filter
                if not include_dormant and not is_active:
                    continue

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
                    "onHand": on_hand,
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
                    "totalSales": total_sales,
                    "isDormant": not is_active,
                    "periods": item_periods
                }
                res.append(item_dict)
            return res
        finally:
            con.close()

def get_project_categories(project_id: str) -> List[str]:
    """Returns list of distinct categories for a project."""
    with _LOCK:
        con = get_connection()
        try:
            rows = con.execute("""
                SELECT DISTINCT COALESCE(NULLIF(TRIM(category), ''), 'General')
                FROM items
                WHERE project_id = ?
                ORDER BY 1 ASC
            """, (project_id,)).fetchall()
            return [r[0] for r in rows if r[0]]
        finally:
            con.close()

def get_project_items_paginated(
    project_id: str,
    page: int = 1,
    page_size: int = 100,
    search: str = "",
    filter_tab: str = "all",
    location: str = "",
    category: str = "",
    include_dormant: bool = False,
    include_periods: bool = False
) -> Dict[str, Any]:
    """
    High-performance SQL-paginated SKU query directly on DuckDB.
    Returns ONLY the requested page slice (max page_size rows, default 100, capped at 250)
    along with summary_counts and total_count calculated via SQL.
    Prevents Edge WebView2 Error code 39 heap crashes on large projects.
    """
    page = max(1, page)
    page_size = max(1, min(page_size, 250))
    offset = (page - 1) * page_size

    with _LOCK:
        con = get_connection()
        try:
            # 1. Base dormant exclusion filter
            base_where = "i.project_id = ?"
            base_params: List[Any] = [project_id]

            if not include_dormant:
                base_where += " AND (COALESCE(i.on_hand, 0) > 0 OR COALESCE(p.total_sales, 0) > 0)"

            # 2. Compute summary_counts across all analyzable items in project via fast SQL
            summary_query = f"""
                SELECT
                    COUNT(*) as count_all,
                    COUNT(CASE WHEN COALESCE(i.order_now, 0) > 0 THEN 1 END) as count_to_buy,
                    COUNT(CASE WHEN i.is_stockout = TRUE OR COALESCE(i.on_hand, 0) <= 0 THEN 1 END) as count_stockout,
                    COUNT(CASE WHEN i.is_overstock = TRUE THEN 1 END) as count_overstock,
                    COUNT(CASE WHEN COALESCE(i.on_order, 0) > 0 THEN 1 END) as count_in_transit
                FROM items i
                LEFT JOIN (
                    SELECT item_id, COALESCE(SUM(actual), 0.0) as total_sales
                    FROM periods
                    WHERE project_id = ?
                    GROUP BY item_id
                ) p ON i.id = p.item_id
                WHERE {base_where}
            """
            summary_row = con.execute(summary_query, [project_id] + base_params).fetchone()
            summary_counts = {
                "all": int(summary_row[0] or 0) if summary_row else 0,
                "to_buy": int(summary_row[1] or 0) if summary_row else 0,
                "stockout_risk": int(summary_row[2] or 0) if summary_row else 0,
                "overstock": int(summary_row[3] or 0) if summary_row else 0,
                "in_transit": int(summary_row[4] or 0) if summary_row else 0,
            }

            # 3. Dynamic filter conditions for the requested view slice
            filter_clauses = [base_where]
            filter_params: List[Any] = list(base_params)

            if search and search.strip():
                s = f"%{search.strip().lower()}%"
                filter_clauses.append("(LOWER(i.code) LIKE ? OR LOWER(COALESCE(i.description, '')) LIKE ? OR LOWER(COALESCE(i.category, '')) LIKE ? OR LOWER(COALESCE(i.location, '')) LIKE ?)")
                filter_params.extend([s, s, s, s])

            if location and location.strip():
                filter_clauses.append("LOWER(TRIM(i.location)) = LOWER(TRIM(?))")
                filter_params.append(location.strip())

            if category and category.strip():
                filter_clauses.append("LOWER(TRIM(i.category)) = LOWER(TRIM(?))")
                filter_params.append(category.strip())

            ft = filter_tab.lower().strip()
            if ft in ("to_buy", "toorder"):
                filter_clauses.append("COALESCE(i.order_now, 0) > 0")
            elif ft in ("stockout_risk", "stockout"):
                filter_clauses.append("(i.is_stockout = TRUE OR COALESCE(i.on_hand, 0) <= 0)")
            elif ft == "overstock":
                filter_clauses.append("i.is_overstock = TRUE")
            elif ft in ("in_transit", "transition"):
                filter_clauses.append("COALESCE(i.on_order, 0) > 0")

            full_filter_sql = " AND ".join(filter_clauses)

            # 4. Total count matching current filters
            count_query = f"""
                SELECT COUNT(*)
                FROM items i
                LEFT JOIN (
                    SELECT item_id, COALESCE(SUM(actual), 0.0) as total_sales
                    FROM periods
                    WHERE project_id = ?
                    GROUP BY item_id
                ) p ON i.id = p.item_id
                WHERE {full_filter_sql}
            """
            count_row = con.execute(count_query, [project_id] + filter_params).fetchone()
            total_count = int(count_row[0] or 0) if count_row else 0
            total_pages = max(1, math.ceil(total_count / page_size))

            # 5. Fetch ONLY the requested page slice
            items_query = f"""
                SELECT i.*, COALESCE(p.total_sales, 0.0) as total_sales
                FROM items i
                LEFT JOIN (
                    SELECT item_id, COALESCE(SUM(actual), 0.0) as total_sales
                    FROM periods
                    WHERE project_id = ?
                    GROUP BY item_id
                ) p ON i.id = p.item_id
                WHERE {full_filter_sql}
                ORDER BY i.code ASC
                LIMIT ? OFFSET ?
            """
            items_df = con.execute(items_query, [project_id] + filter_params + [page_size, offset]).fetchdf()

            if items_df.empty:
                return {
                    "items": [],
                    "total_count": total_count,
                    "page": page,
                    "page_size": page_size,
                    "total_pages": total_pages,
                    "summary_counts": summary_counts
                }

            # 6. Fetch periods ONLY for this page's items if requested
            periods_by_item: Dict[str, List[Dict[str, Any]]] = {}
            if include_periods:
                item_ids = [str(x) for x in items_df["id"].tolist()]
                if item_ids:
                    placeholders = ",".join(["?"] * len(item_ids))
                    periods_df = con.execute(f"""
                        SELECT * FROM periods
                        WHERE project_id = ? AND item_id IN ({placeholders})
                        ORDER BY date ASC
                    """, [project_id] + item_ids).fetchdf()

                    if not periods_df.empty:
                        for row in periods_df.to_dict(orient="records"):
                            iid = str(row["item_id"])
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

            # Format items
            res_items = []
            for item in items_df.to_dict(orient="records"):
                iid = str(item["id"])
                tot_sales = clean_float(item.get("total_sales"), 0.0)
                on_hand = clean_float(item.get("on_hand"), 0.0)
                is_active = is_analyzable_sku(on_hand, tot_sales)

                item_dict = {
                    "id": str(item["id"]),
                    "code": str(item["code"]),
                    "description": str(item.get("description") or ""),
                    "category": str(item.get("category") or "General"),
                    "location": str(item.get("location") or "Default WH"),
                    "channel": str(item.get("channel") or "Direct"),
                    "supplier": str(item.get("supplier") or "Default Supplier"),
                    "dc": str(item["dc"]) if item.get("dc") and pd.notna(item["dc"]) else None,
                    "bomType": str(item["bom_type"]) if item.get("bom_type") and pd.notna(item["bom_type"]) else None,
                    "salesPrice": clean_float(item.get("sales_price"), 0.0),
                    "purchasePrice": clean_float(item.get("purchase_price"), 0.0),
                    "margin": clean_float(item.get("margin"), 0.0),
                    "onHand": on_hand,
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
                    "maxInventory": clean_float(item.get("max_inventory"), 0.0),
                    "orderNow": clean_float(item.get("order_now"), 0.0),
                    "orderNowValue": clean_float(item.get("order_now_value"), 0.0),
                    "daysOfSupply": clean_float(item.get("days_of_supply"), 0.0),
                    "transferQty": clean_float(item.get("transfer_qty"), 0.0),
                    "transferSource": str(item["transfer_source"]) if item.get("transfer_source") and pd.notna(item["transfer_source"]) else None,
                    "accuracy": clean_float(item.get("accuracy"), 100.0),
                    "isStockout": bool(item.get("is_stockout")),
                    "isOverstock": bool(item.get("is_overstock")),
                    "totalSales": tot_sales,
                    "isDormant": not is_active,
                    "periods": periods_by_item.get(iid, [])
                }
                res_items.append(item_dict)

            return {
                "items": res_items,
                "total_count": total_count,
                "page": page,
                "page_size": page_size,
                "total_pages": total_pages,
                "summary_counts": summary_counts
            }
        finally:
            con.close()

def get_project_dashboard_summary(project_id: str) -> Dict[str, Any]:
    """
    Returns slim pre-aggregated dashboard KPI cards, ABC distribution, category breakdown,
    and top risk items directly computed via DuckDB SQL without dumping tens of thousands of SKUs.
    """
    with _LOCK:
        con = get_connection()
        try:
            kpis = compute_project_kpis(project_id)
            dormant_count = get_project_dormant_count(project_id)

            agg_row = con.execute("""
                SELECT
                    COUNT(CASE WHEN i.is_stockout = TRUE OR COALESCE(i.on_hand, 0) <= 0 THEN 1 END) as stockout_count,
                    COUNT(CASE WHEN i.is_overstock = TRUE THEN 1 END) as overstock_count,
                    COALESCE(SUM(COALESCE(i.order_now_value, i.order_now * i.sales_price, 0.0)), 0.0) as total_orders_value,
                    COALESCE(SUM(COALESCE(i.order_now, 0.0)), 0.0) as total_orders_units,
                    COALESCE(SUM(COALESCE(i.overstock_value, 0.0)), 0.0) as total_overstock_value,
                    COALESCE(SUM(COALESCE(i.expected_write_off_value, 0.0)), 0.0) as total_write_off_value
                FROM items i
                LEFT JOIN (
                    SELECT item_id, COALESCE(SUM(actual), 0.0) as total_sales
                    FROM periods
                    WHERE project_id = ?
                    GROUP BY item_id
                ) p ON i.id = p.item_id
                WHERE i.project_id = ?
                  AND (COALESCE(i.on_hand, 0) > 0 OR COALESCE(p.total_sales, 0) > 0)
            """, (project_id, project_id)).fetchone()

            stockout_count = int(agg_row[0] or 0) if agg_row else 0
            overstock_count = int(agg_row[1] or 0) if agg_row else 0
            total_orders_value = round(float(agg_row[2] or 0.0), 2) if agg_row else 0.0
            total_orders_units = round(float(agg_row[3] or 0.0), 2) if agg_row else 0.0
            total_overstock_val = round(float(agg_row[4] or 0.0), 2) if agg_row else 0.0
            total_write_off_val = round(float(agg_row[5] or 0.0), 2) if agg_row else 0.0

            # ABC Distribution
            abc_rows = con.execute("""
                SELECT
                    UPPER(COALESCE(NULLIF(TRIM(i.abc_class), ''), 'C')) as abc,
                    COUNT(*) as sku_count,
                    COALESCE(SUM(i.on_hand * i.sales_price), 0.0) as total_val
                FROM items i
                LEFT JOIN (
                    SELECT item_id, COALESCE(SUM(actual), 0.0) as total_sales
                    FROM periods
                    WHERE project_id = ?
                    GROUP BY item_id
                ) p ON i.id = p.item_id
                WHERE i.project_id = ?
                  AND (COALESCE(i.on_hand, 0) > 0 OR COALESCE(p.total_sales, 0) > 0)
                GROUP BY UPPER(COALESCE(NULLIF(TRIM(i.abc_class), ''), 'C'))
            """, (project_id, project_id)).fetchall()

            abc_map = {r[0]: (r[1], float(r[2])) for r in abc_rows}
            abc_sum = sum(v[1] for v in abc_map.values())

            abc_colors = {'A': '#10B981', 'B': '#2196F3', 'C': '#94A3B8'}
            abc_data = []
            for cls in ['A', 'B', 'C']:
                cnt, val = abc_map.get(cls, (0, 0.0))
                pct = round((val / abc_sum * 100)) if abc_sum > 0 else 0
                abc_data.append({
                    "class": cls,
                    "name": f"Class {cls} ({cnt} SKUs / {pct}%)",
                    "name_ar": f"فئة {cls} ({cnt} صنف / {pct}%)",
                    "count": cnt,
                    "value": round(val, 2),
                    "color": abc_colors[cls]
                })

            # Category Orders Breakdown (Top 10)
            cat_rows = con.execute("""
                SELECT
                    COALESCE(NULLIF(TRIM(i.category), ''), 'General') as cat,
                    COALESCE(SUM(COALESCE(i.order_now_value, i.order_now * i.sales_price, 0.0)), 0.0) as cat_val
                FROM items i
                LEFT JOIN (
                    SELECT item_id, COALESCE(SUM(actual), 0.0) as total_sales
                    FROM periods
                    WHERE project_id = ?
                    GROUP BY item_id
                ) p ON i.id = p.item_id
                WHERE i.project_id = ?
                  AND (COALESCE(i.on_hand, 0) > 0 OR COALESCE(p.total_sales, 0) > 0)
                  AND (COALESCE(i.order_now, 0) > 0 OR COALESCE(i.order_now_value, 0) > 0)
                GROUP BY COALESCE(NULLIF(TRIM(i.category), ''), 'General')
                ORDER BY cat_val DESC
                LIMIT 10
            """, (project_id, project_id)).fetchall()

            category_orders = [{"name": r[0], "value": round(float(r[1]), 2)} for r in cat_rows]

            # Top 15 Stockout Risk Items
            top_risk_rows = con.execute("""
                SELECT i.id, i.code, i.description, i.category, i.location, i.on_hand, i.reorder_point,
                       i.order_now, COALESCE(i.order_now_value, i.order_now * i.sales_price, 0.0) as order_val,
                       i.days_of_supply
                FROM items i
                LEFT JOIN (
                    SELECT item_id, COALESCE(SUM(actual), 0.0) as total_sales
                    FROM periods
                    WHERE project_id = ?
                    GROUP BY item_id
                ) p ON i.id = p.item_id
                WHERE i.project_id = ?
                  AND (COALESCE(i.on_hand, 0) > 0 OR COALESCE(p.total_sales, 0) > 0)
                  AND (i.is_stockout = TRUE OR COALESCE(i.on_hand, 0) <= 0)
                ORDER BY order_val DESC
                LIMIT 15
            """, (project_id, project_id)).fetchall()
            top_risk_items = [{
                "id": str(r[0]), "code": str(r[1]), "description": str(r[2] or ""),
                "category": str(r[3] or ""), "location": str(r[4] or ""),
                "onHand": float(r[5] or 0), "reorderPoint": float(r[6] or 0),
                "orderNow": float(r[7] or 0), "orderNowValue": round(float(r[8] or 0), 2),
                "daysOfSupply": round(float(r[9] or 0), 1)
            } for r in top_risk_rows]

            # Top 15 Overstock Items
            top_overstock_rows = con.execute("""
                SELECT i.id, i.code, i.description, i.category, i.location, i.on_hand,
                       COALESCE(i.overstock_value, 0.0) as over_val, i.days_of_supply
                FROM items i
                LEFT JOIN (
                    SELECT item_id, COALESCE(SUM(actual), 0.0) as total_sales
                    FROM periods
                    WHERE project_id = ?
                    GROUP BY item_id
                ) p ON i.id = p.item_id
                WHERE i.project_id = ?
                  AND (COALESCE(i.on_hand, 0) > 0 OR COALESCE(p.total_sales, 0) > 0)
                  AND i.is_overstock = TRUE
                ORDER BY over_val DESC
                LIMIT 15
            """, (project_id, project_id)).fetchall()
            top_overstock_items = [{
                "id": str(r[0]), "code": str(r[1]), "description": str(r[2] or ""),
                "category": str(r[3] or ""), "location": str(r[4] or ""),
                "onHand": float(r[5] or 0), "overstockValue": round(float(r[6] or 0), 2),
                "daysOfSupply": round(float(r[7] or 0), 1)
            } for r in top_overstock_rows]

            return {
                "project_id": project_id,
                "active_skus": kpis.get("totalSkus", 0),
                "dormant_count": dormant_count,
                "excluded_dormant_count": dormant_count,
                "kpis": kpis,
                "stockout_count": stockout_count,
                "overstock_count": overstock_count,
                "total_orders_value": total_orders_value,
                "total_orders_units": total_orders_units,
                "total_overstock_value": total_overstock_val,
                "total_write_off_value": total_write_off_val,
                "abc_data": abc_data,
                "category_orders": category_orders,
                "top_risk_items": top_risk_items,
                "top_overstock_items": top_overstock_items
            }
        finally:
            con.close()

def get_workspace(project_id: str, include_dormant: bool = False, page: int = 1, page_size: int = 100) -> Dict[str, Any]:
    """Loads slim paginated items, overrides, settings, and filters for project, preventing RAM exhaustion."""
    project = get_project_by_id(project_id)
    paginated = get_project_items_paginated(
        project_id,
        page=page,
        page_size=page_size if page_size > 0 else 100,
        include_dormant=include_dormant,
        include_periods=True
    )
    filters = get_saved_filters_for_project(project_id)
    transitions = get_in_transition_for_project(project_id)
    kpis = compute_project_kpis(project_id)
    dormant_count = get_project_dormant_count(project_id)
    return {
        "project": project,
        "items": paginated["items"],
        "total_count": paginated["total_count"],
        "page": paginated["page"],
        "page_size": paginated["page_size"],
        "total_pages": paginated["total_pages"],
        "filters": filters,
        "transitions": transitions,
        "kpis": kpis,
        "dormant_count": dormant_count,
        "excluded_dormant_count": dormant_count
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

            # Synchronize items.on_order from in_transition shipments for this project
            try:
                con.execute("""
                    UPDATE items SET
                        on_order = COALESCE(sub.tot_qty, 0.0),
                        order_now = GREATEST(0.0, items.reorder_point - items.on_hand - COALESCE(sub.tot_qty, 0.0) + items.backorders),
                        order_now_value = GREATEST(0.0, items.reorder_point - items.on_hand - COALESCE(sub.tot_qty, 0.0) + items.backorders) * items.purchase_price
                    FROM (
                        SELECT item_code, SUM(quantity) AS tot_qty
                        FROM in_transition
                        WHERE project_id = ? AND status NOT IN ('delivered', 'received', 'تم الاستلام', 'تم التسليم')
                        GROUP BY item_code
                    ) sub
                    WHERE items.code = sub.item_code AND items.project_id = ?
                """, (project_id, project_id))
            except Exception:
                pass

            # Mirror in_transition to project_in_transit and checkpoint
            con.execute("DELETE FROM project_in_transit WHERE project_id = ?", (project_id,))
            con.execute("""
                INSERT INTO project_in_transit (
                    project_id, id, code, location, po_number, qty_in_transit, expected_date, supplier, status
                )
                SELECT
                    project_id, id, item_code, destination, order_no, quantity, eta_date, origin, status
                FROM in_transition
                WHERE project_id = ?
            """, (project_id,))
            con.execute("CHECKPOINT;")

            return count
        finally:
            con.close()

def compute_project_kpis(project_id: str) -> Dict[str, Any]:
    """Computes real aggregate supply chain KPIs dynamically from DuckDB, excluding dormant SKUs (0 stock & 0 sales)."""
    with _LOCK:
        con = get_connection()
        try:
            dormant_count = get_project_dormant_count(project_id)
            # Query aggregates only from active, analyzable items
            row = con.execute("""
                SELECT 
                    COUNT(*) as total_skus,
                    COALESCE(SUM(i.on_hand * COALESCE(NULLIF(i.purchase_price, 0.0), i.sales_price, 0.0)), 0.0) as total_inventory_value,
                    COALESCE(SUM(i.order_now * COALESCE(NULLIF(i.purchase_price, 0.0), i.sales_price, 0.0)), 0.0) as total_order_value,
                    SUM(CASE WHEN i.days_of_supply > 90 THEN (i.days_of_supply - 90) * (i.purchase_price * i.mean_daily_demand) ELSE 0 END) as total_overstock,
                    SUM(CASE WHEN i.days_of_supply < 14 THEN (14 - i.days_of_supply) * (i.sales_price * i.mean_daily_demand) ELSE 0 END) as total_stockout_loss,
                    SUM(CASE WHEN i.model_type = 'zero' THEN i.on_hand * i.purchase_price ELSE 0 END) as total_dead_inv,
                    AVG(i.accuracy) as avg_accuracy,
                    AVG(i.days_of_supply) as avg_days_supply,
                    SUM(i.mean_daily_demand * 365 * i.sales_price) as projected_annual_revenue,
                    SUM(i.mean_daily_demand * 365 * i.purchase_price) as projected_annual_cogs
                FROM items i
                LEFT JOIN (
                    SELECT item_id, COALESCE(SUM(actual), 0.0) as total_sales
                    FROM periods
                    WHERE project_id = ?
                    GROUP BY item_id
                ) p ON i.id = p.item_id
                WHERE i.project_id = ?
                  AND (COALESCE(i.on_hand, 0) > 0 OR COALESCE(p.total_sales, 0) > 0)
            """, (project_id, project_id)).fetchone()

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

            active_orders_row = con.execute("""
                SELECT COUNT(*)
                FROM items i
                LEFT JOIN (
                    SELECT item_id, COALESCE(SUM(actual), 0.0) as total_sales
                    FROM periods
                    WHERE project_id = ?
                    GROUP BY item_id
                ) p ON i.id = p.item_id
                WHERE i.project_id = ?
                  AND (COALESCE(i.on_hand, 0) > 0 OR COALESCE(p.total_sales, 0) > 0)
                  AND i.order_now > 0
            """, (project_id, project_id)).fetchone()
            active_orders_count = active_orders_row[0] if active_orders_row else 0

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
                "activeOrdersCount": active_orders_count,
                "dormantCount": dormant_count,
                "excludedDormantCount": dormant_count
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
            active_project_id VARCHAR DEFAULT 'proj_default_retail',
            initial_seed_done VARCHAR DEFAULT 'false',
            updated_at VARCHAR
        )
    """)
    cols = [c[1].lower() for c in con.execute("PRAGMA table_info('app_settings')").fetchall()]
    if "active_project_id" not in cols:
        try:
            con.execute("ALTER TABLE app_settings ADD COLUMN active_project_id VARCHAR DEFAULT 'proj_default_retail'")
        except Exception:
            pass
    if "initial_seed_done" not in cols:
        try:
            con.execute("ALTER TABLE app_settings ADD COLUMN initial_seed_done VARCHAR DEFAULT 'false'")
        except Exception:
            pass

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
                    abc_a_cutoff, abc_b_cutoff, xyz_x_cv, xyz_y_cv, active_project_id, initial_seed_done, updated_at
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
                        abc_a_cutoff, abc_b_cutoff, xyz_x_cv, xyz_y_cv, active_project_id, initial_seed_done, updated_at
                    ) VALUES (
                        'global_settings', 'en', 'EGP', 'ج.م', 'after',
                        2, 1.0, 12, 12,
                        'monthly', 'auto', 0.95, 'periodic',
                        30.0, 7.0, 90.0, 60.0,
                        80.0, 95.0, 0.5, 1.0, 'proj_default_retail', 'false', ?
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
                    "active_project_id": "proj_default_retail",
                    "initial_seed_done": "false",
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
                "active_project_id": row[20] or "proj_default_retail",
                "initial_seed_done": row[21] or "false",
                "updated_at": row[22]
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
                        abc_a_cutoff, abc_b_cutoff, xyz_x_cv, xyz_y_cv, active_project_id, initial_seed_done, updated_at
                    ) VALUES (
                        'global_settings', 'en', 'EGP', 'ج.م', 'after',
                        2, 1.0, 12, 12,
                        'monthly', 'auto', 0.95, 'periodic',
                        30.0, 7.0, 90.0, 60.0,
                        80.0, 95.0, 0.5, 1.0, 'proj_default_retail', 'false', ?
                    )
                """, (now_str,))

            allowed = {
                "language", "currency_code", "currency_symbol", "currency_position",
                "decimal_places", "exchange_rate", "analysis_lookback_periods", "forecast_horizon_periods",
                "period_granularity", "default_forecast_model", "default_service_level", "default_replenishment_policy",
                "default_order_cycle_days", "default_lead_time_days", "overstock_threshold_days", "dead_stock_days",
                "abc_a_cutoff", "abc_b_cutoff", "xyz_x_cv", "xyz_y_cv", "active_project_id", "initial_seed_done"
            }
            set_clauses = ["updated_at = ?"]
            params = [now_str]
            for k, v in updates.items():
                if k in allowed and v is not None:
                    set_clauses.append(f"{k} = ?")
                    params.append(v)

            params.append('global_settings')
            con.execute(f"UPDATE app_settings SET {', '.join(set_clauses)} WHERE id = ?", params)
            con.execute("CHECKPOINT;")
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

def record_daily_sales(project_id: str, records: List[Dict[str, Any]]) -> int:
    """Stores raw daily sales transactions in daily_sales table without loss of transaction detail."""
    if not records:
        return 0
    now_str = datetime.datetime.utcnow().isoformat()
    inserted = 0
    with _LOCK:
        con = get_connection()
        try:
            con.execute("""
                CREATE TABLE IF NOT EXISTS daily_sales (
                    id VARCHAR PRIMARY KEY,
                    project_id VARCHAR NOT NULL,
                    item_code VARCHAR NOT NULL,
                    location VARCHAR,
                    sale_date VARCHAR NOT NULL,
                    qty_sold DOUBLE DEFAULT 0.0,
                    revenue DOUBLE DEFAULT 0.0,
                    created_at VARCHAR
                )
            """)
            for r in records:
                sale_id = f"ds_{uuid.uuid4().hex[:10]}"
                code = str(r.get("item_code", r.get("code", ""))).strip()
                loc = str(r.get("location", "Main Warehouse")).strip()
                date_val = str(r.get("sale_date", r.get("date", ""))).strip()
                qty = clean_float(r.get("qty_sold", r.get("actual", 0.0)))
                rev = clean_float(r.get("revenue", 0.0))
                con.execute("""
                    INSERT INTO daily_sales (id, project_id, item_code, location, sale_date, qty_sold, revenue, created_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """, (sale_id, project_id, code, loc, date_val, qty, rev, now_str))
                inserted += 1
            return inserted
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

            # Query global settings for active system defaults
            settings_row = con.execute("""
                SELECT default_service_level, default_lead_time_days, default_order_cycle_days
                FROM app_settings WHERE id = 'global_settings'
            """).fetchone()
            if settings_row:
                def_sl = clean_float(settings_row[0], 0.95)
                def_lt = clean_float(settings_row[1], 30.0)
                def_cycle = clean_float(settings_row[2], 30.0)
            else:
                def_sl = 0.95
                def_lt = 30.0
                def_cycle = 30.0
            def_lt_var = 5.0
            def_moq = 1.0
            def_brou = 1.0

            # Build map of existing items with their saved parameters
            existing_items_rows = con.execute("""
                SELECT id, code, description, category, location, channel, supplier,
                       sales_price, purchase_price, margin, on_hand, on_order, backorders,
                       lead_time_days, lead_time_variance_days, order_cycle_days,
                       service_level, min_batch, batch_rounding, model_type, replenishment_strategy
                FROM items WHERE project_id = ?
            """, (project_id,)).fetchall()
            existing_items_dict = {
                row[1]: {
                    "id": row[0],
                    "code": row[1],
                    "description": row[2],
                    "category": row[3],
                    "location": row[4],
                    "channel": row[5],
                    "supplier": row[6],
                    "sales_price": clean_float(row[7], 0.0),
                    "purchase_price": clean_float(row[8], 0.0),
                    "margin": clean_float(row[9], 0.0),
                    "on_hand": clean_float(row[10], 0.0),
                    "on_order": clean_float(row[11], 0.0),
                    "backorders": clean_float(row[12], 0.0),
                    "lead_time_days": clean_float(row[13], def_lt),
                    "lead_time_variance_days": clean_float(row[14], def_lt_var),
                    "order_cycle_days": clean_float(row[15], def_cycle),
                    "service_level": clean_float(row[16], def_sl),
                    "min_batch": clean_float(row[17], def_moq),
                    "batch_rounding": clean_float(row[18], def_brou),
                    "model_type": row[19] or "auto",
                    "replenishment_strategy": row[20] or "periodic"
                }
                for row in existing_items_rows
            }
            existing_items_map = {k: v["id"] for k, v in existing_items_dict.items()}

            for itm in items_data:
                code = str(itm.get("code", "")).strip()
                if not code:
                    continue

                existing = existing_items_dict.get(code) if merge_mode == "merge" else None

                desc = str(itm.get("description", "")).strip() or (existing["description"] if existing else f"Item {code}")
                cat = str(itm.get("category", "")).strip() or (existing["category"] if existing else "General")
                loc = str(itm.get("location", "")).strip() or (existing["location"] if existing else "Main Warehouse")
                channel = str(itm.get("channel", "")).strip() or (existing["channel"] if existing else "Standard Channel")
                supplier = str(itm.get("supplier", "")).strip() or (existing["supplier"] if existing else "Primary Supplier")
                cost = clean_float(itm.get("purchase_price", itm.get("cost")), (existing["purchase_price"] if existing else 50.0))
                on_hand = clean_float(itm.get("on_hand", itm.get("stock")), (existing["on_hand"] if existing else 0.0))
                backorders = clean_float(itm.get("backorders"), (existing["backorders"] if existing else 0.0))

                # Auto-populate or preserve Lead Time
                raw_lt = itm.get("lead_time_days", itm.get("lt"))
                if raw_lt is not None and str(raw_lt).strip() != "":
                    lt = clean_float(raw_lt, def_lt)
                elif existing:
                    lt = existing["lead_time_days"]
                else:
                    lt = def_lt

                # Auto-populate or preserve Lead Time Variance
                raw_lt_var = itm.get("lead_time_variance_days", itm.get("lt_var"))
                if raw_lt_var is not None and str(raw_lt_var).strip() != "":
                    lt_var = clean_float(raw_lt_var, def_lt_var)
                elif existing:
                    lt_var = existing["lead_time_variance_days"]
                else:
                    lt_var = def_lt_var

                # Auto-populate or preserve Order Cycle
                raw_cycle = itm.get("order_cycle_days", itm.get("cycle"))
                if raw_cycle is not None and str(raw_cycle).strip() != "":
                    cycle = clean_float(raw_cycle, def_cycle)
                elif existing:
                    cycle = existing["order_cycle_days"]
                else:
                    cycle = def_cycle

                # Auto-populate or preserve Service Level %
                raw_sl = itm.get("service_level", itm.get("sl"))
                if raw_sl is not None and str(raw_sl).strip() != "":
                    sl = clean_float(raw_sl, def_sl)
                    if sl > 1.0:
                        sl = sl / 100.0
                elif existing:
                    sl = existing["service_level"]
                else:
                    sl = def_sl

                # Auto-populate or preserve MOQ
                raw_moq = itm.get("min_batch", itm.get("moq"))
                if raw_moq is not None and str(raw_moq).strip() != "":
                    moq = clean_float(raw_moq, def_moq)
                elif existing:
                    moq = existing["min_batch"]
                else:
                    moq = def_moq

                # Auto-populate or preserve Batch Rounding
                raw_brou = itm.get("batch_rounding", itm.get("round"))
                if raw_brou is not None and str(raw_brou).strip() != "":
                    brou = clean_float(raw_brou, def_brou)
                elif existing:
                    brou = existing["batch_rounding"]
                else:
                    brou = def_brou

                # Auto-derive On-Order from In-Transit Shipments if not provided
                raw_on_order = itm.get("on_order")
                if raw_on_order is not None and str(raw_on_order).strip() != "":
                    on_order = clean_float(raw_on_order, 0.0)
                else:
                    in_trans_row = con.execute("""
                        SELECT COALESCE(SUM(quantity), 0.0)
                        FROM in_transition
                        WHERE project_id = ? AND item_code = ? AND status NOT IN ('delivered', 'received', 'تم الاستلام', 'تم التسليم')
                    """, (project_id, code)).fetchone()
                    in_trans_qty = clean_float(in_trans_row[0], 0.0) if in_trans_row else 0.0
                    if in_trans_qty > 0:
                        on_order = in_trans_qty
                    elif existing:
                        on_order = existing["on_order"]
                    else:
                        on_order = 0.0

                # Auto-derive Selling Price from Sales history if not provided
                raw_price = itm.get("sales_price", itm.get("price"))
                if raw_price is not None and str(raw_price).strip() != "" and clean_float(raw_price, 0.0) > 0:
                    price = clean_float(raw_price)
                elif existing and existing["sales_price"] > 0:
                    price = existing["sales_price"]
                else:
                    p_id_for_query = existing["id"] if existing else None
                    period_sales = None
                    if p_id_for_query:
                        period_sales = con.execute("""
                            SELECT COALESCE(SUM(revenue), 0.0), COALESCE(SUM(actual), 0.0)
                            FROM periods WHERE project_id = ? AND item_id = ?
                        """, (project_id, p_id_for_query)).fetchone()
                    if period_sales and period_sales[1] > 0 and period_sales[0] > 0:
                        price = round(period_sales[0] / period_sales[1], 2)
                    elif cost > 0:
                        price = round(cost * 1.5, 2)
                    else:
                        price = 100.0

                margin = round((price - cost) / price * 100 if price > 0 else 0.0, 1)
                model = str(itm.get("model_type", existing["model_type"] if existing else "auto"))
                strat = str(itm.get("replenishment_strategy", existing["replenishment_strategy"] if existing else "periodic"))

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
                # Pre-aggregate periods_data by (code, date) to sum actuals & revenue across repeated transactions
                pre_agg_periods: Dict[Tuple[str, str], Dict[str, Any]] = {}
                for per in periods_data:
                    c = str(per.get("code", "")).strip()
                    d = str(per.get("date", per.get("period", ""))).strip()
                    if not c or not d:
                        continue
                    key = (c, d)
                    if key not in pre_agg_periods:
                        pre_agg_periods[key] = {
                            "code": c,
                            "item_id": per.get("item_id"),
                            "date": d,
                            "actual": 0.0,
                            "revenue": 0.0,
                            "forecast": per.get("forecast"),
                            "override": per.get("override"),
                            "promotion": clean_float(per.get("promotion", 0.0))
                        }
                    pre_agg_periods[key]["actual"] += clean_float(per.get("actual", per.get("qty_sold", 0.0)))
                    pre_agg_periods[key]["revenue"] += clean_float(per.get("revenue", 0.0))

                for per in pre_agg_periods.values():
                    code = per["code"]
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

                    date_str = per["date"]
                    actual = per["actual"]
                    rev_val = per["revenue"]
                    forecast = clean_opt_float(per.get("forecast"))
                    override = clean_opt_float(per.get("override"))
                    promotion = per.get("promotion", 0.0)

                    # Check if period exists
                    existing_p = con.execute("SELECT id FROM periods WHERE project_id = ? AND item_id = ? AND date = ?", (project_id, item_id, date_str)).fetchone()
                    if existing_p:
                        con.execute("""
                            UPDATE periods SET
                                actual = ?,
                                revenue = ?,
                                forecast = COALESCE(?, forecast),
                                override = COALESCE(?, override),
                                promotion = ?
                            WHERE id = ?
                        """, (actual, rev_val, forecast, override, promotion, existing_p[0]))
                    else:
                        pid = f"per_{uuid.uuid4().hex[:10]}"
                        con.execute("""
                            INSERT INTO periods (
                                id, project_id, item_id, date, actual, forecast, model,
                                conf_upper, conf_lower, override, promotion, revenue
                            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                        """, (
                            pid, project_id, item_id, date_str, actual,
                            forecast or actual, forecast or actual,
                            round((forecast or actual) * 1.15), round((forecast or actual) * 0.85),
                            override, promotion, rev_val
                        ))
                    periods_upserted += 1

            # Auto-derive and update items.sales_price from sales history whenever periods are ingested
            if periods_data:
                try:
                    con.execute("""
                        UPDATE items SET
                            sales_price = sub.derived_price,
                            margin = ROUND((sub.derived_price - items.purchase_price) / sub.derived_price * 100, 1),
                            order_now_value = items.order_now * items.purchase_price
                        FROM (
                            SELECT item_id, ROUND(SUM(revenue) / NULLIF(SUM(actual), 0), 2) AS derived_price
                            FROM periods
                            WHERE project_id = ? AND actual > 0 AND revenue > 0
                            GROUP BY item_id
                        ) sub
                        WHERE items.id = sub.item_id AND items.project_id = ? AND sub.derived_price > 0
                    """, (project_id, project_id))
                except Exception:
                    pass

            # Mirror working items to persistent project_items
            con.execute("DELETE FROM project_items WHERE project_id = ?", (project_id,))
            con.execute("""
                INSERT INTO project_items (
                    project_id, code, description, category, location, on_hand, on_order,
                    lead_time, lt_variability, service_level, moq, batch_rounding, cost, price, supplier
                )
                SELECT
                    project_id, code, description, category, location, on_hand, on_order,
                    lead_time_days, lead_time_variance_days, service_level, min_batch, batch_rounding,
                    purchase_price, sales_price, supplier
                FROM items
                WHERE project_id = ?
            """, (project_id,))

            # Mirror working periods to persistent project_periods
            con.execute("DELETE FROM project_periods WHERE project_id = ?", (project_id,))
            con.execute("""
                INSERT INTO project_periods (
                    project_id, code, location, period, qty_sold, revenue
                )
                SELECT
                    p.project_id, i.code, i.location, p.date, p.actual, p.revenue
                FROM periods p
                JOIN items i ON p.item_id = i.id
                WHERE p.project_id = ?
            """, (project_id,))

            # Total items count
            total_items_count = con.execute("SELECT COUNT(*) FROM items WHERE project_id = ?", (project_id,)).fetchone()[0]

            # Update project SKU count (active analyzable SKUs), item_count & timestamp
            con.execute("""
                UPDATE projects SET
                    item_count = ?,
                    sku_count = (
                        SELECT COUNT(*)
                        FROM items i
                        LEFT JOIN (
                            SELECT item_id, COALESCE(SUM(actual), 0.0) as total_sales
                            FROM periods
                            WHERE project_id = ?
                            GROUP BY item_id
                        ) p ON i.id = p.item_id
                        WHERE i.project_id = ?
                          AND (COALESCE(i.on_hand, 0) > 0 OR COALESCE(p.total_sales, 0) > 0)
                    ),
                    updated_at = ?
                WHERE id = ?
            """, (total_items_count, project_id, project_id, now_str, project_id))

            con.execute("UPDATE app_settings SET active_project_id = ? WHERE id = 'global_settings'", (project_id,))
            con.execute("CHECKPOINT;")

            dormant_cnt = get_project_dormant_count(project_id)

            return {
                "success": True,
                "project_id": project_id,
                "items_upserted": items_upserted,
                "periods_upserted": periods_upserted,
                "dormant_count": dormant_cnt,
                "excluded_dormant_count": dormant_cnt
            }
        finally:
            con.close()

