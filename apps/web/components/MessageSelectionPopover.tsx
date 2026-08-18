"use client";

import { useCallback, useEffect, useRef, useState, type CSSProperties, type RefObject } from "react";
import { Check, MessageSquarePlus, Quote, X } from "lucide-react";

export interface MessageSelectionSnapshot {
  quote: string;
  rect: {
    top: number;
    left: number;
    right: number;
    bottom: number;
    width: number;
    height: number;
  };
}

export interface MessageSelectionState {
  rootRef: RefObject<HTMLDivElement | null>;
  selection: MessageSelectionSnapshot | null;
  commentOpen: boolean;
  comment: string;
  setComment: (value: string) => void;
  openComment: () => void;
  submit: () => void;
  cancel: () => void;
}

function selectionSnapshot(root: HTMLDivElement): MessageSelectionSnapshot | null {
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) return null;
  if (!root.contains(selection.anchorNode) || !root.contains(selection.focusNode)) return null;

  const quote = selection.toString().trim();
  if (!quote) return null;

  const range = selection.getRangeAt(0);
  const rect = range.getBoundingClientRect();
  if (rect.width === 0 && rect.height === 0) return null;
  return {
    quote,
    rect: {
      top: rect.top,
      left: rect.left,
      right: rect.right,
      bottom: rect.bottom,
      width: rect.width,
      height: rect.height,
    },
  };
}

export function useMessageSelectionState(
  onSubmit: (quote: string, comment: string) => void,
  disabled = false,
): MessageSelectionState {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [selection, setSelection] = useState<MessageSelectionSnapshot | null>(null);
  const [commentOpen, setCommentOpen] = useState(false);
  const [comment, setComment] = useState("");

  useEffect(() => {
    if (disabled) {
      setSelection(null);
      return;
    }

    const updateSelection = () => {
      if (commentOpen) return;
      const root = rootRef.current;
      if (!root) return;
      const next = selectionSnapshot(root);
      setSelection(next);
    };
    const clearOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setSelection(null);
      setCommentOpen(false);
    };

    document.addEventListener("selectionchange", updateSelection);
    document.addEventListener("keydown", clearOnEscape);
    return () => {
      document.removeEventListener("selectionchange", updateSelection);
      document.removeEventListener("keydown", clearOnEscape);
    };
  }, [commentOpen, disabled]);

  const openComment = useCallback(() => {
    if (!selection) return;
    setComment("");
    setCommentOpen(true);
  }, [selection]);

  const submit = useCallback(() => {
    if (!selection) return;
    onSubmit(selection.quote, comment.trim());
    setComment("");
    setCommentOpen(false);
    setSelection(null);
    window.getSelection()?.removeAllRanges();
  }, [comment, onSubmit, selection]);

  const cancel = useCallback(() => {
    setComment("");
    setCommentOpen(false);
    setSelection(null);
  }, []);

  return { rootRef, selection, commentOpen, comment, setComment, openComment, submit, cancel };
}

function popoverPosition(selection: MessageSelectionSnapshot, expanded: boolean): CSSProperties {
  const width = expanded ? 340 : 148;
  const left = Math.min(
    Math.max(12, selection.rect.left + selection.rect.width / 2 - width / 2),
    Math.max(12, window.innerWidth - width - 12),
  );
  const top = selection.rect.bottom + (expanded ? 10 : 8) + (expanded ? 0 : 0);
  const estimatedHeight = expanded ? 238 : 36;
  const adjustedTop = top + estimatedHeight > window.innerHeight - 12
    ? Math.max(12, selection.rect.top - estimatedHeight - 8)
    : top;
  return { left, top: adjustedTop };
}

export function MessageSelectionPopover({ state }: { state: MessageSelectionState }) {
  const { selection, commentOpen, comment, setComment, openComment, submit, cancel } = state;
  const commentRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (commentOpen) commentRef.current?.focus();
  }, [commentOpen]);

  if (!selection) return null;

  return (
    <div
      role={commentOpen ? "dialog" : undefined}
      aria-label={commentOpen ? "Add a comment to the selected text" : "Selection actions"}
      style={{
        position: "fixed",
        ...popoverPosition(selection, commentOpen),
        zIndex: 600,
        width: commentOpen ? 340 : "auto",
        maxWidth: "calc(100vw - 24px)",
        padding: commentOpen ? 10 : 4,
        border: "1px solid color-mix(in srgb, var(--border) 85%, var(--accent))",
        borderRadius: 10,
        background: "color-mix(in srgb, var(--bg-panel) 94%, var(--accent))",
        boxShadow: "0 14px 32px rgba(15, 23, 42, 0.18), 0 2px 6px rgba(15, 23, 42, 0.10)",
        backdropFilter: "blur(12px)",
      }}
      onMouseDown={(event) => event.preventDefault()}
    >
      {!commentOpen ? (
        <button
          type="button"
          onClick={openComment}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            height: 28,
            padding: "0 9px",
            border: 0,
            borderRadius: 7,
            background: "var(--accent)",
            color: "#fff",
            cursor: "pointer",
            fontSize: 12,
            fontWeight: 600,
            whiteSpace: "nowrap",
          }}
        >
          <MessageSquarePlus size={14} strokeWidth={2} />
          添加评论
        </button>
      ) : (
        <>
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8, color: "var(--text-muted)", fontSize: 11, fontWeight: 600 }}>
            <Quote size={13} strokeWidth={1.8} />
            <span>评论这段内容</span>
            <button
              type="button"
              aria-label="Cancel comment"
              onClick={cancel}
              style={{ marginLeft: "auto", display: "inline-flex", alignItems: "center", justifyContent: "center", width: 22, height: 22, border: 0, borderRadius: 5, background: "transparent", color: "var(--text-dim)", cursor: "pointer" }}
            >
              <X size={14} />
            </button>
          </div>
          <div style={{ marginBottom: 8, padding: "7px 8px", borderLeft: "2px solid var(--accent)", borderRadius: 4, background: "var(--bg-subtle)", color: "var(--text-muted)", fontSize: 11, lineHeight: 1.45, maxHeight: 58, overflow: "hidden", whiteSpace: "pre-wrap" }}>
            {selection.quote}
          </div>
          <textarea
            ref={commentRef}
            value={comment}
            onChange={(event) => setComment(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                event.preventDefault();
                submit();
              }
              if (event.key === "Escape") {
                event.preventDefault();
                cancel();
              }
            }}
            placeholder="写下你的问题或修改意见…"
            rows={3}
            style={{ width: "100%", minHeight: 62, resize: "vertical", padding: "7px 8px", border: "1px solid var(--border)", borderRadius: 7, outline: "none", background: "var(--bg)", color: "var(--text)", font: "inherit", fontSize: 12, lineHeight: 1.45 }}
          />
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 8, gap: 8 }}>
            <span style={{ color: "var(--text-dim)", fontSize: 10 }}>⌘/Ctrl + Enter 保存</span>
            <button
              type="button"
              onClick={submit}
              style={{ display: "inline-flex", alignItems: "center", gap: 5, height: 28, padding: "0 10px", border: 0, borderRadius: 7, background: "var(--accent)", color: "#fff", cursor: "pointer", fontSize: 12, fontWeight: 600 }}
            >
              <Check size={13} />
              保存批注
            </button>
          </div>
        </>
      )}
    </div>
  );
}
