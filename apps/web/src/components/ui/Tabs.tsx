import { useRef, type KeyboardEvent } from "react";
import { cn } from "@/lib/utils/cn";

export interface TabItem<T extends string> {
  id: T;
  label: string;
}

export interface TabListProps<T extends string> {
  /** Accessible name of the tab list. */
  label: string;
  tabs: ReadonlyArray<TabItem<T>>;
  value: T;
  onChange: (id: T) => void;
  /** Prefix for tab/panel ids so several tab lists can share a page. */
  idPrefix?: string;
  className?: string;
}

export function tabIds(prefix: string, id: string) {
  return { tab: `${prefix}-tab-${id}`, panel: `${prefix}-panel-${id}` };
}

/** WAI-ARIA tabs: roving tabindex, arrow keys / Home / End move selection. Selection lives in the URL. */
export function TabList<T extends string>({ label, tabs, value, onChange, idPrefix = "tabs", className }: TabListProps<T>) {
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  const move = (e: KeyboardEvent<HTMLButtonElement>, index: number) => {
    let next = index;
    if (e.key === "ArrowRight") next = (index + 1) % tabs.length;
    else if (e.key === "ArrowLeft") next = (index - 1 + tabs.length) % tabs.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = tabs.length - 1;
    else return;
    e.preventDefault();
    const target = tabs[next];
    if (!target) return;
    onChange(target.id);
    refs.current[next]?.focus();
  };
  return (
    <div role="tablist" aria-label={label} className={cn("mb-4 flex gap-1 overflow-x-auto border-b border-border", className)}>
      {tabs.map((t, i) => {
        const ids = tabIds(idPrefix, t.id);
        const selected = t.id === value;
        return (
          <button
            key={t.id}
            ref={(el) => {
              refs.current[i] = el;
            }}
            role="tab"
            type="button"
            id={ids.tab}
            aria-selected={selected}
            aria-controls={ids.panel}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(t.id)}
            onKeyDown={(e) => move(e, i)}
            className={cn(
              "-mb-px whitespace-nowrap border-b-2 px-3 py-2 text-sm",
              selected ? "border-primary text-foreground" : "border-transparent text-muted-strong hover:text-foreground",
            )}
          >
            {t.label}
          </button>
        );
      })}
    </div>
  );
}
