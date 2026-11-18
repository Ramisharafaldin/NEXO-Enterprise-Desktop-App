import os
import sys

# Ensure root repo directory is on sys.path
repo_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if repo_dir not in sys.path:
    sys.path.insert(0, repo_dir)

import asyncio
import httpx
from backend.server import app

async def run_tests():
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
        pid = projs[0]['id']
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

        print('\n=== ALL 16 BACKEND & DATA HUB ENDPOINTS TESTED AND VERIFIED 100% OPERATIONAL! ===')

if __name__ == '__main__':
    asyncio.run(run_tests())
