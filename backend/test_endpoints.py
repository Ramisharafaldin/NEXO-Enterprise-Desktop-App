import os
import sys
import tempfile
import shutil
import platform

# Ensure root repo directory is on sys.path
repo_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if repo_dir not in sys.path:
    sys.path.insert(0, repo_dir)

# Create isolated temporary DuckDB file so backend/nexo_workspace.duckdb is never touched or polluted
TEST_TMP_DIR = tempfile.mkdtemp(prefix="nexo_test_")
TEST_DB_PATH = os.path.join(TEST_TMP_DIR, "isolated_test_workspace.duckdb")
os.environ["NEXO_DB_PATH"] = TEST_DB_PATH

# Wave 1 Session Secrets for Local Boundary Authentication (SEC-CRIT-01, SEC-MED-02)
TEST_SESSION_SECRET = "nexo_test_secret_for_automated_test_suite_key_2026"
TEST_BOOTSTRAP_NONCE = "nexo_test_bootstrap_nonce_1234567890abcdef"
os.environ["NEXO_SESSION_SECRET"] = TEST_SESSION_SECRET
os.environ["NEXO_BOOTSTRAP_NONCE"] = TEST_BOOTSTRAP_NONCE

import asyncio
import uuid
import time
import urllib.parse
from pathlib import Path
import httpx
from backend.server import app
from backend.database import init_db, get_connection, close_db, clean_item_code, cleanup_trailing_decimal_codes

async def run_tests():
    init_db()
    transport = httpx.ASGITransport(app=app)

    # --------------------------------------------------------------------------
    # Wave 1: Security Boundary Verification (SEC-CRIT-01..04, SEC-MED-02)
    # --------------------------------------------------------------------------
    async with httpx.AsyncClient(transport=transport, base_url='http://test') as sec_client:
        # 0a. Test unauthenticated API access is rejected with 401
        r_unauth = await sec_client.get('/api/projects')
        assert r_unauth.status_code == 401, f"Expected 401 for unauthenticated request, got {r_unauth.status_code}"
        print("0a. Unauthenticated API access rejected with 401 PASSED")

        # 0b. Test invalid session token is rejected with 401
        r_bad_token = await sec_client.get('/api/projects', headers={"X-NEXO-Session-Token": "invalid_token_123"})
        assert r_bad_token.status_code == 401, f"Expected 401 for invalid token, got {r_bad_token.status_code}"
        print("0b. Invalid session token rejected with 401 PASSED")

        # 0c. Test single-use /auth/bootstrap flow with cookie & replay prevention
        r_boot = await sec_client.get(f'/auth/bootstrap?nonce={TEST_BOOTSTRAP_NONCE}', follow_redirects=False)
        assert r_boot.status_code == 302, f"Expected 302 redirect from /auth/bootstrap, got {r_boot.status_code}"
        assert "nexo_session" in r_boot.cookies, "Expected nexo_session cookie in bootstrap response"
        set_cookie = r_boot.headers.get("set-cookie", "")
        assert "path=/" in set_cookie.lower(), f"Expected Path=/ in set-cookie, got {set_cookie}"
        assert "httponly" in set_cookie.lower(), f"Expected HttpOnly in set-cookie, got {set_cookie}"
        assert "samesite=strict" in set_cookie.lower(), f"Expected SameSite=strict in set-cookie, got {set_cookie}"

        # Nonce replay must be rejected with 403
        r_replay = await sec_client.get(f'/auth/bootstrap?nonce={TEST_BOOTSTRAP_NONCE}', follow_redirects=False)
        assert r_replay.status_code == 403, f"Expected 403 for replayed bootstrap nonce, got {r_replay.status_code}"

        # Invalid nonce must be rejected with 403
        r_fake_nonce = await sec_client.get('/auth/bootstrap?nonce=fake_nonce', follow_redirects=False)
        assert r_fake_nonce.status_code == 403, f"Expected 403 for fake bootstrap nonce, got {r_fake_nonce.status_code}"
        print("0c. Single-use /auth/bootstrap and nonce replay defense PASSED")

        # 0d. Test authenticated access via cookie set by bootstrap
        cookie_val = r_boot.cookies["nexo_session"]
        r_cookie_auth = await sec_client.get('/api/projects', cookies={"nexo_session": cookie_val})
        assert r_cookie_auth.status_code == 200, f"Expected 200 for cookie-authenticated request, got {r_cookie_auth.status_code}"
        print("0d. Cookie-authenticated API access PASSED")

        # 0e. Path Traversal Defense (SEC-CRIT-02)
        r_trav1 = await sec_client.get('/C:/Windows/win.ini')
        assert r_trav1.status_code == 403, f"Expected 403 for C: drive traversal, got {r_trav1.status_code}"
        r_trav2 = await sec_client.get('/%2e%2e/backend/server.py')
        assert r_trav2.status_code == 403, f"Expected 403 for .. traversal, got {r_trav2.status_code}"
        r_trav3 = await sec_client.get('/.env')
        assert r_trav3.status_code == 403, f"Expected 403 for .env traversal, got {r_trav3.status_code}"
        print("0e. Static file path traversal defense PASSED")

        # 0f. SQL Server ERP Injection Defense (SEC-CRIT-04)
        # Malicious items_table identifier
        r_sqli_table = await sec_client.post(
            '/api/sql/import',
            headers={"X-NEXO-Session-Token": TEST_SESSION_SECRET},
            json={'server': 'localhost', 'database': 'ERP_DB', 'items_table': 'items; DROP TABLE users--', 'simulate_demo': True}
        )
        assert r_sqli_table.status_code == 400, f"Expected 400 for malicious items_table, got {r_sqli_table.status_code}"

        # Malicious custom_sql non-SELECT query
        r_sqli_query = await sec_client.post(
            '/api/sql/import',
            headers={"X-NEXO-Session-Token": TEST_SESSION_SECRET},
            json={'server': 'localhost', 'database': 'ERP_DB', 'custom_sql': 'DELETE FROM Dim_Item', 'simulate_demo': True}
        )
        assert r_sqli_query.status_code == 400, f"Expected 400 for non-SELECT custom_sql, got {r_sqli_query.status_code}"
        print("0f. SQL Server ERP injection defense PASSED")

        # 0g. SSRF Defense in External URL Connector (SEC-HIGH-01)
        r_ssrf_local = await sec_client.post(
            '/api/external-url/preview',
            headers={"X-NEXO-Session-Token": TEST_SESSION_SECRET},
            data={'url': 'http://127.0.0.1:8000/'}
        )
        assert r_ssrf_local.status_code == 400, f"Expected 400 for loopback URL, got {r_ssrf_local.status_code}"

        r_ssrf_file = await sec_client.post(
            '/api/external-url/preview',
            headers={"X-NEXO-Session-Token": TEST_SESSION_SECRET},
            data={'url': 'file:///C:/Windows/win.ini'}
        )
        assert r_ssrf_file.status_code == 400, f"Expected 400 for file:// scheme, got {r_ssrf_file.status_code}"

        r_ssrf_host = await sec_client.post(
            '/api/external-url/preview',
            headers={"X-NEXO-Session-Token": TEST_SESSION_SECRET},
            data={'url': 'http://localhost:8000/api/projects'}
        )
        assert r_ssrf_host.status_code == 400, f"Expected 400 for localhost, got {r_ssrf_host.status_code}"
        print("0g. SSRF and scheme defense in Web Feed Connector PASSED")

        # 0h. Formula Sanitization & Unified Backend Excel Export (SEC-HIGH-03, SEC-MED-01)
        from backend.server import sanitize_excel_cell
        assert sanitize_excel_cell("=CMD|'/C calc'!A0") == "'=CMD|'/C calc'!A0"
        assert sanitize_excel_cell("@SUM(1,2)") == "'@SUM(1,2)"
        assert sanitize_excel_cell("+100") == "'+100"
        assert sanitize_excel_cell("-calc") == "'-calc"
        assert sanitize_excel_cell("Safe Product") == "Safe Product"
        assert sanitize_excel_cell(-42) == -42
        assert sanitize_excel_cell(100.5) == 100.5

        import openpyxl
        import io
        r_export = await sec_client.post(
            '/api/export/excel',
            headers={"X-NEXO-Session-Token": TEST_SESSION_SECRET},
            json={
                "filename": "Test_Formula.xlsx",
                "sheets": [
                    {
                        "name": "بيانات المخزون",
                        "rows": [
                            {"كود الصنف": "SKU-TEST-1", "الحقن": "=CMD|'/C calc'!A0", "الرصيد": 100}
                        ]
                    }
                ]
            }
        )
        assert r_export.status_code == 200, f"Expected 200 for Excel export, got {r_export.status_code}"
        assert len(r_export.content) > 1000, "Exported Excel file is too small"
        
        # Verify openpyxl read of exported bytes
        test_wb = openpyxl.load_workbook(io.BytesIO(r_export.content))
        assert "بيانات المخزون" in test_wb.sheetnames
        test_ws = test_wb["بيانات المخزون"]
        # Verify rightToLeft enabled for Arabic sheet
        assert test_ws.views.sheetView[0].rightToLeft is True
        # Verify cell value is sanitized with leading apostrophe
        cell_val = test_ws.cell(row=2, column=2).value
        assert str(cell_val).startswith("'="), f"Formula injection was not neutralized! Got: {cell_val}"
        print("0h. Formula injection defense & RTL Excel export PASSED")

    # --------------------------------------------------------------------------
    # Authenticated Client for Full Functional Regression Suite
    # --------------------------------------------------------------------------
    async with httpx.AsyncClient(
        transport=transport,
        base_url='http://test',
        headers={"X-NEXO-Session-Token": TEST_SESSION_SECRET}
    ) as client:
        # 1. Health check & Dynamic Versioning
        r = await client.get('/api/health')
        assert r.status_code == 200, f'health failed: {r.text}'
        health_json = r.json()
        assert health_json['status'] == 'online'
        assert 'version' in health_json, "Expected 'version' in health payload"
        assert 'current_version' in health_json, "Expected 'current_version' in health payload"
        assert health_json.get('python_version') == platform.python_version(), f"Expected python_version {platform.python_version()}"
        v_file = Path(__file__).resolve().parent.parent / "VERSION"
        expected_v = v_file.read_text(encoding="utf-8").strip() if v_file.exists() else "0.1.0"
        assert health_json['current_version'] == f"v{expected_v}", f"Expected v{expected_v}, got {health_json['current_version']}"

        # Test OTA system check-update returns dynamic current & latest versions
        r_upd = await client.get('/api/system/check-update')
        assert r_upd.status_code == 200, f"check-update failed: {r_upd.text}"
        upd_json = r_upd.json()
        assert 'current_version' in upd_json, "Expected current_version in check-update"
        assert 'latest_version' in upd_json, "Expected latest_version in check-update"
        assert upd_json['current_version'] == f"v{expected_v}", f"Expected v{expected_v}, got {upd_json['current_version']}"
        print(f"1. Health check & Dynamic Versioning PASSED: {health_json['status']} ({health_json['current_version']} -> {upd_json['latest_version']})")

        # 2. List projects
        r = await client.get('/api/projects')
        assert r.status_code == 200, f'projects failed: {r.text}'
        projs_data = r.json()
        projs = projs_data['projects'] if isinstance(projs_data, dict) else projs_data
        assert len(projs) > 0, 'No projects returned'
        pid = next((p['id'] for p in projs if p.get('sku_count', 0) > 0), projs[0]['id'])
        print(f'2. Projects list PASSED ({len(projs)} projects, active: {pid})')

        # 3. Workspace load
        r = await client.get(f'/api/projects/{pid}/workspace')
        assert r.status_code == 200, f'workspace failed: {r.text}'
        ws = r.json()
        items_count = len(ws.get('items', []))
        filters_count = len(ws.get('filters', []))
        assert items_count > 0, 'No items in workspace'
        print(f'3. Workspace load PASSED ({items_count} items, {filters_count} filters)')

        # 4. Save override
        item_id = ws['items'][0]['id']
        r = await client.post(f'/api/projects/{pid}/overrides', json={'item_id': item_id, 'date': '2026-01', 'override': 123.0})
        assert r.status_code == 200, f'override failed: {r.text}'
        print('4. Save inline override PASSED')

        # 5. Parameters update
        r = await client.post(f'/api/projects/{pid}/parameters', json={'item_id': item_id, 'modelType': 'seasonal', 'serviceLevel': 0.98})
        assert r.status_code == 200, f'parameters failed: {r.text}'
        print('5. Save parameters PASSED')

        # 6. SQL test
        r = await client.post('/api/sql/test', json={'server': 'localhost', 'database': 'master', 'simulate_demo': True})
        assert r.status_code == 200, f'sql test failed: {r.text}'
        print('6. SQL Server test PASSED:', r.json()['message'])

        # 7. SQL import
        r = await client.post('/api/sql/import', json={'server': 'localhost', 'database': 'ERP_DB', 'simulate_demo': True, 'save_profile': True})
        assert r.status_code == 200, f'sql import failed: {r.text}'
        print('7. SQL Server import PASSED:', r.json()['message'])

        # 8. Real Excel export
        r = await client.get(f'/api/files/export/{pid}')
        assert r.status_code == 200, f'export failed: {r.text}'
        assert len(r.content) > 1000, 'Export content too small'
        print('8. Real Excel export PASSED:', len(r.content), 'bytes')

        # 9. App Settings (GET & POST)
        r = await client.get('/api/settings')
        assert r.status_code == 200, f'get settings failed: {r.text}'
        s = r.json()
        assert 'currency_code' in s, 'Missing currency_code in settings'
        print(f'9a. GET /api/settings PASSED (Currency: {s["currency_code"]}, Service Level: {s["default_service_level"]})')

        r = await client.post('/api/settings', json={
            'currency_code': 'EGP',
            'currency_symbol': 'ج.م',
            'forecast_horizon_periods': 12,
            'default_service_level': 0.98,
            'abc_a_cutoff': 80.0,
            'abc_b_cutoff': 95.0
        })
        assert r.status_code == 200, f'post settings failed: {r.text}'
        s_updated = r.json()
        assert s_updated['currency_code'] == 'EGP' and s_updated['default_service_level'] == 0.98
        print(f'9b. POST /api/settings PASSED (Updated Currency: {s_updated["currency_code"]}, Z-Score SL: {s_updated["default_service_level"]})')

        # 10. Blank Templates Export (.xlsx)
        r_sales_tmpl = await client.get('/api/templates/sales')
        assert r_sales_tmpl.status_code == 200 and len(r_sales_tmpl.content) > 1000
        r_inv_tmpl = await client.get('/api/templates/inventory')
        assert r_inv_tmpl.status_code == 200 and len(r_inv_tmpl.content) > 1000
        print(f'10. Excel Templates PASSED (Sales: {len(r_sales_tmpl.content)} bytes, Inventory: {len(r_inv_tmpl.content)} bytes)')

        # 11. Typed Ingestion (CSV / Excel)
        csv_sample = b'CODE,DESC,CATI,ONHA,COST,PRIC\nSKU-DATAHUB-1,Hub Item 1,Beverages,250,15.0,25.0\n'
        r_typed = await client.post(
            '/api/files/import-typed',
            files={'file': ('hub_inventory.csv', csv_sample, 'text/csv')},
            data={'import_type': 'inventory', 'project_id': pid, 'merge_mode': 'merge'}
        )
        assert r_typed.status_code == 200 and r_typed.json()['success'] is True
        print('11. Typed Ingestion PASSED (Rows processed:', r_typed.json()['rows_processed'], ')')

        # 12. Local DB Inspection & Hardening (SEC-CRIT-03)
        # Direct server-side file_path is strictly rejected with 400
        r_db_blocked = await client.post('/api/local-db/inspect', data={'file_path': TEST_DB_PATH})
        assert r_db_blocked.status_code == 400, f"Expected 400 for direct file_path, got {r_db_blocked.status_code}"

        # Uploaded file succeeds and discovers tables
        with open(TEST_DB_PATH, "rb") as f:
            duckdb_bytes = f.read()
        r_db = await client.post(
            '/api/local-db/inspect',
            files={'file': ('workspace.duckdb', duckdb_bytes, 'application/octet-stream')}
        )
        assert r_db.status_code == 200 and r_db.json()['success'] is True
        print(f'12a. Local DB Inspect PASSED ({len(r_db.json()["tables"])} tables detected, direct file_path blocked with 400)')

        # Import with direct file_path only is blocked with 400
        r_import_blocked = await client.post('/api/local-db/import', data={'file_path': TEST_DB_PATH, 'table_name': 'items'})
        assert r_import_blocked.status_code == 400, f"Expected 400 for direct file_path import, got {r_import_blocked.status_code}"

        # Import with malicious DDL in custom_query is blocked with 400
        r_bad_import = await client.post(
            '/api/local-db/import',
            files={'file': ('workspace.duckdb', duckdb_bytes, 'application/octet-stream')},
            data={'table_name': 'items', 'custom_query': 'DROP TABLE items; SELECT 1', 'project_id': pid}
        )
        assert r_bad_import.status_code == 400, f"Expected 400 for DDL custom_query, got {r_bad_import.status_code}"
        print('12b. Local DB Import DDL and path defense PASSED')

        # 13. Ingestion Logs & Re-sync
        r_logs = await client.get(f'/api/projects/{pid}/ingestion-logs')
        assert r_logs.status_code == 200
        logs_data = r_logs.json()
        print(f'13a. Ingestion Logs PASSED ({len(logs_data["logs"])} logs recorded)')

        r_sync = await client.post(f'/api/projects/{pid}/sync-saved-source')
        assert r_sync.status_code == 200 and r_sync.json()['success'] is True
        print('13b. 1-Click ERP Re-Sync PASSED:', r_sync.json()['message'])

        # 14. In-Transit Template & Ingestion
        r_transit_tmpl = await client.get('/api/templates/in-transit')
        assert r_transit_tmpl.status_code == 200 and len(r_transit_tmpl.content) > 1000
        transit_csv = b'ITEM_CODE,ORDER_NO,ORIGIN,DESTINATION,QUANTITY,ETA_DATE,CARRIER,STATUS\nSKU-DATAHUB-1,PO-88899,Port of Alexandria,Cairo DC,120,2026-04-15,Maersk,in_transit\n'
        r_transit_ingest = await client.post(
            '/api/files/import-typed',
            files={'file': ('transit_sample.csv', transit_csv, 'text/csv')},
            data={'import_type': 'in_transit', 'project_id': pid, 'merge_mode': 'merge'}
        )
        assert r_transit_ingest.status_code == 200 and r_transit_ingest.json()['success'] is True
        print(f'14. In-Transit Template & Ingestion PASSED ({len(r_transit_tmpl.content)} bytes template, {r_transit_ingest.json()["rows_processed"]} rows ingested)')

        # 15. Bilingual Templates & Round-Trip Auto-Mapping
        r_ar_sales = await client.get('/api/templates/sales?lang=ar')
        r_en_sales = await client.get('/api/templates/sales?lang=en')
        r_ar_inv = await client.get('/api/templates/inventory?lang=ar')
        r_en_inv = await client.get('/api/templates/inventory?lang=en')
        r_ar_transit = await client.get('/api/templates/in-transit?lang=ar')
        r_en_transit = await client.get('/api/templates/in-transit?lang=en')
        assert all(r.status_code == 200 for r in [r_ar_sales, r_en_sales, r_ar_inv, r_en_inv, r_ar_transit, r_en_transit])

        # Test round-trip inspection of Arabic Inventory Template
        r_inspect = await client.post(
            '/api/files/inspect',
            files={'file': ('NEXO_Inventory_Template_AR.xlsx', r_ar_inv.content, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')}
        )
        assert r_inspect.status_code == 200
        insp_data = r_inspect.json()
        assert 'code' in insp_data['suggested_mappings']
        assert insp_data['suggested_mappings']['code'] == 'كود الصنف'
        assert insp_data['suggested_mappings']['on_hand'] == 'الرصيد المتوفر'

        # Ingest Arabic Sales Template round-trip
        r_ingest_ar_sales = await client.post(
            '/api/files/import-typed',
            files={'file': ('NEXO_Sales_Template_AR.xlsx', r_ar_sales.content, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')},
            data={'import_type': 'sales', 'project_id': pid, 'merge_mode': 'merge'}
        )
        assert r_ingest_ar_sales.status_code == 200 and r_ingest_ar_sales.json()['success'] is True
        print(f'15. Bilingual Templates & Arabic Round-Trip PASSED ({r_ingest_ar_sales.json()["rows_processed"]} sales rows ingested)')

        # 16. Streamlined 7-Column Inventory & Auto-Populated Parameters
        r_lean_inv_ar = await client.get('/api/templates/inventory?lang=ar')
        r_lean_inv_en = await client.get('/api/templates/inventory?lang=en')
        assert r_lean_inv_ar.status_code == 200 and r_lean_inv_en.status_code == 200
        import io, pandas as pd
        df_inv_ar = pd.read_excel(io.BytesIO(r_lean_inv_ar.content))
        df_inv_en = pd.read_excel(io.BytesIO(r_lean_inv_en.content))
        assert list(df_inv_ar.columns) == ['كود الصنف', 'اسم الصنف', 'القسم / المجموعة', 'الفرع / المخزن', 'الرصيد المتوفر', 'سعر التكلفة', 'المورد']
        assert list(df_inv_en.columns) == ['CODE', 'DESC', 'CATI', 'LOCA', 'ONHA', 'COST', 'SUPP']

        # Ingest 7-column inventory template
        r_lean_ingest = await client.post(
            '/api/files/import-typed',
            files={'file': ('NEXO_Inventory_Template_AR.xlsx', r_lean_inv_ar.content, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')},
            data={'import_type': 'inventory', 'project_id': pid, 'merge_mode': 'merge'}
        )
        assert r_lean_ingest.status_code == 200 and r_lean_ingest.json()['success'] is True

        from backend.database import get_connection
        con = get_connection()
        item_check = con.execute("SELECT code, lead_time_days, service_level, min_batch, sales_price FROM items WHERE project_id = ? AND code = 'SKU-1001'", (pid,)).fetchone()
        con.close()
        assert item_check is not None and item_check[1] > 0 and item_check[2] >= 0.90
        print(f'16. Lean 7-Column Inventory & Auto-Parameters PASSED (SKU-1001 LeadTime={item_check[1]}, SL={item_check[2]}, Price={item_check[4]})')

        # 17. Daily Sales POS Auto-Aggregation & Zero-Overwrite Test
        con = get_connection()
        con.execute("DELETE FROM daily_sales WHERE project_id = ? AND item_code = 'SKU-TEST-DAILY'", (pid,))
        con.execute("DELETE FROM periods WHERE project_id = ? AND item_id IN (SELECT id FROM items WHERE project_id = ? AND code = 'SKU-TEST-DAILY')", (pid, pid))
        con.execute("DELETE FROM items WHERE project_id = ? AND code = 'SKU-TEST-DAILY'", (pid,))
        con.close()

        daily_sales_df = pd.DataFrame([
            {"كود الصنف": "SKU-TEST-DAILY", "الفرع / المخزن": "Main WH", "تاريخ البيع": "2025-10-01", "الكمية المباعة": 15.0, "قيمة المبيعات": 1500.0},
            {"كود الصنف": "SKU-TEST-DAILY", "الفرع / المخزن": "Main WH", "تاريخ البيع": "2025-10-01 14:30:00", "الكمية المباعة": 25.0, "قيمة المبيعات": 2500.0},
            {"كود الصنف": "SKU-TEST-DAILY", "الفرع / المخزن": "Main WH", "تاريخ البيع": "2025-10-02", "الكمية المباعة": 10.0, "قيمة المبيعات": 1000.0},
        ])
        sales_buf = io.BytesIO()
        daily_sales_df.to_excel(sales_buf, index=False)
        sales_buf.seek(0)

        r_daily_ingest = await client.post(
            '/api/files/import-typed',
            files={'file': ('Daily_Sales_Test.xlsx', sales_buf.getvalue(), 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')},
            data={'import_type': 'sales', 'project_id': pid, 'merge_mode': 'merge'}
        )
        assert r_daily_ingest.status_code == 200 and r_daily_ingest.json()['success'] is True

        con = get_connection()
        p_row = con.execute("""
            SELECT SUM(actual), SUM(revenue)
            FROM periods p
            JOIN items i ON p.item_id = i.id
            WHERE p.project_id = ? AND i.code = 'SKU-TEST-DAILY' AND p.date = '2025-10'
        """, (pid,)).fetchone()
        ds_count = con.execute("SELECT COUNT(*) FROM daily_sales WHERE project_id = ? AND item_code = 'SKU-TEST-DAILY'", (pid,)).fetchone()[0]
        con.close()

        assert p_row is not None and p_row[0] == 50.0 and p_row[1] == 5000.0, f"Expected 50.0 actual and 5000.0 revenue, got {p_row}"
        assert ds_count == 3, f"Expected 3 raw daily transactions in daily_sales, got {ds_count}"
        print(f'17. Daily Sales POS Auto-Aggregation & Zero-Overwrite PASSED (Aggregated Actual={p_row[0]}, Revenue={p_row[1]}, Staged Transactions={ds_count})')

        # 18. Core Analytical Rule: Exclude Zero-Stock & Zero-Sales SKUs
        con = get_connection()
        test_dormant_codes = ['SKU-DORMANT-TEST', 'SKU-STOCKOUT-TEST', 'SKU-DEADSTOCK-TEST']
        for c in test_dormant_codes:
            con.execute("DELETE FROM periods WHERE project_id = ? AND item_id IN (SELECT id FROM items WHERE project_id = ? AND code = ?)", (pid, pid, c))
            con.execute("DELETE FROM items WHERE project_id = ? AND code = ?", (pid, c))

        # Insert 3 test SKUs:
        # A) Dormant SKU: on_hand = 0, no sales (total_sales = 0) -> MUST BE EXCLUDED
        dormant_id = f"{pid}_dormant_test"
        con.execute("""
            INSERT INTO items (id, project_id, code, description, category, location, on_hand, purchase_price, sales_price)
            VALUES (?, ?, 'SKU-DORMANT-TEST', 'Dormant Zero Stock Zero Sales', 'General', 'Main WH', 0.0, 50.0, 100.0)
        """, (dormant_id, pid))

        # B) Stockout SKU: on_hand = 0, actual = 25.0 -> MUST BE INCLUDED
        stockout_id = f"{pid}_stockout_test"
        per_stockout_id = f"per_{uuid.uuid4().hex[:8]}"
        con.execute("DELETE FROM periods WHERE id = 'per_stockout_test'")
        con.execute("""
            INSERT INTO items (id, project_id, code, description, category, location, on_hand, purchase_price, sales_price)
            VALUES (?, ?, 'SKU-STOCKOUT-TEST', 'Stockout SKU with Demand', 'General', 'Main WH', 0.0, 50.0, 100.0)
        """, (stockout_id, pid))
        con.execute("""
            INSERT INTO periods (id, project_id, item_id, date, actual, forecast)
            VALUES (?, ?, ?, '2025-10', 25.0, 25.0)
        """, (per_stockout_id, pid, stockout_id))

        # C) Deadstock/New Stock SKU: on_hand = 40.0, actual = 0.0 -> MUST BE INCLUDED
        deadstock_id = f"{pid}_deadstock_test"
        con.execute("""
            INSERT INTO items (id, project_id, code, description, category, location, on_hand, purchase_price, sales_price)
            VALUES (?, ?, 'SKU-DEADSTOCK-TEST', 'Dead Stock in Warehouse', 'General', 'Main WH', 40.0, 50.0, 100.0)
        """, (deadstock_id, pid))
        con.close()

        # Test A: GET /api/projects/{pid}/items (default: include_dormant=False)
        r_items = await client.get(f'/api/projects/{pid}/items')
        assert r_items.status_code == 200
        items_payload = r_items.json()
        item_codes = [it['code'] for it in items_payload['items']]
        assert 'SKU-DORMANT-TEST' not in item_codes, "Dormant SKU must be excluded from /api/projects/{pid}/items"
        assert 'SKU-STOCKOUT-TEST' in item_codes, "Stockout SKU with sales demand must be included"
        assert 'SKU-DEADSTOCK-TEST' in item_codes, "Dead stock SKU with on-hand units must be included"
        assert items_payload.get('dormant_count', 0) >= 1, "dormant_count must be >= 1"

        # Test B: GET /api/projects/{pid}/items?include_dormant=true
        r_items_all = await client.get(f'/api/projects/{pid}/items?include_dormant=true')
        assert r_items_all.status_code == 200
        all_codes = [it['code'] for it in r_items_all.json()['items']]
        assert 'SKU-DORMANT-TEST' in all_codes, "Dormant SKU should be returned when include_dormant=true"

        # Test C: GET /api/inventory
        r_inv = await client.get(f'/api/inventory?project_id={pid}&search=SKU-')
        assert r_inv.status_code == 200
        inv_codes = [it['code'] for it in r_inv.json()['items']]
        assert 'SKU-DORMANT-TEST' not in inv_codes, "Dormant SKU must be excluded from /api/inventory"
        assert 'SKU-STOCKOUT-TEST' in inv_codes

        # Test D: GET /api/demand
        r_dem = await client.get(f'/api/demand?project_id={pid}&search=SKU-')
        assert r_dem.status_code == 200
        dem_codes = [it['code'] for it in r_dem.json()['series']]
        assert 'SKU-DORMANT-TEST' not in dem_codes, "Dormant SKU must be excluded from /api/demand"
        assert 'SKU-STOCKOUT-TEST' in dem_codes

        # Test E: GET /api/dashboard & /api/reports
        r_dash = await client.get(f'/api/dashboard?project_id={pid}')
        assert r_dash.status_code == 200
        assert r_dash.json().get('dormant_count', 0) >= 1

        r_rep = await client.get(f'/api/reports?project_id={pid}')
        assert r_rep.status_code == 200
        rep_codes = [it['code'] for it in r_rep.json()['items']]
        assert 'SKU-DORMANT-TEST' not in rep_codes, "Dormant SKU must be excluded from /api/reports"

        # Test F: Excel Export must NOT contain dormant SKU
        r_exp = await client.get(f'/api/files/export/{pid}?export_type=all')
        assert r_exp.status_code == 200
        df_exp = pd.read_excel(io.BytesIO(r_exp.content), sheet_name='Inventory Replenishment')
        assert 'SKU-DORMANT-TEST' not in df_exp['Item Code'].values, "Dormant SKU must be excluded from Excel exports"
        assert 'SKU-STOCKOUT-TEST' in df_exp['Item Code'].values
        assert 'SKU-DEADSTOCK-TEST' in df_exp['Item Code'].values

        # Test G: DataHub Summary endpoint
        r_dh = await client.get(f'/api/data-hub/summary?project_id={pid}')
        assert r_dh.status_code == 200
        assert r_dh.json().get('dormant_count', 0) >= 1

        # Test H: Non-destructive storage verification in DuckDB
        con = get_connection()
        raw_db_row = con.execute("SELECT code, description FROM items WHERE project_id = ? AND code = 'SKU-DORMANT-TEST'", (pid,)).fetchone()
        con.close()
        assert raw_db_row is not None and raw_db_row[0] == 'SKU-DORMANT-TEST', "Raw dormant item master row must remain preserved in DuckDB"

        print(f'18. Exclude Zero-Stock & Zero-Sales SKUs PASSED (Dormant excluded from all views/kpis/exports, non-destructively preserved in DuckDB)')

        # 19. Persistent Multi-Project & DuckDB Restart Verification
        new_proj_name = f"Test_Project_{uuid.uuid4().hex[:6]}"
        r_new_proj = await client.post('/api/projects', json={
            'name': new_proj_name,
            'description': 'Persistent DuckDB automated test project',
            'dataset_name': f"{new_proj_name}.xlsx"
        })
        assert r_new_proj.status_code == 200, f"Create project failed: {r_new_proj.text}"
        new_proj_id = r_new_proj.json()['id']

        # Import inventory items and sales periods into this project
        test_items = [
            {'code': 'PERSIST-SKU-1', 'description': 'Persistent Item One', 'category': 'Hardware', 'location': 'Cairo Hub', 'on_hand': 120.0, 'purchase_price': 45.0, 'sales_price': 90.0},
            {'code': 'PERSIST-SKU-2', 'description': 'Persistent Item Two', 'category': 'Hardware', 'location': 'Cairo Hub', 'on_hand': 60.0, 'purchase_price': 30.0, 'sales_price': 60.0}
        ]
        test_periods = [
            {'code': 'PERSIST-SKU-1', 'date': '2026-01-01', 'actual': 15.0, 'revenue': 1350.0},
            {'code': 'PERSIST-SKU-1', 'date': '2026-02-01', 'actual': 20.0, 'revenue': 1800.0},
            {'code': 'PERSIST-SKU-2', 'date': '2026-01-01', 'actual': 10.0, 'revenue': 600.0}
        ]
        r_bulk = await client.post(f'/api/projects/{new_proj_id}/items/bulk', json={
            'items': test_items,
            'periods': test_periods,
            'merge_mode': 'merge'
        })
        assert r_bulk.status_code == 200, f"Bulk save items failed: {r_bulk.text}"

        # Save and checkpoint project workspace
        r_save = await client.post(f'/api/projects/{new_proj_id}/save')
        assert r_save.status_code == 200, f"Save project failed: {r_save.text}"

        # Simulate complete app shutdown and database disconnect
        close_db()

        # Reopen connection directly from disk file to verify persistence across restarts
        con_reopened = get_connection()
        try:
            persisted_proj = con_reopened.execute("SELECT id, name, item_count FROM projects WHERE id = ?", (new_proj_id,)).fetchone()
            assert persisted_proj is not None, f"Project {new_proj_id} not found in DuckDB after restart"
            assert persisted_proj[1] == new_proj_name

            persisted_items = con_reopened.execute("SELECT code, on_hand FROM project_items WHERE project_id = ?", (new_proj_id,)).fetchall()
            assert len(persisted_items) == 2, f"Expected 2 project_items, found {len(persisted_items)}"

            persisted_periods = con_reopened.execute("SELECT code, period, qty_sold FROM project_periods WHERE project_id = ?", (new_proj_id,)).fetchall()
            assert len(persisted_periods) == 3, f"Expected 3 project_periods, found {len(persisted_periods)}"

            settings_active = con_reopened.execute("SELECT active_project_id FROM app_settings WHERE id = 'global_settings'").fetchone()
            assert settings_active is not None and settings_active[0] == new_proj_id, "active_project_id in app_settings must match new_proj_id"
        finally:
            con_reopened.close()

        print(f'19. Multi-Project DuckDB Persistence & Restart PASSED (New project {new_proj_id} + rows completely restored from disk)')

        # 20. 25,000-Row Direct DuckDB Stream Ingestion Benchmark (< 3s & exact sums)
        bench_tag = uuid.uuid4().hex[:6]
        bench_prefix = f"SKU_B_{bench_tag}"
        bench_lines = ["CODE,LOCA,SALE_DATE,QTY_SOLD,REVENUE"]
        for i in range(25000):
            sku = f"{bench_prefix}_{i % 100}"
            day = (i % 28) + 1
            bench_lines.append(f"{sku},Main Warehouse,2026-03-{day:02d},2.0,100.0")
        bench_csv_bytes = "\n".join(bench_lines).encode("utf-8")

        t_start = time.perf_counter()
        r_bench = await client.post(
            '/api/files/import-typed',
            files={'file': ('benchmark_25k_sales.csv', bench_csv_bytes, 'text/csv')},
            data={'import_type': 'sales', 'project_id': pid, 'merge_mode': 'merge'}
        )
        bench_duration = time.perf_counter() - t_start
        assert r_bench.status_code == 200, f"Benchmark import failed: {r_bench.text}"
        bench_json = r_bench.json()
        assert bench_json['success'] is True, f"Benchmark import failed: {bench_json}"
        assert bench_json['rows_processed'] == 25000, f"Expected 25,000 rows, got {bench_json['rows_processed']}"
        assert bench_duration < 8.0, f"Benchmark took too long: {bench_duration:.3f}s (must be < 8.0s)"
        assert bench_json.get('elapsed_seconds', 0) < 5.0, f"Backend reported elapsed time >= 5.0s: {bench_json.get('elapsed_seconds')}"

        con_bench = get_connection()
        try:
            ds_bench = con_bench.execute(f"""
                SELECT COUNT(*), SUM(qty_sold), SUM(revenue)
                FROM daily_sales
                WHERE project_id = ? AND item_code LIKE '{bench_prefix}_%'
            """, (pid,)).fetchone()
            assert ds_bench[0] == 25000, f"Expected 25,000 daily_sales records, found {ds_bench[0]}"
            assert abs(ds_bench[1] - 50000.0) < 1e-4, f"Expected 50000.0 total qty, got {ds_bench[1]}"
            assert abs(ds_bench[2] - 2500000.0) < 1e-4, f"Expected 2500000.0 total rev, got {ds_bench[2]}"

            p_bench = con_bench.execute(f"""
                SELECT COUNT(DISTINCT i.code), SUM(p.actual), SUM(p.revenue)
                FROM periods p
                JOIN items i ON p.item_id = i.id
                WHERE p.project_id = ? AND i.code LIKE '{bench_prefix}_%' AND p.date = '2026-03'
            """, (pid,)).fetchone()
            assert p_bench[0] == 100, f"Expected 100 distinct SKUs in periods, got {p_bench[0]}"
            assert abs(p_bench[1] - 50000.0) < 1e-4, f"Expected 50000.0 aggregated actual, got {p_bench[1]}"
            assert abs(p_bench[2] - 2500000.0) < 1e-4, f"Expected 2500000.0 aggregated rev, got {p_bench[2]}"
        finally:
            con_bench.close()

        print(f'20. 25,000-Row Direct DuckDB Stream Ingestion Benchmark PASSED (Processed in {bench_duration:.3f}s, Throughput: {25000/bench_duration:,.0f} rows/s, Exact Aggregation Verified)')

        # 21. Live Upload & DuckDB Ingestion Progress Polling Test (GET /api/files/import-progress/{job_id})
        test_job_id = f"job_test_{uuid.uuid4().hex[:8]}"
        # Querying uninitialized job returns initial 45% running state
        r_init = await client.get(f'/api/files/import-progress/{test_job_id}')
        assert r_init.status_code == 200, f"Progress endpoint failed: {r_init.text}"
        init_json = r_init.json()
        assert init_json['percent'] == 45
        assert init_json['status'] == 'running'

        # Trigger import-typed with job_id
        csv_sample = "CODE,LOCA,SALE_DATE,QTY_SOLD,REVENUE\nSKU_PROG_1,Wh1,2026-04-01,10.0,500.0".encode("utf-8")
        r_import = await client.post(
            '/api/files/import-typed',
            files={'file': ('progress_test.csv', csv_sample, 'text/csv')},
            data={'import_type': 'sales', 'project_id': pid, 'merge_mode': 'merge', 'job_id': test_job_id}
        )
        assert r_import.status_code == 200, f"Import with job_id failed: {r_import.text}"

        # Progress should now be 100% done
        r_done = await client.get(f'/api/files/import-progress/{test_job_id}')
        assert r_done.status_code == 200, f"Progress polling failed: {r_done.text}"
        done_json = r_done.json()
        assert done_json['percent'] == 100, f"Expected 100%, got {done_json['percent']}"
        assert done_json['status'] == 'done', f"Expected status 'done', got {done_json['status']}"
        assert 'اكتمل الاستيراد بنجاح' in done_json['stage_ar']
        assert done_json['rows_processed'] == 1

        print(f'21. Live Upload & DuckDB Ingestion Progress Polling PASSED (Job {test_job_id} tracked to 100% done)')

        # 22. 30,000-SKU Stress Test: Server-Side Pagination & Pre-Aggregated Dashboard (Fix WebView2 Code 39 Crash)
        stress_pid = "proj_stress_30k"
        con_stress = get_connection()
        try:
            con_stress.execute("DELETE FROM periods WHERE project_id = ?", (stress_pid,))
            con_stress.execute("DELETE FROM items WHERE project_id = ?", (stress_pid,))
            con_stress.execute("""
                INSERT OR REPLACE INTO projects (id, name, dataset_name, sku_count, created_at, updated_at)
                VALUES (?, 'Stress Test 30k Project', 'stress_30k.csv', 30000, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
            """, (stress_pid,))
            con_stress.execute(f"""
                INSERT INTO items (
                    id, project_id, code, description, category, location, on_hand, safety_stock,
                    reorder_point, order_now, order_now_value, purchase_price, sales_price, lead_time_days,
                    abc_class, xyz_class, service_level, model_type, is_stockout, is_overstock,
                    updated_at
                )
                SELECT 
                    '{stress_pid}_sku_' || range,
                    '{stress_pid}',
                    'SKU_STRESS_' || range,
                    'Stress Item ' || range,
                    CASE WHEN range % 3 = 0 THEN 'Electronics' WHEN range % 3 = 1 THEN 'Groceries' ELSE 'Apparel' END,
                    'Main DC',
                    CASE WHEN range % 5 = 0 THEN 0.0 ELSE 50.0 + (range % 100) END,
                    20.0,
                    30.0,
                    CASE WHEN range % 5 = 0 THEN 40.0 ELSE 0.0 END,
                    CASE WHEN range % 5 = 0 THEN 40.0 * 25.0 ELSE 0.0 END,
                    20.0,
                    25.0,
                    14,
                    CASE WHEN range % 10 < 2 THEN 'A' WHEN range % 10 < 5 THEN 'B' ELSE 'C' END,
                    'X',
                    0.95,
                    'constant',
                    (range % 5 = 0),
                    (range % 20 = 0),
                    strftime(CURRENT_TIMESTAMP, '%Y-%m-%d %H:%M:%S')
                FROM range(1, 30001);
            """)
            con_stress.execute(f"""
                INSERT INTO periods (id, project_id, item_id, date, actual, forecast)
                SELECT 
                    'per_stress_' || range,
                    '{stress_pid}',
                    '{stress_pid}_sku_' || range,
                    '2026-03',
                    10.0,
                    10.0
                FROM range(1, 30001);
            """)
            con_stress.execute("CHECKPOINT")
        finally:
            con_stress.close()

        # Test paginated Inventory (100 rows per page)
        t_inv_start = time.perf_counter()
        r_inv = await client.get(f'/api/inventory?project_id={stress_pid}&page=1&page_size=100')
        t_inv_duration = time.perf_counter() - t_inv_start
        assert r_inv.status_code == 200, f"Paginated inventory failed: {r_inv.text}"
        inv_json = r_inv.json()
        assert inv_json['total_count'] == 30000, f"Expected 30000, got {inv_json['total_count']}"
        assert inv_json['total_pages'] == 300, f"Expected 300 pages, got {inv_json['total_pages']}"
        assert len(inv_json['items']) == 100, f"Expected 100 items slice, got {len(inv_json['items'])}"
        assert inv_json['summary_counts']['all'] == 30000, f"Summary counts incorrect: {inv_json['summary_counts']}"
        assert inv_json['summary_counts']['stockout_risk'] == 6000, f"Expected 6000 stockouts, got {inv_json['summary_counts']['stockout_risk']}"
        assert t_inv_duration < 1.0, f"Paginated inventory too slow: {t_inv_duration:.3f}s"

        # Test paginated Demand (50 rows per page)
        t_dem_start = time.perf_counter()
        r_dem = await client.get(f'/api/demand?project_id={stress_pid}&page=1&page_size=50')
        t_dem_duration = time.perf_counter() - t_dem_start
        assert r_dem.status_code == 200, f"Paginated demand failed: {r_dem.text}"
        dem_json = r_dem.json()
        assert dem_json['total_count'] == 30000, f"Expected 30000, got {dem_json['total_count']}"
        assert dem_json['total_pages'] == 600, f"Expected 600 pages, got {dem_json['total_pages']}"
        assert len(dem_json['series']) == 50, f"Expected 50 series slice, got {len(dem_json['series'])}"
        assert len(dem_json['categories']) >= 3, f"Expected >= 3 categories, got {len(dem_json['categories'])}"
        assert t_dem_duration < 1.0, f"Paginated demand too slow: {t_dem_duration:.3f}s"

        # Test pre-aggregated Dashboard (< 100ms, NO raw 30k SKU dump)
        t_dash_start = time.perf_counter()
        r_dash = await client.get(f'/api/dashboard?project_id={stress_pid}')
        t_dash_duration = time.perf_counter() - t_dash_start
        assert r_dash.status_code == 200, f"Dashboard summary failed: {r_dash.text}"
        dash_json = r_dash.json()
        assert dash_json['active_skus'] == 30000, f"Expected 30000 active skus, got {dash_json['active_skus']}"
        assert dash_json['kpis']['totalInventoryValue'] > 0
        assert len(dash_json['abc_data']) == 3, f"Expected 3 ABC classes, got {len(dash_json['abc_data'])}"
        assert len(dash_json['category_orders']) >= 3, f"Expected category orders, got {len(dash_json['category_orders'])}"
        assert len(dash_json['top_risk_items']) <= 15
        assert len(dash_json['top_overstock_items']) <= 15
        assert 'items' not in dash_json, "Raw 30,000 items should NEVER be returned by /api/dashboard"
        assert len(r_dash.content) < 25000, f"Dashboard response payload too large: {len(r_dash.content)} bytes (should be slim < 25KB)"
        assert t_dash_duration < 0.75, f"Dashboard summary too slow: {t_dash_duration:.3f}s"

        print(f'22. 30,000-SKU Pagination & Pre-Aggregated Dashboard Stress Test PASSED (Inv: {t_inv_duration*1000:.1f}ms, Dem: {t_dem_duration*1000:.1f}ms, Dash: {t_dash_duration*1000:.1f}ms, Payload: {len(r_dash.content):,} bytes)')

        # 23. Resilient CSV Parser (Unescaped Quotes, Ragged Cells, CP1256 Arabic) & Direct XLSX Ingestion
        cp1256_csv = """كود الصنف,اسم الصنف,المخزن,الكمية,سعر الشراء
SKU_INCH_1,شاشة سامسونج 32" بوصة,المخزن الرئيسي,15.0,2500.0
SKU_INCH_2,لابتوب ديل 15.6" انش,مخزن الجيزة,10.0,18000.0
SKU_RAGGED_3,طابعة ليزر "HP",مخزن الإسكندرية
""".encode('cp1256')

        r_cp1256 = await client.post(
            '/api/files/import-typed',
            files={'file': ('arabic_cp1256_quotes.csv', cp1256_csv, 'text/csv')},
            data={'import_type': 'inventory', 'project_id': pid, 'merge_mode': 'merge'}
        )
        assert r_cp1256.status_code == 200, f"CP1256 CSV ingestion failed: {r_cp1256.text}"
        cp1256_json = r_cp1256.json()
        assert cp1256_json['success'] is True
        assert cp1256_json['rows_processed'] >= 3

        # Verify inspection endpoint on cp1256 file with unescaped quotes
        r_inspect_cp1256 = await client.post(
            '/api/files/inspect',
            files={'file': ('arabic_inspect.csv', cp1256_csv, 'text/csv')}
        )
        assert r_inspect_cp1256.status_code == 200, f"CP1256 CSV inspection failed: {r_inspect_cp1256.text}"
        inspect_data = r_inspect_cp1256.json()
        assert len(inspect_data['columns']) >= 3

        # Verify Direct XLSX ingestion via pure-Python openpyxl streaming
        xlsx_buffer = io.BytesIO()
        df_excel_test = pd.DataFrame([
            {"CODE": "SKU_XLSX_1", "DESC": "Direct Excel Item 1", "ONHA": 25.0, "COST": 120.0},
            {"CODE": "SKU_XLSX_2", "DESC": "Direct Excel Item 2", "ONHA": 50.0, "COST": 300.0}
        ])
        with pd.ExcelWriter(xlsx_buffer, engine="openpyxl") as writer:
            df_excel_test.to_excel(writer, index=False, sheet_name="Inventory")
        xlsx_bytes = xlsx_buffer.getvalue()

        r_xlsx = await client.post(
            '/api/files/import-typed',
            files={'file': ('openpyxl_streaming.xlsx', xlsx_bytes, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')},
            data={'import_type': 'inventory', 'project_id': pid, 'merge_mode': 'merge'}
        )
        assert r_xlsx.status_code == 200, f"Direct XLSX ingestion failed: {r_xlsx.text}"
        assert r_xlsx.json()['success'] is True
        assert r_xlsx.json()['rows_processed'] == 2

        # Verify legacy .xls rejection
        r_xls = await client.post(
            '/api/files/inspect',
            files={'file': ('legacy.xls', b'DUMMY_BIFF8_XLS_CONTENT', 'application/vnd.ms-excel')}
        )
        assert r_xls.status_code == 400
        assert "Legacy binary .xls files are not supported" in r_xls.json()["detail"]

        print(f'23. Resilient CSV Parser (Unescaped Quotes, Ragged Cells, CP1256 Arabic) & Direct Pure-Python XLSX Ingestion PASSED')

        # 24. Strict Project Isolation & Zero Demo-Data Contamination Test
        # Step a: Verify a previous project with data exists
        r_prev = await client.get(f'/api/inventory?project_id={pid}')
        assert r_prev.status_code == 200
        prev_data = r_prev.json()
        assert prev_data['total_count'] > 0, "Previous project should have items before isolation test"
        prev_count = prev_data['total_count']

        # Step b: Create a brand-new project via POST /api/projects
        r_new_proj = await client.post('/api/projects', json={
            'name': 'Strict Isolation Blank Project',
            'description': 'A completely blank project with 0 initial data',
            'dataset_name': 'Empty Test Sheet.xlsx'
        })
        assert r_new_proj.status_code == 200, f"Create project failed: {r_new_proj.text}"
        new_proj = r_new_proj.json()
        new_pid = new_proj['id']

        # Step c: Assert /api/inventory, /api/demand, /api/dashboard, and /api/in-transit all return 0 items and contain zero demo SKUs
        r_iso_inv = await client.get(f'/api/inventory?project_id={new_pid}')
        assert r_iso_inv.status_code == 200
        iso_inv = r_iso_inv.json()
        assert iso_inv['total_count'] == 0, f"Expected 0 items in new project, got {iso_inv['total_count']}"
        assert len(iso_inv['items']) == 0, f"Expected empty items list, got {len(iso_inv['items'])}"

        r_iso_dem = await client.get(f'/api/demand?project_id={new_pid}')
        assert r_iso_dem.status_code == 200
        iso_dem = r_iso_dem.json()
        assert iso_dem['total_count'] == 0, f"Expected 0 items in demand, got {iso_dem['total_count']}"
        assert len(iso_dem['series']) == 0, f"Expected 0 series, got {len(iso_dem['series'])}"

        r_iso_dash = await client.get(f'/api/dashboard?project_id={new_pid}')
        assert r_iso_dash.status_code == 200
        iso_dash = r_iso_dash.json()
        assert iso_dash['active_skus'] == 0, f"Expected 0 active skus in dashboard, got {iso_dash['active_skus']}"
        assert iso_dash['kpis']['totalInventoryValue'] == 0.0

        r_iso_trans = await client.get(f'/api/in-transit?project_id={new_pid}')
        assert r_iso_trans.status_code == 200
        iso_trans = r_iso_trans.json()
        assert iso_trans['count'] == 0, f"Expected 0 in-transit shipments, got {iso_trans['count']}"

        # Check default queries without project_id query param resolve to active project (which is new_pid)
        r_def_inv = await client.get('/api/inventory')
        assert r_def_inv.status_code == 200
        assert r_def_inv.json()['total_count'] == 0, "Default inventory query should resolve to new blank active project"

        # Step d: Close and reopen nexo_workspace.duckdb; verify the new project is STILL completely empty (no auto-reseed)
        close_db()
        init_db()

        r_reopen_inv = await client.get(f'/api/inventory?project_id={new_pid}')
        assert r_reopen_inv.status_code == 200
        reopen_inv = r_reopen_inv.json()
        assert reopen_inv['total_count'] == 0, f"New project auto-reseeded after DB restart! Count: {reopen_inv['total_count']}"
        assert len(reopen_inv['items']) == 0

        # Step e: Switch back to the previous project via /activate and assert its data is intact and unmixed
        r_act_prev = await client.post(f'/api/projects/{pid}/activate')
        assert r_act_prev.status_code == 200
        r_prev_restored = await client.get(f'/api/inventory?project_id={pid}')
        assert r_prev_restored.status_code == 200
        restored_data = r_prev_restored.json()
        assert restored_data['total_count'] == prev_count, f"Expected {prev_count} restored items in {pid}, got {restored_data['total_count']}"

        print(f'24. Strict Project Isolation & Zero Demo-Data Contamination Test PASSED')

        # Test 25: Trailing .0 Decimal Artifact Ingestion Normalization & Startup DuckDB Cleanup
        # a. Unit assertions on clean_item_code
        assert clean_item_code("10006.0") == "10006"
        assert clean_item_code(1.0) == "1"
        assert clean_item_code("1.000") == "1"
        assert clean_item_code("10006.5") == "10006.5"
        assert clean_item_code("SKU-01.0") == "SKU-01.0"
        assert clean_item_code("A1.0") == "A1.0"
        assert clean_item_code(10006) == "10006"
        assert clean_item_code(None) == ""
        assert clean_item_code("") == ""

        # b. Bulk insert with float code strings normalizes
        r_bulk = await client.post(f'/api/projects/{pid}/items/bulk', json={
            'items': [
                {'code': '5001.0', 'description': 'Item 5001', 'on_hand': 10.0, 'purchase_price': 20.0},
                {'code': 'SKU-FLOAT-01.0', 'description': 'Alphanumeric Code', 'on_hand': 5.0, 'purchase_price': 15.0}
            ]
        })
        assert r_bulk.status_code == 200
        con_check = get_connection()
        try:
            row_5001 = con_check.execute("SELECT code FROM items WHERE project_id = ? AND code = '5001'", (pid,)).fetchone()
            assert row_5001 is not None, "Item '5001.0' should be normalized to '5001' in DuckDB"
            row_alpha = con_check.execute("SELECT code FROM items WHERE project_id = ? AND code = 'SKU-FLOAT-01.0'", (pid,)).fetchone()
            assert row_alpha is not None, "Alphanumeric code 'SKU-FLOAT-01.0' should be preserved intact"
        finally:
            con_check.close()

        # c. Ingestion of CSV with trailing .0 normalizes
        csv_content = "code,description,on_hand,price\n7001.0,Item 7001,50,100\n7002,Item 7002,25,50\n"
        files = {'file': ('test_decimal_skus.csv', csv_content.encode('utf-8'), 'text/csv')}
        r_csv = await client.post('/api/files/import-typed', data={'project_id': pid, 'import_type': 'inventory', 'merge_mode': 'merge'}, files=files)
        assert r_csv.status_code == 200
        con_check = get_connection()
        try:
            row_7001 = con_check.execute("SELECT code FROM items WHERE project_id = ? AND code = '7001'", (pid,)).fetchone()
            assert row_7001 is not None, "CSV SKU '7001.0' should be normalized to '7001' during ingestion"
        finally:
            con_check.close()

        # d. Startup cleanup routine
        con_dirty = get_connection()
        try:
            con_dirty.execute("INSERT INTO items (id, project_id, code, description) VALUES ('dirty_1', ?, '8888.0', 'Item 8888.0')", (pid,))
            con_dirty.execute("INSERT INTO project_items (project_id, code, location) VALUES (?, '8888.0', 'LocA')", (pid,))
            con_dirty.execute("INSERT INTO daily_sales (id, project_id, item_code, location, sale_date) VALUES ('ds_dirty_1', ?, '8888.0', 'LocA', '2026-01-01')", (pid,))
        finally:
            con_dirty.close()

        cleanup_trailing_decimal_codes()

        con_clean = get_connection()
        try:
            cleaned_row = con_clean.execute("SELECT code, description FROM items WHERE id = 'dirty_1'").fetchone()
            assert cleaned_row[0] == '8888', f"Expected '8888', got {cleaned_row[0]}"
            assert cleaned_row[1] == 'Item 8888', f"Expected 'Item 8888', got {cleaned_row[1]}"
            pi_cleaned = con_clean.execute("SELECT code FROM project_items WHERE project_id = ? AND code = '8888'", (pid,)).fetchone()
            assert pi_cleaned is not None, "project_items code should be cleaned to '8888'"
            ds_cleaned = con_clean.execute("SELECT item_code FROM daily_sales WHERE id = 'ds_dirty_1'").fetchone()
            assert ds_cleaned[0] == '8888', f"daily_sales item_code should be cleaned to '8888', got {ds_cleaned[0]}"
            # Cleanup test artifacts
            con_clean.execute("DELETE FROM items WHERE project_id = ? AND code IN ('5001', 'SKU-FLOAT-01.0', '7001', '7002', '8888')", (pid,))
            con_clean.execute("DELETE FROM project_items WHERE project_id = ? AND code IN ('8888')", (pid,))
            con_clean.execute("DELETE FROM daily_sales WHERE id = 'ds_dirty_1'")
        finally:
            con_clean.close()

        print(f'25. Trailing .0 Decimal Artifact Ingestion Normalization & Startup DuckDB Cleanup PASSED')

        # 26. 500,000-Row Timestamped CSV Direct Streaming Ingestion & Concurrent API Reads Stress Test
        stress_csv_path = os.path.join(TEST_TMP_DIR, "stress_500k.csv")
        with open(stress_csv_path, "w", encoding="utf-8") as f:
            f.write("CODE,BRANCH,SALE_DATE,QTY_SOLD,REVENUE\n")
            for i in range(500000):
                sku = f"{20000 + (i % 500)}.0"
                branch = f"Store_{(i % 5) + 1}"
                day = (i % 28) + 1
                f.write(f"{sku},{branch},2026-07-{day:02d} 00:13:00.019000,2.0,100.0\n")

        keep_reading = True
        read_count = 0

        async def concurrent_reader():
            nonlocal read_count
            while keep_reading:
                r1 = await client.get("/api/projects")
                assert r1.status_code == 200
                r2 = await client.get("/api/health")
                assert r2.status_code == 200
                r3 = await client.get("/api/settings")
                assert r3.status_code == 200
                read_count += 3
                await asyncio.sleep(0.05)

        reader_task = asyncio.create_task(concurrent_reader())

        t_s0 = time.perf_counter()
        with open(stress_csv_path, "rb") as cf:
            r_stress = await client.post(
                "/api/files/import-typed",
                files={"file": ("stress_500k.csv", cf, "text/csv")},
                data={"import_type": "sales", "project_id": pid, "merge_mode": "merge"}
            )
        stress_elapsed = time.perf_counter() - t_s0

        keep_reading = False
        await reader_task

        assert r_stress.status_code == 200, f"Stress ingest failed: {r_stress.text}"
        stress_json = r_stress.json()
        assert stress_json["success"] is True
        assert stress_json["rows_processed"] == 500000, f"Expected 500,000 rows, got {stress_json['rows_processed']}"

        con_stress = get_connection()
        try:
            p_stress = con_stress.execute("""
                SELECT COUNT(DISTINCT i.code), SUM(p.actual), SUM(p.revenue)
                FROM periods p
                JOIN items i ON p.item_id = i.id
                WHERE p.project_id = ? AND p.date = '2026-07' AND i.code LIKE '20%'
            """, (pid,)).fetchone()
            assert p_stress[0] == 500, f"Expected 500 distinct SKUs, got {p_stress[0]}"
            assert abs(p_stress[1] - 1000000.0) < 1e-4, f"Expected 1,000,000 total qty, got {p_stress[1]}"
            assert abs(p_stress[2] - 50000000.0) < 1e-4, f"Expected 50,000,000 total rev, got {p_stress[2]}"

            # Verify .0 codes were stripped during ingestion
            dirty_cnt = con_stress.execute("SELECT COUNT(*) FROM items WHERE project_id = ? AND regexp_matches(code, '^[0-9]+\\.0+$')", (pid,)).fetchone()[0]
            assert dirty_cnt == 0, f"Expected 0 codes with trailing .0, got {dirty_cnt}"

            # Clean up test artifacts
            con_stress.execute("DELETE FROM periods WHERE project_id = ? AND date = '2026-07'", (pid,))
            con_stress.execute("DELETE FROM items WHERE project_id = ? AND code LIKE '20%'", (pid,))
            con_stress.execute("DELETE FROM daily_sales WHERE project_id = ? AND item_code LIKE '20%'", (pid,))
        finally:
            con_stress.close()

        if os.path.exists(stress_csv_path):
            try:
                os.remove(stress_csv_path)
            except Exception:
                pass

        print(f"26. 500,000-Row Timestamped CSV Direct Streaming Ingestion & Concurrent API Reads PASSED (Processed in {stress_elapsed:.2f}s, Throughput: {500000/stress_elapsed:,.0f} rows/s, Concurrent Reads: {read_count})")

        # 27. Real UTF-8-BOM (utf-8-sig) Arabic CSV Preview & Streaming Ingestion Persistence Test
        arabic_csv_text = "\ufeffكود الصنف,الفرع / المخزن,تاريخ البيع,الكمية المباعة,قيمة المبيعات\nSKU-AR-01,السلام,2026-01-16 00:00:00,10.0,500.0\n"
        arabic_csv_bytes = arabic_csv_text.encode("utf-8")
        assert arabic_csv_bytes.startswith(b"\xef\xbb\xbf"), "Test payload must start with UTF-8 BOM"

        # Step A: File Inspection Preview Endpoint Verification
        r_insp = await client.post(
            "/api/files/inspect",
            files={"file": ("arabic_sales.csv", arabic_csv_bytes, "text/csv")}
        )
        assert r_insp.status_code == 200, f"Inspect failed: {r_insp.text}"
        insp_json = r_insp.json()
        cols = insp_json.get("columns", [])
        assert "كود الصنف" in cols, f"Expected 'كود الصنف' in columns, got {cols}"
        assert "الفرع / المخزن" in cols, f"Expected 'الفرع / المخزن' in columns, got {cols}"
        assert "تاريخ البيع" in cols, f"Expected 'تاريخ البيع' in columns, got {cols}"
        assert "الكمية المباعة" in cols, f"Expected 'الكمية المباعة' in columns, got {cols}"
        assert "قيمة المبيعات" in cols, f"Expected 'قيمة المبيعات' in columns, got {cols}"

        # Assert no BOM or Mojibake in column names
        for c in cols:
            assert not c.startswith("\ufeff"), f"Column '{c}' contains unstripped BOM"
            assert "ï" not in c and "ظ" not in c, f"Mojibake detected in column name: '{c}'"

        preview_rows = insp_json.get("preview_rows", [])
        assert len(preview_rows) >= 1, "Preview rows should not be empty"
        assert preview_rows[0].get("كود الصنف") == "SKU-AR-01"
        assert preview_rows[0].get("الفرع / المخزن") == "السلام"

        sugg = insp_json.get("suggested_mappings", {})
        assert sugg.get("code") == "كود الصنف"
        assert sugg.get("location") == "الفرع / المخزن"
        assert sugg.get("period") == "تاريخ البيع"
        assert sugg.get("qty_sold") == "الكمية المباعة"
        assert sugg.get("revenue") == "قيمة المبيعات"

        # Step B: Silent 0-Row Prevention (Missing required sales columns should return HTTP 400)
        r_bad = await client.post(
            "/api/files/import-typed",
            files={"file": ("bad_sales.csv", b"col_a,col_b\nval1,val2\n", "text/csv")},
            data={"import_type": "sales", "project_id": pid, "merge_mode": "merge"}
        )
        assert r_bad.status_code == 400, f"Expected 400 for missing required columns, got {r_bad.status_code}"
        assert "Missing required sales columns" in r_bad.json().get("detail", "")

        # Step C: Ingest Arabic CSV with UTF-8 BOM
        r_ingest = await client.post(
            "/api/files/import-typed",
            files={"file": ("arabic_sales.csv", arabic_csv_bytes, "text/csv")},
            data={"import_type": "sales", "project_id": pid, "merge_mode": "merge"}
        )
        assert r_ingest.status_code == 200, f"Import failed: {r_ingest.text}"
        ingest_json = r_ingest.json()
        assert ingest_json["success"] is True
        assert ingest_json["rows_processed"] == 1
        assert ingest_json.get("periods_saved", 0) >= 1
        assert ingest_json.get("items_affected", 0) >= 1
        assert ingest_json.get("warning") is None

        # Step D: Verify immediate appearance in Demand & Items API endpoints
        r_demand = await client.get(f"/api/demand?project_id={pid}&search=SKU-AR-01")
        assert r_demand.status_code == 200
        dem_items = r_demand.json().get("items", [])
        assert len(dem_items) == 1, f"Expected 1 item in demand search, got {len(dem_items)}"
        ar_item = dem_items[0]
        assert ar_item["code"] == "SKU-AR-01"
        assert ar_item["location"] == "السلام", f"Expected location 'السلام', got '{ar_item.get('location')}'"
        assert len(ar_item.get("periods", [])) >= 1
        assert any(p.get("date") == "2026-01" and p.get("actual") == 10.0 for p in ar_item["periods"]), f"Expected 10.0 actual in 2026-01, got {ar_item['periods']}"

        r_items_api = await client.get(f"/api/projects/{pid}/items")
        assert r_items_api.status_code == 200
        proj_items = r_items_api.json().get("items", [])
        item_in_proj = next((it for it in proj_items if it["code"] == "SKU-AR-01"), None)
        assert item_in_proj is not None, "SKU-AR-01 must be present in /api/projects/{pid}/items"
        assert item_in_proj["location"] == "السلام"

        # Direct DuckDB query assertions
        con_check = get_connection()
        try:
            db_row = con_check.execute("""
                SELECT p.actual, p.revenue, i.location
                FROM periods p
                JOIN items i ON p.item_id = i.id
                WHERE p.project_id = ? AND i.code = 'SKU-AR-01' AND p.date = '2026-01'
            """, (pid,)).fetchone()
            assert db_row is not None, "Periods row for SKU-AR-01 in 2026-01 not found"
            assert abs(db_row[0] - 10.0) < 1e-4, f"Expected 10.0 actual, got {db_row[0]}"
            assert abs(db_row[1] - 500.0) < 1e-4, f"Expected 500.0 revenue, got {db_row[1]}"
            assert db_row[2] == "السلام", f"Expected location 'السلام', got {db_row[2]}"

            ds_row = con_check.execute("""
                SELECT item_code, location, sale_date, qty_sold, revenue
                FROM daily_sales
                WHERE project_id = ? AND item_code = 'SKU-AR-01'
            """, (pid,)).fetchone()
            assert ds_row is not None, "daily_sales row for SKU-AR-01 not found"
            assert ds_row[1] == "السلام"
            assert ds_row[2] == "2026-01-16"
            assert abs(ds_row[3] - 10.0) < 1e-4

            # Cleanup test artifacts
            con_check.execute("DELETE FROM periods WHERE project_id = ? AND item_id IN (SELECT id FROM items WHERE project_id = ? AND code = 'SKU-AR-01')", (pid, pid))
            con_check.execute("DELETE FROM items WHERE project_id = ? AND code = 'SKU-AR-01'", (pid,))
            con_check.execute("DELETE FROM project_items WHERE project_id = ? AND code = 'SKU-AR-01'", (pid,))
            con_check.execute("DELETE FROM project_periods WHERE project_id = ? AND code = 'SKU-AR-01'", (pid,))
            con_check.execute("DELETE FROM daily_sales WHERE project_id = ? AND item_code = 'SKU-AR-01'", (pid,))
        finally:
            con_check.close()

        print(f"27. Real UTF-8-BOM (utf-8-sig) Arabic CSV Preview & Streaming Ingestion Persistence PASSED")

        # ----------------------------------------------------------------------
        # Test 28: Global Branch/Location Analysis Selector & Location Filtering
        # ----------------------------------------------------------------------
        branch_pid = "proj_test_branch_scope"
        r_create = await client.post("/api/projects", json={"id": branch_pid, "name": "Branch Scope Test Project"})
        assert r_create.status_code == 200, f"Failed to create project: {r_create.text}"

        # Insert items across two distinct branches: 'السلام' and 'مدينة نصر'
        con_branch = get_connection()
        try:
            con_branch.execute(f"""
                INSERT INTO items (
                    id, project_id, code, description, category, location, supplier,
                    on_hand, on_order, lead_time_days, safety_stock, reorder_point,
                    order_now, order_now_value, days_of_supply, sales_price, purchase_price,
                    abc_class, xyz_class, service_level, model_type, updated_at
                ) VALUES 
                ('it_br_1', '{branch_pid}', 'SKU-BR-1', 'Branch SKU 1', 'Beverages', 'السلام', 'Sup1',
                 50.0, 0.0, 14.0, 20.0, 30.0, 10.0, 250.0, 25.0, 35.0, 25.0, 'A', 'X', 0.95, 'auto', CURRENT_TIMESTAMP),
                ('it_br_2', '{branch_pid}', 'SKU-BR-2', 'Branch SKU 2', 'Snacks', 'السلام', 'Sup1',
                 80.0, 0.0, 14.0, 15.0, 25.0, 0.0, 0.0, 45.0, 20.0, 15.0, 'B', 'Y', 0.95, 'auto', CURRENT_TIMESTAMP),
                ('it_br_3', '{branch_pid}', 'SKU-BR-3', 'Branch SKU 3', 'Beverages', 'مدينة نصر', 'Sup2',
                 30.0, 0.0, 10.0, 10.0, 20.0, 20.0, 600.0, 15.0, 40.0, 30.0, 'A', 'X', 0.95, 'auto', CURRENT_TIMESTAMP);
            """)
            con_branch.execute(f"""
                INSERT INTO periods (id, project_id, item_id, date, actual, forecast) VALUES
                ('per_br_1', '{branch_pid}', 'it_br_1', '2026-03', 100.0, 110.0),
                ('per_br_2', '{branch_pid}', 'it_br_2', '2026-03', 60.0, 65.0),
                ('per_br_3', '{branch_pid}', 'it_br_3', '2026-03', 80.0, 85.0);
            """)
            con_branch.execute("CHECKPOINT")
        finally:
            con_branch.close()

        # Step A: Test GET /api/projects/{pid}/locations
        r_locs = await client.get(f"/api/projects/{branch_pid}/locations")
        assert r_locs.status_code == 200, f"Locations endpoint failed: {r_locs.text}"
        locs_data = r_locs.json()
        assert locs_data["total_locations"] == 2, f"Expected 2 locations, got {locs_data['total_locations']}"
        loc_names = [l["location"] for l in locs_data["locations"]]
        assert "السلام" in loc_names and "مدينة نصر" in loc_names
        salam_loc = next(l for l in locs_data["locations"] if l["location"] == "السلام")
        assert salam_loc["sku_count"] == 2

        # Step B: Test location filtering on /api/inventory
        r_inv_all = await client.get(f"/api/inventory?project_id={branch_pid}&location=ALL")
        assert r_inv_all.status_code == 200
        assert r_inv_all.json()["total_count"] == 3

        r_inv_salam = await client.get(f"/api/inventory?project_id={branch_pid}&location=السلام")
        assert r_inv_salam.status_code == 200
        inv_salam = r_inv_salam.json()
        assert inv_salam["total_count"] == 2
        assert all(it["location"] == "السلام" for it in inv_salam["items"])

        # Step C: Test location filtering on /api/demand
        r_dem_salam = await client.get(f"/api/demand?project_id={branch_pid}&location=السلام")
        assert r_dem_salam.status_code == 200
        dem_salam = r_dem_salam.json()
        assert dem_salam["total_count"] == 2
        assert all(it["location"] == "السلام" for it in dem_salam["series"])

        # Step D: Test location filtering on /api/dashboard and /api/projects/{pid}/kpis
        r_dash_salam = await client.get(f"/api/dashboard?project_id={branch_pid}&location=السلام")
        assert r_dash_salam.status_code == 200
        assert r_dash_salam.json()["active_skus"] == 2
        assert r_dash_salam.json()["location"] == "السلام"

        r_kpis_salam = await client.get(f"/api/projects/{branch_pid}/kpis?location=السلام")
        assert r_kpis_salam.status_code == 200
        assert r_kpis_salam.json()["totalSkus"] == 2

        # Step E: Test Excel export with branch name in filename and zero currency symbols in headers
        r_exp_orders = await client.get(f"/api/files/export?project_id={branch_pid}&export_type=orders&location=السلام")
        assert r_exp_orders.status_code == 200
        cd_hdr = r_exp_orders.headers.get("content-disposition", "")
        assert "PO_" in cd_hdr
        assert urllib.parse.quote("السلام") in cd_hdr or "السلام" in cd_hdr

        # Verify Excel content has zero currency symbols
        import openpyxl
        wb_exp = openpyxl.load_workbook(io.BytesIO(r_exp_orders.content))
        ws_orders = wb_exp["Planned Orders"]
        headers = [cell.value for cell in ws_orders[1]]
        for h in headers:
            if h:
                assert "($)" not in str(h), f"Header '{h}' contains currency symbol '($)'"
        assert "Unit Cost" in headers
        assert "Total Value" in headers

        # Verify inventory export headers as well
        r_exp_inv = await client.get(f"/api/files/export?project_id={branch_pid}&export_type=replenishment&location=السلام")
        assert r_exp_inv.status_code == 200
        wb_inv = openpyxl.load_workbook(io.BytesIO(r_exp_inv.content))
        ws_inv = wb_inv["Inventory Replenishment"]
        inv_headers = [cell.value for cell in ws_inv[1]]
        for h in inv_headers:
            if h:
                assert "($)" not in str(h), f"Header '{h}' contains currency symbol '($)'"
        assert "Sales Price" in inv_headers
        assert "Purchase Price" in inv_headers
        assert "Order Value" in inv_headers

        print("28. Global Branch / Location Analysis Selector & Location Filtering PASSED")

        print('\n=== ALL 28 BACKEND & DATA HUB ENDPOINTS TESTED AND VERIFIED 100% OPERATIONAL! ===')

if __name__ == '__main__':
    try:
        asyncio.run(run_tests())
    finally:
        try:
            close_db()
        except Exception:
            pass
        try:
            shutil.rmtree(TEST_TMP_DIR, ignore_errors=True)
        except Exception:
            pass
