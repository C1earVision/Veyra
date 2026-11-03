// Storage manager for recent chat conversations (capped at 10)
// Tied to authenticated user in production, stored in localStorage locally.

import axios from "axios";
import { AI_API_URL } from "../config/api";
import { getStoredAuth, authHeaders } from "./auth";

const BASE_STORAGE_KEY = "Veyra_recent_chats";
const MAX_CHATS = 10;

/**
 * Determine whether we are running in production mode.
 */
export const isProduction = () => {
  return import.meta.env.PROD || import.meta.env.MODE === "production";
};

/**
 * Extract current user ID from stored session.
 */
export function getCurrentUserId() {
  const auth = getStoredAuth();
  return (
    auth?.user?.CustomerId ||
    auth?.user?.customerId ||
    auth?.user?.id ||
    auth?.user?.Email ||
    null
  );
}

/**
 * In production, scope the storage key by the authenticated user's ID.
 * In local deployment, keep the simple global key.
 */
export function getStorageKey() {
  if (isProduction()) {
    const userId = getCurrentUserId();
    if (userId) {
      return `${BASE_STORAGE_KEY}_${userId}`;
    }
  }
  return BASE_STORAGE_KEY;
}

/**
 * Retrieve saved active data source for current user across logouts.
 */
export function getSavedActiveSource() {
  const userId = isProduction() ? getCurrentUserId() : null;
  const key = userId ? `Veyra_active_source_${userId}` : "activeSource";
  try {
    const raw =
      localStorage.getItem(key) ||
      (userId ? localStorage.getItem("activeSource") : null);
    if (raw) return JSON.parse(raw);
  } catch (e) {
    console.error("Failed to load activeSource:", e);
  }
  return {
    source_id: "default",
    name: "Default Database",
    type: "database",
  };
}

/**
 * Persist active data source for current user across logouts.
 */
export function saveActiveSource(source) {
  if (!source) return;
  const userId = isProduction() ? getCurrentUserId() : null;
  const key = userId ? `Veyra_active_source_${userId}` : "activeSource";
  try {
    localStorage.setItem(key, JSON.stringify(source));
    localStorage.setItem("activeSource", JSON.stringify(source));
  } catch (e) {
    console.error("Failed to save activeSource:", e);
  }
}

/**
 * Retrieve saved active chat session (messages, chatId, context) across logouts.
 */
export function getSavedActiveSession() {
  const userId = isProduction() ? getCurrentUserId() : null;
  const msgKey = userId ? `Veyra_active_messages_${userId}` : "Veyra_active_messages";
  const idKey = userId ? `Veyra_active_chat_id_${userId}` : "Veyra_active_chat_id";
  const ctxKey = userId ? `Veyra_context_${userId}` : "messages";
  try {
    const rawMsgs = localStorage.getItem(msgKey);
    const chatId = localStorage.getItem(idKey);
    const rawCtx = localStorage.getItem(ctxKey);
    return {
      messages: rawMsgs ? JSON.parse(rawMsgs) : [],
      chatId: chatId || null,
      contextMessages: rawCtx ? JSON.parse(rawCtx) : ["Context: "],
    };
  } catch (e) {
    console.error("Failed to load active session:", e);
    return { messages: [], chatId: null, contextMessages: ["Context: "] };
  }
}

/**
 * Persist active chat session (messages, chatId, context) across logouts.
 */
export function saveActiveSession(messages, chatId, contextMessages) {
  const userId = isProduction() ? getCurrentUserId() : null;
  const msgKey = userId ? `Veyra_active_messages_${userId}` : "Veyra_active_messages";
  const idKey = userId ? `Veyra_active_chat_id_${userId}` : "Veyra_active_chat_id";
  const ctxKey = userId ? `Veyra_context_${userId}` : "messages";
  try {
    if (messages && messages.length > 0) {
      localStorage.setItem(msgKey, JSON.stringify(messages));
    } else {
      localStorage.removeItem(msgKey);
    }
    if (chatId) {
      localStorage.setItem(idKey, chatId);
    } else {
      localStorage.removeItem(idKey);
    }
    if (contextMessages) {
      localStorage.setItem(ctxKey, JSON.stringify(contextMessages));
      localStorage.setItem("messages", JSON.stringify(contextMessages));
    }
  } catch (e) {
    console.error("Failed to save active session:", e);
  }
}

/**
 * Generate a short, readable title from the user's first prompt.
 */
export function generateChatTitle(prompt) {
  if (!prompt || typeof prompt !== "string") return "New Conversation";
  const clean = prompt
    .replace(/^Context:\s*/i, "")
    .replace(/token:\S+/gi, "")
    .trim();
  if (!clean) return "New Conversation";
  const firstLine = clean.split("\n")[0].trim();
  return firstLine.length > 50 ? `${firstLine.slice(0, 48)}…` : firstLine;
}

/**
 * Get all saved recent chats (up to 10), sorted by updatedAt descending.
 */
export function getRecentChats() {
  try {
    const key = getStorageKey();
    const raw = localStorage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.slice(0, MAX_CHATS);
  } catch (err) {
    console.error("Failed to load recent chats from localStorage:", err);
    return [];
  }
}

/**
 * Synchronize recent chats to backend server in production.
 */
export async function syncChatsToServer(chats) {
  if (!isProduction()) return;
  try {
    const auth = getStoredAuth();
    if (!auth?.token) return;
    await axios.post(
      `${AI_API_URL}/chats/recent`,
      { chats: (chats || []).slice(0, MAX_CHATS) },
      { headers: authHeaders() }
    );
  } catch (err) {
    console.error("Failed to sync chats to server:", err);
  }
}

/**
 * Fetch remote recent chats for current user in production and sync to localStorage.
 */
export async function fetchUserRecentChats() {
  const localChats = getRecentChats();
  if (!isProduction()) return localChats;

  try {
    const auth = getStoredAuth();
    if (!auth?.token) return localChats;
    const res = await axios.get(`${AI_API_URL}/chats/recent`, {
      headers: authHeaders(),
    });
    if (res.data?.status === "ok" && Array.isArray(res.data?.chats)) {
      const serverChats = res.data.chats.slice(0, MAX_CHATS);
      if (serverChats.length > 0) {
        localStorage.setItem(getStorageKey(), JSON.stringify(serverChats));
        return serverChats;
      }
    }
  } catch (err) {
    console.error("Failed to fetch remote chats:", err);
  }
  return localChats;
}

/**
 * Save or update a chat session in the list.
 * Inserts/moves the chat to index 0, keeps at most 10 items.
 */
export function saveChatSession(session) {
  if (!session || !session.id) return [];
  try {
    const chats = getRecentChats();
    const existingIndex = chats.findIndex((c) => c.id === session.id);

    const updatedSession = {
      ...session,
      updatedAt: new Date().toISOString(),
    };

    let updatedList;
    if (existingIndex >= 0) {
      chats.splice(existingIndex, 1);
      updatedList = [updatedSession, ...chats];
    } else {
      updatedList = [updatedSession, ...chats];
    }

    const trimmed = updatedList.slice(0, MAX_CHATS);
    const key = getStorageKey();
    localStorage.setItem(key, JSON.stringify(trimmed));
    syncChatsToServer(trimmed);
    return trimmed;
  } catch (err) {
    console.error("Failed to save chat session:", err);
    return [];
  }
}

/**
 * Delete a chat session by id.
 */
export function deleteChatSession(sessionId) {
  try {
    const chats = getRecentChats();
    const filtered = chats.filter((c) => c.id !== sessionId);
    const key = getStorageKey();
    localStorage.setItem(key, JSON.stringify(filtered));
    syncChatsToServer(filtered);
    return filtered;
  } catch (err) {
    console.error("Failed to delete chat session:", err);
    return [];
  }
}

/**
 * Clear all chat history.
 */
export function clearAllChats() {
  try {
    const key = getStorageKey();
    localStorage.removeItem(key);
    syncChatsToServer([]);
    return [];
  } catch (err) {
    console.error("Failed to clear chat history:", err);
    return [];
  }
}

/**
 * Format relative time (e.g. "5m ago", "2h ago", "Yesterday", "Oct 22").
 */
export function formatRelativeTime(dateString) {
  if (!dateString) return "";
  try {
    const date = new Date(dateString);
    const now = new Date();
    const diffSec = Math.floor((now.getTime() - date.getTime()) / 1000);

    if (diffSec < 60) return "Just now";
    const diffMin = Math.floor(diffSec / 60);
    if (diffMin < 60) return `${diffMin}m ago`;
    const diffHours = Math.floor(diffMin / 60);
    if (diffHours < 24) return `${diffHours}h ago`;
    const diffDays = Math.floor(diffHours / 24);
    if (diffDays === 1) return "Yesterday";
    if (diffDays < 7) return `${diffDays}d ago`;

    return date.toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
    });
  } catch {
    return "";
  }
}
