"""
NEXO Enterprise Supply Chain Planning Platform
Universal Full-Stack Application Launcher (Windows / Linux / macOS)

Orchestrates:
1. Python backend verification (FastAPI + DuckDB)
2. Frontend verification (Node.js + Vite)
3. Stale port cleanup (8000 & 5173)
4. Starts FastAPI backend on http://127.0.0.1:8000
5. Health checks the backend API
6. Starts Vite frontend dev server on http://localhost:5173
7. Opens the default browser directly to NEXO
8. Handles graceful shutdown of both servers on Ctrl+C
"""

import os
import sys
import subprocess

# 1. Safe pythonw.exe stdout/stderr stream redirection
if sys.platform == "win32":
    _ws_dir = os.path.dirname(os.path.abspath(__file__))
    _log_file = os.path.join(_ws_dir, "desktop_app.log")
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

import time
import socket
import webbrowser
import urllib.request
import signal

WORKSPACE_DIR = os.path.dirname(os.path.abspath(__file__))
BACKEND_DIR = os.path.join(WORKSPACE_DIR, "backend")
BACKEND_PORT = 8000
FRONTEND_PORT = 5173

def log(msg: str):
    print(msg, flush=True)

def print_banner():
    banner = r"""
===============================================================================
                NEXO - ENTERPRISE SUPPLY CHAIN PLANNING PLATFORM
             Full-Stack Desktop Environment (FastAPI + DuckDB + Vite)
===============================================================================
"""
    log(banner)

def is_port_in_use(port: int) -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.settimeout(0.4)
        return s.connect_ex(("127.0.0.1", port)) == 0

def kill_port_owner(port: int):
    """Cleanly terminate any existing process holding the target port on Windows."""
    if os.name != "nt":
        return
    try:
        output = subprocess.check_output(f"netstat -aon | findstr :{port}", shell=True).decode()
        for line in output.splitlines():
            if "LISTENING" in line:
                parts = line.strip().split()
                pid = parts[-1]
                if pid.isdigit() and int(pid) != os.getpid():
                    subprocess.run(f"taskkill /F /PID {pid}", shell=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    except Exception:
        pass

def check_python_environment():
    log("[1/4] Checking Python environment and dependencies...")
    try:
        import fastapi
        import uvicorn
        import duckdb
        import pyodbc
        import pandas
        import openpyxl
        log(f"      [OK] Python {sys.version.split()[0]} ready.")
        log("      [OK] Dependencies verified: DuckDB, pyodbc, FastAPI, Pandas.")
    except ImportError as e:
        log(f"      [!] Missing package ({e.name}), installing backend requirements...")
        req_file = os.path.join(BACKEND_DIR, "requirements.txt")
        subprocess.check_call([sys.executable, "-m", "pip", "install", "-r", req_file])
        log("      [OK] Python dependencies installed successfully.")

def check_frontend_environment():
    log("[2/4] Checking Node.js frontend environment...")
    npm_cmd = "npm.cmd" if os.name == "nt" else "npm"
    node_modules = os.path.join(WORKSPACE_DIR, "node_modules")
    if not os.path.exists(node_modules):
        log("      [!] node_modules missing, running npm install...")
        subprocess.check_call([npm_cmd, "install"], cwd=WORKSPACE_DIR)
        log("      [OK] Frontend packages installed.")
    else:
        log("      [OK] Node modules verified.")

def wait_for_http(url: str, timeout_sec: int = 15) -> bool:
    start_time = time.time()
    while time.time() - start_time < timeout_sec:
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "NEXO-Launcher"})
            with urllib.request.urlopen(req, timeout=1.2) as resp:
                if resp.status == 200:
                    return True
        except Exception:
            time.sleep(0.3)
    return False

def main():
    print_banner()

    # Step 1 & 2: Environment checks
    check_python_environment()
    check_frontend_environment()

    # Step 3: Clean up ports if busy
    log("[3/4] Initializing ports and services...")
    if is_port_in_use(BACKEND_PORT):
        log(f"      Releasing busy port {BACKEND_PORT}...")
        kill_port_owner(BACKEND_PORT)
        time.sleep(0.5)

    if is_port_in_use(FRONTEND_PORT):
        log(f"      Releasing busy port {FRONTEND_PORT}...")
        kill_port_owner(FRONTEND_PORT)
        time.sleep(0.5)

    # Step 4: Launch FastAPI backend
    log("      Launching FastAPI backend on http://127.0.0.1:8000...")
    backend_cmd = [
        sys.executable,
        "-m", "uvicorn",
        "server:app",
        "--app-dir", "backend",
        "--host", "127.0.0.1",
        "--port", str(BACKEND_PORT),
        "--log-level", "warning"
    ]
    backend_proc = subprocess.Popen(
        backend_cmd,
        cwd=WORKSPACE_DIR
    )

    # Wait for backend health check
    log("      Waiting for DuckDB workspace to initialize...")
    if not wait_for_http(f"http://127.0.0.1:{BACKEND_PORT}/api/health", timeout_sec=12):
        log("      [ERROR] Backend failed to start.")
        backend_proc.kill()
        sys.exit(1)
    log("      [OK] Backend online: DuckDB persistence ready.")

    # Step 5: Launch Vite frontend
    log("[4/4] Starting Vite frontend on http://localhost:5173...")
    npm_cmd = "npm.cmd" if os.name == "nt" else "npm"
    frontend_cmd = [npm_cmd, "run", "dev", "--", "--host", "127.0.0.1", "--port", str(FRONTEND_PORT)]
    frontend_proc = subprocess.Popen(
        frontend_cmd,
        cwd=WORKSPACE_DIR
    )

    # Wait for frontend ready
    log("      Waiting for Vite development server...")
    wait_for_http(f"http://127.0.0.1:{FRONTEND_PORT}", timeout_sec=15)

    banner_ready = """
===============================================================================
   NEXO ENTERPRISE PLANNING IS LIVE AND READY!
   - Web UI:   http://localhost:5173
   - Backend:  http://127.0.0.1:8000
   - Database: backend/nexo_workspace.duckdb
   Opening browser...
===============================================================================

   [!] Keep this window open while using NEXO.
   [!] Press Ctrl+C at any time to shut down all services safely.
"""
    log(banner_ready)

    # Automatically open browser
    try:
        webbrowser.open(f"http://localhost:{FRONTEND_PORT}")
    except Exception:
        pass

    # Monitor processes until user terminates
    try:
        while True:
            time.sleep(1)
            if backend_proc.poll() is not None:
                log("\n[!] Backend process stopped unexpectedly.")
                break
            if frontend_proc.poll() is not None:
                log("\n[!] Frontend process stopped unexpectedly.")
                break
    except KeyboardInterrupt:
        log("\n\nShutting down NEXO services...")
    finally:
        try:
            backend_proc.terminate()
            backend_proc.wait(timeout=2)
        except Exception:
            backend_proc.kill()

        try:
            frontend_proc.terminate()
            frontend_proc.wait(timeout=2)
        except Exception:
            frontend_proc.kill()

        log("[OK] NEXO services closed cleanly. Goodbye!")

if __name__ == "__main__":
    main()
