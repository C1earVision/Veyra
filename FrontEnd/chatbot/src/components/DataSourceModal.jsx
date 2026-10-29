// Data Source Connection & File Upload Modal
// Allows connecting external databases via connection string or uploading CSV/Excel sheets.

import React, { useState, useEffect } from "react";
import axios from "axios";
import {
  X,
  Database,
  Upload,
  CheckCircle2,
  AlertCircle,
  Loader2,
  FileSpreadsheet,
  Layers,
  ArrowRight,
  Server,
  Pencil,
  Check,
  Trash2,
} from "lucide-react";
import { AI_API_URL } from "../config/api";
import { reconcileSourceWithServer, DEFAULT_SOURCE } from "../lib/dataSourceSync";
import { authHeaders } from "../lib/auth";

export default function DataSourceModal({ isOpen, onClose, activeSource, onSelectSource }) {
  const [tab, setTab] = useState("connect");
  const [connString, setConnString] = useState("");
  const [customName, setCustomName] = useState("");
  const [files, setFiles] = useState([]);
  const [datasetName, setDatasetName] = useState("");
  const [editingSourceId, setEditingSourceId] = useState(null);
  const [editingName, setEditingName] = useState("");
  const [renameLoading, setRenameLoading] = useState(false);
  const [deleteLoadingId, setDeleteLoadingId] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [successMsg, setSuccessMsg] = useState(null);
  const [activeSources, setActiveSources] = useState([]);

  useEffect(() => {
    if (isOpen) {
      fetchActiveSources();
      setError(null);
      setSuccessMsg(null);
      setEditingSourceId(null);
      setEditingName("");
    }
  }, [isOpen]);

  const fetchActiveSources = async () => {
    try {
      const res = await axios.get(`${AI_API_URL}/data-sources/active`, {
        headers: authHeaders(),
      });
      if (res.data?.data_sources) {
        setActiveSources(res.data.data_sources);
        if (activeSource) {
          const reconciled = reconcileSourceWithServer(
            activeSource,
            res.data.data_sources
          );
          if (reconciled.source_id !== (activeSource.source_id || "default")) {
            onSelectSource(reconciled);
          }
        }
      }
    } catch (err) {
      console.error("Failed to fetch active data sources:", err);
    }
  };

  const handleConnectDb = async (e) => {
    e.preventDefault();
    if (!connString.trim()) {
      setError("Please provide a valid database connection string.");
      return;
    }
    setLoading(true);
    setError(null);
    setSuccessMsg(null);

    try {
      const res = await axios.post(
        `${AI_API_URL}/data-sources/connect`,
        {
          connection_string: connString.trim(),
          custom_name: customName.trim() || undefined,
        },
        { headers: authHeaders() }
      );

      if (res.data?.data_source) {
        const newSource = res.data.data_source;
        setSuccessMsg(`Connected successfully! Discovered ${newSource.tables.length} table(s).`);
        onSelectSource(newSource);
        fetchActiveSources();
        setTimeout(() => {
          onClose();
        }, 1200);
      }
    } catch (err) {
      setError(err.response?.data?.error || "Failed to connect to the database. Verify host, port, and credentials.");
    } finally {
      setLoading(false);
    }
  };

  const handleFileChange = (e) => {
    if (e.target.files && e.target.files.length > 0) {
      const selected = Array.from(e.target.files);
      setFiles(selected);
      setError(null);

      // Prepopulate default dataset name if user hasn't typed one yet
      if (!datasetName.trim()) {
        const firstBase = selected[0].name.replace(/\.[^/.]+$/, "");
        if (selected.length > 1) {
          setDatasetName(`${firstBase} & ${selected.length - 1} more`);
        } else {
          setDatasetName(firstBase);
        }
      }
    }
  };

  const handleRemoveFile = (indexToRemove) => {
    const updated = files.filter((_, idx) => idx !== indexToRemove);
    setFiles(updated);
    if (updated.length === 0) {
      setDatasetName("");
    }
  };

  const handleUploadFiles = async (e) => {
    e.preventDefault();
    if (files.length === 0) {
      setError("Please select at least one CSV or Excel file to upload.");
      return;
    }
    setLoading(true);
    setError(null);
    setSuccessMsg(null);

    try {
      const formData = new FormData();
      files.forEach((file) => {
        formData.append("files", file);
      });

      if (datasetName.trim()) {
        formData.append("custom_name", datasetName.trim());
      }

      const res = await axios.post(`${AI_API_URL}/data-sources/upload`, formData, {
        headers: authHeaders({ "Content-Type": "multipart/form-data" }),
      });

      if (res.data?.data_source) {
        const newSource = res.data.data_source;
        setSuccessMsg(`Dataset prepared! Discovered ${newSource.tables.length} table(s).`);
        onSelectSource(newSource);
        fetchActiveSources();
        setFiles([]);
        setDatasetName("");
        setTimeout(() => {
          onClose();
        }, 1200);
      }
    } catch (err) {
      setError(err.response?.data?.error || "Failed to process files. Please verify the file formats.");
    } finally {
      setLoading(false);
    }
  };

  const handleStartRename = (e, source) => {
    e.stopPropagation();
    setEditingSourceId(source.source_id);
    setEditingName(source.name);
  };

  const handleCancelRename = (e) => {
    if (e) e.stopPropagation();
    setEditingSourceId(null);
    setEditingName("");
  };

  const handleDeleteSource = async (e, source) => {
    e.stopPropagation();
    if (source.source_id === "default") return;
    const label = source.name || source.source_id;
    if (
      !window.confirm(
        `Remove "${label}" from active sources? This cannot be undone.${
          source.type === "file"
            ? " The uploaded dataset file will be deleted from the server."
            : ""
        }`
      )
    ) {
      return;
    }
    setDeleteLoadingId(source.source_id);
    setError(null);
    try {
      await axios.delete(`${AI_API_URL}/data-sources/${source.source_id}`, {
        headers: authHeaders(),
      });
      setActiveSources((prev) => prev.filter((s) => s.source_id !== source.source_id));
      if ((activeSource?.source_id || "default") === source.source_id) {
        onSelectSource(DEFAULT_SOURCE);
      }
      setSuccessMsg(`Removed "${label}".`);
    } catch (err) {
      setError(err.response?.data?.error || "Failed to remove data source.");
    } finally {
      setDeleteLoadingId(null);
    }
  };

  const handleSaveRename = async (e, sourceId) => {
    if (e) e.stopPropagation();
    if (!editingName.trim()) {
      setError("Dataset name cannot be empty.");
      return;
    }
    setRenameLoading(true);
    try {
      const res = await axios.patch(
        `${AI_API_URL}/data-sources/${sourceId}/rename`,
        { name: editingName.trim() },
        { headers: authHeaders() }
      );
      if (res.data?.data_source) {
        const updated = res.data.data_source;
        setActiveSources((prev) =>
          prev.map((s) => (s.source_id === sourceId ? { ...s, name: updated.name } : s))
        );
        if ((activeSource?.source_id || "default") === sourceId) {
          onSelectSource({ ...activeSource, name: updated.name });
        }
        setEditingSourceId(null);
        setEditingName("");
      }
    } catch (err) {
      setError(err.response?.data?.error || "Failed to rename dataset.");
    } finally {
      setRenameLoading(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm animate-fadeIn">
      <div className="w-full max-w-xl bg-[#151820] border border-[#272B35] rounded-xl shadow-2xl flex flex-col overflow-hidden max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#272B35] bg-[#111319]">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-blue-500/10 border border-blue-500/20 flex items-center justify-center text-blue-400">
              <Database size={16} />
            </div>
            <div>
              <h2 className="text-[15px] font-semibold text-[#F3F4F6]">Connect Business Data</h2>
              <p className="text-[12px] text-[#9CA3AF]">Query any database or analyze uploaded CSV/Excel files</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-[#9CA3AF] hover:text-[#F3F4F6] rounded-md hover:bg-[#1E2230] transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        {/* Tab Switcher */}
        <div className="flex border-b border-[#272B35] px-6 bg-[#13161F]">
          <button
            onClick={() => { setTab("connect"); setError(null); }}
            className={`py-2.5 px-3 text-[13px] font-medium border-b-2 transition-all flex items-center gap-2 ${
              tab === "connect"
                ? "border-blue-500 text-blue-400"
                : "border-transparent text-[#9CA3AF] hover:text-[#D1D5DB]"
            }`}
          >
            <Server size={14} />
            Database Connection
          </button>

          <button
            onClick={() => { setTab("upload"); setError(null); }}
            className={`py-2.5 px-3 text-[13px] font-medium border-b-2 transition-all flex items-center gap-2 ${
              tab === "upload"
                ? "border-blue-500 text-blue-400"
                : "border-transparent text-[#9CA3AF] hover:text-[#D1D5DB]"
            }`}
          >
            <Upload size={14} />
            Upload CSV / Excel
          </button>

          <button
            onClick={() => { setTab("active"); setError(null); fetchActiveSources(); }}
            className={`py-2.5 px-3 text-[13px] font-medium border-b-2 transition-all flex items-center gap-2 ${
              tab === "active"
                ? "border-blue-500 text-blue-400"
                : "border-transparent text-[#9CA3AF] hover:text-[#D1D5DB]"
            }`}
          >
            <Layers size={14} />
            Active Sources ({activeSources.length})
          </button>
        </div>

        {/* Content Body */}
        <div className="p-6 overflow-y-auto flex-1">
          {error && (
            <div className="mb-4 p-3.5 rounded-lg bg-red-500/10 border border-red-500/25 text-red-300 text-[12px] flex items-start gap-2.5 max-h-72 overflow-y-auto">
              <AlertCircle size={18} className="mt-0.5 shrink-0 text-red-400" />
              <div className="whitespace-pre-line leading-relaxed font-sans flex-1">{error}</div>
            </div>
          )}

          {successMsg && (
            <div className="mb-4 p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-[12.5px] flex items-start gap-2.5">
              <CheckCircle2 size={16} className="mt-0.5 shrink-0" />
              <span>{successMsg}</span>
            </div>
          )}

          {/* TAB 1: Connect Database */}
          {tab === "connect" && (
            <form onSubmit={handleConnectDb} className="space-y-4">
              <div>
                <label className="block text-[12.5px] font-medium text-[#D1D5DB] mb-1.5">
                  Connection URI
                </label>
                <input
                  type="text"
                  placeholder="e.g. postgresql://user:password@host:5432/dbname"
                  value={connString}
                  onChange={(e) => setConnString(e.target.value)}
                  className="w-full px-3.5 py-2 text-[13px] bg-[#0F1117] border border-[#272B35] rounded-md text-[#F3F4F6] placeholder-[#4B5563] focus:outline-none focus:border-blue-500 transition-colors font-mono"
                />
                <p className="text-[11.5px] text-[#6B7280] mt-1">
                  Supports PostgreSQL, MySQL, SQLite, and SQL Server.
                </p>
              </div>

              <div>
                <label className="block text-[12.5px] font-medium text-[#D1D5DB] mb-1.5">
                  Display Name (Optional)
                </label>
                <input
                  type="text"
                  placeholder="e.g. Production Analytics DB"
                  value={customName}
                  onChange={(e) => setCustomName(e.target.value)}
                  className="w-full px-3.5 py-2 text-[13px] bg-[#0F1117] border border-[#272B35] rounded-md text-[#F3F4F6] placeholder-[#4B5563] focus:outline-none focus:border-blue-500 transition-colors"
                />
              </div>

              <div className="pt-2">
                <button
                  type="submit"
                  disabled={loading || !connString.trim()}
                  className="w-full py-2.5 px-4 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-[13px] font-medium rounded-md flex items-center justify-center gap-2 transition-colors cursor-pointer"
                >
                  {loading ? (
                    <>
                      <Loader2 size={16} className="animate-spin" />
                      <span>Verifying & Connecting…</span>
                    </>
                  ) : (
                    <>
                      <Database size={16} />
                      <span>Connect Database</span>
                    </>
                  )}
                </button>
              </div>
            </form>
          )}

          {/* TAB 2: Upload Files */}
          {tab === "upload" && (
            <form onSubmit={handleUploadFiles} className="space-y-4">
              <div className="border-2 border-dashed border-[#272B35] hover:border-blue-500/50 rounded-xl p-6 text-center bg-[#0F1117]/50 transition-colors">
                <input
                  type="file"
                  id="file-upload"
                  multiple
                  accept=".csv,.xlsx,.xls"
                  onChange={handleFileChange}
                  className="hidden"
                />
                <label
                  htmlFor="file-upload"
                  className="cursor-pointer flex flex-col items-center justify-center"
                >
                  <div className="w-12 h-12 rounded-xl bg-blue-500/10 text-blue-400 flex items-center justify-center mb-3">
                    <FileSpreadsheet size={24} />
                  </div>
                  <span className="text-[13.5px] font-medium text-[#F3F4F6] mb-1">
                    Choose CSV or Excel sheets
                  </span>
                  <span className="text-[12px] text-[#6B7280]">
                    Drop or select single or multiple .csv, .xlsx, or .xls files
                  </span>
                </label>
              </div>

              {files.length > 0 && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-[12px] font-medium text-[#9CA3AF]">
                      Selected Files ({files.length})
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        setFiles([]);
                        setDatasetName("");
                      }}
                      className="text-[11px] text-[#6B7280] hover:text-red-400 transition-colors"
                    >
                      Clear all
                    </button>
                  </div>
                  <div className="space-y-1.5 max-h-36 overflow-y-auto pr-1">
                    {files.map((file, idx) => (
                      <div
                        key={idx}
                        className="flex items-center justify-between px-3 py-1.5 rounded bg-[#111319] border border-[#272B35] text-[12px]"
                      >
                        <span className="text-[#D1D5DB] truncate max-w-[340px]">{file.name}</span>
                        <div className="flex items-center gap-2">
                          <span className="text-[#6B7280]">{(file.size / 1024).toFixed(1)} KB</span>
                          <button
                            type="button"
                            onClick={() => handleRemoveFile(idx)}
                            className="text-[#6B7280] hover:text-red-400 p-0.5 rounded transition-colors"
                            title="Remove file"
                          >
                            <X size={13} />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Custom Dataset Name Field */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-[12.5px] font-medium text-[#D1D5DB]">
                    Dataset Name {files.length > 1 ? "" : "(Optional)"}
                  </label>
                  {files.length > 1 && (
                    <span className="text-[11px] text-blue-400 font-medium bg-blue-500/10 px-2 py-0.5 rounded border border-blue-500/20">
                      {files.length} files combined into 1 dataset
                    </span>
                  )}
                </div>
                <input
                  type="text"
                  placeholder={
                    files.length > 1
                      ? "e.g. Sales & Customers Q3 (Custom dataset name)"
                      : files.length === 1
                      ? `e.g. Custom name (default: ${files[0].name.replace(/\.[^/.]+$/, "")})`
                      : "e.g. Custom Dataset Name"
                  }
                  value={datasetName}
                  onChange={(e) => setDatasetName(e.target.value)}
                  className="w-full px-3.5 py-2 text-[13px] bg-[#0F1117] border border-[#272B35] rounded-md text-[#F3F4F6] placeholder-[#4B5563] focus:outline-none focus:border-blue-500 transition-colors"
                />
                <p className="text-[11.5px] text-[#6B7280] mt-1">
                  {files.length > 1
                    ? "All selected CSV/Excel files will be ingested into this dataset as individual SQL tables."
                    : "Specify a custom display name for this dataset, or leave blank to use the file name."}
                </p>
              </div>

              <div className="pt-2">
                <button
                  type="submit"
                  disabled={loading || files.length === 0}
                  className="w-full py-2.5 px-4 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-[13px] font-medium rounded-md flex items-center justify-center gap-2 transition-colors cursor-pointer"
                >
                  {loading ? (
                    <>
                      <Loader2 size={16} className="animate-spin" />
                      <span>Ingesting into Analytics Engine…</span>
                    </>
                  ) : (
                    <>
                      <Upload size={16} />
                      <span>
                        Upload & Ingest {files.length > 1 ? `${files.length} Files` : "Dataset"}
                      </span>
                    </>
                  )}
                </button>
              </div>
            </form>
          )}

          {/* TAB 3: Active Sources */}
          {tab === "active" && (
            <div className="space-y-2.5 max-h-[min(420px,55vh)] overflow-y-auto pr-1">
              {activeSources.length === 0 ? (
                <p className="text-[13px] text-[#6B7280] text-center py-6">
                  No custom data sources registered yet.
                </p>
              ) : (
                activeSources.map((source) => {
                  const isSelected = (activeSource?.source_id || "default") === source.source_id;
                  const isEditing = editingSourceId === source.source_id;
                  const canRename = source.source_id !== "default";
                  const canDelete = source.source_id !== "default";
                  const isDeleting = deleteLoadingId === source.source_id;

                  return (
                    <div
                      key={source.source_id}
                      onClick={() => {
                        if (isEditing) return;
                        onSelectSource(source);
                        onClose();
                      }}
                      className={`p-3.5 rounded-lg border transition-all cursor-pointer flex items-center justify-between ${
                        isSelected
                          ? "bg-blue-600/10 border-blue-500/50"
                          : "bg-[#111319] border-[#272B35] hover:border-[#3E4352]"
                      }`}
                    >
                      <div className="flex items-center gap-3 flex-1 min-w-0 mr-3">
                        <div
                          className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${
                            source.type === "file"
                              ? "bg-amber-500/10 text-amber-400"
                              : "bg-blue-500/10 text-blue-400"
                          }`}
                        >
                          {source.type === "file" ? <FileSpreadsheet size={16} /> : <Database size={16} />}
                        </div>
                        <div className="flex-1 min-w-0">
                          {isEditing ? (
                            <div
                              className="flex items-center gap-1.5"
                              onClick={(e) => e.stopPropagation()}
                            >
                              <input
                                type="text"
                                value={editingName}
                                autoFocus
                                onChange={(e) => setEditingName(e.target.value)}
                                onKeyDown={(e) => {
                                  if (e.key === "Enter") handleSaveRename(e, source.source_id);
                                  if (e.key === "Escape") handleCancelRename(e);
                                }}
                                className="px-2 py-1 text-[13px] bg-[#0F1117] border border-blue-500 rounded text-[#F3F4F6] focus:outline-none w-full max-w-[220px]"
                              />
                              <button
                                type="button"
                                disabled={renameLoading || !editingName.trim()}
                                onClick={(e) => handleSaveRename(e, source.source_id)}
                                className="p-1 rounded bg-blue-600 hover:bg-blue-500 text-white disabled:opacity-50 transition-colors"
                                title="Save name"
                              >
                                {renameLoading ? (
                                  <Loader2 size={13} className="animate-spin" />
                                ) : (
                                  <Check size={13} />
                                )}
                              </button>
                              <button
                                type="button"
                                onClick={handleCancelRename}
                                className="p-1 rounded bg-[#272B35] hover:bg-[#3E4352] text-[#9CA3AF] transition-colors"
                                title="Cancel"
                              >
                                <X size={13} />
                              </button>
                            </div>
                          ) : (
                            <div className="flex items-center gap-2">
                              <span className="text-[13.5px] font-medium text-[#F3F4F6] truncate">
                                {source.name}
                              </span>
                              {canRename && (
                                <button
                                  type="button"
                                  onClick={(e) => handleStartRename(e, source)}
                                  className="p-1 text-[#6B7280] hover:text-[#9CA3AF] rounded hover:bg-[#1E2230] transition-colors shrink-0"
                                  title="Rename dataset"
                                >
                                  <Pencil size={12} />
                                </button>
                              )}
                              {isSelected && (
                                <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-blue-500/20 text-blue-400 shrink-0">
                                  ACTIVE
                                </span>
                              )}
                            </div>
                          )}
                          <p className="text-[11.5px] text-[#6B7280] mt-0.5 truncate">
                            {source.tables.length} table(s): {source.tables.slice(0, 3).join(", ")}
                            {source.tables.length > 3 ? "..." : ""}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-1 shrink-0" onClick={(e) => e.stopPropagation()}>
                        {canDelete && (
                          <button
                            type="button"
                            disabled={isDeleting}
                            onClick={(e) => handleDeleteSource(e, source)}
                            className="p-1.5 rounded-md text-[#6B7280] hover:text-red-400 hover:bg-red-500/10 transition-colors disabled:opacity-50"
                            title="Remove data source"
                          >
                            {isDeleting ? (
                              <Loader2 size={14} className="animate-spin" />
                            ) : (
                              <Trash2 size={14} />
                            )}
                          </button>
                        )}
                        <ArrowRight size={14} className="text-[#6B7280]" />
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
