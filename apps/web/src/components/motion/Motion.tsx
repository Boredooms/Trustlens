import { Children, Component, type ReactNode } from "react";
import { MotionConfig, m, LazyMotion, domAnimation, useReducedMotion } from "motion/react";
import NumberFlow, { type Format } from "@number-flow/react";
import { STAGGER_CAP, transitions, variants } from "@/lib/motion";
import { cn } from "@/lib/utils/cn";

/**
 * Root motion context: `reducedMotion="user"` makes every Motion component drop transforms when the
 * OS asks for reduced motion (opacity still fades, ≤ base duration). LazyMotion keeps the bundle to
 * the DOM-animation feature set; `m.*` components below rely on it.
 */
export function MotionProvider({ children }: { children: ReactNode }) {
  return (
    <LazyMotion features={domAnimation}>
      <MotionConfig reducedMotion="user" transition={transitions.enter}>
        {children}
      </MotionConfig>
    </LazyMotion>
  );
}

export interface RevealProps {
  children: ReactNode;
  className?: string;
  /** Seconds. Use sparingly — the grammar prefers a parent <Stagger>. */
  delay?: number;
  as?: "div" | "section" | "li" | "article";
}

/** `enter` grammar: fade + 6 px rise once, on mount. */
export function Reveal({ children, className, delay = 0, as = "div" }: RevealProps) {
  const Comp = m[as];
  return (
    <Comp
      className={className}
      initial="hidden"
      animate="visible"
      variants={variants.enter}
      transition={{ ...transitions.enter, delay }}
    >
      {children}
    </Comp>
  );
}

export interface StaggerProps {
  children: ReactNode;
  className?: string;
  as?: "div" | "ul" | "ol" | "section";
}

/**
 * `stagger` grammar. Wrap children in <StaggerItem>. Items past STAGGER_CAP render without delay, so a
 * 200-row list costs the same entrance time as a 12-row one.
 */
export function Stagger({ children, className, as = "div" }: StaggerProps) {
  const Comp = m[as];
  return (
    <Comp className={className} initial="hidden" animate="visible" variants={variants.list}>
      {children}
    </Comp>
  );
}

export interface StaggerItemProps {
  children: ReactNode;
  className?: string;
  as?: "div" | "li" | "section" | "article";
  index?: number;
}

export function StaggerItem({ children, className, as = "div", index = 0 }: StaggerItemProps) {
  const Comp = m[as];
  // Past the cap, show immediately: the variant still resolves but with no perceptible delay.
  return (
    <Comp className={className} variants={index >= STAGGER_CAP ? variants.fade : variants.enter}>
      {children}
    </Comp>
  );
}

/** Convenience: stagger a plain array of nodes without hand-wrapping each one. */
export function StaggerList({ children, className, itemClassName }: { children: ReactNode; className?: string; itemClassName?: string }) {
  return (
    <Stagger as="ul" className={className}>
      {Children.toArray(children).map((child, i) => (
        <StaggerItem as="li" key={i} index={i} className={itemClassName}>
          {child}
        </StaggerItem>
      ))}
    </Stagger>
  );
}

export interface AnimatedNumberProps {
  value: number | null | undefined;
  className?: string;
  /** Shown when value is null/undefined (unknown is not zero). */
  fallback?: string;
  format?: Format;
  suffix?: string;
  /** "mono" for data (tables, inline scores); "display" for hero numbers (KPI tiles). */
  face?: "mono" | "display";
}

/**
 * `update` grammar for live numbers: NumberFlow rolls only the digits that changed. Screen readers get
 * the plain number (NumberFlow renders accessible text), and reduced motion disables the roll.
 */
export function AnimatedNumber({ value, className, fallback = "—", format, suffix, face = "mono" }: AnimatedNumberProps) {
  const faceCls = face === "display" ? "font-display tabular" : "font-mono tabular";
  const reduce = useReducedMotion();
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return <span className={cn(faceCls, className)}>{fallback}</span>;
  }
  const plain = (
    <span className={cn(faceCls, className)}>
      {new Intl.NumberFormat(undefined, format).format(value)}
      {suffix}
    </span>
  );
  return (
    <NumberFlowBoundary fallback={plain}>
      <NumberFlow value={value} format={format} suffix={suffix} animated={!reduce} className={cn(faceCls, className)} />
    </NumberFlowBoundary>
  );
}

/**
 * NumberFlow is a custom element. Where it cannot upgrade (jsdom, a blocked custom-elements
 * registry) it throws on update; the number must still show, so this boundary renders it as text.
 */
class NumberFlowBoundary extends Component<{ fallback: ReactNode; children: ReactNode }, { failed: boolean }> {
  override state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  override componentDidCatch() {
    /* intentionally silent: the plain-text fallback is the complete, accessible representation */
  }
  override render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}
