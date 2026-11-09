import { Fragment, useMemo } from "react";

export interface Indicator {
  value: string;
  kind: "url" | "domain" | "payee" | "email";
}

/**
 * Read-back of a pasted message with the indicators the SERVER extracted marked inline. Matching is
 * exact (case-insensitive) on the server's values; defanged forms ("hxxps://", "[.]") are refanged
 * for matching only. Rendered as text segments — never as HTML — so a pasted payload cannot run.
 */
export function IndicatorHighlights({ text, indicators, className }: { text: string; indicators: Indicator[]; className?: string }) {
  const segments = useMemo(() => {
    const refanged = text.replace(/hxxp/gi, "http").replace(/\[\.\]/g, ".");
    // Map positions in the refanged text back to the original by building both in parallel.
    const map: number[] = [];
    for (let i = 0, j = 0; i < text.length; ) {
      if (/^hxxp/i.test(text.slice(i, i + 4))) {
        for (let k = 0; k < 4; k++) map[j + k] = i + k;
        i += 4;
        j += 4;
      } else if (text.slice(i, i + 3) === "[.]") {
        map[j] = i;
        i += 3;
        j += 1;
      } else {
        map[j] = i;
        i += 1;
        j += 1;
      }
    }
    map.push(text.length);
    const hits: Array<{ start: number; end: number; kind: Indicator["kind"] }> = [];
    const lower = refanged.toLowerCase();
    for (const ind of [...indicators].sort((a, b) => b.value.length - a.value.length)) {
      const v = ind.value.toLowerCase();
      if (v.length < 3) continue;
      let from = 0;
      for (;;) {
        const at = lower.indexOf(v, from);
        if (at === -1) break;
        const start = map[at] ?? 0;
        const end = map[at + v.length] ?? text.length;
        if (!hits.some((h) => start < h.end && end > h.start)) hits.push({ start, end, kind: ind.kind });
        from = at + v.length;
      }
    }
    hits.sort((a, b) => a.start - b.start);
    const out: Array<{ text: string; kind?: Indicator["kind"] }> = [];
    let pos = 0;
    for (const h of hits) {
      if (h.start > pos) out.push({ text: text.slice(pos, h.start) });
      out.push({ text: text.slice(h.start, h.end), kind: h.kind });
      pos = h.end;
    }
    if (pos < text.length) out.push({ text: text.slice(pos) });
    return out;
  }, [text, indicators]);

  return (
    <p className={className}>
      {segments.map((s, i) =>
        s.kind ? (
          <mark key={i} className="indicator-mark" data-kind={s.kind}>
            {s.text}
            <span className="sr-only"> ({s.kind})</span>
          </mark>
        ) : (
          <Fragment key={i}>{s.text}</Fragment>
        ),
      )}
    </p>
  );
}
