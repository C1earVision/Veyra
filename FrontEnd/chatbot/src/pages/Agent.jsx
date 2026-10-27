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
import {
  getRecentChats,
  saveChatSession,
  deleteChatSession,
  clearAllChats,
  generateChatTitle
} from "../lib/chatStorage";
import { normalizeQueryResponse } from "../types/agentApi";
import {
  DEFAULT_SOURCE,
  fetchServerDataSources,
  reconcileSourceWithServer,
  sourceFromQueryResponse,
} from "../lib/dataSourceSync";
import { streamAgentQuery } from "../lib/queryStream";
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
    title: "PowerBI Dashboard",
    prompt: "Generate a comprehensive multi-page PowerBI business dashboard with revenue trends, category breakdown, and operational insights",
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
  onSelectSource,
  onOpenSourceModal,
  selectedModel,
  messages,
  setMessages,
  currentChatId,
  setCurrentChatId,
  onSaveChatSession,
  onNewChat,
  isSidebarOpen,
  onToggleSidebar,
}) {
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);
  const chatContainerRef = useRef(null);
  const abortControllerRef = useRef(null);
  const userStoppedRef = useRef(false);
  const currentChatIdRef = useRef(currentChatId);
  const [showScrollBtn, setShowScrollBtn] = useState(false);

  // Keep ref in sync so streaming callbacks always see the latest chat ID
  useEffect(() => {
    currentChatIdRef.current = currentChatId;
  }, [currentChatId]);

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

  const handleResetChat = () => {
    onNewChat();
  };

  const stopGeneration = () => {
    userStoppedRef.current = true;
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    setLoading(false);
    setMessages((prev) => {
      const filtered = prev.filter((msg) => !msg.isLoading);
      const finalMessages = [...filtered, { role: "AI_Message", content: "Generation stopped." }];
      const sid = currentChatId || `chat_${Date.now()}`;
      if (!currentChatId) setCurrentChatId(sid);
      const firstUser = finalMessages.find((m) => m.role === "User_Message");
      const title = generateChatTitle(firstUser?.content);
      onSaveChatSession({
        id: sid,
        title,
        createdAt: new Date().toISOString(),
        source: activeSource,
        modelId: selectedModel,
        messages: finalMessages,
        contextMessages: JSON.parse(localStorage.getItem("messages")) || [],
      });
      return finalMessages;
    });
  };

  const sendMessage = async (customPrompt) => {
    const textToSend = typeof customPrompt === "string" ? customPrompt : input;
    if (!textToSend.trim() || loading) return;

    const sessionId = currentChatId || `chat_${Date.now()}`;
    if (!currentChatId) {
      setCurrentChatId(sessionId);
    }

    const newMessage = { role: "User_Message", content: textToSend };
    let storedMessages =
      JSON.parse(localStorage.getItem("messages")) || ["Context: "];
    storedMessages.push(`${newMessage.role}: ${newMessage.content};`);
    localStorage.setItem("messages", JSON.stringify(storedMessages));

    setMessages((prev) => [
      ...prev,
      newMessage,
      {
        role: "AI_Message",
        content: "",
        isLoading: true,
        streaming: true,
        thinking: "",
        steps: [],
        streamStatus: "Connecting…",
      },
    ]);
    setInput("");
    if (inputRef.current) {
      inputRef.current.style.height = "auto";
    }
    setLoading(true);
    inputRef.current?.focus();

    userStoppedRef.current = false;
    abortControllerRef.current = new AbortController();

    // Early-save the session with the user message so the "else" branch
    // (when the user navigates away during streaming) can find it.
    const earlyMessages = [...messages, newMessage];
    const earlyTitle = generateChatTitle(textToSend);
    onSaveChatSession({
      id: sessionId,
      title: earlyTitle,
      createdAt: new Date().toISOString(),
      source: activeSource,
      modelId: selectedModel,
      messages: earlyMessages,
      contextMessages: storedMessages,
    });

    try {
      const session = getStoredAuth();
      if (!session) {
        setMessages((prev) => {
          const filtered = prev.filter((msg) => !msg.isLoading);
          return [...filtered, { role: "AI_Message", content: "Please log in first to use the agent." }];
        });
        setLoading(false);
        return;
      }

      const payLoad = {
        question: JSON.parse(localStorage.getItem("messages")).join(" "),
        source_id: activeSource?.source_id,
        model_id: selectedModel || null,
      };
      let streamThinking = "";
      let streamSteps = [];
      let streamStatus = "Working…";

      const mergeThinking = (finalThinking, live) => {
        if (!finalThinking) return live;
        if (!live) return finalThinking;
        return live.includes(finalThinking) ? live : `${live}\n\n---\n\n${finalThinking}`;
      };

      let payload = null;

      await streamAgentQuery(AI_API_URL, payLoad, {
        signal: abortControllerRef.current.signal,
        headers: authHeaders(),
        onEvent: (type, data) => {
          if (type === "thinking_delta" && data.text) {
            streamThinking += data.text;
            setMessages((prev) =>
              prev.map((msg) =>
                msg.isLoading
                  ? {
                    ...msg,
                    thinking: streamThinking,
                    streamStatus: data.phase === "router" ? "Routing…" : streamStatus,
                  }
                  : msg
              )
            );
          } else if (type === "step" && data.step) {
            streamSteps = [...streamSteps, data.step];
            setMessages((prev) =>
              prev.map((msg) =>
                msg.isLoading
                  ? {
                    ...msg,
                    steps: streamSteps,
                    streamStatus: `${data.step.label}…`,
                  }
                  : msg
              )
            );
          } else if (type === "status" && data.text) {
            streamStatus = data.text;
            setMessages((prev) =>
              prev.map((msg) =>
                msg.isLoading ? { ...msg, streamStatus: data.text } : msg
              )
            );
          } else if (type === "done") {
            payload = normalizeQueryResponse(data);
          } else if (type === "error") {
            console.error("[stream error event received]", data);
            if (data.error === "cancelled") {
              const cancelled = new Error("cancelled");
              cancelled.name = "AbortError";
              throw cancelled;
            }
            const errorMsg = data.error || data.detail || data.raw || (typeof data === "string" ? data : JSON.stringify(data));
            throw new Error(errorMsg || "Stream failed");
          }
        },
      });

      if (userStoppedRef.current) {
        return;
      }

      if (!payload) {
        throw new Error("No response from agent stream");
      }

      const resolvedSource = sourceFromQueryResponse(payload);
      const sessionSource = resolvedSource || activeSource;
      if (resolvedSource && onSelectSource) {
        onSelectSource(resolvedSource);
      }

      const imageUrl = normalizeVisualizationUrl(payload.image);
      const aiMessage = {
        role: "AI_Message",
        content: payload.answer,
        agent: payload.agent,
        source_name: payload.source_name,
        thinking: mergeThinking(payload.thinking, streamThinking),
        steps: payload.steps?.length ? payload.steps : streamSteps,
        ...(imageUrl ? { image: imageUrl } : {}),
        ...(payload.dashboard ? { dashboard: payload.dashboard } : {}),
      };

      let updatedMessages =
        JSON.parse(localStorage.getItem("messages")) || [];
      updatedMessages.push(`${aiMessage.role}: ${aiMessage.content};`);
      localStorage.setItem("messages", JSON.stringify(updatedMessages));

      // Check if user has navigated away from this chat while streaming
      const stillOnSameChat =
        currentChatIdRef.current === sessionId ||
        currentChatIdRef.current === null;

      if (stillOnSameChat) {
        setMessages((prev) => {
          const filtered = prev.filter((msg) => !msg.isLoading);
          const finalMessages = [...filtered, aiMessage];

          // Auto-save to recent chats
          const firstUser = finalMessages.find((m) => m.role === "User_Message");
          const title = generateChatTitle(firstUser?.content);
          onSaveChatSession({
            id: sessionId,
            title,
            createdAt: new Date().toISOString(),
            source: sessionSource,
            modelId: selectedModel,
            messages: finalMessages,
            contextMessages: updatedMessages,
          });

          return finalMessages;
        });
      } else {
        // User navigated away — save the completed response to the original
        // session in storage (so it's visible when they return) but do NOT
        // overwrite the current on-screen messages.
        // Reconstruct the session from what was previously saved in chat storage.
        const existingSession = getRecentChats().find((c) => c.id === sessionId);
        const previousMessages = existingSession?.messages || [];
        // Remove any leftover loading placeholders and append the real AI answer
        const cleanPrev = previousMessages.filter((m) => !m.isLoading);
        const finalMessages = [...cleanPrev, aiMessage];
        const firstUser = finalMessages.find((m) => m.role === "User_Message");
        const title = generateChatTitle(firstUser?.content);
        onSaveChatSession({
          id: sessionId,
          title,
          createdAt: new Date().toISOString(),
          source: sessionSource,
          modelId: selectedModel,
          messages: finalMessages,
          contextMessages: updatedMessages,
        });
      }
    } catch (err) {
      if (err.name === "AbortError" || axios.isCancel(err)) {
        return;
      }
      console.error("[Agent sendMessage error]:", err);
      const displayError = err.message || err.response?.data?.error || "Please try again.";
      setMessages((prev) => {
        const filtered = prev.filter((msg) => !msg.isLoading);
        const finalMessages = [
          ...filtered,
          {
            role: "AI_Message",
            content: `AI Error: ${displayError}`,
          },
        ];

        // Save session on error as well
        const firstUser = finalMessages.find((m) => m.role === "User_Message");
        const title = generateChatTitle(firstUser?.content);
        onSaveChatSession({
          id: sessionId,
          title,
          createdAt: new Date().toISOString(),
          source: activeSource,
          modelId: selectedModel,
          messages: finalMessages,
          contextMessages: JSON.parse(localStorage.getItem("messages")) || [],
        });

        return finalMessages;
      });
    } finally {
      setLoading(false);
      abortControllerRef.current = null;
    }
  };

  const handleKeyPress = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* Top action bar showing active data source */}
      <div className="flex items-center justify-between px-4 sm:px-6 py-2.5 border-b border-[#1E2230] bg-[#0F1117]/80 backdrop-blur-sm">
        <div className="flex items-center gap-2.5">
          {onToggleSidebar && (
            <>
              <button
                onClick={onToggleSidebar}
                className="p-1.5 rounded-lg text-[#9CA3AF] hover:text-[#F3F4F6] hover:bg-[#1E2230] transition-colors cursor-pointer"
                title={isSidebarOpen ? "Collapse sidebar" : "Open sidebar"}
              >
                {isSidebarOpen ? (
                  <PanelLeftClose size={16} />
                ) : (
                  <PanelLeftOpen size={16} className="text-blue-400" />
                )}
              </button>
              <span className="h-4 w-[1px] bg-[#1E2230]" />
            </>
          )}
          <span className="text-[12px] text-[#6B7280]">Active Data:</span>
          <button
            onClick={onOpenSourceModal}
            className="flex items-center gap-1.5 px-2.5 py-1 text-[12px] font-medium text-blue-400 bg-blue-500/10 border border-blue-500/20 hover:bg-blue-500/20 rounded-md transition-colors cursor-pointer"
            title="Click to connect another database or upload CSV/Excel files"
          >
            <Database size={13} />
            <span>{activeSource?.name || "Default Database"}</span>
            <span className="text-[10px] text-blue-400/70 ml-0.5">▾</span>
          </button>
        </div>

        {messages.length > 0 && (
          <button
            onClick={handleResetChat}
            className="flex items-center gap-1.5 px-2.5 py-1 text-[12px] text-[#9CA3AF] hover:text-[#F3F4F6] hover:bg-[#1E2230] rounded-md transition-colors cursor-pointer"
            title="Start new conversation"
          >
            <RotateCcw size={13} />
            <span>New chat</span>
          </button>
        )}
      </div>

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
                  onClick={() => sendMessage(card.prompt)}
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
            onClick={() => (loading ? stopGeneration() : sendMessage())}
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
  const [messages, setMessages] = useState([]);
  const [currentChatId, setCurrentChatId] = useState(null);
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

  const [activeSource, setActiveSource] = useState(() => {
    try {
      return (
        JSON.parse(localStorage.getItem("activeSource")) || {
          source_id: "default",
          name: "Default Database",
          type: "database",
        }
      );
    } catch {
      return { source_id: "default", name: "Default Database", type: "database" };
    }
  });

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

  const navigate = useNavigate();

  useEffect(() => {
    if (!localStorage.getItem("messages")) {
      localStorage.setItem("messages", JSON.stringify(["Context: "]));
    }
    localStorage.setItem("admin", JSON.stringify(false));
  }, []);

  // Fetch available models on mount
  useEffect(() => {
    const fetchModels = async () => {
      try {
        const res = await axios.get(`${AI_API_URL}/models`, {
          headers: authHeaders(),
        });
        if (res.data?.models) {
          setAvailableModels(res.data.models);
          // If no model is selected yet, default to the first one (Ollama local)
          if (!selectedModel && res.data.models.length > 0) {
            const defaultId = res.data.models[0].id;
            setSelectedModel(defaultId);
            localStorage.setItem("selectedModel", defaultId);
          }
        }
      } catch (err) {
        console.error("Failed to fetch available models:", err);
      }
    };
    fetchModels();
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
    try {
      localStorage.setItem("activeSource", JSON.stringify(next));
    } catch (e) {
      console.error("Failed to save activeSource:", e);
    }
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

  useEffect(() => {
    syncActiveSourceWithServer(
      JSON.parse(localStorage.getItem("activeSource") || "null")
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSaveChatSession = (session) => {
    const updated = saveChatSession(session);
    setRecentChats(updated);
  };

  const handleSelectChat = async (chat) => {
    // Re-read from storage in case a background streaming response has
    // updated this session since the sidebar was last rendered.
    const freshChats = getRecentChats();
    const freshChat = freshChats.find((c) => c.id === chat.id) || chat;
    setRecentChats(freshChats);

    setCurrentChatId(freshChat.id);
    setMessages(freshChat.messages || []);
    if (freshChat.contextMessages) {
      localStorage.setItem("messages", JSON.stringify(freshChat.contextMessages));
    }
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

  const handleDeleteChat = (chatId) => {
    const updated = deleteChatSession(chatId);
    setRecentChats(updated);
    if (currentChatId === chatId) {
      handleNewChat();
    }
  };

  const handleClearAllChats = () => {
    clearAllChats();
    setRecentChats([]);
    handleNewChat();
  };

  const handleNewChat = () => {
    setCurrentChatId(null);
    setMessages([]);
    localStorage.setItem("messages", JSON.stringify(["Context: "]));
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
    localStorage.removeItem("user");
    localStorage.removeItem("messages");
    localStorage.removeItem("admin");
    navigate("/");
  };

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
              onClick={() => setPage("agent")}
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
                        <MessageSquare
                          size={14}
                          className={`flex-shrink-0 ${isActive ? "text-blue-400" : "text-[#6B7280] group-hover:text-[#9CA3AF]"
                            }`}
                        />
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
              onClick={() => setIsSourceModalOpen(true)}
              className="p-2 rounded-lg bg-[#151820] border border-[#272B35] hover:border-blue-500/40 cursor-pointer transition-all"
            >
              <div className="flex items-center justify-between mb-0.5">
                <span className="text-[10px] font-medium text-[#6B7280] uppercase tracking-wider">
                  Connected Source
                </span>
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
              </div>
              <p className="text-[12px] font-medium text-[#E5E7EB] truncate">
                {activeSource?.name || "Default Database"}
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
      <main className="flex-1 flex flex-col min-h-0 min-w-0 overflow-hidden bg-[#0F1117]">
        {page === "agent" ? (
          <ChatView
            activeSource={activeSource}
            onSelectSource={handleSelectSource}
            onOpenSourceModal={() => setIsSourceModalOpen(true)}
            selectedModel={selectedModel}
            messages={messages}
            setMessages={setMessages}
            currentChatId={currentChatId}
            setCurrentChatId={setCurrentChatId}
            onSaveChatSession={handleSaveChatSession}
            onNewChat={handleNewChat}
            isSidebarOpen={isSidebarOpen}
            onToggleSidebar={toggleSidebar}
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
