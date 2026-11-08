import { PageHeader } from "@/components/layout/PageHeader";
import { Card } from "@/components/ui/Card";
import { Skeleton } from "@/components/ui/Skeleton";
import { ErrorState } from "@/components/ui/States";
import { useMe } from "@/lib/query/hooks";
import { useAuth } from "@/lib/auth/AuthProvider";
import { DENSITIES, THEMES, useUiStore, type Density, type Theme } from "@/stores/ui";
import { env } from "@/lib/env";
import { humanise } from "@/lib/format";
import { cn } from "@/lib/utils/cn";
import { ClerkAccount, DevAccountNote } from "./settings/ClerkAccount";
import { DeleteAccount } from "./settings/DeleteAccount";
import { DemoCard } from "./settings/DemoCard";
import { PairedDevices } from "@/components/domain/PairedDevices";

const THEME_LABEL: Record<Theme, string> = { system: "Match system", light: "Light", dark: "Dark" };
const DENSITY_LABEL: Record<Density, string> = { default: "Default", compact: "Compact" };

function Segmented<T extends string>({
  legend,
  options,
  value,
  labels,
  onChange,
}: {
  legend: string;
  options: readonly T[];
  value: T;
  labels: Record<T, string>;
  onChange: (v: T) => void;
}) {
  return (
    <fieldset>
      <legend className="text-xs font-medium">{legend}</legend>
      <div className="mt-2 inline-flex rounded-md border border-border p-0.5">
        {options.map((o) => (
          <label
            key={o}
            className={cn(
              "cursor-pointer rounded-sm px-3 py-1.5 text-sm has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2",
              value === o ? "bg-surface-secondary text-foreground" : "text-muted-strong hover:text-foreground",
            )}
          >
            <input
              type="radio"
              name={legend}
              value={o}
              checked={value === o}
              onChange={() => onChange(o)}
              className="sr-only"
            />
            {labels[o]}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

export default function Settings() {
  const { theme, density, setTheme, setDensity } = useUiStore();
  const me = useMe();
  const { mode } = useAuth();
  return (
    <>
      <PageHeader title="Settings" subtitle="Your account and how the dashboard looks on this device." />
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card title="Appearance">
          <div className="flex flex-col gap-6">
            <Segmented legend="Theme" options={THEMES} value={theme} labels={THEME_LABEL} onChange={setTheme} />
            <Segmented legend="Density" options={DENSITIES} value={density} labels={DENSITY_LABEL} onChange={setDensity} />
          </div>
        </Card>
        <Card title="Account">
          {me.isPending ? (
            <Skeleton className="h-20 w-full" />
          ) : me.isError ? (
            <ErrorState error={me.error} title="We could not load your account" onRetry={() => void me.refetch()} compact />
          ) : (
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
              <dt className="text-muted">Name</dt>
              <dd>{me.data.display_name ?? "—"}</dd>
              <dt className="text-muted">Email</dt>
              <dd className="break-all font-mono text-xs">{me.data.email}</dd>
              <dt className="text-muted">Role</dt>
              <dd>{humanise(me.data.role)}</dd>
              <dt className="text-muted">Organisations</dt>
              <dd>
                {me.data.organisations.length === 0
                  ? "None"
                  : me.data.organisations.map((o) => `${o.name} (${humanise(o.role)})`).join(", ")}
              </dd>
              <dt className="text-muted">Sign-in</dt>
              <dd>{mode === "clerk" ? "Clerk" : "Development sign-in"}</dd>
            </dl>
          )}
        </Card>
        {mode === "clerk" ? <ClerkAccount /> : <DevAccountNote />}
        <Card title="Security">
          <p className="mb-3 text-sm text-muted-strong">
            Browsers paired with the TrustLens extension. Revoke any you no longer use; pair a new one from Developers.
          </p>
          <PairedDevices />
        </Card>
        {me.data ? <DemoCard isOperator={me.data.role === "operator"} /> : null}
        {me.data ? <DeleteAccount email={me.data.email} /> : null}
        <Card title="About">
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
            <dt className="text-muted">Version</dt>
            <dd className="font-mono text-xs">web/{env.appVersion}</dd>
            <dt className="text-muted">API</dt>
            <dd className="break-all font-mono text-xs">{env.apiBaseUrl}</dd>
            <dt className="text-muted">Demo mode</dt>
            <dd>{env.demoMode ? "On" : "Off"}</dd>
          </dl>
        </Card>
      </div>
    </>
  );
}
