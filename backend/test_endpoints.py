import os
import sys

# Ensure root repo directory is on sys.path
repo_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if repo_dir not in sys.path:
    sys.path.insert(0, repo_dir)

import asyncio
import httpx
from backend.server import app
from backend.database import init_db

async def run_tests():
    init_db()
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url='http://test') as client:
        # 1. Health check
        r = await client.get('/api/health')
        assert r.status_code == 200, f'health failed: {r.text}'
        print('1. Health check PASSED:', r.json()['status'])

        # 2. List projects
        r = await client.get('/api/projects')
        assert r.status_code == 200, f'projects failed: {r.text}'
        projs = r.json()
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
        r = await client.post('/api/sql/import', json={'server': 'localhost', 'database': 'ERP_DB', 'simulate_demo': True})
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

        # 12. Local DB Inspection
        r_db = await client.post('/api/local-db/inspect', data={'file_path': 'backend/nexo_workspace.duckdb'})
        assert r_db.status_code == 200 and r_db.json()['success'] is True
        print(f'12. Local DB Inspect PASSED ({len(r_db.json()["tables"])} tables detected)')

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
        con.execute("""
            INSERT INTO items (id, project_id, code, description, category, location, on_hand, purchase_price, sales_price)
            VALUES (?, ?, 'SKU-STOCKOUT-TEST', 'Stockout SKU with Demand', 'General', 'Main WH', 0.0, 50.0, 100.0)
        """, (stockout_id, pid))
        con.execute("""
            INSERT INTO periods (id, project_id, item_id, date, actual, forecast)
            VALUES ('per_stockout_test', ?, ?, '2025-10', 25.0, 25.0)
        """, (pid, stockout_id))

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
        r_inv = await client.get(f'/api/inventory?project_id={pid}')
        assert r_inv.status_code == 200
        inv_codes = [it['code'] for it in r_inv.json()['items']]
        assert 'SKU-DORMANT-TEST' not in inv_codes, "Dormant SKU must be excluded from /api/inventory"
        assert 'SKU-STOCKOUT-TEST' in inv_codes

        # Test D: GET /api/demand
        r_dem = await client.get(f'/api/demand?project_id={pid}')
        assert r_dem.status_code == 200
        dem_codes = [it['code'] for it in r_dem.json()['series']]
        assert 'SKU-DORMANT-TEST' not in dem_codes, "Dormant SKU must be excluded from /api/demand"

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

        print('\n=== ALL 18 BACKEND & DATA HUB ENDPOINTS TESTED AND VERIFIED 100% OPERATIONAL! ===')

if __name__ == '__main__':
    asyncio.run(run_tests())
