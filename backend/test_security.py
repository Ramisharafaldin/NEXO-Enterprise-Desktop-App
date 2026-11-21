"""
NEXO Automated Cybersecurity Verification Suite
Strictly verifies all Wave 1, Wave 2, and Wave 3 security boundaries against an isolated temporary DuckDB file.
"""

import os
import sys
import tempfile
import shutil
import asyncio
from pathlib import Path

# Ensure root repo directory is on sys.path
repo_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if repo_dir not in sys.path:
    sys.path.insert(0, repo_dir)

# Isolated temporary database directory
TEST_TMP_DIR = tempfile.mkdtemp(prefix="nexo_sec_suite_")
TEST_DB_PATH = os.path.join(TEST_TMP_DIR, "isolated_security_suite.duckdb")
os.environ["NEXO_DB_PATH"] = TEST_DB_PATH

# Startup test credentials
TEST_SESSION_SECRET = "nexo_test_security_suite_secret_key_2026_xyz"
TEST_BOOTSTRAP_NONCE = "nexo_test_security_suite_nonce_2026_abc"
os.environ["NEXO_SESSION_SECRET"] = TEST_SESSION_SECRET
os.environ["NEXO_BOOTSTRAP_NONCE"] = TEST_BOOTSTRAP_NONCE

import httpx
from backend.server import app, sanitize_excel_cell, stream_upload_to_file, MAX_CSV_UPLOAD_SIZE, MAX_OTHER_UPLOAD_SIZE, MIN_DISK_HEADROOM
from backend.database import init_db, close_db, get_connection, save_erp_connection
from backend.security_utils import encrypt_secret, decrypt_secret, mask_secret

async def run_security_suite():
    init_db()
    transport = httpx.ASGITransport(app=app)

    print("===============================================================================")
    print("           NEXO COMPREHENSIVE CYBERSECURITY VERIFICATION SUITE                 ")
    print("===============================================================================")

    async with httpx.AsyncClient(transport=transport, base_url='http://test') as client:
        # 1. Unauthenticated /api/projects -> 401
        r_unauth = await client.get('/api/projects')
        assert r_unauth.status_code == 401, f"Assertion 1 Failed: Expected 401 for unauthenticated request, got {r_unauth.status_code}"
        print("[PASS] 1. Unauthenticated API access rejected with 401 Unauthorized")

        # 2. Single-use /auth/bootstrap sets HttpOnly + SameSite=Strict cookie; nonce reuse -> 403
        r_boot = await client.get(f'/auth/bootstrap?nonce={TEST_BOOTSTRAP_NONCE}', follow_redirects=False)
        assert r_boot.status_code == 302, f"Assertion 2 Failed: Expected 302 from bootstrap, got {r_boot.status_code}"
        assert "nexo_session" in r_boot.cookies, "Assertion 2 Failed: Missing nexo_session cookie"
        cookie_header = r_boot.headers.get("set-cookie", "").lower()
        assert "httponly" in cookie_header, "Assertion 2 Failed: Missing HttpOnly in cookie"
        assert "samesite=strict" in cookie_header, "Assertion 2 Failed: Missing SameSite=Strict in cookie"
        assert "path=/" in cookie_header, "Assertion 2 Failed: Missing Path=/ in cookie"

        # Nonce reuse must be rejected with 403
        r_replay = await client.get(f'/auth/bootstrap?nonce={TEST_BOOTSTRAP_NONCE}', follow_redirects=False)
        assert r_replay.status_code == 403, f"Assertion 2 Failed: Replayed nonce was not rejected with 403, got {r_replay.status_code}"

        # Cookie authentication verification
        cookie_val = r_boot.cookies["nexo_session"]
        r_cookie_auth = await client.get('/api/projects', cookies={"nexo_session": cookie_val})
        assert r_cookie_auth.status_code == 200, f"Assertion 2 Failed: Cookie authentication failed, got {r_cookie_auth.status_code}"
        print("[PASS] 2. Single-use /auth/bootstrap sets HttpOnly/SameSite=Strict cookie; replay blocked with 403")

        # 3. Invalid Host header -> 400 (DNS Rebinding Defense via TrustedHostMiddleware)
        r_bad_host = await client.get('/api/health', headers={"Host": "evil.attacker.com"})
        assert r_bad_host.status_code == 400, f"Assertion 3 Failed: Expected 400 for untrusted host header, got {r_bad_host.status_code}"
        print("[PASS] 3. DNS Rebinding blocked: untrusted Host header rejected with 400 Bad Request")

        # 4. Path traversal (/%2e%2e/backend/server.py, /C:/Windows/win.ini, /.env) -> 403
        for traversal_path in ['/C:/Windows/win.ini', '/%2e%2e/backend/server.py', '/.env', '/..%2fbackend/server.py']:
            r_trav = await client.get(traversal_path)
            assert r_trav.status_code == 403, f"Assertion 4 Failed: Path traversal '{traversal_path}' not blocked with 403, got {r_trav.status_code}"
            assert "[extensions]" not in r_trav.text, "Assertion 4 Failed: Sensitive file contents leaked!"
        print("[PASS] 4. Static file path traversal blocked with 403 Forbidden (zero file leakage)")

        # 5. /api/local-db/inspect rejects arbitrary server-side file_path
        r_db_path = await client.post(
            '/api/local-db/inspect',
            headers={"X-NEXO-Session-Token": TEST_SESSION_SECRET},
            data={'file_path': TEST_DB_PATH}
        )
        assert r_db_path.status_code == 400, f"Assertion 5 Failed: Direct file_path not rejected with 400, got {r_db_path.status_code}"
        print("[PASS] 5. Arbitrary server-side database file_path inspection rejected with 400 Bad Request")

        # 6. /api/external-url/preview rejects file:/// and http://127.0.0.1 (SSRF Defense)
        r_ssrf_file = await client.post(
            '/api/external-url/preview',
            headers={"X-NEXO-Session-Token": TEST_SESSION_SECRET},
            data={'url': 'file:///C:/Windows/win.ini'}
        )
        assert r_ssrf_file.status_code == 400, f"Assertion 6 Failed: file:// scheme not rejected with 400, got {r_ssrf_file.status_code}"

        r_ssrf_loop = await client.post(
            '/api/external-url/preview',
            headers={"X-NEXO-Session-Token": TEST_SESSION_SECRET},
            data={'url': 'http://127.0.0.1:8000/'}
        )
        assert r_ssrf_loop.status_code == 400, f"Assertion 6 Failed: loopback IP not rejected with 400, got {r_ssrf_loop.status_code}"

        r_ssrf_local = await client.post(
            '/api/external-url/preview',
            headers={"X-NEXO-Session-Token": TEST_SESSION_SECRET},
            data={'url': 'http://localhost:8000/api/projects'}
        )
        assert r_ssrf_local.status_code == 400, f"Assertion 6 Failed: localhost not rejected with 400, got {r_ssrf_local.status_code}"
        print("[PASS] 6. SSRF defense: file:// and loopback 127.0.0.1 / localhost rejected with 400 Bad Request")

        # 7. SQL Server ERP injection rejected (items_table & custom_sql)
        r_sqli_table = await client.post(
            '/api/sql/import',
            headers={"X-NEXO-Session-Token": TEST_SESSION_SECRET},
            json={'server': 'localhost', 'database': 'ERP_DB', 'items_table': 'items; DROP TABLE x--', 'simulate_demo': True}
        )
        assert r_sqli_table.status_code == 400, f"Assertion 7 Failed: Malicious items_table not rejected with 400, got {r_sqli_table.status_code}"

        r_sqli_sql = await client.post(
            '/api/sql/import',
            headers={"X-NEXO-Session-Token": TEST_SESSION_SECRET},
            json={'server': 'localhost', 'database': 'ERP_DB', 'custom_sql': 'DROP TABLE Dim_Item', 'simulate_demo': True}
        )
        assert r_sqli_sql.status_code == 400, f"Assertion 7 Failed: Malicious custom_sql not rejected with 400, got {r_sqli_sql.status_code}"
        print("[PASS] 7. SQL Server ERP injection (items_table & custom_sql) rejected with 400 Bad Request")

        # 8. Formula injection helper neutralizes =CMD|'/C calc'!A0
        assert sanitize_excel_cell("=CMD|'/C calc'!A0") == "'=CMD|'/C calc'!A0"
        assert sanitize_excel_cell("@SUM(1,2)") == "'@SUM(1,2)"
        assert sanitize_excel_cell("+cmd") == "'+cmd"
        assert sanitize_excel_cell("-calc") == "'-calc"
        assert sanitize_excel_cell("Safe Product") == "Safe Product"
        assert sanitize_excel_cell(-50) == -50
        assert sanitize_excel_cell(99.99) == 99.99
        print("[PASS] 8. Excel formula injection sanitized (leading =, +, -, @ neutralized)")

        # 9. DPAPI encrypt_secret / decrypt_secret round-trips and sensitive fields masked in API
        raw_secret = "EnterpriseSecret_Password_2026!#"
        encrypted_secret = encrypt_secret(raw_secret)
        assert encrypted_secret.startswith("dpapi:"), f"Assertion 9 Failed: Ciphertext missing dpapi: prefix: {encrypted_secret}"
        assert raw_secret not in encrypted_secret, "Assertion 9 Failed: Plaintext leaked in ciphertext!"
        decrypted = decrypt_secret(encrypted_secret)
        assert decrypted == raw_secret, f"Assertion 9 Failed: Decrypted text '{decrypted}' does not match original '{raw_secret}'"

        # Verify DuckDB storage and masking in ingestion logs
        conn_profile = {
            "name": "Secured ERP Connection",
            "project_id": "proj_sec_test",
            "source_type": "sql_server",
            "server_host": "localhost",
            "database_name": "ERP_DW",
            "username": "sa",
            "password": raw_secret,
            "api_auth_header": "Bearer secret_api_token_12345"
        }
        saved = save_erp_connection(conn_profile)
        # Check raw database table content
        con = get_connection()
        row = con.execute("SELECT password_enc, api_auth_header FROM erp_connections WHERE id = ?", (saved["id"],)).fetchone()
        con.close()
        assert row[0].startswith("dpapi:"), "Assertion 9 Failed: Password not encrypted at rest with DPAPI!"
        assert raw_secret not in row[0], "Assertion 9 Failed: Plaintext password found in database!"

        # Query API endpoint: verify masked output
        r_logs = await client.get(
            '/api/projects/proj_sec_test/ingestion-logs',
            headers={"X-NEXO-Session-Token": TEST_SESSION_SECRET}
        )
        assert r_logs.status_code == 200, f"Assertion 9 Failed: Failed to get ingestion logs, got {r_logs.status_code}"
        conns = r_logs.json().get("connections", [])
        assert len(conns) > 0, "Assertion 9 Failed: Saved connection not returned in logs"
        target_conn = next(c for c in conns if c["id"] == saved["id"])
        assert target_conn["password_enc"] == "********", f"Assertion 9 Failed: Password not masked! Got: {target_conn['password_enc']}"
        assert target_conn["api_auth_header"] == "********", f"Assertion 9 Failed: API header not masked! Got: {target_conn['api_auth_header']}"
        print("[PASS] 9. DPAPI encryption at rest verified and sensitive credentials masked in API responses")

        # 10. Security headers present on responses
        r_health = await client.get('/api/health')
        assert r_health.status_code == 200
        headers = r_health.headers
        assert headers.get("x-content-type-options") == "nosniff", f"Assertion 10 Failed: Missing nosniff, got {headers.get('x-content-type-options')}"
        assert headers.get("x-frame-options") == "DENY", f"Assertion 10 Failed: Missing DENY, got {headers.get('x-frame-options')}"
        assert headers.get("referrer-policy") == "no-referrer", f"Assertion 10 Failed: Missing no-referrer, got {headers.get('referrer-policy')}"
        assert "content-security-policy" in headers, "Assertion 10 Failed: Missing Content-Security-Policy header"
        csp = headers["content-security-policy"]
        assert "default-src 'self'" in csp, f"Assertion 10 Failed: default-src missing in CSP: {csp}"
        assert "frame-ancestors 'none'" in csp, f"Assertion 10 Failed: frame-ancestors missing in CSP: {csp}"
        print("[PASS] 10. Security headers (X-Content-Type-Options, X-Frame-Options, CSP, Referrer-Policy) verified")

        # 11. Smart file-type upload limits & disk headroom DoS defense (SEC-MED-05)
        from io import BytesIO
        from starlette.datastructures import UploadFile as StarletteUploadFile
        from fastapi import HTTPException

        assert MAX_CSV_UPLOAD_SIZE == 2048 * 1024 * 1024
        assert MAX_OTHER_UPLOAD_SIZE == 300 * 1024 * 1024
        assert MIN_DISK_HEADROOM == 500 * 1024 * 1024

        # Test CSV limit enforcement with simulated threshold
        os.environ["NEXO_MAX_CSV_MB"] = "1"
        try:
            large_csv_stream = BytesIO(b"x" * (2 * 1024 * 1024))
            mock_csv = StarletteUploadFile(file=large_csv_stream, filename="stress.csv")
            try:
                stream_upload_to_file(mock_csv)
                assert False, "Assertion 11 Failed: CSV file exceeding limit did not raise 413"
            except HTTPException as e:
                assert e.status_code == 413
                assert "1 MB for CSV" in e.detail, f"Expected active limit in detail, got: {e.detail}"
        finally:
            os.environ.pop("NEXO_MAX_CSV_MB", None)

        # Test Excel limit enforcement with simulated threshold
        os.environ["NEXO_MAX_EXCEL_MB"] = "1"
        try:
            large_excel_stream = BytesIO(b"x" * (2 * 1024 * 1024))
            mock_excel = StarletteUploadFile(file=large_excel_stream, filename="stress.xlsx")
            try:
                stream_upload_to_file(mock_excel)
                assert False, "Assertion 11 Failed: Excel file exceeding limit did not raise 413"
            except HTTPException as e:
                assert e.status_code == 413
                assert "1 MB for Excel" in e.detail, f"Expected active limit in detail, got: {e.detail}"
        finally:
            os.environ.pop("NEXO_MAX_EXCEL_MB", None)

        # Test disk headroom defense (507 Insufficient Storage)
        os.environ["NEXO_MIN_DISK_HEADROOM_MB"] = "999999999"
        try:
            tiny_stream = BytesIO(b"code,desc\n1,test\n")
            mock_file = StarletteUploadFile(file=tiny_stream, filename="small.csv")
            try:
                stream_upload_to_file(mock_file)
                assert False, "Assertion 11 Failed: Lack of disk headroom did not raise 507"
            except HTTPException as e:
                assert e.status_code == 507
                assert "Insufficient disk space" in e.detail
        finally:
            os.environ.pop("NEXO_MIN_DISK_HEADROOM_MB", None)

        print("[PASS] 11. Smart upload caps (2GB CSV, 300MB Excel) and disk headroom DoS defense (413/507) verified")

    print("\n===============================================================================")
    print("        ALL 11 CYBERSECURITY ASSERTIONS VERIFIED AND 100% PASSING!             ")
    print("===============================================================================")

if __name__ == "__main__":
    try:
        asyncio.run(run_security_suite())
    finally:
        try:
            close_db()
        except Exception:
            pass
        try:
            shutil.rmtree(TEST_TMP_DIR, ignore_errors=True)
        except Exception:
            pass
