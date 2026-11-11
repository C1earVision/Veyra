/**
 * Consume POST /query/stream (SSE) and dispatch typed events.
 * @param {string} baseUrl
 * @param {Record<string, unknown>} payload
 * @param {{ signal?: AbortSignal, headers?: Record<string, string>, onEvent: (type: string, data: Record<string, unknown>) => void }} handlers
 */
export async function streamAgentQuery(baseUrl, payload, { signal, headers = {}, onEvent }) {
  const url = `${baseUrl.replace(/\/$/, "")}/query/stream`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "text/event-stream",
      ...headers,
    },
    body: JSON.stringify(payload),
    signal,
  });

  if (!res.ok) {
    let detail = res.statusText;
    try {
      const errJson = await res.json();
      detail = errJson.error || detail;
    } catch {
      /* ignore */
    }
    throw new Error(detail || "Stream request failed");
  }

  await _consumeSSE(res, onEvent, signal);
}


/**
 * Checkpoint Phase 1: POST /query/stream/data
 * Streams SSE events then returns via onEvent either:
 * - 'done' with { final_response } (non-BI agent or single-chart)
 * - 'data_phase_done' with { data_phase_result } (needs assembly next)
 */
export async function streamDataPhase(baseUrl, payload, { signal, headers = {}, onEvent }) {
  const url = `${baseUrl.replace(/\/$/, "")}/query/stream/data`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "text/event-stream",
      ...headers,
    },
    body: JSON.stringify(payload),
    signal,
  });

  if (!res.ok) {
    let detail = res.statusText;
    try {
      const errJson = await res.json();
      detail = errJson.error || detail;
    } catch {
      /* ignore */
    }
    throw new Error(detail || "Data phase stream request failed");
  }

  await _consumeSSE(res, onEvent, signal);
}


/**
 * Checkpoint Phase 2: POST /query/stream/assemble
 * Sends the data_phase_result back and streams SSE assembly events,
 * finishing with 'done' containing the final DashboardSpec.
 */
export async function streamAssemblyPhase(baseUrl, assemblyPayload, { signal, headers = {}, onEvent }) {
  const url = `${baseUrl.replace(/\/$/, "")}/query/stream/assemble`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "text/event-stream",
      ...headers,
    },
    body: JSON.stringify(assemblyPayload),
    signal,
  });

  if (!res.ok) {
    let detail = res.statusText;
    try {
      const errJson = await res.json();
      detail = errJson.error || detail;
    } catch {
      /* ignore */
    }
    throw new Error(detail || "Assembly phase stream request failed");
  }

  await _consumeSSE(res, onEvent, signal);
}


/**
 * Internal: consume an SSE ReadableStream, dispatch parsed events via onEvent.
 */
async function _consumeSSE(res, onEvent, signal) {
  const reader = res.body?.getReader();
  if (!reader) {
    throw new Error("Streaming not supported in this browser");
  }

  const decoder = new TextDecoder();
  let buffer = "";

  const flushBlock = (block) => {
    const lines = block.split("\n");
    let eventType = "message";
    const dataLines = [];
    for (const line of lines) {
      if (line.startsWith("event:")) {
        eventType = line.slice(6).trim();
      } else if (line.startsWith("data:")) {
        dataLines.push(line.slice(5).trim());
      }
    }
    if (!dataLines.length) return;
    const raw = dataLines.join("\n");
    try {
      const parsed = JSON.parse(raw);
      onEvent(eventType, parsed);
    } catch (parseErr) {
      console.warn("[queryStream] Non-JSON or parse error on event:", eventType, raw, parseErr);
      onEvent(eventType, { error: raw, raw });
    }
  };

  try {
    while (true) {
      if (signal?.aborted) {
        await reader.cancel();
        throw new DOMException("The user aborted a request.", "AbortError");
      }
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const parts = buffer.split("\n\n");
      buffer = parts.pop() || "";
      for (const part of parts) {
        if (part.trim()) flushBlock(part);
      }
    }

    if (buffer.trim()) {
      flushBlock(buffer);
    }
  } finally {
    try {
      await reader.cancel();
    } catch {
      /* already closed */
    }
  }
}
