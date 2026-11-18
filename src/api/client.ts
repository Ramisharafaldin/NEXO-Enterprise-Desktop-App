/**
 * NEXO Local Desktop Application
 * API Client connecting React Frontend to FastAPI + DuckDB Backend
 */

import { InventoryItem, DashboardKpis, ModelType, ReplenishmentStrategy, AppSettings } from '../engine/types';
export type { AppSettings, DashboardKpis };

const getApiBase = (): string => {
  if (typeof window !== 'undefined' && window.location.origin.startsWith('http')) {
    const port = window.location.port;
    if (port && port !== '5173') {
      return `${window.location.origin}/api`;
    }
  }
  return 'http://127.0.0.1:8000/api';
};

const API_BASE = getApiBase();

export interface UpdateInfo {
  update_available: boolean;
  local_sha: string;
  remote_sha: string;
  commit_message: string;
  commit_date: string;
  files_changed: number;
  offline: boolean;
  version?: string;
  current_version?: string;
  error?: string;
}

export interface ApplyUpdateResult {
  status: string;
  restart_required: boolean;
  message: string;
  log?: string;
}

export interface ProjectSummary {
  id: string;
  name: string;
  description?: string;
  created_at: string;
  updated_at: string;
  dataset_name?: string;
  sku_count: number;
  status: string;
}

export interface SqlServerConfig {
  server?: string;
  server_host?: string;
  port?: number;
  database?: string;
  database_name?: string;
  auth_type?: string;
  auth_mode?: 'sql' | 'windows';
  username?: string;
  password?: string;
  driver?: string;
  items_table?: string;
  sales_table?: string;
  inventory_table?: string;
  bom_table?: string;
  custom_sql?: string;
  sales_sql?: string;
  simulate_demo?: boolean;
  save_profile?: boolean;
  profile_name?: string;
  project_id?: string;
  merge_mode?: 'merge' | 'replace';
}

export interface IngestionLog {
  id: string;
  project_id: string;
  source_type: 'excel' | 'sql_server' | 'duckdb_sqlite' | 'api_url';
  source_name: string;
  data_category: 'inventory' | 'sales' | 'combined';
  rows_processed: number;
  status: string;
  error_message?: string;
  created_at: string;
}

export interface ErpConnection {
  id: string;
  project_id?: string;
  name: string;
  source_type: 'sql_server' | 'api_url' | 'duckdb_sqlite';
  server_host?: string;
  database_name?: string;
  auth_mode?: string;
  username?: string;
  items_table?: string;
  sales_table?: string;
  inventory_table?: string;
  bom_table?: string;
  custom_sql?: string;
  api_url?: string;
  api_auth_header?: string;
  last_sync_time?: string;
  last_sync_status?: string;
  created_at?: string;
}

export interface SqlServerTestResult {
  success: boolean;
  message?: string;
  driver_used?: string;
  version?: string;
  database?: string;
  tables?: string[];
  table_count?: number;
  error?: string;
  installed_drivers?: string[];
  suggestion?: string;
  is_simulation?: boolean;
}

export interface SavedFilter {
  id: string;
  project_id: string;
  name: string;
  condition_type: string;
  filter_column: string;
  operator: string;
  filter_value: string;
  created_at: string;
}

export interface InTransitionRecord {
  id?: string;
  item_code: string;
  order_no: string;
  origin?: string;
  destination?: string;
  quantity: number;
  eta_date?: string;
  carrier?: string;
  status?: string;
}

export interface FileInspectResult {
  filename: string;
  sheets: string[];
  columns: string[];
  row_count: number;
  preview_rows: Record<string, any>[];
  suggested_mappings: Record<string, string>;
}

export const api = {
  /**
   * Diagnostic health check
   */
  async checkHealth(): Promise<{ status: string; app: string; duckdb_version: string; sql_server_driver_available: boolean; installed_odbc_drivers: string[] }> {
    const res = await fetch(`${API_BASE}/health`);
    if (!res.ok) throw new Error(`Health check failed: ${res.statusText}`);
    return res.json();
  },

  /**
   * Projects management
   */
  async getProjects(): Promise<ProjectSummary[]> {
    const res = await fetch(`${API_BASE}/projects`);
    if (!res.ok) throw new Error('Failed to fetch projects');
    return res.json();
  },

  async createProject(name: string, description: string = '', dataset_name: string = ''): Promise<ProjectSummary> {
    const res = await fetch(`${API_BASE}/projects`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, description, dataset_name }),
    });
    if (!res.ok) throw new Error('Failed to create project');
    return res.json();
  },

  async deleteProject(projectId: string): Promise<void> {
    const res = await fetch(`${API_BASE}/projects/${projectId}`, { method: 'DELETE' });
    if (!res.ok) throw new Error('Failed to delete project');
  },

  /**
   * Complete project workspace load (items, filters, transitions, kpis)
   */
  async getWorkspace(projectId: string): Promise<{
    project: ProjectSummary;
    items: InventoryItem[];
    filters: SavedFilter[];
    transitions: InTransitionRecord[];
    kpis: DashboardKpis;
  }> {
    const res = await fetch(`${API_BASE}/projects/${projectId}/workspace`);
    if (!res.ok) throw new Error(`Failed to load workspace: ${res.statusText}`);
    return res.json();
  },

  /**
   * Items & time-series periods
   */
  async getProjectItems(projectId: string): Promise<{ project_id: string; count: number; items: InventoryItem[] }> {
    const res = await fetch(`${API_BASE}/projects/${projectId}/items`);
    if (!res.ok) throw new Error(`Failed to load items: ${res.statusText}`);
    return res.json();
  },

  async updateItemParameters(projectId: string, itemId: string, updates: Partial<InventoryItem>): Promise<void> {
    const res = await fetch(`${API_BASE}/projects/${projectId}/parameters`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ item_id: itemId, parameters: updates }),
    });
    if (!res.ok) {
      // Fallback to direct PUT
      await fetch(`${API_BASE}/projects/${projectId}/items/${itemId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      });
    }
  },

  async bulkSaveItems(
    projectId: string,
    items: any[],
    periods?: any[],
    mergeMode: 'merge' | 'replace' = 'merge'
  ): Promise<{ success: boolean; items_upserted: number; periods_upserted: number }> {
    const res = await fetch(`${API_BASE}/projects/${projectId}/items/bulk`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items, periods, merge_mode: mergeMode }),
    });
    if (!res.ok) throw new Error('Failed to bulk save items');
    return res.json();
  },

  async savePeriodOverride(projectId: string, itemId: string, date: string, override: number | undefined): Promise<void> {
    const res = await fetch(`${API_BASE}/projects/${projectId}/overrides`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ item_id: itemId, date, override: override ?? null }),
    });
    if (!res.ok) throw new Error('Failed to save period override');
  },

  /**
   * Saved Filters
   */
  async getFilters(projectId: string): Promise<SavedFilter[]> {
    const res = await fetch(`${API_BASE}/projects/${projectId}/filters`);
    if (!res.ok) return [];
    return res.json();
  },

  async createFilter(projectId: string, filter: { name: string; filter_column: string; operator: string; filter_value: string }): Promise<SavedFilter> {
    const res = await fetch(`${API_BASE}/projects/${projectId}/filters`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(filter),
    });
    if (!res.ok) throw new Error('Failed to save filter');
    return res.json();
  },

  async deleteFilter(projectId: string, filterId: string): Promise<void> {
    const res = await fetch(`${API_BASE}/projects/${projectId}/filters/${filterId}`, { method: 'DELETE' });
    if (!res.ok) throw new Error('Failed to delete filter');
  },

  /**
   * In-Transition shipments
   */
  async getTransitions(projectId: string): Promise<InTransitionRecord[]> {
    const res = await fetch(`${API_BASE}/projects/${projectId}/transitions`);
    if (!res.ok) return [];
    return res.json();
  },

  async addTransition(projectId: string, record: InTransitionRecord): Promise<InTransitionRecord> {
    const res = await fetch(`${API_BASE}/projects/${projectId}/transitions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(record),
    });
    if (!res.ok) throw new Error('Failed to add transition');
    return res.json();
  },

  /**
   * Real aggregate KPIs from DuckDB
   */
  async getKpis(projectId: string): Promise<DashboardKpis> {
    const res = await fetch(`${API_BASE}/projects/${projectId}/kpis`);
    if (!res.ok) throw new Error('Failed to compute KPIs');
    return res.json();
  },

  /**
   * Microsoft SQL Server ERP
   */
  async testSqlServer(config: SqlServerConfig): Promise<SqlServerTestResult> {
    const res = await fetch(`${API_BASE}/sql/test`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(config),
    });
    return res.json();
  },

  async importSqlServer(config: SqlServerConfig & { project_name?: string }): Promise<{ success: boolean; project_id: string; project_name: string; imported_skus: number; items?: InventoryItem[]; message: string }> {
    const res = await fetch(`${API_BASE}/sql/import`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(config),
    });
    if (!res.ok) throw new Error('Failed to import ERP data from SQL Server');
    return res.json();
  },

  /**
   * File Inspection, Import & Export
   */
  async inspectFile(file: File): Promise<FileInspectResult> {
    const formData = new FormData();
    formData.append('file', file);
    const res = await fetch(`${API_BASE}/files/inspect`, {
      method: 'POST',
      body: formData,
    });
    if (!res.ok) throw new Error('Failed to inspect spreadsheet headers');
    return res.json();
  },

  async uploadFile(
    file: File,
    projectName?: string,
    columnMapping?: Record<string, string>
  ): Promise<{ success: boolean; project_id: string; project_name: string; imported_skus: number }> {
    const formData = new FormData();
    formData.append('file', file);
    if (projectName) {
      formData.append('project_name', projectName);
    }
    if (columnMapping) {
      formData.append('column_mapping', JSON.stringify(columnMapping));
    }
    const res = await fetch(`${API_BASE}/files/import`, {
      method: 'POST',
      body: formData,
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: res.statusText }));
      throw new Error(err.detail || 'File import failed');
    }
    return res.json();
  },

  getExportUrl(projectId: string, exportType: string = 'all'): string {
    return `${API_BASE}/files/export/${projectId}?export_type=${exportType}`;
  },

  /**
   * Native Desktop / Browser Excel Export
   * If pywebview desktop window is active, triggers a native Windows SaveFileDialog.
   * Otherwise triggers standard browser file download.
   */
  async downloadExcelExport(
    projectId: string,
    exportType: string = 'all',
    defaultFilename?: string
  ): Promise<boolean> {
    const filename = defaultFilename || `NEXO_${exportType}_${projectId}.xlsx`;
    const exportUrl = `${API_BASE}/files/export/${projectId}?export_type=${exportType}`;

    // 1. Check if running inside native pywebview desktop window
    const pyApi = (window as any).pywebview?.api;
    if (pyApi && typeof pyApi.save_file_dialog === 'function') {
      try {
        const res = await fetch(exportUrl);
        const blob = await res.blob();
        return new Promise((resolve) => {
          const reader = new FileReader();
          reader.onloadend = async () => {
            try {
              const base64data = (reader.result as string).split(',')[1];
              const savedPath = await pyApi.save_file_dialog(filename, base64data);
              resolve(!!savedPath);
            } catch (dialogErr) {
              console.warn('save_file_dialog bridge error:', dialogErr);
              resolve(false);
            }
          };
          reader.readAsDataURL(blob);
        });
      } catch (err) {
        console.warn('Native desktop save dialog encountered error, falling back to browser download:', err);
      }
    }

    // 2. Standard browser fallback
    const link = document.createElement('a');
    link.href = exportUrl;
    link.setAttribute('download', filename);
    document.body.appendChild(link);
    link.click();
    link.remove();
    return true;
  },

  /**
   * Unified Data Hub API Endpoints
   */
  async downloadTemplate(
    templateType: 'sales' | 'inventory' | 'in-transit',
    defaultFilename?: string,
    language: 'ar' | 'en' = 'en'
  ): Promise<boolean> {
    const isAr = language === 'ar';
    const filename = defaultFilename || (
      templateType === 'sales' ? `NEXO_Sales_Template_${isAr ? 'AR' : 'EN'}.xlsx` :
        templateType === 'inventory' ? `NEXO_Inventory_Template_${isAr ? 'AR' : 'EN'}.xlsx` :
          `NEXO_InTransit_Template_${isAr ? 'AR' : 'EN'}.xlsx`
    );
    const templateUrl = `${API_BASE}/templates/${templateType}?lang=${language}`;

    const pyApi = (window as any).pywebview?.api;
    if (pyApi && typeof pyApi.save_file_dialog === 'function') {
      try {
        const res = await fetch(templateUrl);
        const blob = await res.blob();
        return new Promise((resolve) => {
          const reader = new FileReader();
          reader.onloadend = async () => {
            try {
              const base64data = (reader.result as string).split(',')[1];
              const savedPath = await pyApi.save_file_dialog(filename, base64data);
              resolve(!!savedPath);
            } catch (dialogErr) {
              console.warn('save_file_dialog error:', dialogErr);
              resolve(false);
            }
          };
          reader.readAsDataURL(blob);
        });
      } catch (err) {
        console.warn('Native desktop save dialog encountered error, falling back:', err);
      }
    }

    const link = document.createElement('a');
    link.href = templateUrl;
    link.setAttribute('download', filename);
    document.body.appendChild(link);
    link.click();
    link.remove();
    return true;
  },

  async importTypedFile(
    file: File,
    importType: 'inventory' | 'sales' | 'combined' | 'in_transit',
    projectId?: string,
    newProjectName?: string,
    mergeMode: 'merge' | 'replace' = 'merge',
    columnMapping?: Record<string, string>
  ): Promise<{ success: boolean; project_id: string; rows_processed: number; items_upserted: number; periods_upserted: number; message: string }> {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('import_type', importType);
    formData.append('merge_mode', mergeMode);
    if (projectId) formData.append('project_id', projectId);
    if (newProjectName) formData.append('new_project_name', newProjectName);
    if (columnMapping) formData.append('column_mapping', JSON.stringify(columnMapping));

    const res = await fetch(`${API_BASE}/files/import-typed`, {
      method: 'POST',
      body: formData,
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: res.statusText }));
      throw new Error(err.detail || 'Typed file import failed');
    }
    return res.json();
  },

  async inspectLocalDb(fileOrPath: File | string): Promise<{
    success: boolean;
    file_type: 'duckdb' | 'sqlite';
    db_path: string;
    tables: string[];
    table_details: Record<string, { columns: { name: string; type: string }[]; preview: any[]; row_count: number }>;
  }> {
    const formData = new FormData();
    if (typeof fileOrPath === 'string') {
      formData.append('file_path', fileOrPath);
    } else {
      formData.append('file', fileOrPath);
    }
    const res = await fetch(`${API_BASE}/local-db/inspect`, {
      method: 'POST',
      body: formData,
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: res.statusText }));
      throw new Error(err.detail || 'Local database inspection failed');
    }
    return res.json();
  },

  async importLocalDb(params: {
    file?: File;
    filePath?: string;
    tableName: string;
    customQuery?: string;
    dataCategory?: string;
    columnMapping?: Record<string, string>;
    mergeMode?: 'merge' | 'replace';
    projectId?: string;
    newProjectName?: string;
  }): Promise<{ success: boolean; project_id: string; rows_processed: number; items_upserted: number; message: string }> {
    const formData = new FormData();
    if (params.file) formData.append('file', params.file);
    if (params.filePath) formData.append('file_path', params.filePath);
    formData.append('table_name', params.tableName);
    if (params.customQuery) formData.append('custom_query', params.customQuery);
    if (params.dataCategory) formData.append('data_category', params.dataCategory);
    if (params.mergeMode) formData.append('merge_mode', params.mergeMode);
    if (params.projectId) formData.append('project_id', params.projectId);
    if (params.newProjectName) formData.append('new_project_name', params.newProjectName);
    if (params.columnMapping) formData.append('column_mapping', JSON.stringify(params.columnMapping));

    const res = await fetch(`${API_BASE}/local-db/import`, {
      method: 'POST',
      body: formData,
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: res.statusText }));
      throw new Error(err.detail || 'Local database import failed');
    }
    return res.json();
  },

  async previewExternalUrl(url: string, authHeader?: string, authToken?: string): Promise<{
    success: boolean;
    url: string;
    columns: string[];
    row_count: number;
    preview_rows: any[];
  }> {
    const formData = new FormData();
    formData.append('url', url);
    if (authHeader) formData.append('auth_header', authHeader);
    if (authToken) formData.append('auth_token', authToken);

    const res = await fetch(`${API_BASE}/external-url/preview`, {
      method: 'POST',
      body: formData,
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: res.statusText }));
      throw new Error(err.detail || 'Failed to preview remote web feed');
    }
    return res.json();
  },

  async importExternalUrl(params: {
    url: string;
    authHeader?: string;
    authToken?: string;
    dataCategory?: string;
    columnMapping?: Record<string, string>;
    mergeMode?: 'merge' | 'replace';
    projectId?: string;
    newProjectName?: string;
    saveProfile?: boolean;
    profileName?: string;
  }): Promise<{ success: boolean; project_id: string; rows_processed: number; items_upserted: number; message: string }> {
    const formData = new FormData();
    formData.append('url', params.url);
    if (params.authHeader) formData.append('auth_header', params.authHeader);
    if (params.authToken) formData.append('auth_token', params.authToken);
    if (params.dataCategory) formData.append('data_category', params.dataCategory);
    if (params.mergeMode) formData.append('merge_mode', params.mergeMode);
    if (params.projectId) formData.append('project_id', params.projectId);
    if (params.newProjectName) formData.append('new_project_name', params.newProjectName);
    if (params.saveProfile) formData.append('save_profile', 'true');
    if (params.profileName) formData.append('profile_name', params.profileName);
    if (params.columnMapping) formData.append('column_mapping', JSON.stringify(params.columnMapping));

    const res = await fetch(`${API_BASE}/external-url/import`, {
      method: 'POST',
      body: formData,
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: res.statusText }));
      throw new Error(err.detail || 'External feed import failed');
    }
    return res.json();
  },

  async getIngestionLogs(projectId: string): Promise<{ project_id: string; logs: IngestionLog[]; connections: ErpConnection[] }> {
    const res = await fetch(`${API_BASE}/projects/${projectId}/ingestion-logs`);
    if (!res.ok) throw new Error('Failed to retrieve ingestion logs');
    return res.json();
  },

  async syncSavedSource(projectId: string): Promise<{ success: boolean; project_id: string; profile_name: string; imported_skus: number; message: string }> {
    const res = await fetch(`${API_BASE}/projects/${projectId}/sync-saved-source`, {
      method: 'POST',
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: res.statusText }));
      throw new Error(err.detail || 'Sync failed: No saved profile or connection error');
    }
    return res.json();
  },

  /**
   * Application Settings (Currency, Horizons, Service Level, ABC/XYZ)
   */
  async getSettings(): Promise<AppSettings> {
    const res = await fetch(`${API_BASE}/settings`);
    if (!res.ok) throw new Error(`Failed to load settings: ${res.statusText}`);
    return res.json();
  },

  async saveSettings(settings: Partial<AppSettings>): Promise<AppSettings> {
    const res = await fetch(`${API_BASE}/settings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(settings),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: res.statusText }));
      throw new Error(err.detail || 'Failed to save settings');
    }
    return res.json();
  },

  /**
   * System & GitHub Auto-Update
   */
  async checkUpdate(): Promise<UpdateInfo> {
    const res = await fetch(`${API_BASE}/system/check-update`);
    if (!res.ok) throw new Error(`Update check failed: ${res.statusText}`);
    return res.json();
  },

  async applyUpdate(): Promise<ApplyUpdateResult> {
    const res = await fetch(`${API_BASE}/system/apply-update`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: res.statusText }));
      throw new Error(err.detail || 'Failed to apply update from GitHub');
    }
    return res.json();
  },

  async restartApp(): Promise<{ status: string; message: string }> {
    if (typeof window !== 'undefined' && (window as any).pywebview?.api?.restart_app) {
      try {
        (window as any).pywebview.api.restart_app();
      } catch (e) {
        console.warn('Native restart_app failed, falling back to REST endpoint', e);
      }
    }
    const res = await fetch(`${API_BASE}/system/restart`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });
    if (!res.ok) throw new Error('Failed to restart application');
    return res.json();
  }
};
