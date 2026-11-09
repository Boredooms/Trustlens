// Halftone Wordmark Footer — a site footer whose wordmark is set enormous and cropped by the bottom
// edge, printed as a field of halftone dots. Each dot is sized by how much of the letter covers its
// cell, so the type keeps its edges at any scale. Move across it and the dots part around the
// pointer on springs, warming in colour as they are pushed off their place; click and a shock ring
// runs through the word. Above it sit the studio line, tracked link columns and a back-to-top,
// separated by a hairline, all over a fine print grain.
//
// Adapted from the 21st.dev registry component for this repo:
//   - named export (eslint `no-restricted-exports`); no "use client" (Vite SPA, not Next);
//   - preset colours as rgb() strings, and the colour parser accepts rgb() as well as hex
//     (check-tokens forbids hex literals outside src/styles/tokens.css);
//   - internal links ("/…") render as react-router <Link> so navigation stays in the SPA;
//   - all link columns sit inside ONE <nav aria-label="Footer"> (each column is a labelled group),
//     so the footer is a single landmark;
//   - reduced motion: the dots are drawn once and never animate.
// One file, React only. A 2D canvas for the dots and the grain, real anchors for the links. Every
// rule in the scoped <style> is .hwf- prefixed and nothing is fetched.
import * as React from "react";
import { Link } from "react-router-dom";

export interface HalftonePalette {
  /** The footer background. */
  background: string;
  /** The dots at rest, and the text. */
  ink: string;
  /** The colour a dot warms toward as it is pushed off its place. */
  warm: string;
}

export type HalftonePreset = "night" | "paper" | "ember" | "cobalt";

export interface FooterLink {
  label: string;
  /** "/path" → in-app link; "https://…" → external (opens in a new tab); omitted → plain text. */
  href?: string;
}

export interface FooterColumn {
  title: string;
  links: FooterLink[];
}

export interface HalftoneWordmarkFooterProps {
  /** The giant word printed in dots. Lowercase reads best. */
  wordmark?: string;
  /** Top-left studio line. */
  label?: string;
  /** The muted line under it. */
  meta?: string;
  /** Link columns along the top. */
  columns?: FooterColumn[];
  /** Show the back-to-top link. It scrolls the window to 0. Defaults to true. */
  backToTop?: boolean;
  /** Starting colours. Defaults to "night". */
  preset?: HalftonePreset;
  /** Colour overrides, merged over the preset (hex or rgb()). */
  palette?: { background?: string; ink?: string; warm?: string };
  /** Distance between dot centres, in CSS px. Defaults to 6. */
  dotGap?: number;
  /** How far the pointer pushes, in CSS px. Defaults to 80. */
  radius?: number;
  /** How much of the word's cap height hangs below the bottom edge, 0–0.6. Defaults to 0.2. */
  crop?: number;
  /** Print grain over everything, 0–1. Defaults to 0.5. */
  grain?: number;
  /** Pointer and click response. Defaults to true. */
  interactive?: boolean;
  /** Face for the wordmark. Heavy grotesks print best. */
  fontFamily?: string;
  /** Weight of the wordmark. Defaults to 800. */
  fontWeight?: number;
  /** Face for the small type. */
  monoFamily?: string;
  /** Minimum root height (px, clamp(), vw). The footer grows with its links; the word keeps its band. */
  height?: string;
  /** Extra root class names. */
  className?: string;
  /** Accessible name of the link landmark. Defaults to "Footer". */
  navLabel?: string;
}

const PRESETS: { [K in HalftonePreset]: HalftonePalette } = {
  night: { background: "rgb(12, 12, 11)", ink: "rgb(233, 228, 218)", warm: "rgb(233, 118, 43)" },
  paper: { background: "rgb(239, 235, 227)", ink: "rgb(23, 21, 15)", warm: "rgb(194, 54, 28)" },
  ember: { background: "rgb(22, 10, 6)", ink: "rgb(242, 196, 140)", warm: "rgb(255, 90, 31)" },
  cobalt: { background: "rgb(13, 27, 77)", ink: "rgb(223, 231, 255)", warm: "rgb(255, 205, 60)" },
};

const DEFAULT_COLUMNS: FooterColumn[] = [
  { title: "Work", links: [{ label: "Index" }, { label: "Archive" }, { label: "Journal" }] },
  { title: "Studio", links: [{ label: "About" }, { label: "Process" }, { label: "Careers" }] },
  { title: "Contact", links: [{ label: "hello@example.com" }] },
];

const SANS_STACK = '"Inter Tight", "Inter Variable", "Inter", "Helvetica Neue", Arial, system-ui, sans-serif';
const MONO_STACK = '"Geist Mono", "JetBrains Mono", "SF Mono", ui-monospace, Menlo, Consolas, monospace';

// #region halftone — pure helpers (unit-tested in halftone-wordmark-footer.test.ts)

/** "#rgb" / "#rrggbb" / "rgb(r, g, b)" → [r, g, b] in 0–255, or null for anything else. */
export function hwfColor(input: string): [number, number, number] | null {
  const s = (input || "").trim();
  const rgb = /^rgba?\(\s*(\d{1,3})[\s,]+(\d{1,3})[\s,]+(\d{1,3})/i.exec(s);
  if (rgb) return [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])].map((v) => Math.min(255, v)) as [number, number, number];
  const raw = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(s)?.[1];
  if (!raw) return null;
  const h = raw.length === 3 ? raw.split("").map((c) => c + c).join("") : raw;
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

/** Dot radius for a cell coverage in [0, 1]: area-true, so tone stays even. */
export function hwfRadius(coverage: number, gap: number): number {
  const c = coverage < 0 ? 0 : coverage > 1 ? 1 : coverage;
  return Math.sqrt(c) * gap * 0.56;
}

/**
 * One step of a dot's spring back to home, plus the push from a pointer at (px, py) within radius
 * r. Returns [x, y, vx, vy]. Away from the pointer a displaced dot always heads home and comes to rest.
 */
export function hwfStep(
  x: number, y: number, vx: number, vy: number,
  hx: number, hy: number, px: number, py: number, r: number,
): [number, number, number, number] {
  const dx = x - px;
  const dy = y - py;
  const d2 = dx * dx + dy * dy;
  if (r > 0 && d2 < r * r) {
    const d = Math.sqrt(d2) + 0.001;
    const f = (1 - d / r) * 2.6;
    vx += (dx / d) * f;
    vy += (dy / d) * f;
  }
  vx = (vx + (hx - x) * 0.05) * 0.84;
  vy = (vy + (hy - y) * 0.05) * 0.84;
  return [x + vx, y + vy, vx, vy];
}

/** How warm a dot is drawn: 0 at home, 1 once it is `span` px or more away. */
export function hwfWarmth(x: number, y: number, hx: number, hy: number, span: number): number {
  const d = Math.hypot(x - hx, y - hy);
  return span > 0 ? Math.min(1, d / span) : 0;
}

/** Font size that sets `measured` (width at 100px) to fill `width` exactly. */
export function hwfFitSize(measured: number, width: number): number {
  return measured > 0 ? (width / measured) * 100 : 0;
}

// #endregion

const HWF_CSS = `
.hwf-root {
  position: relative; width: 100%; overflow: hidden; isolation: isolate;
  /* The text flows; the word gets its own band below it, scaled with the width, so they never collide. */
  padding-bottom: clamp(110px, 28vw, 300px);
  background: var(--hwf-bg); color: var(--hwf-ink); -webkit-font-smoothing: antialiased;
}
.hwf-root canvas { position: absolute; inset: 0; width: 100%; height: 100%; display: block; max-width: none; }
.hwf-top {
  position: relative; z-index: 1; display: grid; grid-template-columns: minmax(0, 1.25fr) minmax(0, 3fr);
  gap: 24px; padding: clamp(22px, 3.4vw, 40px) clamp(20px, 3.4vw, 44px) 0;
  font-family: var(--hwf-mono); font-size: 10.5px; letter-spacing: .18em; text-transform: uppercase; line-height: 1.75;
}
.hwf-cols { display: grid; grid-template-columns: repeat(var(--hwf-cols, 3), minmax(0, 1fr)); gap: 24px; }
.hwf-brand strong { display: block; font-weight: 500; }
.hwf-brand span { opacity: .55; display: block; text-transform: none; letter-spacing: .04em; font-size: 11.5px; max-width: 34ch; }
.hwf-col h3 { margin: 0; font: inherit; opacity: .45; font-weight: 500; }
.hwf-col ul { list-style: none; margin: 0; padding: 0; }
.hwf-col li { padding: 2px 0; }
.hwf-col a, .hwf-col .hwf-text, .hwf-up {
  color: inherit; text-decoration: none; opacity: .82; background: none; border: 0; padding: 0;
  font: inherit; letter-spacing: inherit; text-transform: inherit;
}
.hwf-col a, .hwf-up {
  cursor: pointer;
  background-image: linear-gradient(currentColor, currentColor); background-size: 0% 1px;
  background-repeat: no-repeat; background-position: 0 100%; transition: opacity .25s ease, background-size .35s cubic-bezier(.2,.7,.1,1);
}
.hwf-col a:hover, .hwf-up:hover { opacity: 1; background-size: 100% 1px; }
.hwf-col a:focus-visible, .hwf-up:focus-visible { outline: 1px solid currentColor; outline-offset: 3px; opacity: 1; }
.hwf-rule {
  position: relative; z-index: 1; display: flex; justify-content: space-between; align-items: center; gap: 16px;
  margin: clamp(18px, 2.6vw, 30px) clamp(20px, 3.4vw, 44px) 0; padding-top: 12px;
  border-top: 0.5px solid color-mix(in srgb, var(--hwf-ink) 16%, transparent);
  font-family: var(--hwf-mono); font-size: 10.5px; letter-spacing: .18em; text-transform: uppercase;
}
.hwf-rule .hwf-note { opacity: .5; text-transform: none; letter-spacing: .04em; font-size: 11.5px; }
.hwf-sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
@media (max-width: 720px) {
  .hwf-top { grid-template-columns: minmax(0, 1fr); row-gap: 18px; }
  .hwf-cols { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); row-gap: 16px; }
  .hwf-col li { padding: 5px 0; }
  .hwf-rule { flex-direction: column; align-items: flex-start; gap: 8px; }
}
@media (prefers-reduced-motion: reduce) {
  .hwf-col a, .hwf-up { transition: none; }
}
`;

function FooterAnchor({ link }: { link: FooterLink }) {
  if (!link.href) return <span className="hwf-text">{link.label}</span>;
  if (link.href.startsWith("/")) return <Link to={link.href}>{link.label}</Link>;
  return (
    <a href={link.href} target="_blank" rel="noopener noreferrer">
      {link.label}
    </a>
  );
}

export function HalftoneWordmarkFooter({
  wordmark = "halden",
  label = "Halden Studio",
  meta = "©2026",
  columns = DEFAULT_COLUMNS,
  backToTop = true,
  preset = "night",
  palette,
  dotGap = 6,
  radius = 80,
  crop = 0.2,
  grain = 0.5,
  interactive = true,
  fontFamily = SANS_STACK,
  fontWeight = 800,
  monoFamily = MONO_STACK,
  height = "560px",
  className = "",
  navLabel = "Footer",
  children,
}: HalftoneWordmarkFooterProps & { children?: React.ReactNode }) {
  const colors = { ...(PRESETS[preset] || PRESETS.night), ...(palette || {}) };
  const rootRef = React.useRef<HTMLElement | null>(null);
  const canvasRef = React.useRef<HTMLCanvasElement | null>(null);
  const opts = React.useRef({ colors, dotGap, radius, crop, grain, interactive, fontFamily, fontWeight, wordmark });
  opts.current = { colors, dotGap, radius, crop, grain, interactive, fontFamily, fontWeight, wordmark };
  const key = [wordmark, dotGap, crop, grain, fontFamily, fontWeight, colors.background, colors.ink, colors.warm].join("|");

  React.useEffect(() => {
    const root = rootRef.current;
    const canvas = canvasRef.current;
    if (!root || !canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return; // jsdom / no canvas: the footer still renders its links

    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    let w = 0;
    let h = 0;
    let dpr = 1;
    let px = -1e5;
    let py = -1e5;
    let raf = 0;
    let visible = true;
    let awake = true;
    let ring = { x: 0, y: 0, t: -1 };
    // Flat arrays: x, y, vx, vy, hx, hy, r per dot.
    let dots = new Float32Array(0);
    let count = 0;
    let grainTile: HTMLCanvasElement | null = null;
    const ink = hwfColor(opts.current.colors.ink) ?? [233, 228, 218];
    const warm = hwfColor(opts.current.colors.warm) ?? [233, 118, 43];

    const layout = () => {
      const o = opts.current;
      const rect = root.getBoundingClientRect();
      w = Math.max(1, Math.round(rect.width));
      h = Math.max(1, Math.round(rect.height));
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);

      // Set the word once, at a size that fills the width, on a 1x mask.
      const mask = document.createElement("canvas");
      mask.width = w;
      mask.height = h;
      const m = mask.getContext("2d", { willReadFrequently: true });
      if (!m) return;
      m.font = o.fontWeight + " 100px " + o.fontFamily;
      const word = o.wordmark || " ";
      const fit = hwfFitSize(m.measureText(word).width, w * 1.02);
      m.font = o.fontWeight + " " + fit + "px " + o.fontFamily;
      const box = m.measureText(word);
      const cap = box.actualBoundingBoxAscent || fit * 0.72;
      const c = Math.max(0, Math.min(0.6, o.crop));
      m.fillStyle = "black";
      m.textBaseline = "alphabetic";
      m.fillText(word, (w - box.width) / 2, h + cap * c);
      const img = m.getImageData(0, 0, w, h).data;

      // Smaller dots on narrow screens keep the letters legible.
      const gap = Math.max(3, w < 520 ? Math.min(o.dotGap, 4) : o.dotGap);
      const cols = Math.ceil(w / gap);
      const rows = Math.ceil(h / gap);
      const tmp: number[] = [];
      for (let gy = 0; gy < rows; gy++) {
        for (let gx = 0; gx < cols; gx++) {
          // Coverage: average alpha over a 3×3 sample of the cell.
          let sum = 0;
          for (let sy = 0; sy < 3; sy++) {
            for (let sx = 0; sx < 3; sx++) {
              const x = Math.min(w - 1, Math.floor(gx * gap + ((sx + 0.5) * gap) / 3));
              const y = Math.min(h - 1, Math.floor(gy * gap + ((sy + 0.5) * gap) / 3));
              sum += img[(y * w + x) * 4 + 3] ?? 0;
            }
          }
          const cov = sum / (9 * 255);
          if (cov < 0.06) continue;
          const hx = gx * gap + gap / 2;
          const hy = gy * gap + gap / 2;
          tmp.push(hx, hy, 0, 0, hx, hy, hwfRadius(cov, gap));
        }
      }
      dots = new Float32Array(tmp);
      count = tmp.length / 7;

      // A fixed tile of print grain, drawn once and laid over every frame.
      grainTile = document.createElement("canvas");
      grainTile.width = 256;
      grainTile.height = 256;
      const g = grainTile.getContext("2d");
      if (g) {
        const id = g.createImageData(256, 256);
        for (let i = 0; i < id.data.length; i += 4) {
          const v = Math.random() * 255;
          id.data[i] = id.data[i + 1] = id.data[i + 2] = v;
          id.data[i + 3] = Math.random() < 0.5 ? 0 : 255;
        }
        g.putImageData(id, 0, 0);
      }
      awake = true;
    };

    const draw = (now: number) => {
      const o = opts.current;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = o.colors.background;
      ctx.fillRect(0, 0, w, h);
      const r = o.interactive && !reduced ? Math.max(0, o.radius) : 0;
      const ringAge = ring.t < 0 ? 1e9 : now - ring.t;
      const ringR = ringAge * 0.9;
      let moving = false;
      for (let i = 0; i < count; i++) {
        const j = i * 7;
        let x = dots[j]!;
        let y = dots[j + 1]!;
        let vx = dots[j + 2]!;
        let vy = dots[j + 3]!;
        const hx = dots[j + 4]!;
        const hy = dots[j + 5]!;
        if (!reduced) {
          if (ringAge < 900) {
            const dx = hx - ring.x;
            const dy = hy - ring.y;
            const d = Math.sqrt(dx * dx + dy * dy) + 0.001;
            const band = 1 - Math.min(1, Math.abs(d - ringR) / 26);
            if (band > 0) {
              const f = band * 3.2 * (1 - ringAge / 900);
              vx += (dx / d) * f;
              vy += (dy / d) * f;
            }
          }
          const s = hwfStep(x, y, vx, vy, hx, hy, px, py, r);
          [x, y, vx, vy] = s;
          if (Math.abs(vx) + Math.abs(vy) > 0.02 || Math.abs(x - hx) + Math.abs(y - hy) > 0.05) moving = true;
          else {
            x = hx;
            y = hy;
            vx = 0;
            vy = 0;
          }
          dots[j] = x;
          dots[j + 1] = y;
          dots[j + 2] = vx;
          dots[j + 3] = vy;
        }
        const k = hwfWarmth(x, y, hx, hy, 28);
        ctx.fillStyle =
          k > 0.02
            ? "rgb(" +
              Math.round(ink[0] + (warm[0] - ink[0]) * k) + "," +
              Math.round(ink[1] + (warm[1] - ink[1]) * k) + "," +
              Math.round(ink[2] + (warm[2] - ink[2]) * k) + ")"
            : o.colors.ink;
        ctx.beginPath();
        ctx.arc(x, y, dots[j + 6]!, 0, 6.2832);
        ctx.fill();
      }
      if (grainTile && o.grain > 0) {
        ctx.globalAlpha = Math.min(1, o.grain) * 0.09;
        ctx.globalCompositeOperation = "overlay";
        const pattern = ctx.createPattern(grainTile, "repeat");
        if (pattern) {
          ctx.fillStyle = pattern;
          ctx.fillRect(0, 0, w, h);
        }
        ctx.globalAlpha = 1;
        ctx.globalCompositeOperation = "source-over";
      }
      // Sleep once everything is home and nothing is pushing.
      awake = moving || ringAge < 900 || px > -1e4;
    };

    const loop = (now: number) => {
      raf = 0;
      if (!visible) return;
      draw(now);
      if (awake && !reduced) raf = requestAnimationFrame(loop);
    };
    const wake = () => {
      awake = true;
      if (!raf && visible) raf = requestAnimationFrame(loop);
    };
    const toLocal = (e: PointerEvent): [number, number] => {
      const b = canvas.getBoundingClientRect();
      return [e.clientX - b.left, e.clientY - b.top];
    };
    const onMove = (e: PointerEvent) => {
      if (!opts.current.interactive || e.pointerType === "touch") return;
      [px, py] = toLocal(e);
      wake();
    };
    const onLeave = () => {
      px = -1e5;
      py = -1e5;
      wake();
    };
    const onDown = (e: PointerEvent) => {
      if (!opts.current.interactive || reduced) return;
      if ((e.target as HTMLElement).closest("a,button")) return;
      const p = toLocal(e);
      ring = { x: p[0], y: p[1], t: performance.now() };
      wake();
    };

    layout();
    draw(performance.now());
    wake();
    root.addEventListener("pointermove", onMove);
    root.addEventListener("pointerleave", onLeave);
    root.addEventListener("pointerdown", onDown);
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(() => { layout(); wake(); }) : null;
    ro?.observe(root);
    const io =
      typeof IntersectionObserver !== "undefined"
        ? new IntersectionObserver((entries) => {
            visible = entries[0] ? entries[0].isIntersecting : true;
            if (visible) wake();
          })
        : null;
    io?.observe(root);
    // A web font that lands late re-sets the word in its real face.
    let alive = true;
    void document.fonts?.ready.then(() => {
      if (!alive) return;
      layout();
      wake();
    });
    return () => {
      alive = false;
      cancelAnimationFrame(raf);
      ro?.disconnect();
      io?.disconnect();
      root.removeEventListener("pointermove", onMove);
      root.removeEventListener("pointerleave", onLeave);
      root.removeEventListener("pointerdown", onDown);
    };
    // `key` captures every input that changes the layout; the rest is read from opts.current.
  }, [key]);

  const toTop = () => {
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    window.scrollTo({ top: 0, behavior: reduce ? "auto" : "smooth" });
  };

  return (
    <footer
      ref={rootRef}
      className={"hwf-root " + className}
      style={
        {
          minHeight: height,
          "--hwf-bg": colors.background,
          "--hwf-ink": colors.ink,
          "--hwf-mono": monoFamily,
          "--hwf-cols": String(Math.max(1, columns.length)),
        } as React.CSSProperties
      }
    >
      <style>{HWF_CSS}</style>
      <canvas ref={canvasRef} aria-hidden="true" />
      <span className="hwf-sr">{wordmark}</span>
      <div className="hwf-top">
        <div className="hwf-brand">
          <strong>{label}</strong>
          <span>{meta}</span>
        </div>
        <nav className="hwf-cols" aria-label={navLabel}>
          {columns.map((col) => {
            const id = `hwf-col-${col.title.toLowerCase().replace(/\W+/g, "-")}`;
            return (
              <div className="hwf-col" key={col.title} role="group" aria-labelledby={id}>
                <h3 id={id}>{col.title}</h3>
                <ul>
                  {col.links.map((l) => (
                    <li key={l.label}>
                      <FooterAnchor link={l} />
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </nav>
      </div>
      <div className="hwf-rule">
        <span className="hwf-note">{children}</span>
        {backToTop ? (
          <button type="button" className="hwf-up" onClick={toTop}>
            Back to top ↑
          </button>
        ) : null}
      </div>
    </footer>
  );
}
