import { Link } from "react-router-dom";
import { ArrowRight } from "lucide-react";

/**
 * The landing hero, ported from the Serene study: a full-bleed film behind one serif statement.
 * The palette here is deliberately surface-independent (the film is the background), so the light
 * values live in `.serene-*` classes in globals.css rather than in the token-mapped Tailwind colours.
 */
export function SereneHero() {
  return (
    <section id="top" aria-labelledby="hero-title" className="serene-hero relative h-screen w-full overflow-hidden">
      <video
        className="absolute inset-0 h-full w-full object-cover"
        src="/serene/hero.mp4"
        autoPlay
        muted
        loop
        playsInline
        preload="auto"
        aria-hidden
        tabIndex={-1}
      />
      <div aria-hidden className="serene-veil absolute inset-0" />

      <div className="relative z-10 flex h-full items-center justify-center px-6">
        <div className="-mt-[120px] flex w-full flex-col items-center text-center">
          <h1
            id="hero-title"
            className="serene-glow-title font-display text-[36px] leading-[0.95] tracking-tight md:text-7xl lg:text-[110px]"
          >
            <span className="block">Encrypted connection.</span>
            <span className="block">Unverified identity.</span>
          </h1>

          <p className="serene-sub mt-5 max-w-xl text-sm md:mt-7 md:text-base">
            A padlock proves the line is private — not who is on the other end. TrustLens checks what a
            page claims against the rules, and shows the evidence behind every verdict.
          </p>

          <div className="mt-6 flex flex-wrap items-center justify-center gap-3 md:mt-9">
            <Link to="/app" className="serene-cta group inline-flex items-center gap-2 rounded-full px-8 py-3.5 text-sm font-medium tracking-wide transition-all duration-300">
              Check a website
              <ArrowRight aria-hidden className="h-4 w-4 transition-transform duration-300 group-hover:translate-x-0.5" />
            </Link>
            <Link to="/features" className="serene-glass inline-flex items-center rounded-full px-7 py-3.5 text-sm font-medium tracking-wide transition-colors duration-300">
              What it checks
            </Link>
          </div>
        </div>
      </div>

      {/* Sound indicator */}
      <div className="absolute bottom-8 left-8 z-10 hidden items-center gap-3 md:flex">
        <span className="serene-glass flex h-10 w-10 items-center justify-center rounded-full">
          <span aria-hidden className="serene-bar h-[1.5px] w-3" />
        </span>
        <span className="serene-faint text-xs leading-tight">
          Every answer
          <br />
          cites evidence
        </span>
      </div>

      {/* Onward */}
      <div className="absolute inset-x-0 bottom-7 z-10 flex justify-center md:justify-end md:pr-12">
        <Link
          to="/how-it-works"
          className="serene-glass group flex items-center gap-3 rounded-full py-2 pl-5 pr-2 text-[11px] uppercase tracking-[0.18em] transition-colors duration-300"
        >
          How it works
          <span className="serene-hairline flex h-8 w-8 items-center justify-center rounded-full border transition-transform duration-300 group-hover:translate-y-0.5">
            <svg
              aria-hidden
              viewBox="0 0 24 24"
              fill="none"
              className="h-3.5 w-3.5"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M12 5v14" />
              <path d="m18 13-6 6-6-6" />
            </svg>
          </span>
        </Link>
      </div>
    </section>
  );
}
