import { useState, useEffect } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { X, Maximize2 } from "lucide-react";

/* ─── Lightbox for chart images ─── */
function ImageLightbox({ src, alt, onClose }) {
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 animate-in fade-in duration-150"
      onClick={onClose}
    >
      <button
        onClick={onClose}
        className="absolute top-5 right-5 p-2 rounded-lg bg-[#272B35]/80 text-[#9CA3AF] hover:text-[#F3F4F6] hover:bg-[#353A47] transition-colors"
        aria-label="Close"
      >
        <X size={20} />
      </button>
      <img
        src={src}
        alt={alt || "Enlarged chart"}
        className="max-w-[92vw] max-h-[88vh] object-contain rounded-lg border border-[#272B35] shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      />
    </div>
  );
}

/* ─── Chart / visualization image wrapper ─── */
export function ChartImage({ src, alt }) {
  const [showLightbox, setShowLightbox] = useState(false);

  if (!src) return null;

  return (
    <>
      <div className="mt-3 group relative inline-block max-w-xl rounded-lg border border-[#272B35] bg-[#0C0E13] overflow-hidden shadow-md animate-card-enter">
        <img
          src={src}
          alt={alt || "Generated visualization"}
          className="block max-w-full h-auto cursor-pointer transition-transform duration-200 group-hover:scale-[1.01]"
          loading="lazy"
          onClick={() => setShowLightbox(true)}
        />
        <button
          onClick={() => setShowLightbox(true)}
          className="absolute top-2 right-2 p-1.5 rounded-md bg-[#151820]/80 text-[#9CA3AF] opacity-0 group-hover:opacity-100 hover:text-[#F3F4F6] hover:bg-[#272B35] transition-all"
          title="Expand image"
        >
          <Maximize2 size={14} />
        </button>
      </div>
      {showLightbox && (
        <ImageLightbox
          src={src}
          alt={alt}
          onClose={() => setShowLightbox(false)}
        />
      )}
    </>
  );
}

/* ─── Preprocess markdown text to ensure GFM tables parse reliably ─── */
function preprocessMarkdown(text) {
  if (typeof text !== "string") return "";

  // 1. Convert literal escaped \n strings into real newlines if present
  let normalized = text.replace(/\\n/g, "\n");

  // 2. Convert unicode bullet characters (•) to standard markdown list syntax (- )
  normalized = normalized.replace(/^(\s*)•\s+/gm, "$1- ");

  // 3. Ensure there is a blank line before a table starts and after it ends,
  // WITHOUT inserting blank lines between internal rows (which breaks the table)
  const lines = normalized.split("\n");
  const result = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const prevLine = i > 0 ? lines[i - 1] : null;
    const isTableLine = /^\s*\|.*\|\s*$/.test(line);
    const prevIsTableLine = prevLine !== null && /^\s*\|.*\|\s*$/.test(prevLine);

    // If entering a table, make sure the line before was blank
    if (isTableLine && !prevIsTableLine && prevLine !== null && prevLine.trim() !== "") {
      result.push("");
    }

    result.push(line);

    // If leaving a table, make sure the line after is blank
    const nextLine = i < lines.length - 1 ? lines[i + 1] : null;
    const nextIsTableLine = nextLine !== null && /^\s*\|.*\|\s*$/.test(nextLine);
    if (isTableLine && !nextIsTableLine && nextLine !== null && nextLine.trim() !== "") {
      result.push("");
    }
  }

  return result.join("\n");
}

/* ─── Custom renderers for ReactMarkdown ─── */
const markdownComponents = {
  /* --- Block elements --- */
  p: ({ children }) => (
    <p className="mb-2.5 last:mb-0 leading-relaxed text-[#D1D5DB]">{children}</p>
  ),
  h1: ({ children }) => (
    <h1 className="text-[17px] font-semibold text-[#F3F4F6] mt-4 mb-2 first:mt-0 tracking-tight">{children}</h1>
  ),
  h2: ({ children }) => (
    <h2 className="text-[15px] font-semibold text-[#F3F4F6] mt-3.5 mb-1.5 first:mt-0 tracking-tight">{children}</h2>
  ),
  h3: ({ children }) => (
    <h3 className="text-[14px] font-semibold text-[#F3F4F6] mt-3 mb-1.5 first:mt-0">{children}</h3>
  ),
  h4: ({ children }) => (
    <h4 className="text-[13.5px] font-medium text-[#F3F4F6] mt-2.5 mb-1 first:mt-0">{children}</h4>
  ),

  /* --- Lists --- */
  ul: ({ children }) => (
    <ul className="mb-2.5 last:mb-0 pl-5 space-y-1 list-disc marker:text-[#6B7280] text-[#D1D5DB]">{children}</ul>
  ),
  ol: ({ children }) => (
    <ol className="mb-2.5 last:mb-0 pl-5 space-y-1 list-decimal marker:text-[#6B7280] text-[#D1D5DB]">{children}</ol>
  ),
  li: ({ children }) => (
    <li className="leading-relaxed">{children}</li>
  ),

  /* --- Inline --- */
  strong: ({ children }) => (
    <strong className="font-semibold text-[#F3F4F6]">{children}</strong>
  ),
  em: ({ children }) => (
    <em className="italic text-[#E5E7EB]">{children}</em>
  ),
  a: ({ href, children }) => (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="text-[#3B82F6] hover:text-[#60A5FA] underline underline-offset-2 transition-colors"
    >
      {children}
    </a>
  ),

  /* --- Code --- */
  pre: ({ children }) => (
    <div className="my-3 overflow-hidden rounded-lg border border-[#272B35] bg-[#0C0E13]">
      <pre className="p-3.5 overflow-x-auto text-[12.5px] font-mono text-[#D1D5DB] leading-relaxed">
        {children}
      </pre>
    </div>
  ),
  code: ({ className, children, ...props }) => {
    const hasLang = /language-(\w+)/.test(className || "");
    const isMultiLine = typeof children === "string" && children.includes("\n");

    if (hasLang || isMultiLine) {
      return (
        <code className={`block font-mono text-[12.5px] ${className || ""}`} {...props}>
          {children}
        </code>
      );
    }
    return (
      <code
        className="px-1.5 py-0.5 text-[12px] font-mono bg-[#1E2230] text-[#E5E7EB] rounded border border-[#272B35]"
        {...props}
      >
        {children}
      </code>
    );
  },

  /* --- Blockquote --- */
  blockquote: ({ children }) => (
    <blockquote className="my-3 pl-3.5 border-l-2 border-[#3B82F6] text-[#9CA3AF] italic">
      {children}
    </blockquote>
  ),

  /* --- Horizontal rule --- */
  hr: () => <hr className="my-3.5 border-[#1E2230]" />,

  /* --- Table (GitHub Flavored Markdown) --- */
  table: ({ children }) => (
    <div className="my-3.5 max-w-full overflow-x-auto rounded-lg border border-[#272B35] bg-[#10131B] shadow-sm animate-table-in">
      <table className="w-full min-w-[500px] text-[13px] border-collapse text-left">
        {children}
      </table>
    </div>
  ),
  thead: ({ children }) => (
    <thead className="bg-[#161922] border-b border-[#272B35] text-[11.5px] uppercase font-semibold tracking-wider text-[#9CA3AF]">
      {children}
    </thead>
  ),
  tbody: ({ children }) => (
    <tbody className="divide-y divide-[#1E2230] text-[#D1D5DB]">{children}</tbody>
  ),
  tr: ({ children }) => (
    <tr className="hover:bg-[#1A1E29]/70 transition-colors animate-table-row">{children}</tr>
  ),
  th: ({ children, style }) => (
    <th
      className="px-4 py-3 font-semibold whitespace-nowrap text-[#9CA3AF]"
      style={style}
    >
      {children}
    </th>
  ),
  td: ({ children, style }) => {
    const text = typeof children === "string" ? children : (Array.isArray(children) ? children.join("") : "");
    const isNumeric = /^[\$€£¥]?\s*[\d,]+\.?\d*\s*%?$/.test(String(text).trim());
    return (
      <td
        className={`px-4 py-2.5 whitespace-nowrap ${isNumeric ? "text-right tabular-nums font-mono text-[12.5px]" : ""}`}
        style={style}
      >
        {children}
      </td>
    );
  },

  /* --- Images (inline markdown images) --- */
  img: ({ src, alt }) => (
    <ChartImage src={src} alt={alt} />
  ),
};

/* ─── Main renderer ─── */
export default function MarkdownContent({ content }) {
  if (!content) return null;

  const cleanedContent = preprocessMarkdown(content);

  return (
    <div className="text-[14px] leading-relaxed break-words">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={markdownComponents}
      >
        {cleanedContent}
      </ReactMarkdown>
    </div>
  );
}

