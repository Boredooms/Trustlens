import { useEffect } from "react";
import { Link } from "react-router-dom";
import { buttonClasses } from "@/components/ui/Button";

export function NotFound({ inApp = false }: { inApp?: boolean }) {
  useEffect(() => {
    document.title = "Page not found · TrustLens";
  }, []);
  return (
    <div className="mx-auto flex max-w-reading flex-col gap-4 px-4 py-24">
      <p className="font-mono text-sm text-muted">404</p>
      <h1 className="text-3xl font-medium tracking-tight">There is no page at this address</h1>
      <p className="text-sm text-muted-strong">The link may be out of date, or the address was typed incorrectly.</p>
      <div>
        <Link to={inApp ? "/app" : "/"} className={buttonClasses("primary")}>
          {inApp ? "Go to the overview" : "Go to the home page"}
        </Link>
      </div>
    </div>
  );
}
