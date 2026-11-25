"""
NEXO — Enterprise Demand & Supply Chain Planning
Native Windows Desktop Application Runtime (WebView2 + FastAPI + DuckDB)

Features:
- Standalone Native Windows OS Frame (1380x840, resizable, maximizable, centered)
- Zero browser chrome, zero URL bars, zero developer console popups
- Unified single-process architecture: FastAPI serves both REST API and compiled React dist/
- Native Windows File Save Dialog via pywebview bridge for Excel exports
- Multi-resolution Windows application icon (public/nexo.ico)
- Single-instance activation: brings existing window to front if already running
- Persistent WebView2 profile in %LOCALAPPDATA%\\NEXO\\webview2_profile
- Clean, automatic shutdown of DuckDB on window close
- Full Windows error dialog reporting on unhandled exceptions
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

# 1b. Native C-level crash dump handler (faulthandler)
import faulthandler
_logs_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "backend", "logs")
try:
    os.makedirs(_logs_dir, exist_ok=True)
    _crash_log_file = open(os.path.join(_logs_dir, "crash_dump.log"), "a", encoding="utf-8")
    faulthandler.enable(file=_crash_log_file)
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

# 3. Edge WebView2 low-RAM optimization flags (prevents Error code 39 renderer heap exhaustion)
os.environ.setdefault(
    "WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS",
    "--disable-gpu-shader-disk-cache --renderer-process-limit=2 --js-flags=--max-old-space-size=1024"
)

import time
import socket
import secrets
import logging
import threading
import base64
import urllib.request
import ctypes
from typing import Optional

SUBPROCESS_FLAGS = subprocess.CREATE_NO_WINDOW if sys.platform == "win32" else 0

# Setup directories
WORKSPACE_DIR = os.path.dirname(os.path.abspath(__file__))
BACKEND_DIR = os.path.join(WORKSPACE_DIR, "backend")
LOG_FILE = os.path.join(WORKSPACE_DIR, "desktop_app.log")

if WORKSPACE_DIR not in sys.path:
    sys.path.insert(0, WORKSPACE_DIR)
if BACKEND_DIR not in sys.path:
    sys.path.insert(0, BACKEND_DIR)

# Configure logging
logging.basicConfig(
    filename=LOG_FILE,
    filemode="w",
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s"
)
logger = logging.getLogger("nexo_desktop")

def show_error_dialog(title: str, message: str):
    """Displays a native Windows MessageBox on fatal errors."""
    try:
        ctypes.windll.user32.MessageBoxW(0, str(message), str(title), 0x10 | 0x10000)
    except Exception:
        pass

def focus_existing_window() -> bool:
    """Checks if a NEXO window is already running and brings it to the foreground."""
    try:
        user32 = ctypes.windll.user32
        target_hwnd = None
        
        def enum_cb(hwnd, lParam):
            nonlocal target_hwnd
            if user32.IsWindowVisible(hwnd):
                length = user32.GetWindowTextLengthW(hwnd)
                if length > 0:
                    buff = ctypes.create_unicode_buffer(length + 1)
                    user32.GetWindowTextW(hwnd, buff, length + 1)
                    val = buff.value
                    if "NEXO — Enterprise" in val or "NEXO" in val:
                        target_hwnd = hwnd
                        return False
            return True

        EnumWindowsProc = ctypes.WINFUNCTYPE(ctypes.c_bool, ctypes.POINTER(ctypes.c_int), ctypes.POINTER(ctypes.c_int))
        user32.EnumWindows(EnumWindowsProc(enum_cb), 0)
        
        if target_hwnd:
            logger.info(f"Existing NEXO window found (HWND {target_hwnd}), bringing to front.")
            user32.ShowWindow(target_hwnd, 9)  # SW_RESTORE
            user32.SetForegroundWindow(target_hwnd)
            return True
    except Exception as e:
        logger.warning(f"focus_existing_window error: {e}")
    return False

def is_port_open(port: int) -> bool:
    """Fast check whether a port is accepting TCP connections."""
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.settimeout(0.05)
        return s.connect_ex(("127.0.0.1", port)) == 0

def is_backend_healthy(port: int, timeout: float = 0.5) -> bool:
    """Returns True if the backend at http://127.0.0.1:{port}/api/health responds 200."""
    if not is_port_open(port):
        return False
    url = f"http://127.0.0.1:{port}/api/health"
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "NEXO-Desktop-Runtime"})
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return resp.status == 200
    except Exception:
        return False

def find_available_port(preferred_port: int = 8000) -> int:
    """Checks if preferred_port is free on 127.0.0.1; otherwise picks an available port."""
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.settimeout(0.2)
        if s.connect_ex(("127.0.0.1", preferred_port)) != 0:
            return preferred_port
    
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]

def run_fastapi_server(port: int):
    """Runs Uvicorn in the background daemon thread with signals disabled."""
    try:
        import uvicorn
        from backend.server import app
        
        config = uvicorn.Config(
            app=app,
            host="127.0.0.1",
            port=port,
            log_level="warning",
            access_log=False,
        )
        server = uvicorn.Server(config)
        # Disable signals since this is a worker thread
        server.install_signal_handlers = lambda: None
        logger.info(f"Starting Uvicorn server on 127.0.0.1:{port}")
        server.run()
    except Exception as e:
        logger.exception(f"Uvicorn server crashed: {e}")

def wait_for_backend(port: int, timeout: float = 15.0) -> bool:
    """Waits until FastAPI /api/health responds HTTP 200."""
    start_time = time.time()
    while time.time() - start_time < timeout:
        if is_backend_healthy(port):
            return True
        time.sleep(0.25)
    return False

import webview
from generate_icon import create_nexo_icon
from backend.database import close_db, flush_db

class DesktopApi:
    """JavaScript API bridge exposed as window.pywebview.api."""
    def __init__(self):
        self._window = None

    def set_window(self, window):
        self._window = window

    def restart_app(self):
        """Cleanly restarts the NEXO desktop application."""
        logger.info("restart_app called from JS API bridge.")
        threading.Thread(target=restart_desktop_process, daemon=True).start()
        return True

    def save_file_dialog(self, filename: str, base64_content: str):
        """
        Opens a native Windows Save As dialog and saves binary payload directly to disk.
        Returns a structured dict:
          {"status": "saved", "path": filepath, "filename": basename}
          {"status": "cancelled"}
          {"status": "error", "error": message}
        """
        if not self._window:
            return {"status": "error", "error": "Desktop window is not initialized"}

        safe_name = os.path.basename((filename or "NEXO_Export.xlsx").strip()) or "NEXO_Export.xlsx"
        ext = os.path.splitext(safe_name)[1].lower() or ".xlsx"
        if ext == ".json":
            file_types = ('JSON Files (*.json)', 'All files (*.*)')
        elif ext == ".csv":
            file_types = ('CSV Files (*.csv)', 'All files (*.*)')
        else:
            ext = ".xlsx"
            if not safe_name.lower().endswith(".xlsx"):
                safe_name += ".xlsx"
            file_types = ('Excel Workbook (*.xlsx)', 'All files (*.*)')

        dialog_type = getattr(webview, "FileDialog", None)
        save_mode = dialog_type.SAVE if dialog_type else 30

        try:
            result = self._window.create_file_dialog(
                dialog_type=save_mode,
                save_filename=safe_name,
                file_types=file_types
            )

            if result:
                filepath = result[0] if isinstance(result, (list, tuple)) else str(result)
                if not filepath.lower().endswith(ext):
                    filepath += ext
                data = base64.b64decode(base64_content)
                with open(filepath, "wb") as f:
                    f.write(data)
                logger.info(f"File successfully exported via native dialog: {filepath}")
                return {
                    "status": "saved",
                    "path": filepath,
                    "filename": os.path.basename(filepath),
                }
            return {"status": "cancelled"}
        except Exception as e:
            logger.exception(f"Error in save_file_dialog: {e}")
            return {"status": "error", "error": str(e)}

def restart_desktop_process():
    """
    Safely checkpoints DuckDB, spawns a new detached NEXO process, and exits the current instance.
    Eliminates shell=True and string-formatted commands (SEC-HIGH-02).
    """
    time.sleep(0.5)
    try:
        from backend.database import close_db, flush_db
        close_db()
    except Exception as e:
        logger.warning(f"Error closing db during restart: {e}")

    vbs_path = os.path.join(WORKSPACE_DIR, "NEXO.vbs")
    app_py = os.path.join(WORKSPACE_DIR, "desktop_app.py")
    DETACHED_PROCESS = 0x00000008
    CREATE_NO_WINDOW = 0x08000000
    creationflags = (DETACHED_PROCESS | CREATE_NO_WINDOW) if sys.platform == "win32" else 0

    if sys.platform == "win32" and os.path.exists(vbs_path):
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
            cwd=WORKSPACE_DIR,
            creationflags=creationflags,
            close_fds=True
        )
        logger.info("Spawned detached process to restart NEXO. Terminating current instance.")
    except Exception as e:
        logger.error(f"Failed to spawn restart process: {e}")
    finally:
        os._exit(0)

def on_closing():
    """Clean window close callback: execute flush_db() and close_db() cleanly before exiting."""
    logger.info("Window closing event received. Checkpointing and shutting down DuckDB.")
    try:
        flush_db()
        close_db()
    except Exception as e:
        logger.warning(f"Error during on_closing db flush: {e}")

def on_closed():
    """Safe shutdown callback: flush DuckDB and terminate process."""
    logger.info("Window closed event received. Shutting down DuckDB.")
    try:
        close_db()
    except Exception:
        pass
    os._exit(0)

def main():
    logger.info("=== NEXO Desktop Application Starting ===")

    # Generate startup secrets for local boundary defense (SEC-CRIT-01, SEC-MED-02)
    session_secret = os.environ.get("NEXO_SESSION_SECRET") or secrets.token_urlsafe(32)
    os.environ["NEXO_SESSION_SECRET"] = session_secret
    bootstrap_nonce = secrets.token_urlsafe(32)
    os.environ["NEXO_BOOTSTRAP_NONCE"] = bootstrap_nonce

    # 1. Ensure nexo.ico exists
    ico_path = os.path.join(WORKSPACE_DIR, "public", "nexo.ico")
    if not os.path.exists(ico_path):
        create_nexo_icon(os.path.join(WORKSPACE_DIR, "public"))

    # 2. Check if a NEXO instance is already running with an active window
    already_online = is_backend_healthy(8000, timeout=0.3)
    if already_online:
        logger.info("NEXO backend is already running on port 8000.")
        if focus_existing_window():
            logger.info("Successfully activated existing window. Exiting launcher.")
            sys.exit(0)
        port = 8000
    else:
        port = find_available_port(8000)
        logger.info(f"Selected port: {port}")
        server_thread = threading.Thread(target=run_fastapi_server, args=(port,), daemon=True)
        server_thread.start()

        # Wait for FastAPI backend to initialize
        if not wait_for_backend(port):
            err_msg = f"NEXO backend failed to initialize on port {port} within timeout."
            logger.error(err_msg)
            show_error_dialog("NEXO Startup Error", err_msg)
            sys.exit(1)

    logger.info(f"NEXO backend is online and healthy on port {port}.")

    # 3. Instantiate JS-API bridge
    api = DesktopApi()

    # 4. Create native Windows OS frame pointing to bootstrap authentication route
    url = f"http://127.0.0.1:{port}/auth/bootstrap?nonce={bootstrap_nonce}&t={int(time.time())}"
    logger.info(f"Creating pywebview window pointing to bootstrap URL: {url}")
    
    window = webview.create_window(
        title="NEXO — Enterprise Demand & Supply Chain Planning",
        url=url,
        width=1380,
        height=840,
        min_size=(1024, 680),
        resizable=True,
        fullscreen=False,
        confirm_close=False,
        js_api=api,
        text_select=True,
        background_color="#343D46",
    )
    api.set_window(window)
    window.events.closing += on_closing
    window.events.closed += on_closed

    # 5. Define persistent storage path for WebView2 to prevent temporary folder race conditions
    profile_dir = os.path.join(os.environ.get("LOCALAPPDATA", WORKSPACE_DIR), "NEXO", "webview2_profile")
    os.makedirs(profile_dir, exist_ok=True)
    logger.info(f"Using WebView2 profile directory: {profile_dir}")

    # 6. Start pywebview with Microsoft Edge Chromium WebView2 engine
    logger.info("Calling webview.start()...")
    webview.start(
        icon=ico_path if os.path.exists(ico_path) else None,
        debug=False,
        private_mode=False,
        storage_path=profile_dir
    )
    logger.info("webview.start() completed.")

if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        logger.exception(f"Unhandled fatal error in main: {exc}")
        show_error_dialog(
            "NEXO Fatal Error",
            f"An unexpected error occurred while running NEXO:\n\n{exc}\n\nSee desktop_app.log for details."
        )
        sys.exit(1)
