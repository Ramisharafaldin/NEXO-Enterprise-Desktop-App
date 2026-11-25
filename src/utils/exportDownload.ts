/**
 * NEXO Unified Desktop & Browser File Export Pipeline
 * Supports native PyWebView Windows Save As dialog, authenticated WebView2
 * Downloads fallback (/api/files/save-desktop), and standard browser Blob downloads.
 */

export interface SaveExportResult {
  saved: boolean;
  cancelled?: boolean;
  method?: 'pywebview' | 'desktop_downloads' | 'browser';
  path?: string;
  filename: string;
}

const getApiBase = (): string => {
  if (typeof window !== 'undefined' && window.location.origin.startsWith('http')) {
    const port = window.location.port;
    if (port && port !== '5173') {
      return `${window.location.origin}/api`;
    }
  }
  return 'http://127.0.0.1:8000/api';
};

function sanitizeExportFilename(rawName: string, defaultExt: string = '.xlsx'): string {
  const cleaned = (rawName || `NEXO_Export${defaultExt}`)
    .trim()
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '_');
  if (/\.(xlsx|json|csv)$/i.test(cleaned)) {
    return cleaned;
  }
  return `${cleaned}${defaultExt}`;
}

export function extractFilenameFromHeader(headerValue: string | null, fallback: string): string {
  if (!headerValue) return fallback;
  const utfMatch = headerValue.match(/filename\*=UTF-8''([^;]+)/i);
  if (utfMatch && utfMatch[1]) {
    try {
      return sanitizeExportFilename(decodeURIComponent(utfMatch[1].trim()));
    } catch {
      // fall through
    }
  }
  const plainMatch = headerValue.match(/filename="?([^";]+)"?/i);
  if (plainMatch && plainMatch[1]) {
    return sanitizeExportFilename(plainMatch[1].trim());
  }
  return fallback;
}

export function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const result = typeof reader.result === 'string' ? reader.result : '';
      const commaIdx = result.indexOf(',');
      if (commaIdx === -1) {
        reject(new Error('Failed to encode exported file payload.'));
        return;
      }
      resolve(result.slice(commaIdx + 1));
    };
    reader.onerror = () => reject(reader.error || new Error('FileReader failed during export.'));
    reader.readAsDataURL(blob);
  });
}

export async function saveBlobWithDesktopFallback(
  blob: Blob,
  rawFilename: string,
  defaultExt: '.xlsx' | '.json' | '.csv' = '.xlsx'
): Promise<SaveExportResult> {
  const filename = sanitizeExportFilename(rawFilename, defaultExt);
  if (!blob || blob.size === 0) {
    throw new Error('Generated export file was empty.');
  }

  const pyApi = (window as any).pywebview?.api;
  let base64Cache: string | null = null;
  const getBase64 = async () => {
    if (base64Cache === null) {
      base64Cache = await blobToBase64(blob);
    }
    return base64Cache;
  };

  // 1. Native pywebview Save As dialog (when running inside NEXO desktop window)
  let pywebviewErrored = false;
  if (pyApi && typeof pyApi.save_file_dialog === 'function') {
    try {
      const b64 = await getBase64();
      const dialogRes = await pyApi.save_file_dialog(filename, b64);
      if (typeof dialogRes === 'string' && dialogRes.length > 0) {
        return {
          saved: true,
          method: 'pywebview',
          path: dialogRes,
          filename: dialogRes.split(/[\\/]/).pop() || filename,
        };
      }
      if (dialogRes && typeof dialogRes === 'object') {
        if (dialogRes.status === 'cancelled') {
          return { saved: false, cancelled: true, filename };
        }
        if (dialogRes.status === 'saved' && dialogRes.path) {
          return {
            saved: true,
            method: 'pywebview',
            path: dialogRes.path,
            filename: dialogRes.filename || filename,
          };
        }
        if (dialogRes.status === 'error') {
          console.warn('pywebview save_file_dialog reported error:', dialogRes.error);
          pywebviewErrored = true;
        }
      } else {
        // Legacy null/false return means user cancelled dialog
        return { saved: false, cancelled: true, filename };
      }
    } catch (err) {
      console.warn('save_file_dialog bridge error, falling back:', err);
      pywebviewErrored = true;
    }
  }

  // 2. Desktop WebView2 authenticated backend save to Downloads fallback
  const isDesktopWebView =
    Boolean((window as any).pywebview) ||
    Boolean((window as any).chrome?.webview) ||
    pywebviewErrored;

  if (isDesktopWebView) {
    const b64 = await getBase64();
    const saveRes = await fetch(`${getApiBase()}/files/save-desktop`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filename, content_base64: b64 }),
    });
    if (!saveRes.ok) {
      const errData = await saveRes.json().catch(() => ({ detail: saveRes.statusText }));
      throw new Error(errData.detail || `Desktop save failed (${saveRes.status})`);
    }
    const savedInfo = await saveRes.json();
    return {
      saved: true,
      method: 'desktop_downloads',
      path: savedInfo.path,
      filename: savedInfo.filename || filename,
    };
  }

  // 3. Standard browser Blob download (with deferred revokeObjectURL so Edge/Chrome finish streaming)
  const downloadUrl = window.URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = downloadUrl;
  link.setAttribute('download', filename);
  link.style.display = 'none';
  document.body.appendChild(link);
  link.click();
  setTimeout(() => {
    try {
      link.remove();
      window.URL.revokeObjectURL(downloadUrl);
    } catch {
      // ignore cleanup errors
    }
  }, 10000);

  return {
    saved: true,
    method: 'browser',
    filename,
  };
}

export async function fetchAndSaveExport(
  url: string,
  options: RequestInit & { fallbackFilename: string; defaultExt?: '.xlsx' | '.json' | '.csv' }
): Promise<SaveExportResult> {
  const { fallbackFilename, defaultExt = '.xlsx', ...fetchInit } = options;
  const res = await fetch(url, fetchInit);
  if (!res.ok) {
    let detail = res.statusText;
    try {
      const text = await res.text();
      if (text) {
        try {
          const parsed = JSON.parse(text);
          detail = parsed.detail || text;
        } catch {
          detail = text;
        }
      }
    } catch {
      // keep statusText
    }
    throw new Error(detail || `Export failed (HTTP ${res.status})`);
  }

  const resolvedName = extractFilenameFromHeader(
    res.headers.get('Content-Disposition'),
    fallbackFilename
  );
  const blob = await res.blob();
  return saveBlobWithDesktopFallback(blob, resolvedName, defaultExt);
}

export function formatExportSuccessToast(result: SaveExportResult, isAr: boolean): string | null {
  if (!result.saved || result.cancelled) return null;
  if (result.path) {
    return isAr
      ? `تم تصدير الملف بنجاح في: ${result.path}`
      : `Exported successfully to: ${result.path}`;
  }
  return isAr
    ? `تم تصدير الملف بنجاح: ${result.filename}`
    : `Exported successfully: ${result.filename}`;
}
