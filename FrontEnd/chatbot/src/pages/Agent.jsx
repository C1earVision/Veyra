import { useState, useEffect, useRef } from "react";
import axios from "axios";
import {
  Copy,
  Trash2,
  Search,
  Send,
  Square,
  MessageSquare,
  Package,
  LogOut,
  Check,
  Loader2,
  ArrowDown,
  Sparkles,
  TrendingUp,
  BarChart3,
  PackageSearch,
  Cpu,
  ArrowRight,
  RotateCcw,
  LayoutDashboard,
  AlertTriangle,
  Database,
  HardDrive,
  ChevronDown,
  Zap,
  Cloud,
  Monitor,
  History,
  Plus,
  PanelLeftClose,
  PanelLeftOpen
} from "lucide-react";
import { API_URL, AI_API_URL } from "../config/api";
import { useNavigate } from "react-router-dom";
import MarkdownContent, { ChartImage } from "../components/MarkdownContent";
import InteractiveDashboard from "../components/InteractiveDashboard";
import DataSourceModal from "../components/DataSourceModal";
import DataExplorer from "../components/DataExplorer";
import AgentThinking from "../components/AgentThinking";
import RecentChatsView from "../components/RecentChatsView";
import AppLoadingScreen from "../components/AppLoadingScreen";
import {
  getRecentChats,
  saveChatSession,
  deleteChatSession,
  clearAllChats,
  generateChatTitle,
  fetchUserRecentChats,
  getSavedActiveSource,
  saveActiveSource,
  getSavedActiveSession,
  saveActiveSession,
} from "../lib/chatStorage";
import { normalizeQueryResponse } from "../types/agentApi";
import {
  DEFAULT_SOURCE,
  fetchServerDataSources,
  reconcileSourceWithServer,
  sourceFromQueryResponse,
} from "../lib/dataSourceSync";
import { streamAgentQuery, streamDataPhase, streamAssemblyPhase } from "../lib/queryStream";
import { authHeaders, getStoredAuth } from "../lib/auth";

/* ─── URL normaliser (unchanged logic) ─── */
function normalizeVisualizationUrl(imageUrl) {
  if (!imageUrl || typeof imageUrl !== "string") return null;
  const trimmed = imageUrl.trim();
  if (!trimmed) return null;

  const aiBase = AI_API_URL.replace(/\/$/, "");
  if (trimmed.startsWith("/")) {
    return `${aiBase}${trimmed}`;
  }

  try {
    const apiOrigin = new URL(aiBase).origin;
    const parsed = new URL(trimmed);
    if (parsed.pathname.startsWith("/visualizations/")) {
      return `${apiOrigin}${parsed.pathname}`;
    }
  } catch {
    // keep original URL if parsing fails
  }

  return trimmed;
}

/* ─── Active background streams registry: Map<sessionId, StreamState> ─── */
const activeStreams = new Map();

/* ─── Agent label helper ─── */
function agentLabel(agent) {
  const map = {
    use_rag_agent: "RAG Agent",
    use_web_search_agent: "Search Agent",
    use_crud_agent: "CRUD Agent",
    use_data_analysis_and_visualization_agent: "Analysis Agent",
  };
  return map[agent] || agent;
}

/* ════════════════════════════════════════════════════════════════
   Dashboard — product catalog table
   ════════════════════════════════════════════════════════════════ */
function DashBoard() {
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [copiedId, setCopiedId] = useState(null);

  // Search states
  const [searchField, setSearchField] = useState("Name");
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("All");

  useEffect(() => {
    const fetchProducts = async () => {
      const user = JSON.parse(localStorage.getItem("user"));
      if (!user) {
        setError("Please log in first to view products");
        setLoading(false);
        return;
      }
      try {
        const res = await axios.get(`${API_URL}/products`, {
          headers: {
            Authorization: `Bearer ${user.token}`,
          },
        });
        setProducts(res.data.Products);
      } catch (err) {
        setError("Failed to load products");
      } finally {
        setLoading(false);
      }
    };

    fetchProducts();
  }, []);

  const handleCopy = async (id) => {
    try {
      await navigator.clipboard.writeText(id);
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 1500);
    } catch (err) {
      console.error("Failed to copy: ", err);
    }
  };

  const handleDelete = async (id) => {
    if (!window.confirm("Are you sure you want to delete this product?")) return;
    const user = JSON.parse(localStorage.getItem("user"));
    if (!user) {
      alert("You must be logged in");
      return;
    }
    try {
      await axios.delete(`${API_URL}/user/admin/${id}`, {
        headers: {
          Authorization: `Bearer ${user.token}`,
        },
      });
      setProducts((prev) => prev.filter((p) => p.ProductId !== id));
    } catch (err) {
      console.error("Failed to delete product:", err);
      alert("Failed to delete product");
    }
  };

  // Get unique categories for dropdown
  const categories = ["All", ...new Set(products.map((p) => p.Category))];

  // Filtering logic
  const filteredProducts = products.filter((p) => {
    const matchesSearch =
      searchField === "ID"
        ? p.ProductId.toString().toLowerCase().includes(searchTerm.toLowerCase())
        : p.Name.toLowerCase().includes(searchTerm.toLowerCase());

    const matchesCategory =
      selectedCategory === "All" || p.Category === selectedCategory;

    return matchesSearch && matchesCategory;
  });

  if (loading) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <Loader2 size={20} className="animate-spin text-[#9CA3AF]" />
        <span className="ml-2 text-[14px] text-[#9CA3AF]">Loading products…</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-1 items-center justify-center text-[14px] text-red-400">
        {error}
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col min-h-0 p-6">
      {/* Header */}
      <div className="mb-5">
        <h2 className="text-[18px] font-semibold text-[#F3F4F6]">Products</h2>
        <p className="text-[13px] text-[#6B7280] mt-0.5">
          {filteredProducts.length} {filteredProducts.length === 1 ? "item" : "items"}
          {selectedCategory !== "All" && ` in ${selectedCategory}`}
        </p>
      </div>

      {/* Filters */}
      <div className="flex flex-col md:flex-row gap-2 mb-4">
        <select
          value={searchField}
          onChange={(e) => setSearchField(e.target.value)}
          className="px-3 py-1.5 text-[13px] rounded-md bg-[#151820] text-[#D1D5DB] border border-[#272B35] focus:outline-none focus:border-[#2563EB] transition-colors"
        >
          <option value="Name">Name</option>
          <option value="ID">ID</option>
        </select>

        <div className="relative flex-1">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[#6B7280]" size={15} />
          <input
            type="text"
            placeholder={`Search by ${searchField.toLowerCase()}…`}
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-8 pr-3 py-1.5 text-[13px] rounded-md bg-[#151820] text-[#D1D5DB] border border-[#272B35] placeholder-[#4B5563] focus:outline-none focus:border-[#2563EB] transition-colors"
          />
        </div>

        <select
          value={selectedCategory}
          onChange={(e) => setSelectedCategory(e.target.value)}
          className="px-3 py-1.5 text-[13px] rounded-md bg-[#151820] text-[#D1D5DB] border border-[#272B35] focus:outline-none focus:border-[#2563EB] transition-colors"
        >
          {categories.map((cat, i) => (
            <option key={i} value={cat}>
              {cat}
            </option>
          ))}
        </select>
      </div>

      {/* Table */}
      <div className="flex-1 min-h-0 overflow-auto rounded-md border border-[#272B35]">
        <table className="w-full text-[13px]">
          <thead className="sticky top-0 z-10">
            <tr className="bg-[#151820] text-[#9CA3AF] text-left text-[12px] uppercase tracking-wider">
              <th className="px-4 py-2.5 font-medium">ID</th>
              <th className="px-4 py-2.5 font-medium">Name</th>
              <th className="px-4 py-2.5 font-medium">Price</th>
              <th className="px-4 py-2.5 font-medium">Category</th>
              <th className="px-4 py-2.5 font-medium">Brand</th>
              <th className="px-4 py-2.5 font-medium">Stock</th>
              <th className="px-4 py-2.5 font-medium w-[80px]"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#1E2230]">
            {filteredProducts.length > 0 ? (
              filteredProducts.map((p) => (
                <tr
                  key={p.ProductId}
                  className="text-[#D1D5DB] hover:bg-[#151820]/60 transition-colors"
                >
                  <td className="px-4 py-2.5 font-mono text-[12px] text-[#9CA3AF]">
                    {p.ProductId}
                  </td>
                  <td className="px-4 py-2.5 text-[#F3F4F6]">{p.Name}</td>
                  <td className="px-4 py-2.5">${p.Price}</td>
                  <td className="px-4 py-2.5">
                    <span className="inline-block px-1.5 py-0.5 text-[11px] rounded bg-[#1E2230] text-[#9CA3AF]">
                      {p.Category}
                    </span>
                  </td>
                  <td className="px-4 py-2.5">{p.Brand}</td>
                  <td className="px-4 py-2.5">{p.StockQuantity}</td>
                  <td className="px-4 py-2.5">
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => handleCopy(p.ProductId)}
                        className="p-1 rounded text-[#6B7280] hover:text-[#D1D5DB] hover:bg-[#272B35] transition-colors"
                        title="Copy ID"
                      >
                        {copiedId === p.ProductId ? (
                          <Check size={14} className="text-green-400" />
                        ) : (
                          <Copy size={14} />
                        )}
                      </button>
                      <button
                        onClick={() => handleDelete(p.ProductId)}
                        className="p-1 rounded text-[#6B7280] hover:text-red-400 hover:bg-red-400/10 transition-colors"
                        title="Delete product"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan="7" className="text-center py-8 text-[13px] text-[#6B7280]">
                  No products found
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}


/* ─── Prompt suggestion definitions ─── */
const PROMPT_SUGGESTIONS = [
  {
    icon: LayoutDashboard,
    badge: "bg-blue-500/10 text-blue-400 border border-blue-500/20",
    title: "Dashboard",
    prompt: "Generate a comprehensive multi-page business dashboard with revenue trends, category breakdown, and operational insights",
    description: "Multi-page interactive report with executive takeaways and KPIs",
  },
  {
    icon: TrendingUp,
    badge: "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20",
    title: "Top Performers",
    prompt: "Show me our top 5 best-selling products by order volume",
    description: "Analyze most popular hardware by order volume",
  },
  {
    icon: BarChart3,
    badge: "bg-purple-500/10 text-purple-400 border border-purple-500/20",
    title: "Sales & Charts",
    prompt: "Generate a chart of monthly sales revenue",
    description: "Create a visual revenue breakdown over time",
  },
  {
    icon: AlertTriangle,
    badge: "bg-amber-500/10 text-amber-400 border border-amber-500/20",
    title: "Low Stock Alert",
    prompt: "Which products have fewer than 15 units remaining in stock? Show them in a table",
    description: "Identify inventory items needing immediate restocking",
  },
];

/* ════════════════════════════════════════════════════════════════
   ChatView — agent chat interface
   ════════════════════════════════════════════════════════════════ */
function ChatView({
  activeSource,
  onOpenSourceModal,
  selectedModel,
  messages,
  currentChatId,
  onNewChat,
  isSidebarOpen,
  onToggleSidebar,
  sendMessage,
  stopGeneration,
  isStreaming,
}) {
  const [input, setInput] = useState("");
  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);
  const chatContainerRef = useRef(null);
  const [showScrollBtn, setShowScrollBtn] = useState(false);

  const loading = Boolean(isStreaming || messages.some((m) => m.isLoading));

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  // Track scroll position to show/hide scroll-to-bottom button
  useEffect(() => {
    const container = chatContainerRef.current;
    if (!container) return;
    const handleScroll = () => {
      const distanceFromBottom = container.scrollHeight - container.scrollTop - container.clientHeight;
      setShowScrollBtn(distanceFromBottom > 100);
    };
    container.addEventListener("scroll", handleScroll);
    return () => container.removeEventListener("scroll", handleScroll);
  }, []);

  // Reset textarea height whenever input is cleared
  useEffect(() => {
    if (!input && inputRef.current) {
      inputRef.current.style.height = "auto";
    }
  }, [input]);

  const handleSend = (customPrompt) => {
    const textToSend = typeof customPrompt === "string" ? customPrompt : input;
    if (!textToSend || !textToSend.trim() || loading) return;
    setInput("");
    if (inputRef.current) {
      inputRef.current.style.height = "auto";
    }
    sendMessage(textToSend);
    inputRef.current?.focus();
  };

  const handleStop = () => {
    stopGeneration(currentChatId);
    inputRef.current?.focus();
  };

  const handleKeyPress = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };



  return (
    <div className="flex-1 flex flex-col min-h-0">

      {/* Messages area */}
      <div
        ref={chatContainerRef}
        className="flex-1 overflow-y-auto px-4 sm:px-6 py-6 relative"
      >
        {messages.length === 0 ? (
          /* Empty state: Hero + Prompt suggestion cards */
          <div className="flex flex-col items-center justify-center min-h-[65vh] max-w-3xl mx-auto px-4 text-center my-auto">
            {/* Hero Icon */}
            <div className="w-12 h-12 rounded-2xl bg-gradient-to-tr from-blue-600/20 to-indigo-500/10 border border-blue-500/30 flex items-center justify-center mb-4 text-[#3B82F6] shadow-sm">
              <Sparkles size={22} />
            </div>

            <h1 className="text-[20px] font-semibold text-[#F3F4F6] tracking-tight">
              How can I assist your business today?
            </h1>
            <p className="text-[13.5px] text-[#9CA3AF] mt-1.5 mb-8 max-w-md">
              Ask about inventory, best selling products, sales figures, or request visual charts and tables.
            </p>

            {/* Prompt Cards Grid */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 w-full text-left">
              {PROMPT_SUGGESTIONS.map((card, idx) => (
                <button
                  key={idx}
                  onClick={() => handleSend(card.prompt)}
                  disabled={loading}
                  className="group relative p-4 rounded-xl bg-[#151820] border border-[#272B35] hover:border-[#3B82F6]/60 hover:bg-[#181C26] transition-all duration-150 flex flex-col justify-between text-left disabled:opacity-50 cursor-pointer shadow-sm"
                >
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2.5">
                      <span className={`p-1.5 rounded-lg ${card.badge}`}>
                        <card.icon size={15} />
                      </span>
                      <span className="text-[13px] font-medium text-[#E5E7EB] group-hover:text-blue-400 transition-colors">
                        {card.title}
                      </span>
                    </div>
                    <ArrowRight
                      size={14}
                      className="text-[#6B7075] opacity-0 group-hover:opacity-100 group-hover:translate-x-0.5 transition-all"
                    />
                  </div>
                  <p className="text-[12.5px] text-[#9CA3AF] group-hover:text-[#D1D5DB] transition-colors leading-snug">
                    “{card.prompt}”
                  </p>
                </button>
              ))}
            </div>

            {/* Connect Database */}
            <button
              onClick={onOpenSourceModal}
              className="flex items-center gap-2 px-5 py-2.5 mt-8 text-[13px] font-medium text-blue-400 bg-blue-500/10 border border-blue-500/20 hover:bg-blue-500/20 hover:border-blue-500/40 rounded-lg transition-all cursor-pointer group"
            >
              <Database size={15} className="group-hover:scale-110 transition-transform" />
              <span>Connect Database</span>
            </button>
          </div>
        ) : (
          /* Active conversation transcript */
          <div className="w-full max-w-5xl mx-auto space-y-6">
            {messages.map((msg, i) => (
              <div key={i}>
                {msg.role === "User_Message" ? (
                  /* User message */
                  <div className="flex justify-end">
                    <div className="max-w-[80%] sm:max-w-[70%] px-4 py-2.5 rounded-lg bg-[#1E2230] text-[14px] text-[#F3F4F6] leading-relaxed whitespace-pre-wrap break-words font-sans">
                      {msg.content}
                    </div>
                  </div>
                ) : (
                  /* AI message */
                  <div className="flex justify-start">
                    <div className="w-full">
                      {msg.isLoading ? (
                        <AgentThinking
                          thinking={msg.thinking}
                          steps={msg.steps}
                          streaming
                          statusText={msg.streamStatus || "Thinking…"}
                        />
                      ) : (() => {
                        const dashboardSpec = msg.dashboard || null;
                        const displayContent = msg.content;
                        return (
                          <>
                            <AgentThinking
                              thinking={msg.thinking}
                              steps={msg.steps}
                            />
                            {displayContent && (
                              <MarkdownContent content={displayContent} />
                            )}
                            {dashboardSpec && (
                              <InteractiveDashboard spec={dashboardSpec} />
                            )}
                            {msg.image && (
                              <ChartImage
                                src={msg.image}
                                alt="Generated visualization"
                              />
                            )}
                            {msg.agent && (
                              <div className="mt-1.5 flex items-center gap-2 text-[11px] text-[#6B7280]">
                                <span>via {agentLabel(msg.agent)}</span>
                                {msg.source_name && (
                                  <>
                                    <span>•</span>
                                    <span className="text-[#9CA3AF] flex items-center gap-1">
                                      <Database size={11} /> {msg.source_name}
                                    </span>
                                  </>
                                )}
                              </div>
                            )}
                          </>
                        );
                      })()}
                    </div>
                  </div>
                )}
              </div>
            ))}
            <div ref={messagesEndRef} />
          </div>
        )}

        {/* Scroll-to-bottom button */}
        {showScrollBtn && (
          <button
            onClick={scrollToBottom}
            className="sticky bottom-4 left-1/2 -translate-x-1/2 p-2 rounded-full bg-[#272B35] text-[#9CA3AF] hover:text-[#F3F4F6] hover:bg-[#353a47] transition-colors shadow-lg"
          >
            <ArrowDown size={16} />
          </button>
        )}
      </div>

      {/* Input area */}
      <div className="border-t border-[#1E2230] px-4 sm:px-6 py-4">
        <div className="w-full max-w-5xl mx-auto flex items-end gap-2.5">
          <textarea
            ref={inputRef}
            placeholder="Ask anything about your business…"
            value={input}
            onChange={(e) => {
              setInput(e.target.value);
              // Auto-resize: reset height then set to scrollHeight
              e.target.style.height = "auto";
              if (e.target.value) {
                e.target.style.height = Math.min(e.target.scrollHeight, 200) + "px";
              }
            }}
            onKeyDown={handleKeyPress}
            disabled={loading}
            rows={1}
            className="flex-1 px-3.5 py-2.5 text-[14px] text-[#F3F4F6] bg-[#151820] border border-[#272B35] rounded-lg placeholder-[#4B5563] focus:outline-none focus:border-[#2563EB] disabled:opacity-50 transition-colors resize-none leading-relaxed overflow-y-auto"
            style={{ maxHeight: "200px" }}
          />
          <button
            onClick={() => (loading ? handleStop() : handleSend())}
            disabled={!input.trim() && !loading}
            className="flex items-center justify-center w-9 h-9 flex-shrink-0 rounded-lg bg-[#2563EB] text-white hover:bg-[#1D4ED8] disabled:opacity-40 disabled:cursor-not-allowed transition-colors mb-[1px]"
            title={loading ? "Stop generation" : "Send message"}
          >
            {loading ? (
              <Square size={16} />
            ) : (
              <Send size={16} />
            )}
          </button>
        </div>
      </div>
    </div>
  );
}


/* ════════════════════════════════════════════════════════════════
   Main Layout — sidebar + content area
   ════════════════════════════════════════════════════════════════ */
export default function App() {
  const [page, setPage] = useState("agent");
  const [isSourceModalOpen, setIsSourceModalOpen] = useState(false);
  const [initialSession] = useState(() => getSavedActiveSession());
  const [messages, setMessages] = useState(() => initialSession.messages || []);
  const [currentChatId, setCurrentChatId] = useState(() => initialSession.chatId || null);
  const [recentChats, setRecentChats] = useState(() => getRecentChats());
  const [isSidebarOpen, setIsSidebarOpen] = useState(() => {
    try {
      const stored = localStorage.getItem("sidebarOpen");
      return stored !== "false";
    } catch {
      return true;
    }
  });

  const toggleSidebar = () => {
    setIsSidebarOpen((prev) => {
      const next = !prev;
      try {
        localStorage.setItem("sidebarOpen", String(next));
      } catch (e) {
        console.error("Failed to persist sidebarOpen:", e);
      }
      return next;
    });
  };

  const [activeSource, setActiveSource] = useState(() => getSavedActiveSource());

  // Application initialization loading state
  const [isAppLoading, setIsAppLoading] = useState(true);
  const [modelsStatus, setModelsStatus] = useState("loading"); // "loading" | "ready" | "error"
  const [sourcesStatus, setSourcesStatus] = useState("loading"); // "loading" | "ready" | "error"

  // Model selection state
  const [availableModels, setAvailableModels] = useState([]);
  const [selectedModel, setSelectedModel] = useState(() => {
    try {
      return localStorage.getItem("selectedModel") || "";
    } catch {
      return "";
    }
  });
  const [isModelDropdownOpen, setIsModelDropdownOpen] = useState(false);
  const modelDropdownRef = useRef(null);
  const liveChatIdRef = useRef(null);
  const [activeStreamIds, setActiveStreamIds] = useState(() => new Set());
  const currentChatIdRef = useRef(currentChatId);
  const pageRef = useRef(page);

  useEffect(() => {
    currentChatIdRef.current = currentChatId;
  }, [currentChatId]);

  useEffect(() => {
    pageRef.current = page;
  }, [page]);

  const navigate = useNavigate();

  useEffect(() => {
    if (!localStorage.getItem("messages")) {
      localStorage.setItem("messages", JSON.stringify(["Context: "]));
    }
    localStorage.setItem("admin", JSON.stringify(false));
  }, []);

  // Close model dropdown on outside click
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (modelDropdownRef.current && !modelDropdownRef.current.contains(e.target)) {
        setIsModelDropdownOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleModelSelect = (modelId) => {
    setSelectedModel(modelId);
    localStorage.setItem("selectedModel", modelId);
    setIsModelDropdownOpen(false);
  };

  const handleSelectSource = (source) => {
    const next = source?.source_id ? source : DEFAULT_SOURCE;
    setActiveSource(next);
    saveActiveSource(next);
  };

  const syncActiveSourceWithServer = async (preferred) => {
    try {
      const serverList = await fetchServerDataSources();
      const base = preferred || activeSource;
      const reconciled = reconcileSourceWithServer(base, serverList);
      if (reconciled.source_id !== (base?.source_id || "default")) {
        console.info(
          "[DataSource] Stale connection reset:",
          base?.source_id,
          "→",
          reconciled.source_id
        );
      }
      handleSelectSource(reconciled);
      return { serverList, reconciled };
    } catch (err) {
      console.error("Failed to sync data source with server:", err);
      return { serverList: [], reconciled: activeSource };
    }
  };

  // Orchestrated startup: fetch models and active sources before application starts
  const bootstrapApplication = async () => {
    setIsAppLoading(true);
    setModelsStatus("loading");
    setSourcesStatus("loading");

    // Task 1: Fetch available AI models
    const modelsTask = (async () => {
      try {
        const res = await axios.get(`${AI_API_URL}/models`, {
          headers: authHeaders(),
        });
        if (res.data?.models) {
          setAvailableModels(res.data.models);
          if (!selectedModel && res.data.models.length > 0) {
            const defaultId = res.data.models[0].id;
            setSelectedModel(defaultId);
            localStorage.setItem("selectedModel", defaultId);
          }
        }
        setModelsStatus("ready");
        return res.data?.models || [];
      } catch (err) {
        console.error("Failed to fetch available models:", err);
        setModelsStatus("error");
        return [];
      }
    })();

    // Task 2: Synchronize active data source with server
    const sourcesTask = (async () => {
      try {
        const savedSource = getSavedActiveSource();
        const res = await syncActiveSourceWithServer(savedSource);
        setSourcesStatus("ready");
        return res;
      } catch (err) {
        console.error("Failed to sync active source with server:", err);
        setSourcesStatus("error");
        return null;
      }
    })();

    // Task 3: Sync recent chats
    const chatsTask = (async () => {
      try {
        const chats = await fetchUserRecentChats();
        if (Array.isArray(chats) && chats.length > 0) {
          setRecentChats(chats);
          const activeState = getSavedActiveSession();
          if ((!activeState.messages || activeState.messages.length === 0) && !currentChatIdRef.current) {
            const latest = chats[0];
            setCurrentChatId(latest.id);
            currentChatIdRef.current = latest.id;
            setMessages(latest.messages || []);
            if (latest.contextMessages) {
              localStorage.setItem("messages", JSON.stringify(latest.contextMessages));
            }
            if (latest.source) {
              handleSelectSource(latest.source);
            }
          }
        }
      } catch (err) {
        console.error("Failed to sync recent chats:", err);
      }
    })();

    await Promise.allSettled([modelsTask, sourcesTask, chatsTask]);

    // Smooth transition buffer so completed state is visible before transition
    setTimeout(() => {
      setIsAppLoading(false);
    }, 400);
  };

  useEffect(() => {
    // If active messages are empty, but user has recent chats, restore latest chat session
    const activeState = getSavedActiveSession();
    if (activeState.messages && activeState.messages.length > 0) {
      setMessages(activeState.messages);
      if (activeState.chatId) setCurrentChatId(activeState.chatId);
      if (activeState.contextMessages) {
        localStorage.setItem("messages", JSON.stringify(activeState.contextMessages));
      }
    } else {
      const storedChats = getRecentChats();
      if (storedChats.length > 0 && !currentChatId) {
        const latest = storedChats[0];
        setCurrentChatId(latest.id);
        setMessages(latest.messages || []);
        if (latest.contextMessages) {
          localStorage.setItem("messages", JSON.stringify(latest.contextMessages));
        }
        if (latest.source) {
          handleSelectSource(latest.source);
        }
      }
    }

    bootstrapApplication();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSaveChatSession = (session) => {
    const updated = saveChatSession(session);
    setRecentChats(updated);
    if (!currentChatId || session.id === currentChatId) {
      saveActiveSession(
        session.messages || [],
        session.id,
        session.contextMessages
      );
    }
  };

  const sendMessage = async (textToSend) => {
    if (!textToSend || !textToSend.trim()) return;

    const sessionId = currentChatId || `chat_${Date.now()}`;
    liveChatIdRef.current = sessionId;
    if (!currentChatId) {
      setCurrentChatId(sessionId);
      currentChatIdRef.current = sessionId;
    }

    const newMessage = { role: "User_Message", content: textToSend };
    let storedMessages = ["Context: "];
    try {
      storedMessages = JSON.parse(localStorage.getItem("messages")) || ["Context: "];
    } catch (e) {}
    storedMessages.push(`${newMessage.role}: ${newMessage.content};`);
    localStorage.setItem("messages", JSON.stringify(storedMessages));

    const loadingMessage = {
      role: "AI_Message",
      content: "",
      isLoading: true,
      streaming: true,
      thinking: "",
      steps: [],
      streamStatus: "Connecting…",
    };

    const newMessages = [...messages, newMessage, loadingMessage];
    setMessages(newMessages);

    // Early-save session so it is preserved if the page is reloaded
    const earlyMessages = [...messages, newMessage];
    const earlyTitle = generateChatTitle(textToSend);
    handleSaveChatSession({
      id: sessionId,
      title: earlyTitle,
      createdAt: new Date().toISOString(),
      source: activeSource,
      modelId: selectedModel,
      messages: earlyMessages,
      contextMessages: storedMessages,
    });

    const abortController = new AbortController();
    activeStreams.set(sessionId, {
      sessionId,
      abortController,
      userStopped: false,
      thinking: "",
      steps: [],
      streamStatus: "Connecting…",
      messages: newMessages,
      contextMessages: storedMessages,
      source: activeSource,
      modelId: selectedModel,
    });
    setActiveStreamIds((prev) => new Set(prev).add(sessionId));

    try {
      const session = getStoredAuth();
      if (!session) {
        const errorMessages = newMessages
          .filter((msg) => !msg.isLoading)
          .concat({ role: "AI_Message", content: "Please log in first to use the agent." });
        if (pageRef.current === "agent" && currentChatIdRef.current === sessionId) {
          setMessages(errorMessages);
        }
        activeStreams.delete(sessionId);
        setActiveStreamIds((prev) => {
          const next = new Set(prev);
          next.delete(sessionId);
          return next;
        });
        return;
      }

      const payLoad = {
        question: storedMessages.join(" "),
        source_id: activeSource?.source_id,
        model_id: selectedModel || null,
      };

      let payload = null;

      // ─── Shared SSE event handler for both phases ───
      const handleStreamEvent = (type, data) => {
        const stream = activeStreams.get(sessionId);
        if (!stream || stream.userStopped) return;

        if (type === "thinking_delta" && data.text) {
          stream.thinking += data.text;
          if (data.phase === "router") {
            stream.streamStatus = "Routing…";
          }
          stream.messages = stream.messages.map((msg) =>
            msg.isLoading
              ? {
                  ...msg,
                  thinking: stream.thinking,
                  streamStatus: stream.streamStatus,
                }
              : msg
          );
          if (pageRef.current === "agent" && currentChatIdRef.current === sessionId) {
            setMessages(stream.messages);
          }
        } else if (type === "step" && data.step) {
          stream.steps = [...stream.steps, data.step];
          stream.streamStatus = `${data.step.label}…`;
          stream.messages = stream.messages.map((msg) =>
            msg.isLoading
              ? {
                  ...msg,
                  steps: stream.steps,
                  streamStatus: stream.streamStatus,
                }
              : msg
          );
          if (pageRef.current === "agent" && currentChatIdRef.current === sessionId) {
            setMessages(stream.messages);
          }
        } else if (type === "status" && data.text) {
          stream.streamStatus = data.text;
          stream.messages = stream.messages.map((msg) =>
            msg.isLoading ? { ...msg, streamStatus: stream.streamStatus } : msg
          );
          if (pageRef.current === "agent" && currentChatIdRef.current === sessionId) {
            setMessages(stream.messages);
          }
        } else if (type === "error") {
          console.error("[stream error event received]", data);
          if (data.error === "cancelled") {
            const cancelled = new Error("cancelled");
            cancelled.name = "AbortError";
            throw cancelled;
          }
          const errorMsg =
            data.error ||
            data.detail ||
            data.raw ||
            (typeof data === "string" ? data : JSON.stringify(data));
          throw new Error(errorMsg || "Stream failed");
        }
      };

      // ─── Checkpoint Strategy: Two-phase streaming ───
      // Phase 1: Data phase (Router → Schema → SQL → Execution)
      let dataPhaseResult = null;

      await streamDataPhase(AI_API_URL, payLoad, {
        signal: abortController.signal,
        headers: authHeaders(),
        onEvent: (type, data) => {
          if (type === "done") {
            // Non-BI agent or single-chart path completed fully
            payload = normalizeQueryResponse(data.final_response);
          } else if (type === "data_phase_done") {
            // BI dashboard: data phase complete, need assembly
            dataPhaseResult = data.data_phase_result;
          } else {
            handleStreamEvent(type, data);
          }
        },
      });

      // Phase 2: Assembly phase (if needed — fresh Vercel timeout window)
      if (dataPhaseResult && !payload) {
        const stream = activeStreams.get(sessionId);
        if (stream && !stream.userStopped) {
          stream.streamStatus = "Designing dashboard layout…";
          stream.messages = stream.messages.map((msg) =>
            msg.isLoading ? { ...msg, streamStatus: stream.streamStatus } : msg
          );
          if (pageRef.current === "agent" && currentChatIdRef.current === sessionId) {
            setMessages(stream.messages);
          }

          const assemblyPayload = {
            data_phase_result: dataPhaseResult,
            model_id: selectedModel || null,
            source_id: activeSource?.source_id,
          };

          await streamAssemblyPhase(AI_API_URL, assemblyPayload, {
            signal: abortController.signal,
            headers: authHeaders(),
            onEvent: (type, data) => {
              if (type === "done") {
                payload = normalizeQueryResponse(data);
              } else {
                handleStreamEvent(type, data);
              }
            },
          });
        }
      }

      const stream = activeStreams.get(sessionId);
      if (!stream || stream.userStopped) return;

      if (!payload) {
        // If the user navigated away during streaming and no done event was received,
        // silently return instead of throwing — the stream will continue in the background
        if (currentChatIdRef.current !== sessionId) return;
        throw new Error("No response from agent stream");
      }

      const mergeThinking = (finalThinking, live) => {
        if (!finalThinking) return live;
        if (!live) return finalThinking;
        return live.includes(finalThinking) ? live : `${live}\n\n---\n\n${finalThinking}`;
      };

      const resolvedSource = sourceFromQueryResponse(payload);
      const sessionSource = resolvedSource || stream.source || activeSource;
      if (
        resolvedSource &&
        pageRef.current === "agent" &&
        currentChatIdRef.current === sessionId
      ) {
        handleSelectSource(resolvedSource);
      }

      const imageUrl = normalizeVisualizationUrl(payload.image);
      const aiMessage = {
        role: "AI_Message",
        content: payload.answer,
        agent: payload.agent,
        source_name: payload.source_name,
        thinking: mergeThinking(payload.thinking, stream.thinking),
        steps: payload.steps?.length ? payload.steps : stream.steps,
        ...(imageUrl ? { image: imageUrl } : {}),
        ...(payload.dashboard ? { dashboard: payload.dashboard } : {}),
      };

      const finalMessages = stream.messages
        .filter((msg) => !msg.isLoading)
        .concat(aiMessage);

      const updatedContext = [...(stream.contextMessages || ["Context: "])];
      updatedContext.push(`${aiMessage.role}: ${aiMessage.content};`);

      if (pageRef.current === "agent" && currentChatIdRef.current === sessionId) {
        setMessages(finalMessages);
        localStorage.setItem("messages", JSON.stringify(updatedContext));
      }

      const firstUser = finalMessages.find((m) => m.role === "User_Message");
      const title = generateChatTitle(firstUser?.content);
      handleSaveChatSession({
        id: sessionId,
        title,
        createdAt: new Date().toISOString(),
        source: sessionSource,
        modelId: stream.modelId || selectedModel,
        messages: finalMessages,
        contextMessages: updatedContext,
      });
    } catch (err) {
      if (err.name === "AbortError" || axios.isCancel(err)) {
        return;
      }
      // If the user navigated away from this session, suppress the error
      // as the stream will continue in the background
      const stream = activeStreams.get(sessionId);
      if (stream?.userStopped) return;
      console.error("[Agent sendMessage error]:", err);
      const prevList = stream?.messages || messages;
      const displayError = err.message || err.response?.data?.error || "Please try again.";
      const finalMessages = prevList
        .filter((msg) => !msg.isLoading)
        .concat({
          role: "AI_Message",
          content: `AI Error: ${displayError}, This request took more than 300 seconds to finish which exceedes Vercel free limit. Try again in a while.`,
        });

      if (pageRef.current === "agent" && currentChatIdRef.current === sessionId) {
        setMessages(finalMessages);
      }

      const firstUser = finalMessages.find((m) => m.role === "User_Message");
      const title = generateChatTitle(firstUser?.content);
      handleSaveChatSession({
        id: sessionId,
        title,
        createdAt: new Date().toISOString(),
        source: stream?.source || activeSource,
        modelId: stream?.modelId || selectedModel,
        messages: finalMessages,
        contextMessages: stream?.contextMessages || [],
      });
    } finally {
      activeStreams.delete(sessionId);
      setActiveStreamIds((prev) => {
        const next = new Set(prev);
        next.delete(sessionId);
        return next;
      });
      setRecentChats(getRecentChats());
    }
  };

  const stopGeneration = (targetSessionId) => {
    const sid = targetSessionId || currentChatId;
    const stream = activeStreams.get(sid);
    if (stream) {
      stream.userStopped = true;
      if (stream.abortController) {
        stream.abortController.abort();
      }
      const finalMessages = stream.messages
        .filter((m) => !m.isLoading)
        .concat({ role: "AI_Message", content: "Generation stopped." });

      if (pageRef.current === "agent" && currentChatIdRef.current === sid) {
        setMessages(finalMessages);
      }

      const firstUser = finalMessages.find((m) => m.role === "User_Message");
      const title = generateChatTitle(firstUser?.content);
      handleSaveChatSession({
        id: sid,
        title,
        createdAt: new Date().toISOString(),
        source: stream.source || activeSource,
        modelId: stream.modelId || selectedModel,
        messages: finalMessages,
        contextMessages: stream.contextMessages || [],
      });

      activeStreams.delete(sid);
      setActiveStreamIds((prev) => {
        const next = new Set(prev);
        next.delete(sid);
        return next;
      });
      setRecentChats(getRecentChats());
    } else {
      setMessages((prev) => {
        const filtered = prev.filter((m) => !m.isLoading);
        return [...filtered, { role: "AI_Message", content: "Generation stopped." }];
      });
    }
  };

  const isCurrentChatStreaming = Boolean(
    (currentChatId && activeStreamIds.has(currentChatId)) ||
    messages.some((m) => m.isLoading)
  );

  const handleSelectChat = async (chat) => {
    // Save current chat as the live chat before switching
    if (currentChatId && messages.length > 0) {
      liveChatIdRef.current = currentChatId;
    }

    // If chat is currently streaming, restore its live stream state immediately
    if (activeStreams.has(chat.id)) {
      const stream = activeStreams.get(chat.id);
      setCurrentChatId(stream.sessionId);
      currentChatIdRef.current = stream.sessionId;
      setMessages(stream.messages);
      if (stream.contextMessages) {
        localStorage.setItem("messages", JSON.stringify(stream.contextMessages));
      }
      saveActiveSession(
        stream.messages,
        stream.sessionId,
        stream.contextMessages || ["Context: "]
      );
      if (stream.source) {
        await syncActiveSourceWithServer(stream.source);
      }
      if (stream.modelId) {
        setSelectedModel(stream.modelId);
        localStorage.setItem("selectedModel", stream.modelId);
      }
      setPage("agent");
      return;
    }

    // Re-read from storage in case a background streaming response has
    // updated this session since the sidebar was last rendered.
    const freshChats = getRecentChats();
    const freshChat = freshChats.find((c) => c.id === chat.id) || chat;
    setRecentChats(freshChats);

    setCurrentChatId(freshChat.id);
    currentChatIdRef.current = freshChat.id;
    setMessages(freshChat.messages || []);
    if (freshChat.contextMessages) {
      localStorage.setItem("messages", JSON.stringify(freshChat.contextMessages));
    }
    saveActiveSession(
      freshChat.messages || [],
      freshChat.id,
      freshChat.contextMessages || ["Context: "]
    );

    if (freshChat.source) {
      await syncActiveSourceWithServer(freshChat.source);
    } else {
      await syncActiveSourceWithServer(activeSource);
    }
    if (freshChat.modelId) {
      setSelectedModel(freshChat.modelId);
      localStorage.setItem("selectedModel", freshChat.modelId);
    }
    setPage("agent");
  };

  // Re-fetch recent chats from storage periodically to pick up
  // any sessions saved by a background streaming response
  useEffect(() => {
    const interval = setInterval(() => {
      const latest = getRecentChats();
      setRecentChats(latest);
    }, 3000);
    return () => clearInterval(interval);
  }, []);

  // Sync recent chats from server when tab/window is focused across devices
  useEffect(() => {
    const handleFocus = () => {
      fetchUserRecentChats().then((chats) => {
        if (Array.isArray(chats) && chats.length > 0) {
          setRecentChats(chats);
        }
      });
    };
    window.addEventListener("focus", handleFocus);
    return () => window.removeEventListener("focus", handleFocus);
  }, []);

  const handleDeleteChat = (chatId) => {
    if (activeStreams.has(chatId)) {
      const stream = activeStreams.get(chatId);
      if (stream.abortController) {
        stream.abortController.abort();
      }
      activeStreams.delete(chatId);
      setActiveStreamIds((prev) => {
        const next = new Set(prev);
        next.delete(chatId);
        return next;
      });
    }
    if (liveChatIdRef.current === chatId) {
      liveChatIdRef.current = null;
    }
    const updated = deleteChatSession(chatId);
    setRecentChats(updated);
    if (currentChatId === chatId) {
      handleNewChat();
    }
  };

  const handleClearAllChats = () => {
    for (const [id, stream] of activeStreams.entries()) {
      if (stream.abortController) {
        stream.abortController.abort();
      }
    }
    activeStreams.clear();
    setActiveStreamIds(new Set());
    liveChatIdRef.current = null;
    clearAllChats();
    setRecentChats([]);
    handleNewChat();
  };

  const handleNewChat = () => {
    if (currentChatId && messages.length > 0) {
      liveChatIdRef.current = currentChatId;
    }
    setCurrentChatId(null);
    currentChatIdRef.current = null;
    setMessages([]);
    localStorage.setItem("messages", JSON.stringify(["Context: "]));
    saveActiveSession([], null, ["Context: "]);
    setPage("agent");
  };

  const handleGoToCurrentChat = () => {
    // If there is an active stream, prioritize returning to it
    const targetId =
      (liveChatIdRef.current && activeStreams.has(liveChatIdRef.current) && liveChatIdRef.current) ||
      (activeStreams.size > 0 ? activeStreams.keys().next().value : null) ||
      liveChatIdRef.current;

    if (targetId) {
      if (activeStreams.has(targetId)) {
        const stream = activeStreams.get(targetId);
        setCurrentChatId(stream.sessionId);
        currentChatIdRef.current = stream.sessionId;
        setMessages(stream.messages);
        if (stream.contextMessages) {
          localStorage.setItem("messages", JSON.stringify(stream.contextMessages));
        }
        saveActiveSession(
          stream.messages,
          stream.sessionId,
          stream.contextMessages || ["Context: "]
        );
        if (stream.source) {
          syncActiveSourceWithServer(stream.source);
        }
        if (stream.modelId) {
          setSelectedModel(stream.modelId);
          localStorage.setItem("selectedModel", stream.modelId);
        }
        setPage("agent");
        return;
      }

      const freshChats = getRecentChats();
      const liveChat = freshChats.find((c) => c.id === targetId);
      if (liveChat) {
        setCurrentChatId(liveChat.id);
        currentChatIdRef.current = liveChat.id;
        setMessages(liveChat.messages || []);
        if (liveChat.contextMessages) {
          localStorage.setItem("messages", JSON.stringify(liveChat.contextMessages));
        }
        saveActiveSession(
          liveChat.messages || [],
          liveChat.id,
          liveChat.contextMessages || ["Context: "]
        );
        if (liveChat.source) {
          syncActiveSourceWithServer(liveChat.source);
        }
        if (liveChat.modelId) {
          setSelectedModel(liveChat.modelId);
          localStorage.setItem("selectedModel", liveChat.modelId);
        }
        setPage("agent");
        return;
      }
    }
    // No live chat to restore — just go to agent page
    setPage("agent");
  };

  const user = (() => {
    try {
      const data = JSON.parse(localStorage.getItem("user"));
      return data?.user || null;
    } catch {
      return null;
    }
  })();

  const handleLogout = () => {
    for (const [id, stream] of activeStreams.entries()) {
      if (stream.abortController) {
        stream.abortController.abort();
      }
    }
    activeStreams.clear();
    setActiveStreamIds(new Set());

    // Preserve current active session and source for current user before logging out
    if (messages.length > 0) {
      let ctx = ["Context: "];
      try {
        ctx = JSON.parse(localStorage.getItem("messages") || '["Context: "]');
      } catch (e) {}
      saveActiveSession(messages, currentChatId, ctx);
    }
    if (activeSource) {
      saveActiveSource(activeSource);
    }
    // Remove authentication session and reset active in-memory state to avoid cross-user bleed
    localStorage.removeItem("user");
    localStorage.removeItem("admin");
    localStorage.removeItem("activeSource");
    localStorage.removeItem("messages");
    setMessages([]);
    setCurrentChatId(null);
    setActiveSource(DEFAULT_SOURCE);
    navigate("/");
  };

  if (isAppLoading) {
    return (
      <AppLoadingScreen
        modelsStatus={modelsStatus}
        sourcesStatus={sourcesStatus}
        modelsCount={availableModels.length}
        activeSource={activeSource}
        onRetry={bootstrapApplication}
        onContinue={() => setIsAppLoading(false)}
      />
    );
  }

  return (
    <div className="flex h-screen bg-[#0F1117] text-[#F3F4F6] overflow-hidden">
      {/* ─── Sidebar (ChatGPT / Claude style) ─── */}
      <aside
        className={`flex-shrink-0 flex flex-col h-full bg-[#0F1117] transition-[width,border-color] duration-200 ease-in-out overflow-hidden z-20 ${isSidebarOpen ? "w-64 border-r border-[#1E2230]" : "w-0 border-r-0"
          }`}
      >
        <div className="w-64 flex flex-col h-full min-h-0 flex-shrink-0">
          {/* Header: Logo + Collapse Button + New Chat */}
          <div className="p-3 border-b border-[#1E2230]/60 space-y-2.5 flex-shrink-0">
            <div className="flex items-center justify-between px-1">
              <div className="flex items-center gap-2">
                <span className="text-[16px] font-semibold tracking-tight text-[#F3F4F6]">
                  Veyra
                </span>
                <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-400 border border-blue-500/20">
                  BI
                </span>
              </div>
              <button
                onClick={toggleSidebar}
                className="p-1.5 rounded-lg text-[#9CA3AF] hover:text-[#F3F4F6] hover:bg-[#1E2230] transition-colors cursor-pointer"
                title="Collapse sidebar"
              >
                <PanelLeftClose size={16} />
              </button>
            </div>

            <button
              onClick={handleNewChat}
              className="w-full flex items-center justify-between px-3 py-2 rounded-lg bg-[#151820] hover:bg-[#1C202C] border border-[#272B35] hover:border-blue-500/40 text-[13px] font-medium text-[#F3F4F6] transition-all cursor-pointer group shadow-sm"
            >
              <div className="flex items-center gap-2">
                <Plus size={15} className="text-blue-400 group-hover:scale-110 transition-transform" />
                <span>New Chat</span>
              </div>
              <span className="text-[10px] text-[#6B7280] font-mono border border-[#272B35] rounded px-1.5 py-0.5">
                +
              </span>
            </button>
          </div>

          {/* Navigation & Tools */}
          <div className="px-3 py-2 border-b border-[#1E2230]/60 space-y-1 flex-shrink-0">
            <button
              onClick={handleGoToCurrentChat}
              className={`w-full flex items-center gap-2.5 px-3 py-1.5 rounded-md text-[13px] font-medium transition-colors cursor-pointer ${page === "agent" && !currentChatId
                ? "bg-[#2563EB]/10 text-[#3B82F6]"
                : "text-[#9CA3AF] hover:text-[#D1D5DB] hover:bg-[#151820]"
                }`}
            >
              <MessageSquare size={15} />
              <span>AI Agent</span>
            </button>

            <button
              onClick={() => setPage("explorer")}
              className={`w-full flex items-center gap-2.5 px-3 py-1.5 rounded-md text-[13px] font-medium transition-colors cursor-pointer ${page === "explorer"
                ? "bg-[#2563EB]/10 text-[#3B82F6]"
                : "text-[#9CA3AF] hover:text-[#D1D5DB] hover:bg-[#151820]"
                }`}
            >
              <Database size={15} />
              <span>Data Explorer</span>
            </button>

            <button
              onClick={() => setIsSourceModalOpen(true)}
              className="w-full flex items-center gap-2.5 px-3 py-1.5 rounded-md text-[13px] font-medium text-[#9CA3AF] hover:text-[#D1D5DB] hover:bg-[#151820] transition-colors cursor-pointer"
            >
              <HardDrive size={15} />
              <span>Data Sources</span>
            </button>
          </div>

          {/* AI Model Selector */}
          <div className="px-3 py-2.5 border-b border-[#1E2230]/60 flex-shrink-0">
            <div className="text-[10px] font-medium text-[#6B7280] uppercase tracking-wider px-1 mb-1.5">
              AI Model
            </div>
            <div className="relative" ref={modelDropdownRef}>
              <button
                onClick={() => setIsModelDropdownOpen(!isModelDropdownOpen)}
                className="w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg bg-[#151820] border border-[#272B35] hover:border-[#3B82F6]/40 text-[12.5px] text-[#E5E7EB] transition-all cursor-pointer"
              >
                <div className="flex items-center gap-2 min-w-0">
                  {(() => {
                    const current = availableModels.find(m => m.id === selectedModel);
                    const provider = current?.provider || "";
                    const badgeClass =
                      provider === "ollama"
                        ? "bg-emerald-500/15 text-emerald-400 border border-emerald-500/30"
                        : provider === "groq"
                          ? "bg-orange-500/15 text-orange-400 border border-orange-500/30"
                          : provider === "gemini" || provider === "google"
                            ? "bg-sky-500/15 text-sky-400 border border-sky-500/30"
                            : "bg-violet-500/15 text-violet-400 border border-violet-500/30";
                    const badgeIcon =
                      provider === "ollama" ? (
                        <Monitor size={10} />
                      ) : provider === "groq" ? (
                        <Zap size={10} />
                      ) : provider === "gemini" || provider === "google" ? (
                        <Sparkles size={10} />
                      ) : (
                        <Cloud size={10} />
                      );
                    return (
                      <>
                        <span className={`flex-shrink-0 w-4.5 h-4.5 rounded flex items-center justify-center text-[9px] font-bold ${badgeClass}`}>
                          {badgeIcon}
                        </span>
                        <span className="truncate">{current?.name || "Select Model"}</span>
                      </>
                    );
                  })()}
                </div>
                <ChevronDown size={13} className={`flex-shrink-0 text-[#6B7280] transition-transform ${isModelDropdownOpen ? "rotate-180" : ""}`} />
              </button>

              {isModelDropdownOpen && (
                <div className="absolute left-0 right-0 top-full mt-1 bg-[#151820] border border-[#272B35] rounded-lg shadow-xl shadow-black/40 z-50 overflow-hidden">
                  {availableModels.map((model) => {
                    const mBadgeClass =
                      model.provider === "ollama"
                        ? "bg-emerald-500/15 text-emerald-400 border border-emerald-500/30"
                        : model.provider === "groq"
                          ? "bg-orange-500/15 text-orange-400 border border-orange-500/30"
                          : model.provider === "gemini" || model.provider === "google"
                            ? "bg-sky-500/15 text-sky-400 border border-sky-500/30"
                            : "bg-violet-500/15 text-violet-400 border border-violet-500/30";
                    const mBadgeIcon =
                      model.provider === "ollama" ? (
                        <Monitor size={10} />
                      ) : model.provider === "groq" ? (
                        <Zap size={10} />
                      ) : model.provider === "gemini" || model.provider === "google" ? (
                        <Sparkles size={10} />
                      ) : (
                        <Cloud size={10} />
                      );
                    return (
                      <button
                        key={model.id}
                        onClick={() => handleModelSelect(model.id)}
                        className={`w-full flex items-center gap-2 px-3 py-2 text-[12.5px] transition-colors cursor-pointer ${model.id === selectedModel
                          ? "bg-[#2563EB]/10 text-blue-400"
                          : "text-[#D1D5DB] hover:bg-[#1E2230] hover:text-[#F3F4F6]"
                          }`}
                      >
                        <span className={`flex-shrink-0 w-4.5 h-4.5 rounded flex items-center justify-center text-[9px] font-bold ${mBadgeClass}`}>
                          {mBadgeIcon}
                        </span>
                        <span className="truncate w-full text-left">{model.name}</span>
                        {model.id === selectedModel && (
                          <Check size={13} className="flex-shrink-0 ml-auto text-blue-400" />
                        )}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          {/* Recent Chats on Sidebar (ChatGPT / Claude style) */}
          <div className="flex-1 overflow-y-auto px-2 py-3 min-h-0">
            <div className="flex items-center justify-between px-2 mb-1.5">
              <span className="text-[10px] font-semibold text-[#6B7280] uppercase tracking-wider">
                Recent Chats
              </span>
              {recentChats.length > 0 && (
                <span className="text-[10px] text-[#6B7280] font-medium">
                  {recentChats.length} / 10
                </span>
              )}
            </div>

            {recentChats.length === 0 ? (
              <div className="px-2 py-6 text-center">
                <p className="text-[12px] text-[#6B7280]">No recent chats</p>
                <p className="text-[11px] text-[#4B5563] mt-0.5">Your conversations will appear here</p>
              </div>
            ) : (
              <div className="space-y-0.5">
                {recentChats.map((chat) => {
                  const isActive = currentChatId === chat.id && page === "agent";
                  const isChatStreaming = activeStreamIds.has(chat.id);
                  return (
                    <div
                      key={chat.id}
                      onClick={() => handleSelectChat(chat)}
                      className={`group flex items-center justify-between px-2.5 py-2 rounded-lg text-[13px] transition-all cursor-pointer ${isActive
                        ? "bg-blue-600/15 text-blue-400 font-medium"
                        : "text-[#9CA3AF] hover:text-[#F3F4F6] hover:bg-[#151820]"
                        }`}
                      title={chat.title}
                    >
                      <div className="flex items-center gap-2 min-w-0 flex-1 mr-1">
                        {isChatStreaming ? (
                          <Loader2
                            size={14}
                            className="flex-shrink-0 text-blue-400 animate-spin"
                          />
                        ) : (
                          <MessageSquare
                            size={14}
                            className={`flex-shrink-0 ${isActive ? "text-blue-400" : "text-[#6B7280] group-hover:text-[#9CA3AF]"
                              }`}
                          />
                        )}
                        <span className="truncate">{chat.title || "Conversation"}</span>
                      </div>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDeleteChat(chat.id);
                        }}
                        className="opacity-0 group-hover:opacity-100 p-1 text-[#6B7280] hover:text-red-400 rounded hover:bg-[#1E2230] transition-all flex-shrink-0"
                        title="Delete conversation"
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Footer: Connected Source + User Sign Out */}
          <div className="p-3 border-t border-[#1E2230] space-y-2 flex-shrink-0">
            <div
              className="p-2 rounded-lg bg-[#151820] border border-[#272B35] transition-all"
            >
              <div className="flex items-center justify-between mb-0.5">
                <span className="text-[10px] font-medium text-[#6B7280] uppercase tracking-wider">
                  Connected Source
                </span>
                {activeSource && activeSource.source_id !== "default" && (
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
                )}
              </div>
              <p className={`text-[12px] font-medium truncate ${activeSource && activeSource.source_id !== "default" ? "text-[#E5E7EB]" : "text-[#6B7280]"}`}>
                {activeSource && activeSource.source_id !== "default"
                  ? activeSource.name
                  : "No database connected"}
              </p>
            </div>

            <div className="pt-0.5 flex items-center justify-between">
              {user && (
                <p className="text-[11.5px] text-[#6B7280] truncate max-w-[130px]" title={user.Email}>
                  {user.Email}
                </p>
              )}
              <button
                onClick={handleLogout}
                className="flex items-center gap-1.5 px-2 py-1 rounded text-[12px] text-[#9CA3AF] hover:text-[#D1D5DB] hover:bg-[#151820] transition-colors cursor-pointer ml-auto"
                title="Sign out"
              >
                <LogOut size={14} />
                <span>Sign out</span>
              </button>
            </div>
          </div>
        </div>
      </aside>

      {/* ─── Content ─── */}
      <main className="flex-1 flex flex-col min-h-0 min-w-0 overflow-hidden bg-[#0F1117] relative">
        {/* Floating sidebar toggle when collapsed */}
        {!isSidebarOpen && (
          <button
            onClick={toggleSidebar}
            className="absolute top-3 left-3 z-30 p-1.5 rounded-lg bg-[#151820]/90 border border-[#272B35] text-blue-400 hover:text-[#F3F4F6] hover:bg-[#1E2230] transition-colors cursor-pointer shadow-md backdrop-blur-sm"
            title="Open sidebar"
          >
            <PanelLeftOpen size={16} />
          </button>
        )}
        {page === "agent" ? (
          <ChatView
            key={currentChatId || "new"}
            activeSource={activeSource}
            onOpenSourceModal={() => setIsSourceModalOpen(true)}
            selectedModel={selectedModel}
            messages={messages}
            currentChatId={currentChatId}
            onNewChat={handleNewChat}
            isSidebarOpen={isSidebarOpen}
            onToggleSidebar={toggleSidebar}
            sendMessage={sendMessage}
            stopGeneration={stopGeneration}
            isStreaming={isCurrentChatStreaming}
          />
        ) : (
          <DataExplorer
            activeSource={activeSource}
            onOpenSourceModal={() => setIsSourceModalOpen(true)}
            onSourceInvalid={() => syncActiveSourceWithServer()}
            isSidebarOpen={isSidebarOpen}
            onToggleSidebar={toggleSidebar}
          />
        )}
      </main>

      {/* Data Source Connection & File Upload Modal */}
      <DataSourceModal
        isOpen={isSourceModalOpen}
        onClose={() => setIsSourceModalOpen(false)}
        activeSource={activeSource}
        onSelectSource={handleSelectSource}
      />
    </div>
  );
}
