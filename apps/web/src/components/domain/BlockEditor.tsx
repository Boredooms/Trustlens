/**
 * BlockEditor — a disciplined, Notion-style block model for investigation notes.
 *
 * Owns: an ordered list of typed blocks (paragraph, heading 1–3, bullet, numbered, todo, quote, code,
 * callout, divider), each edited in an auto-sizing plain-text area. No contentEditable and no HTML:
 * text is stored and rendered as text, so a pasted payload can never execute.
 *
 * Keyboard (also listed in the editor's help popover):
 *   Enter               new block after (lists and todos continue; an empty list item becomes a paragraph)
 *   Shift+Enter         line break inside a block
 *   Backspace (empty)   delete the block and move to the previous one
 *   ↑ / ↓ at an edge    move between blocks
 *   Alt+Shift+↑ / ↓     reorder the block
 *   "/" in an empty block  open the block-type menu
 *   Markdown shortcuts  "# ", "## ", "### ", "- ", "1. ", "[] ", "> ", "``` ", "! ", "---"
 *
 * The editor edits notes only. It never produces a finding, a score or a decision.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import { m } from "motion/react";
import {
  AlertCircle,
  CheckSquare,
  Code2,
  Heading1,
  Heading2,
  Heading3,
  List,
  ListOrdered,
  Minus,
  Pilcrow,
  Quote,
  type LucideIcon,
} from "lucide-react";
import type { NoteBlock, NoteBlockType } from "@/lib/api/endpoints";
import { transitions } from "@/lib/motion";
import { cn } from "@/lib/utils/cn";

export interface EditorBlock {
  id: string;
  type: NoteBlockType;
  text: string;
  checked?: boolean;
  level?: number;
}

interface BlockKind {
  key: string;
  type: NoteBlockType;
  level?: number;
  label: string;
  hint: string;
  icon: LucideIcon;
}

export const BLOCK_KINDS: BlockKind[] = [
  { key: "paragraph", type: "paragraph", label: "Text", hint: "Plain paragraph", icon: Pilcrow },
  { key: "h1", type: "heading", level: 1, label: "Heading 1", hint: "# ", icon: Heading1 },
  { key: "h2", type: "heading", level: 2, label: "Heading 2", hint: "## ", icon: Heading2 },
  { key: "h3", type: "heading", level: 3, label: "Heading 3", hint: "### ", icon: Heading3 },
  { key: "bullet", type: "bullet", label: "Bulleted list", hint: "- ", icon: List },
  { key: "numbered", type: "numbered", label: "Numbered list", hint: "1. ", icon: ListOrdered },
  { key: "todo", type: "todo", label: "To-do", hint: "[] ", icon: CheckSquare },
  { key: "quote", type: "quote", label: "Quote", hint: "> ", icon: Quote },
  { key: "code", type: "code", label: "Code / indicator", hint: "``` ", icon: Code2 },
  { key: "callout", type: "callout", label: "Callout", hint: "! ", icon: AlertCircle },
  { key: "divider", type: "divider", label: "Divider", hint: "---", icon: Minus },
];

const SHORTCUTS: Array<[string, Pick<EditorBlock, "type" | "level">]> = [
  ["### ", { type: "heading", level: 3 }],
  ["## ", { type: "heading", level: 2 }],
  ["# ", { type: "heading", level: 1 }],
  ["- ", { type: "bullet" }],
  ["* ", { type: "bullet" }],
  ["1. ", { type: "numbered" }],
  ["[] ", { type: "todo" }],
  ["[ ] ", { type: "todo" }],
  ["> ", { type: "quote" }],
  ["``` ", { type: "code" }],
  ["! ", { type: "callout" }],
];

const CONTINUES = new Set<NoteBlockType>(["bullet", "numbered", "todo"]);

let seq = 0;
export function newBlockId(): string {
  seq += 1;
  return `b${Date.now().toString(36)}${seq.toString(36)}`;
}

export function toEditorBlocks(blocks: NoteBlock[] | null | undefined): EditorBlock[] {
  const out = (blocks ?? []).map((b) => ({
    id: b.id,
    type: b.type,
    text: b.text ?? "",
    checked: b.checked ?? undefined,
    level: b.level ?? undefined,
  }));
  return out.length ? out : [{ id: newBlockId(), type: "paragraph", text: "" }];
}

/** Wire shape: drop empty trailing paragraphs and fields that do not apply to the block type. */
export function toWireBlocks(blocks: EditorBlock[]): NoteBlock[] {
  const trimmed = [...blocks];
  while (trimmed.length && trimmed[trimmed.length - 1]?.type === "paragraph" && !trimmed[trimmed.length - 1]?.text.trim()) trimmed.pop();
  return trimmed.map((b) => {
    const wire: NoteBlock = { id: b.id, type: b.type, text: b.type === "divider" ? "" : b.text };
    if (b.type === "todo") wire.checked = Boolean(b.checked);
    if (b.type === "heading") wire.level = b.level ?? 2;
    return wire;
  });
}

/** Markdown export (copy / download). Plain text; no HTML. */
export function blocksToMarkdown(blocks: EditorBlock[]): string {
  let n = 0;
  return blocks
    .map((b) => {
      if (b.type !== "numbered") n = 0;
      switch (b.type) {
        case "heading":
          return `${"#".repeat(b.level ?? 2)} ${b.text}`;
        case "bullet":
          return `- ${b.text}`;
        case "numbered":
          n += 1;
          return `${n}. ${b.text}`;
        case "todo":
          return `- [${b.checked ? "x" : " "}] ${b.text}`;
        case "quote":
          return `> ${b.text}`;
        case "code":
          return "```\n" + b.text + "\n```";
        case "callout":
          return `> **Note:** ${b.text}`;
        case "divider":
          return "---";
        default:
          return b.text;
      }
    })
    .join("\n\n");
}

function autosize(el: HTMLTextAreaElement | null) {
  if (!el) return;
  el.style.height = "0px";
  el.style.height = `${el.scrollHeight}px`;
}

export interface BlockEditorProps {
  blocks: EditorBlock[];
  onChange: (blocks: EditorBlock[]) => void;
  /** Accessible name for the editor region. */
  label: string;
  placeholder?: string;
  readOnly?: boolean;
}

export function BlockEditor({ blocks, onChange, label, placeholder = "Write a note, or type “/” for blocks…", readOnly }: BlockEditorProps) {
  const refs = useRef(new Map<string, HTMLTextAreaElement>());
  const [focusId, setFocusId] = useState<{ id: string; at: "start" | "end" } | null>(null);
  const [menu, setMenu] = useState<{ id: string; index: number } | null>(null);

  useLayoutEffect(() => {
    if (!focusId) return;
    const el = refs.current.get(focusId.id);
    if (el) {
      el.focus();
      const pos = focusId.at === "start" ? 0 : el.value.length;
      el.setSelectionRange(pos, pos);
    }
    setFocusId(null);
  }, [focusId, blocks]);

  useLayoutEffect(() => {
    refs.current.forEach((el) => autosize(el));
  }, [blocks]);

  const update = useCallback((id: string, patch: Partial<EditorBlock>) => onChange(blocks.map((b) => (b.id === id ? { ...b, ...patch } : b))), [blocks, onChange]);

  const insertAfter = (index: number, block: EditorBlock) => {
    const next = [...blocks];
    next.splice(index + 1, 0, block);
    onChange(next);
    setFocusId({ id: block.id, at: "start" });
  };

  const applyKind = (id: string, kind: BlockKind) => {
    const index = blocks.findIndex((b) => b.id === id);
    if (kind.type === "divider") {
      const next = [...blocks];
      next[index] = { id, type: "divider", text: "" };
      const after: EditorBlock = { id: newBlockId(), type: "paragraph", text: "" };
      next.splice(index + 1, 0, after);
      onChange(next);
      setFocusId({ id: after.id, at: "start" });
    } else {
      update(id, { type: kind.type, level: kind.level, text: (blocks[index]?.text ?? "").replace(/^\/\S*$/, "") });
      setFocusId({ id, at: "end" });
    }
    setMenu(null);
  };

  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>, b: EditorBlock, index: number) => {
    const el = e.currentTarget;
    if (menu?.id === b.id) {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        const d = e.key === "ArrowDown" ? 1 : -1;
        setMenu({ id: b.id, index: (menu.index + d + BLOCK_KINDS.length) % BLOCK_KINDS.length });
        return;
      }
      if (e.key === "Enter") {
        e.preventDefault();
        const kind = BLOCK_KINDS[menu.index];
        if (kind) applyKind(b.id, kind);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setMenu(null);
        return;
      }
    }
    if (e.key === "Enter" && !e.shiftKey && b.type !== "code") {
      e.preventDefault();
      if (CONTINUES.has(b.type) && !b.text.trim()) {
        update(b.id, { type: "paragraph", checked: undefined });
        return;
      }
      insertAfter(index, { id: newBlockId(), type: CONTINUES.has(b.type) ? b.type : "paragraph", text: "", checked: b.type === "todo" ? false : undefined });
      return;
    }
    if (e.key === "Backspace" && el.selectionStart === 0 && el.selectionEnd === 0) {
      if (b.type !== "paragraph" && b.type !== "divider") {
        e.preventDefault();
        update(b.id, { type: "paragraph", level: undefined, checked: undefined });
        return;
      }
      if (!b.text && blocks.length > 1) {
        e.preventDefault();
        const prev = blocks[index - 1] ?? blocks[index + 1];
        onChange(blocks.filter((x) => x.id !== b.id));
        if (prev) setFocusId({ id: prev.id, at: "end" });
        return;
      }
    }
    if (e.altKey && e.shiftKey && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
      e.preventDefault();
      const to = index + (e.key === "ArrowUp" ? -1 : 1);
      if (to < 0 || to >= blocks.length) return;
      const next = [...blocks];
      const [moved] = next.splice(index, 1);
      if (moved) next.splice(to, 0, moved);
      onChange(next);
      setFocusId({ id: b.id, at: "end" });
      return;
    }
    if (e.key === "ArrowUp" && el.selectionStart === 0 && index > 0) {
      const prev = blocks[index - 1];
      if (prev) {
        e.preventDefault();
        setFocusId({ id: prev.id, at: "end" });
      }
      return;
    }
    if (e.key === "ArrowDown" && el.selectionEnd === el.value.length && index < blocks.length - 1) {
      const next = blocks[index + 1];
      if (next) {
        e.preventDefault();
        setFocusId({ id: next.id, at: "start" });
      }
    }
  };

  const onInput = (b: EditorBlock, value: string) => {
    if (b.type === "paragraph") {
      if (value === "---") {
        applyKind(b.id, BLOCK_KINDS.find((k) => k.type === "divider") as BlockKind);
        return;
      }
      const hit = SHORTCUTS.find(([p]) => value.startsWith(p));
      if (hit) {
        update(b.id, { ...hit[1], text: value.slice(hit[0].length), checked: hit[1].type === "todo" ? false : undefined });
        return;
      }
      if (value.startsWith("/") && !value.includes(" ")) setMenu({ id: b.id, index: 0 });
      else if (menu?.id === b.id) setMenu(null);
    }
    update(b.id, { text: value });
  };

  let numbered = 0;
  return (
    <div role="group" aria-label={label} className="flex flex-col gap-0.5">
      {blocks.map((b, index) => {
        numbered = b.type === "numbered" ? numbered + 1 : 0;
        if (b.type === "divider") {
          return (
            <div key={b.id} className="group relative py-2">
              <div className="hairline" />
              {!readOnly ? (
                <button
                  type="button"
                  aria-label="Remove divider"
                  onClick={() => onChange(blocks.filter((x) => x.id !== b.id))}
                  className="absolute right-0 top-0 hidden rounded px-1 text-2xs text-muted hover:text-foreground group-hover:block group-focus-within:block"
                >
                  Remove
                </button>
              ) : null}
            </div>
          );
        }
        const marker =
          b.type === "bullet" ? (
            <span aria-hidden className="mt-[0.65rem] h-1.5 w-1.5 shrink-0 rounded-full bg-muted-strong" />
          ) : b.type === "numbered" ? (
            <span aria-hidden className="mt-[0.3rem] w-5 shrink-0 text-right font-mono text-xs text-muted">
              {numbered}.
            </span>
          ) : b.type === "todo" ? (
            <input
              type="checkbox"
              checked={Boolean(b.checked)}
              disabled={readOnly}
              onChange={(e) => update(b.id, { checked: e.target.checked })}
              aria-label={`Done: ${b.text || "to-do"}`}
              className="mt-[0.4rem] h-3.5 w-3.5 shrink-0 accent-[var(--foreground)]"
            />
          ) : null;
        return (
          <m.div
            key={b.id}
            layout="position"
            transition={transitions.layout}
            className={cn(
              "relative flex items-start gap-2 rounded-md px-2 transition-colors duration-fast",
              b.type === "quote" && "border-l-2 border-border-strong pl-3",
              b.type === "callout" && "my-1 border border-warning bg-warning-surface py-1.5",
              b.type === "code" && "my-1 border border-border bg-surface-secondary py-1",
            )}
          >
            {marker}
            <textarea
              ref={(el) => {
                if (el) refs.current.set(b.id, el);
                else refs.current.delete(b.id);
              }}
              rows={1}
              value={b.text}
              readOnly={readOnly}
              spellCheck={b.type !== "code"}
              placeholder={index === 0 && blocks.length === 1 ? placeholder : b.type === "heading" ? "Heading" : ""}
              aria-label={`${BLOCK_KINDS.find((k) => k.type === b.type && (k.level ?? 0) === (b.type === "heading" ? b.level ?? 2 : 0))?.label ?? "Text"} block ${index + 1}`}
              aria-expanded={menu?.id === b.id ? true : undefined}
              aria-controls={menu?.id === b.id ? `blockmenu-${b.id}` : undefined}
              onChange={(e) => onInput(b, e.target.value)}
              onKeyDown={(e) => onKey(e, b, index)}
              onBlur={() => setTimeout(() => setMenu((mm) => (mm?.id === b.id ? null : mm)), 120)}
              className={cn(
                "min-h-[1.75rem] w-full resize-none overflow-hidden bg-transparent py-1 text-sm leading-6 text-foreground outline-none placeholder:text-muted",
                b.type === "heading" && b.level === 1 && "font-display text-3xl leading-tight",
                b.type === "heading" && (b.level ?? 2) === 2 && "font-display text-2xl leading-tight",
                b.type === "heading" && b.level === 3 && "text-base font-medium",
                b.type === "todo" && b.checked && "text-muted line-through",
                b.type === "code" && "font-mono text-code",
                b.type === "quote" && "italic text-muted-strong",
              )}
            />
            {menu?.id === b.id ? (
              <ul
                id={`blockmenu-${b.id}`}
                role="listbox"
                aria-label="Block type"
                className="absolute left-2 top-full z-20 mt-1 w-64 rounded-lg border border-border bg-surface p-1 shadow-overlay"
              >
                {BLOCK_KINDS.map((k, i) => (
                  <li key={k.key} role="option" aria-selected={menu.index === i}>
                    <button
                      type="button"
                      tabIndex={-1}
                      onMouseDown={(e) => {
                        e.preventDefault();
                        applyKind(b.id, k);
                      }}
                      className={cn(
                        "flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-sm",
                        menu.index === i ? "bg-surface-secondary text-foreground" : "text-muted-strong",
                      )}
                    >
                      <k.icon aria-hidden className="h-4 w-4" strokeWidth={1.5} />
                      <span className="flex-1">{k.label}</span>
                      <span className="font-mono text-2xs text-muted">{k.hint}</span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
          </m.div>
        );
      })}
    </div>
  );
}

/** Debounced autosave helper: calls `save` `delay` ms after the last change. */
export function useDebouncedSave<T>(value: T, save: (v: T) => void, delay = 900, enabled = true) {
  const first = useRef(true);
  const saveRef = useRef(save);
  saveRef.current = save;
  useEffect(() => {
    if (!enabled) return;
    if (first.current) {
      first.current = false;
      return;
    }
    const t = setTimeout(() => saveRef.current(value), delay);
    return () => clearTimeout(t);
  }, [value, delay, enabled]);
}
