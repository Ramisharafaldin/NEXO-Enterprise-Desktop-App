/**
 * Hardened, unified Excel (.xlsx) export utility.
 * Replaces vulnerable frontend xlsx package (SEC-HIGH-03).
 * Calls backend POST /api/export/excel with openpyxl, formula injection
 * sanitization (SEC-MED-01) and automatic Arabic RTL sheet support.
 * Supports native pywebview save dialog in desktop mode and standard browser Blob download.
 */

export interface ExcelSheet {
  name: string;
  rows: Record<string, any>[];
}

export async function exportSheetsToExcel(sheets: ExcelSheet[], filename: string): Promise<boolean> {
  const safeFilename = filename.endsWith('.xlsx') ? filename : `${filename}.xlsx`;
  const res = await fetch('/api/export/excel', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ filename: safeFilename, sheets }),
  });

  if (!res.ok) {
    throw new Error(`Failed to generate Excel file: ${res.statusText}`);
  }

  const blob = await res.blob();

  // 1. Native pywebview desktop save dialog
  const pyApi = (window as any).pywebview?.api;
  if (pyApi && typeof pyApi.save_file_dialog === 'function') {
    try {
      return await new Promise<boolean>((resolve) => {
        const reader = new FileReader();
        reader.onloadend = async () => {
          try {
            const base64data = (reader.result as string).split(',')[1];
            const savedPath = await pyApi.save_file_dialog(safeFilename, base64data);
            resolve(!!savedPath);
          } catch {
            resolve(false);
          }
        };
        reader.readAsDataURL(blob);
      });
    } catch {
      // Fallback to browser blob
    }
  }

  // 2. Standard browser Blob download
  const url = window.URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.setAttribute('download', safeFilename);
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.URL.revokeObjectURL(url);
  return true;
}
