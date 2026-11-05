// Dynamic Data Explorer Component
// Displays discovered database tables, column schemas, and live record previews.
// Features horizontal overflow slider controls, expandable image lightbox previews, and configurable row limits.

import React, { useState, useEffect, useMemo, useRef } from "react";
import axios from "axios";
import {
  Database,
  Search,
  Loader2,
  RefreshCw,
  HardDrive,
  Code2,
  AlertCircle,
  FileSpreadsheet,
  Maximize2,
  ZoomIn,
  ZoomOut,
  RotateCcw,
  Download,
  X,
  ChevronLeft,
  ChevronRight,
  Sliders,
  Image as ImageIcon,
  PanelLeftClose,
  PanelLeftOpen
} from "lucide-react";
import { AI_API_URL } from "../config/api";
import { authHeaders } from "../lib/auth";

// Helper to determine whether a cell string contains an image (base64 data URL, image file extension, or visualization path)
function isImageValue(val) {
  if (typeof val !== "string") return false;
  const trimmed = val.trim();
  if (trimmed.startsWith("data:image/")) return true;
  if (/^https?:\/\/.*\.(png|jpe?g|webp|gif|svg|ico)(\?.*)?$/i.test(trimmed)) return true;
  if (/^\/visualizations\/.*\.(png|jpe?g|webp)$/i.test(trimmed)) return true;
  if (/^.*\.(png|jpe?g|webp|gif|svg)$/i.test(trimmed) && trimmed.length < 500) return true;
  return false;
}

// Normalizes image URLs for local backend paths
function normalizeImgSrc(val) {
  if (!val || typeof val !== "string") return "";
  const trimmed = val.trim();
  if (trimmed.startsWith("data:image/") || /^https?:\/\//i.test(trimmed)) {
    return trimmed;
  }
  if (trimmed.startsWith("/")) {
    return `${AI_API_URL.replace(/\/$/, "")}${trimmed}`;
  }
  return trimmed;
}

export default function DataExplorer({
  activeSource,
  onOpenSourceModal,
  onSourceInvalid,
  isSidebarOpen,
  onToggleSidebar,
}) {
  const [schemaData, setSchemaData] = useState({ tables: [], previews: {}, columns: {} });
  const [selectedTable, setSelectedTable] = useState("");
  const [rowLimit, setRowLimit] = useState(25);
  const [loading, setLoading] = useState(false);
  const [tableLoading, setTableLoading] = useState(false);
  const [error, setError] = useState(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [activeTab, setActiveTab] = useState("preview"); // 'preview' | 'schema'

  // Image lightbox state
  const [expandedImage, setExpandedImage] = useState(null);
  const [imageZoom, setImageZoom] = useState(1);

  // Horizontal scroll tracking for overflow slider
  const tableContainerRef = useRef(null);
  const [scrollPercent, setScrollPercent] = useState(0);

  const sourceId = activeSource?.source_id || "default";

  // Initial schema discovery
  useEffect(() => {
    fetchSchema();
  }, [sourceId]);

  // Handle ESC key to dismiss expanded image lightbox
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === "Escape" && expandedImage) {
        setExpandedImage(null);
        setImageZoom(1);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [expandedImage]);

  // Fetch full schema definitions
  const fetchSchema = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await axios.get(`${AI_API_URL}/data-sources/${sourceId}/schema?limit=${rowLimit}`, {
        headers: authHeaders(),
      });
      if (res.data?.schema) {
        const schema = res.data.schema;
        setSchemaData(schema);
        if (schema.tables?.length > 0) {
          setSelectedTable((prev) => (schema.tables.includes(prev) ? prev : schema.tables[0]));
        } else {
          setSelectedTable("");
        }
      }
    } catch (err) {
      console.error("Failed to load schema:", err);
      if (err.response?.status === 404) {
        setError(
          err.response?.data?.error ||
            "This data source is no longer available. Reconnect or use the default database."
        );
        onSourceInvalid?.();
      } else {
        setError(
          err.response?.data?.error ||
            "Could not connect to the AI backend service. Please verify the server is running."
        );
      }
    } finally {
      setLoading(false);
    }
  };

  // Fetch table records when table selection or row limit changes
  const fetchTableRecords = async (tableName, limit) => {
    if (!tableName) return;
    setTableLoading(true);
    try {
      const res = await axios.get(
        `${AI_API_URL}/data-sources/${sourceId}/tables/${tableName}?limit=${limit}`,
        { headers: authHeaders() }
      );
      if (res.data?.data) {
        setSchemaData((prev) => ({
          ...prev,
          previews: {
            ...prev.previews,
            [tableName]: res.data.data,
          },
        }));
      }
    } catch (err) {
      console.error("Failed to load table records:", err);
    } finally {
      setTableLoading(false);
    }
  };

  const handleTableChange = (newTable) => {
    setSelectedTable(newTable);
    setSearchTerm("");
    fetchTableRecords(newTable, rowLimit);
  };

  const handleRowLimitChange = (newLimit) => {
    setRowLimit(newLimit);
    fetchTableRecords(selectedTable, newLimit);
  };

  // Sync scroll slider with container scroll position
  const updateScrollState = () => {
    const el = tableContainerRef.current;
    if (!el) return;
    const maxScroll = el.scrollWidth - el.clientWidth;
    if (maxScroll > 0) {
      const pct = (el.scrollLeft / maxScroll) * 100;
      setScrollPercent(Math.min(100, Math.max(0, pct)));
    } else {
      setScrollPercent(0);
    }
  };

  useEffect(() => {
    const el = tableContainerRef.current;
    if (!el) return;

    updateScrollState();
    el.addEventListener("scroll", updateScrollState, { passive: true });
    window.addEventListener("resize", updateScrollState);

    const observer = new ResizeObserver(() => updateScrollState());
    observer.observe(el);

    return () => {
      el.removeEventListener("scroll", updateScrollState);
      window.removeEventListener("resize", updateScrollState);
      observer.disconnect();
    };
  }, [selectedTable, schemaData]);

  const handleSliderScroll = (e) => {
    const val = Number(e.target.value);
    setScrollPercent(val);
    const el = tableContainerRef.current;
    if (!el) return;
    const maxScroll = el.scrollWidth - el.clientWidth;
    if (maxScroll > 0) {
      el.scrollLeft = (val / 100) * maxScroll;
    }
  };

  const handleStepScroll = (direction) => {
    const el = tableContainerRef.current;
    if (!el) return;
    el.scrollBy({ left: direction * 280, behavior: "smooth" });
  };

  const handleJumpScroll = (targetPercent) => {
    const el = tableContainerRef.current;
    if (!el) return;
    const maxScroll = el.scrollWidth - el.clientWidth;
    el.scrollTo({ left: (targetPercent / 100) * maxScroll, behavior: "smooth" });
  };

  const currentPreview = schemaData.previews?.[selectedTable];
  const currentSchemaDdl = schemaData.columns?.[selectedTable] || "";

  // Normalize preview structure
  const { previewColumns, previewRows, isRawString } = useMemo(() => {
    if (!currentPreview) {
      return { previewColumns: [], previewRows: [], isRawString: false };
    }
    if (typeof currentPreview === "object" && Array.isArray(currentPreview.columns)) {
      return {
        previewColumns: currentPreview.columns,
        previewRows: currentPreview.rows || [],
        isRawString: false,
      };
    }
    if (typeof currentPreview === "string") {
      return { previewColumns: [], previewRows: [], isRawString: true };
    }
    return { previewColumns: [], previewRows: [], isRawString: false };
  }, [currentPreview]);

  // Filter rows based on search term
  const filteredRows = useMemo(() => {
    if (!searchTerm.trim() || isRawString) return previewRows;
    const term = searchTerm.toLowerCase();
    return previewRows.filter((row) =>
      Object.values(row).some((val) => String(val).toLowerCase().includes(term))
    );
  }, [previewRows, searchTerm, isRawString]);

  return (
    <div className="flex-1 flex flex-col min-h-0 min-w-0 w-full overflow-hidden p-6 bg-[#0F1117]">
      {/* Top Banner */}
      <div className="flex-shrink-0 flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-5">
        <div className="flex items-center gap-3">
          {onToggleSidebar && (
            <button
              onClick={onToggleSidebar}
              className="p-1.5 rounded-lg text-[#9CA3AF] hover:text-[#F3F4F6] hover:bg-[#151820] border border-[#272B35] transition-colors cursor-pointer shrink-0"
              title={isSidebarOpen ? "Collapse sidebar" : "Open sidebar"}
            >
              {isSidebarOpen ? (
                <PanelLeftClose size={16} />
              ) : (
                <PanelLeftOpen size={16} className="text-blue-400" />
              )}
            </button>
          )}
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-[18px] font-semibold text-[#F3F4F6]">Data Explorer</h2>
              <span className="px-2 py-0.5 rounded text-[11px] font-medium bg-blue-500/10 text-blue-400 border border-blue-500/20">
                {activeSource?.name || "Default Database"}
              </span>
            </div>
            <p className="text-[13px] text-[#6B7280] mt-0.5">
              Explore discovered tables, schema definitions, image records, and sample data.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2.5">
          <button
            onClick={fetchSchema}
            disabled={loading}
            className="p-2 rounded-md bg-[#151820] text-[#9CA3AF] hover:text-[#F3F4F6] border border-[#272B35] transition-colors cursor-pointer"
            title="Refresh Schema"
          >
            <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
          </button>
          <button
            onClick={onOpenSourceModal}
            className="flex items-center gap-2 px-3 py-1.5 text-[13px] font-medium rounded-md bg-blue-600 hover:bg-blue-500 text-white transition-colors cursor-pointer"
          >
            <HardDrive size={14} />
            <span>Switch Data Source</span>
          </button>
        </div>
      </div>

      {/* Main Content Area */}
      {loading ? (
        <div className="flex flex-1 items-center justify-center">
          <Loader2 size={20} className="animate-spin text-blue-400" />
          <span className="ml-2.5 text-[14px] text-[#9CA3AF]">Introspecting database tables…</span>
        </div>
      ) : error ? (
        <div className="flex-1 flex flex-col items-center justify-center p-8 border border-dashed border-red-500/30 rounded-xl text-center bg-red-500/5">
          <AlertCircle size={32} className="text-red-400 mb-3" />
          <h3 className="text-[15px] font-medium text-[#F3F4F6] mb-1">Failed to Connect</h3>
          <p className="text-[13px] text-[#9CA3AF] max-w-md mb-4">{error}</p>
          <button
            onClick={fetchSchema}
            className="px-4 py-2 text-[13px] font-medium rounded-md bg-blue-600 hover:bg-blue-500 text-white transition-colors cursor-pointer"
          >
            Retry Connection
          </button>
        </div>
      ) : schemaData.tables.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center p-8 border border-dashed border-[#272B35] rounded-xl text-center">
          <Database size={32} className="text-[#6B7280] mb-3" />
          <h3 className="text-[15px] font-medium text-[#F3F4F6] mb-1">No tables discovered</h3>
          <p className="text-[13px] text-[#6B7280] max-w-sm mb-4">
            Connect an external database or upload CSV / Excel spreadsheets to query any business data.
          </p>
          <button
            onClick={onOpenSourceModal}
            className="px-4 py-2 text-[13px] font-medium rounded-md bg-blue-600 hover:bg-blue-500 text-white transition-colors cursor-pointer"
          >
            Connect Data Source
          </button>
        </div>
      ) : (
        <div className="flex-1 flex flex-col min-h-0 min-w-0 w-full bg-[#151820] border border-[#272B35] rounded-xl overflow-hidden shadow-sm">
          {/* Controls Bar */}
          <div className="flex-shrink-0 flex flex-col lg:flex-row lg:items-center justify-between gap-3 p-3.5 border-b border-[#272B35] bg-[#111319]">
            <div className="flex flex-wrap items-center gap-3">
              <span className="text-[12.5px] font-medium text-[#9CA3AF]">Table:</span>
              <div className="relative">
                <select
                  value={selectedTable}
                  onChange={(e) => handleTableChange(e.target.value)}
                  className="px-3 py-1.5 text-[13px] rounded-md bg-[#1E2230] text-[#F3F4F6] border border-[#2E3444] focus:outline-none focus:border-blue-500 transition-colors font-medium cursor-pointer"
                >
                  {schemaData.tables.map((tbl) => (
                    <option key={tbl} value={tbl}>
                      {tbl}
                    </option>
                  ))}
                </select>
              </div>

              {/* Row Limit Selector */}
              <div className="flex items-center gap-1.5 bg-[#1E2230] px-2.5 py-1 rounded-md border border-[#2E3444]">
                <span className="text-[11.5px] text-[#9CA3AF] font-medium">Rows:</span>
                <select
                  value={rowLimit}
                  onChange={(e) => handleRowLimitChange(Number(e.target.value))}
                  className="text-[12px] bg-transparent text-[#F3F4F6] focus:outline-none cursor-pointer font-medium"
                >
                  <option value={10} className="bg-[#1E2230]">10 rows</option>
                  <option value={25} className="bg-[#1E2230]">25 rows</option>
                  <option value={50} className="bg-[#1E2230]">50 rows</option>
                  <option value={100} className="bg-[#1E2230]">100 rows</option>
                  <option value={200} className="bg-[#1E2230]">200 rows</option>
                </select>
              </div>

              {previewColumns.length > 0 && (
                <span className="text-[12px] text-[#6B7280]">
                  {previewColumns.length} columns • {filteredRows.length} displayed
                  {tableLoading && <Loader2 size={12} className="inline ml-1.5 animate-spin text-blue-400" />}
                </span>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-3">
              {/* Tab Switcher */}
              <div className="flex items-center bg-[#1E2230] p-0.5 rounded-md border border-[#2E3444]">
                <button
                  onClick={() => setActiveTab("preview")}
                  className={`flex items-center gap-1.5 px-2.5 py-1 text-[12px] font-medium rounded transition-colors cursor-pointer ${activeTab === "preview"
                      ? "bg-blue-600 text-white"
                      : "text-[#9CA3AF] hover:text-[#F3F4F6]"
                    }`}
                >
                  <FileSpreadsheet size={13} />
                  <span>Data Preview</span>
                </button>
                <button
                  onClick={() => setActiveTab("schema")}
                  className={`flex items-center gap-1.5 px-2.5 py-1 text-[12px] font-medium rounded transition-colors cursor-pointer ${activeTab === "schema"
                      ? "bg-blue-600 text-white"
                      : "text-[#9CA3AF] hover:text-[#F3F4F6]"
                    }`}
                >
                  <Code2 size={13} />
                  <span>DDL Schema</span>
                </button>
              </div>

              {/* Search Filter (only for preview tab) */}
              {activeTab === "preview" && !isRawString && (
                <div className="relative">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[#6B7280]" size={13} />
                  <input
                    type="text"
                    placeholder="Search records…"
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="pl-8 pr-3 py-1 text-[12.5px] rounded-md bg-[#1E2230] text-[#D1D5DB] border border-[#2E3444] placeholder-[#4B5563] focus:outline-none focus:border-blue-500 transition-colors w-40 sm:w-52"
                  />
                </div>
              )}
            </div>
          </div>

          {/* Table Viewport with Horizontal and Vertical Scrolling */}
          <div
            ref={tableContainerRef}
            className="flex-1 min-h-0 min-w-0 w-full overflow-x-auto overflow-y-auto select-text relative"
          >
            {tableLoading && (
              <div className="absolute inset-0 bg-[#0F1117]/60 backdrop-blur-[1px] flex items-center justify-center z-20">
                <Loader2 size={22} className="animate-spin text-blue-400" />
                <span className="ml-2 text-[13px] text-[#D1D5DB]">Loading records…</span>
              </div>
            )}

            {activeTab === "preview" ? (
              isRawString ? (
                <div className="p-4">
                  <pre className="text-[12.5px] font-mono text-[#D1D5DB] leading-relaxed bg-[#0F1117] p-4 rounded-lg border border-[#222634] overflow-x-auto whitespace-pre-wrap">
                    {currentPreview}
                  </pre>
                </div>
              ) : previewColumns.length > 0 ? (
                <table className="w-max min-w-full text-[12.5px] border-collapse divide-y divide-[#222634] animate-table-in">
                  <thead className="sticky top-0 z-10 bg-[#111319]">
                    <tr className="text-[#9CA3AF] text-left">
                      <th className="sticky left-0 z-20 bg-[#111319] px-3.5 py-2.5 font-medium text-[11.5px] uppercase tracking-wider text-[#6B7280] w-12 text-center border-r border-[#222634]">
                        #
                      </th>
                      {previewColumns.map((col) => (
                        <th
                          key={col}
                          className="px-4 py-2.5 font-medium text-[12px] uppercase tracking-wider whitespace-nowrap text-[#D1D5DB] border-r border-[#222634]/60 last:border-r-0 min-w-[130px] max-w-[260px]"
                        >
                          {col}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#1E2230]/70 bg-[#0F1117]">
                    {filteredRows.length > 0 ? (
                      filteredRows.map((row, idx) => (
                        <tr
                          key={idx}
                          className="text-[#D1D5DB] hover:bg-[#151820] transition-colors animate-table-row"
                          style={{ animationDelay: `${Math.min(idx, 15) * 20}ms` }}
                        >
                          <td className="sticky left-0 z-10 bg-[#0F1117] hover:bg-[#151820] px-3.5 py-2 text-[11px] font-mono text-[#6B7280] text-center border-r border-[#222634] select-none">
                            {idx + 1}
                          </td>
                          {previewColumns.map((col) => {
                            const cellValue = row[col];
                            const isImg = isImageValue(cellValue);
                            const imgSrc = isImg ? normalizeImgSrc(cellValue) : "";

                            return (
                              <td
                                key={col}
                                className="px-4 py-2 whitespace-nowrap border-r border-[#222634]/50 last:border-r-0 max-w-[260px] truncate text-[12.5px]"
                                title={isImg ? "Image (click thumbnail to expand)" : String(cellValue ?? "")}
                              >
                                {isImg ? (
                                  <div className="flex items-center gap-2">
                                    <div
                                      onClick={() => {
                                        setExpandedImage({
                                          src: imgSrc,
                                          alt: `${col} from ${selectedTable}`,
                                          columnName: col,
                                          rowIndex: idx + 1,
                                          tableName: selectedTable,
                                        });
                                        setImageZoom(1);
                                      }}
                                      className="group/thumb relative inline-flex items-center justify-center h-10 w-10 rounded-md border border-[#272B35] bg-[#111319] hover:border-blue-500 hover:ring-2 hover:ring-blue-500/20 transition-all cursor-pointer overflow-hidden flex-shrink-0"
                                      title="Click to expand image"
                                    >
                                      <img
                                        src={imgSrc}
                                        alt={`${col} thumbnail`}
                                        className="h-full w-full object-cover group-hover/thumb:scale-110 transition-transform"
                                        loading="lazy"
                                        onError={(e) => {
                                          e.currentTarget.style.display = "none";
                                          e.currentTarget.parentElement.innerHTML =
                                            '<span class="text-[10px] text-gray-500">Image</span>';
                                        }}
                                      />
                                      <div className="absolute inset-0 bg-black/40 opacity-0 group-hover/thumb:opacity-100 flex items-center justify-center transition-opacity text-white">
                                        <Maximize2 size={13} />
                                      </div>
                                    </div>
                                    <span className="text-[11px] text-[#6B7280] font-mono">
                                      [Image]
                                    </span>
                                  </div>
                                ) : cellValue !== "" && cellValue !== null && cellValue !== undefined ? (
                                  String(cellValue)
                                ) : (
                                  <span className="text-[#4B5563] italic font-mono text-[11px]">
                                    NULL
                                  </span>
                                )}
                              </td>
                            );
                          })}
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td
                          colSpan={previewColumns.length + 1}
                          className="text-center py-8 text-[13px] text-[#6B7280]"
                        >
                          {searchTerm ? "No matching records found." : "No preview records available."}
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              ) : (
                <p className="text-[13px] text-[#6B7280] text-center py-10">
                  No preview records available for table "{selectedTable}".
                </p>
              )
            ) : (
              /* DDL Schema View */
              <div className="p-4">
                <div className="bg-[#0F1117] p-4 rounded-lg border border-[#222634] overflow-x-auto">
                  <pre className="text-[12px] font-mono text-[#93C5FD] leading-relaxed whitespace-pre-wrap">
                    {currentSchemaDdl || `-- No DDL schema metadata available for table "${selectedTable}"`}
                  </pre>
                </div>
              </div>
            )}
          </div>

          {/* Horizontal Overflow Slider Controller */}
          {activeTab === "preview" && previewColumns.length > 0 && (
            <div className="flex-shrink-0 flex flex-wrap sm:flex-nowrap items-center justify-between gap-3 px-4 py-2.5 border-t border-[#272B35] bg-[#111319] text-[12px] text-[#9CA3AF]">
              <div className="flex items-center gap-1.5 text-[12px] text-[#9CA3AF] flex-shrink-0">
                <Sliders size={13} className="text-blue-400" />
                <span className="font-medium text-[#D1D5DB]">Table Slider:</span>
                <span className="text-[11px] text-[#6B7280]">({previewColumns.length} cols)</span>
              </div>

              {/* Slider Track with Navigation Controls */}
              <div className="flex-1 max-w-xl mx-2 flex items-center gap-2">
                <button
                  onClick={() => handleJumpScroll(0)}
                  className="px-2 py-0.5 rounded text-[11px] font-medium bg-[#1E2230] text-[#9CA3AF] hover:text-[#F3F4F6] border border-[#2E3444] transition-colors cursor-pointer flex-shrink-0"
                  title="Jump to first column"
                >
                  Start
                </button>
                <button
                  onClick={() => handleStepScroll(-1)}
                  className="p-1 rounded bg-[#1E2230] text-[#9CA3AF] hover:text-[#F3F4F6] border border-[#2E3444] transition-colors cursor-pointer flex-shrink-0"
                  title="Pan left"
                >
                  <ChevronLeft size={15} />
                </button>

                <div className="flex-1 relative flex items-center">
                  <input
                    type="range"
                    min="0"
                    max="100"
                    value={scrollPercent}
                    onChange={handleSliderScroll}
                    className="w-full h-2 bg-[#1E2230] rounded-lg appearance-none cursor-pointer accent-blue-500 hover:accent-blue-400 transition-colors border border-[#2E3444]"
                    title="Drag slider to scroll table horizontally"
                  />
                </div>

                <button
                  onClick={() => handleStepScroll(1)}
                  className="p-1 rounded bg-[#1E2230] text-[#9CA3AF] hover:text-[#F3F4F6] border border-[#2E3444] transition-colors cursor-pointer flex-shrink-0"
                  title="Pan right"
                >
                  <ChevronRight size={15} />
                </button>
                <button
                  onClick={() => handleJumpScroll(100)}
                  className="px-2 py-0.5 rounded text-[11px] font-medium bg-[#1E2230] text-[#9CA3AF] hover:text-[#F3F4F6] border border-[#2E3444] transition-colors cursor-pointer flex-shrink-0"
                  title="Jump to last column"
                >
                  End
                </button>
              </div>

              <div className="flex items-center gap-2 flex-shrink-0">
                <span className="text-[11px] font-mono px-2 py-0.5 rounded bg-[#1E2230] text-[#93C5FD] border border-[#2E3444]">
                  {Math.round(scrollPercent)}%
                </span>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Expandable Image Lightbox Modal */}
      {expandedImage && (
        <div
          onClick={() => {
            setExpandedImage(null);
            setImageZoom(1);
          }}
          className="fixed inset-0 z-50 bg-black/85 backdrop-blur-sm flex flex-col items-center justify-center p-4 sm:p-6 select-none"
        >
          {/* Modal Header Bar */}
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-4xl flex items-center justify-between mb-3 px-4 py-2.5 rounded-lg bg-[#151820] border border-[#272B35]"
          >
            <div className="flex items-center gap-2">
              <ImageIcon size={16} className="text-blue-400" />
              <span className="text-[13px] font-medium text-[#F3F4F6]">
                {expandedImage.tableName}
              </span>
              <span className="text-[11px] px-2 py-0.5 rounded bg-blue-500/10 text-blue-400 border border-blue-500/20 font-mono">
                {expandedImage.columnName} • Row #{expandedImage.rowIndex}
              </span>
            </div>

            <div className="flex items-center gap-2">
              {/* Zoom Controls */}
              <div className="flex items-center gap-1 bg-[#1E2230] px-2 py-1 rounded border border-[#2E3444]">
                <button
                  onClick={() => setImageZoom((z) => Math.max(0.5, z - 0.25))}
                  className="p-1 rounded text-[#9CA3AF] hover:text-[#F3F4F6] transition-colors cursor-pointer"
                  title="Zoom Out"
                >
                  <ZoomOut size={14} />
                </button>
                <span className="text-[11px] font-mono text-[#D1D5DB] w-10 text-center">
                  {Math.round(imageZoom * 100)}%
                </span>
                <button
                  onClick={() => setImageZoom((z) => Math.min(3, z + 0.25))}
                  className="p-1 rounded text-[#9CA3AF] hover:text-[#F3F4F6] transition-colors cursor-pointer"
                  title="Zoom In"
                >
                  <ZoomIn size={14} />
                </button>
                <button
                  onClick={() => setImageZoom(1)}
                  className="p-1 rounded text-[#9CA3AF] hover:text-[#F3F4F6] transition-colors cursor-pointer ml-1"
                  title="Reset Zoom"
                >
                  <RotateCcw size={13} />
                </button>
              </div>

              {/* Download Image Button */}
              <a
                href={expandedImage.src}
                download={`${expandedImage.tableName}_${expandedImage.columnName}_${expandedImage.rowIndex}.png`}
                className="p-1.5 rounded-md bg-[#1E2230] text-[#9CA3AF] hover:text-[#F3F4F6] border border-[#2E3444] transition-colors cursor-pointer"
                title="Download image"
              >
                <Download size={14} />
              </a>

              {/* Close Button */}
              <button
                onClick={() => {
                  setExpandedImage(null);
                  setImageZoom(1);
                }}
                className="p-1.5 rounded-md bg-[#1E2230] text-[#9CA3AF] hover:text-red-400 hover:bg-red-500/10 border border-[#2E3444] transition-colors cursor-pointer"
                title="Close (Esc)"
              >
                <X size={15} />
              </button>
            </div>
          </div>

          {/* Modal Image Viewport */}
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-4xl max-h-[80vh] flex items-center justify-center p-4 bg-[#0F1117] border border-[#272B35] rounded-xl overflow-auto"
          >
            <img
              src={expandedImage.src}
              alt={expandedImage.alt}
              style={{ transform: `scale(${imageZoom})`, transformOrigin: "center center" }}
              className="max-h-[72vh] max-w-full object-contain rounded-md transition-transform duration-150"
            />
          </div>
        </div>
      )}
    </div>
  );
}
