import { useEffect } from "react";
import { SereneHero } from "@/components/marketing/SereneHero";

/** The landing page is the opening statement and nothing else — every section is its own route. */
export function Landing() {
  useEffect(() => {
    document.title = "TrustLens — encrypted connection, unverified identity";
  }, []);

  return <SereneHero />;
}
