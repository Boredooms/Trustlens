import { useEffect } from "react";
import { About, Demo, Docs, Features, FinalCta, Method } from "@/components/marketing/Sections";

/**
 * The promotional pages. Each is a route of its own so it can be linked, indexed and screenshotted
 * on its own — the landing page only carries the hero.
 */
function useTitle(title: string) {
  useEffect(() => {
    document.title = `${title} · TrustLens`;
  }, [title]);
}

export function FeaturesPage() {
  useTitle("What it checks");
  return (
    <div className="pt-10">
      <Features />
      <FinalCta />
    </div>
  );
}

export function MethodPage() {
  useTitle("The method");
  return (
    <div className="pt-10">
      <Method />
      <FinalCta />
    </div>
  );
}

export function DemoPage() {
  useTitle("Try the check");
  return (
    <div className="pt-10">
      <Demo />
      <FinalCta />
    </div>
  );
}

export function DocsPage() {
  useTitle("Docs");
  return (
    <div className="pt-10">
      <Docs />
      <FinalCta />
    </div>
  );
}

export function AboutPage() {
  useTitle("About");
  return (
    <div className="pt-10">
      <About />
      <FinalCta />
    </div>
  );
}
