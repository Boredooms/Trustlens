/**
 * Settings — rebuilt on the shadcn/app-1 component set (Avatar, Badge, Card parts, Progress,
 * Separator, Label) with TrustLens tokens. Panels and the states each one owns:
 *
 *   Profile hero      loading (skeleton) · error (retry) · ready
 *   KPI row           per tile: loading · unavailable · value
 *   Appearance        always ready (local preference)
 *   Account details   loading · error · ready
 *   Sign-in           Clerk UserProfile themed from tokens, or the dev sign-in note
 *   Paired browsers   loading · error · empty · list   (domain/PairedDevices)
 *   Demo controls     operators only                   (settings/DemoCard)
 *   Danger zone       typed-email confirmation          (settings/DeleteAccount)
 *   About             build + API origin (public values only)
 */
import type { ReactNode } from "react";
import { Building2, Gauge, Laptop, Monitor, Moon, Palette, Rows3, ShieldCheck, Sun, UserRound, type LucideIcon } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { PairedDevices } from "@/components/domain/PairedDevices";
import { AnimatedNumber, Reveal, Stagger, StaggerItem } from "@/components/motion/Motion";
import { Avatar, AvatarFallback, initialsOf } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { CardContent, CardDescription, CardHeader, CardRoot, CardTitle } from "@/components/ui/Card";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/Skeleton";
import { ErrorState } from "@/components/ui/States";
import { UserAvatarImage } from "@/components/ui/app-1-utils/user-avatar";
import { TimeText } from "@/components/domain/Text";
import { listData } from "@/lib/api/endpoints";
import { useDevices, useMe, useOverview } from "@/lib/query/hooks";
import { useAuth } from "@/lib/auth/AuthProvider";
import { DENSITIES, THEMES, useUiStore, type Density, type Theme } from "@/stores/ui";
import { env } from "@/lib/env";
import { humanise, plural } from "@/lib/format";
import { cn } from "@/lib/utils";
import { ClerkAccount, DevAccountNote } from "./settings/ClerkAccount";
import { DeleteAccount } from "./settings/DeleteAccount";
import { DemoCard } from "./settings/DemoCard";

const THEME_LABEL: Record<Theme, string> = { system: "Match system", light: "Light", dark: "Dark" };
const THEME_ICON: Record<Theme, LucideIcon> = { system: Monitor, light: Sun, dark: Moon };
const DENSITY_LABEL: Record<Density, string> = { default: "Comfortable", compact: "Compact" };

// ── Profile hero ──────────────────────────────────────────────────────────────

function ProfileHero() {
  const me = useMe();
  const { mode } = useAuth();
  return (
    <section aria-label="Profile" className="mesh-panel rounded-xl border border-border shadow-raised">
      <div className="flex flex-col gap-6 p-6 md:flex-row md:items-center md:justify-between md:p-8">
        <div className="flex min-w-0 items-center gap-5">
          <Avatar className="h-16 w-16 border-border-strong shadow-raised md:h-20 md:w-20">
            {mode === "clerk" ? <UserAvatarImage /> : null}
            <AvatarFallback className="font-display text-2xl">{me.data ? initialsOf(me.data.display_name || me.data.email) : "·"}</AvatarFallback>
          </Avatar>
          <div className="min-w-0">
            {me.isPending ? (
              <>
                <Skeleton className="h-8 w-56" />
                <Skeleton className="mt-2 h-4 w-40" />
              </>
            ) : me.isError ? (
              <ErrorState error={me.error} title="We could not load your profile" onRetry={() => void me.refetch()} retrying={me.isFetching} compact />
            ) : (
              <>
                <p className="font-display text-3xl leading-tight text-foreground md:text-4xl">{me.data.display_name || me.data.email}</p>
                <p className="mt-1 truncate font-mono text-xs text-muted-strong">{me.data.email}</p>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <Badge variant="outline">
                    <UserRound aria-hidden className="h-3 w-3" strokeWidth={1.5} />
                    {humanise(me.data.role)}
                  </Badge>
                  <Badge variant="secondary">
                    <ShieldCheck aria-hidden className="h-3 w-3" strokeWidth={1.5} />
                    {mode === "clerk" ? "Signed in with Clerk" : "Development sign-in"}
                  </Badge>
                  <Badge variant="outline">{plural(me.data.organisations.length, "organisation")}</Badge>
                </div>
              </>
            )}
          </div>
        </div>
        <dl className="grid shrink-0 grid-cols-2 gap-x-8 gap-y-1 text-xs md:text-right">
          <dt className="text-muted">Member since</dt>
          <dd className="text-foreground">{me.data ? <TimeText iso={me.data.created_at} /> : "—"}</dd>
          <dt className="text-muted">Last sign-in</dt>
          <dd className="text-foreground">{me.data?.last_login_at ? <TimeText iso={me.data.last_login_at} /> : "—"}</dd>
        </dl>
      </div>
    </section>
  );
}

// ── KPI row (app-1 STATS pattern, real numbers) ──────────────────────────────

function Kpi({ label, icon: Icon, children, hint }: { label: string; icon: LucideIcon; children: ReactNode; hint: ReactNode }) {
  return (
    <CardRoot className="sheen h-full">
      <CardHeader className="flex-row items-center justify-between gap-2 space-y-0 pb-2">
        <CardTitle className="text-xs font-medium uppercase tracking-wide text-muted">{label}</CardTitle>
        <span aria-hidden className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-border bg-surface-secondary">
          <Icon className="h-3.5 w-3.5 text-muted-strong" strokeWidth={1.5} />
        </span>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        <div className="font-display text-[2.75rem] leading-none text-foreground">{children}</div>
        <div className="text-xs text-muted">{hint}</div>
      </CardContent>
    </CardRoot>
  );
}

function KpiRow() {
  const me = useMe();
  const devices = useDevices();
  const overview = useOverview();
  const quota = overview.data?.quota ?? null;
  const pct = quota ? Math.min(100, Math.round((quota.scans_used / Math.max(1, quota.scans_limit)) * 100)) : 0;
  const theme = useUiStore((s) => s.theme);
  const ThemeIcon = THEME_ICON[theme];
  return (
    <Stagger className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <StaggerItem index={0} className="h-full">
        <Kpi label="Organisations" icon={Building2} hint={me.data ? (me.data.organisations.map((o) => o.name).join(", ") || "Not a member of any organisation") : me.isError ? "Unavailable" : "Loading"}>
          <AnimatedNumber face="display" value={me.data ? me.data.organisations.length : null} />
        </Kpi>
      </StaggerItem>
      <StaggerItem index={1} className="h-full">
        <Kpi label="Paired browsers" icon={Laptop} hint={devices.isError ? "Unavailable" : "Extension devices with a live token"}>
          <AnimatedNumber face="display" value={devices.data ? listData(devices.data).length : null} />
        </Kpi>
      </StaggerItem>
      <StaggerItem index={2} className="h-full">
        <Kpi
          label="Scans this period"
          icon={Gauge}
          hint={
            quota ? (
              <div className="flex flex-col gap-1.5">
                <Progress value={pct} aria-label="Scan quota used" aria-valuetext={`${quota.scans_used} of ${quota.scans_limit} scans used`} />
                <span>
                  {quota.scans_used} of {quota.scans_limit} · resets <TimeText iso={quota.resets_at} />
                </span>
              </div>
            ) : overview.isPending ? (
              "Loading"
            ) : (
              "Quota unavailable"
            )
          }
        >
          <AnimatedNumber face="display" value={quota ? quota.scans_used : null} />
        </Kpi>
      </StaggerItem>
      <StaggerItem index={3} className="h-full">
        <Kpi label="Theme" icon={Palette} hint="Saved on this device only">
          <span className="inline-flex items-center gap-2 text-3xl">
            <ThemeIcon aria-hidden className="h-6 w-6 text-muted-strong" strokeWidth={1.5} />
            {THEME_LABEL[theme]}
          </span>
        </Kpi>
      </StaggerItem>
    </Stagger>
  );
}

// ── Appearance ───────────────────────────────────────────────────────────────

/** A miniature of the dashboard rendered with that theme's own tokens (scoped `.dark` / `.theme-light`). */
function ThemePreview({ theme }: { theme: Theme }) {
  const half = (cls: string) => (
    <div className={cn(cls, "app-canvas flex h-full flex-1 gap-1.5 p-2")}>
      <div className="w-1/4 rounded-sm border border-border bg-surface-secondary" />
      <div className="flex flex-1 flex-col gap-1.5">
        <div className="h-2 w-2/3 rounded-sm bg-foreground" />
        <div className="flex-1 rounded-sm border border-border bg-surface" />
      </div>
    </div>
  );
  return (
    <div aria-hidden className="flex h-20 overflow-hidden rounded-md border border-border">
      {theme === "system" ? (
        <>
          {half("theme-light")}
          {half("dark")}
        </>
      ) : (
        half(theme === "dark" ? "dark" : "theme-light")
      )}
    </div>
  );
}

function Appearance() {
  const { theme, density, setTheme, setDensity } = useUiStore();
  return (
    <CardRoot id="appearance">
      <CardHeader>
        <CardTitle>Appearance</CardTitle>
        <CardDescription>How the dashboard looks on this device. Nothing here is sent to the server.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-6">
        <fieldset>
          <legend className="mb-3 text-xs font-medium text-foreground">Theme</legend>
          <div className="grid grid-cols-3 gap-3">
            {THEMES.map((t) => {
              const Icon = THEME_ICON[t];
              const active = theme === t;
              return (
                <label
                  key={t}
                  className={cn(
                    "group flex cursor-pointer flex-col gap-2 rounded-lg border p-2 transition-[border-color,box-shadow] duration-fast has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring",
                    active ? "border-border-strong shadow-raised" : "border-border hover:border-border-strong",
                  )}
                >
                  <input type="radio" name="theme" value={t} checked={active} onChange={() => setTheme(t)} className="sr-only" />
                  <ThemePreview theme={t} />
                  <span className="flex items-center gap-1.5 px-0.5 text-xs">
                    <Icon aria-hidden className="h-3.5 w-3.5 text-muted-strong" strokeWidth={1.5} />
                    <span className={active ? "text-foreground" : "text-muted-strong"}>{THEME_LABEL[t]}</span>
                    {active ? <span className="ml-auto h-1.5 w-1.5 rounded-full bg-foreground" /> : null}
                  </span>
                </label>
              );
            })}
          </div>
        </fieldset>
        <Separator />
        <fieldset>
          <legend className="mb-3 flex items-center gap-1.5 text-xs font-medium text-foreground">
            <Rows3 aria-hidden className="h-3.5 w-3.5 text-muted-strong" strokeWidth={1.5} />
            Density
          </legend>
          <div className="inline-flex rounded-md border border-border bg-surface-secondary p-0.5">
            {DENSITIES.map((d) => (
              <Label
                key={d}
                className={cn(
                  "cursor-pointer rounded-sm px-3 py-1.5 text-sm font-normal transition-colors duration-fast has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring",
                  density === d ? "bg-surface text-foreground shadow-card" : "text-muted-strong hover:text-foreground",
                )}
              >
                <input type="radio" name="density" value={d} checked={density === d} onChange={() => setDensity(d)} className="sr-only" />
                {DENSITY_LABEL[d]}
              </Label>
            ))}
          </div>
          <p className="mt-2 text-xs text-muted">Compact tightens table and list rows; text size never changes.</p>
        </fieldset>
      </CardContent>
    </CardRoot>
  );
}

// ── Account details ──────────────────────────────────────────────────────────

function AccountDetails() {
  const me = useMe();
  const { mode } = useAuth();
  return (
    <CardRoot>
      <CardHeader>
        <CardTitle>Account</CardTitle>
        <CardDescription>What TrustLens stores about you. Identity itself lives with Clerk.</CardDescription>
      </CardHeader>
      <CardContent>
        {me.isPending ? (
          <Skeleton className="h-32 w-full" />
        ) : me.isError ? (
          <ErrorState error={me.error} title="We could not load your account" onRetry={() => void me.refetch()} retrying={me.isFetching} compact />
        ) : (
          <dl className="grid grid-cols-[minmax(7rem,auto)_1fr] gap-x-4 gap-y-3 text-sm">
            <dt className="text-muted">Name</dt>
            <dd>{me.data.display_name ?? "—"}</dd>
            <dt className="text-muted">Email</dt>
            <dd className="break-all font-mono text-xs">{me.data.email}</dd>
            <dt className="text-muted">Role</dt>
            <dd>{humanise(me.data.role)}</dd>
            <dt className="text-muted">Organisations</dt>
            <dd className="flex flex-wrap gap-1.5">
              {me.data.organisations.length === 0 ? (
                <span>None</span>
              ) : (
                me.data.organisations.map((o) => (
                  <Badge key={o.id} variant="outline">
                    {o.name} · {humanise(o.role)}
                  </Badge>
                ))
              )}
            </dd>
            <dt className="text-muted">Sign-in</dt>
            <dd>{mode === "clerk" ? "Clerk" : "Development sign-in"}</dd>
          </dl>
        )}
      </CardContent>
    </CardRoot>
  );
}

function About() {
  return (
    <CardRoot>
      <CardHeader>
        <CardTitle>About</CardTitle>
        <CardDescription>Build information. Public values only.</CardDescription>
      </CardHeader>
      <CardContent>
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
          <dt className="text-muted">Version</dt>
          <dd className="font-mono text-xs">web/{env.appVersion}</dd>
          <dt className="text-muted">API</dt>
          <dd className="break-all font-mono text-xs">{env.apiBaseUrl}</dd>
          <dt className="text-muted">Demo mode</dt>
          <dd>{env.demoMode ? "On" : "Off"}</dd>
        </dl>
      </CardContent>
    </CardRoot>
  );
}

export default function Settings() {
  const me = useMe();
  const { mode } = useAuth();
  return (
    <>
      <PageHeader eyebrow="Workspace" title="Settings" subtitle="Your profile, sign-in, devices and how the dashboard looks on this device." />
      <div className="flex flex-col gap-6">
        <Reveal>
          <ProfileHero />
        </Reveal>
        <KpiRow />
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <Reveal>
            <Appearance />
          </Reveal>
          <Reveal delay={0.04}>
            <AccountDetails />
          </Reveal>
        </div>
        <Reveal>{mode === "clerk" ? <ClerkAccount /> : <DevAccountNote />}</Reveal>
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <CardRoot>
            <CardHeader>
              <CardTitle>Paired browsers</CardTitle>
              <CardDescription>Browsers paired with the TrustLens extension. Revoke any you no longer use; pair a new one from Developers.</CardDescription>
            </CardHeader>
            <CardContent>
              <PairedDevices />
            </CardContent>
          </CardRoot>
          <About />
        </div>
        {me.data ? <DemoCard isOperator={me.data.role === "operator"} /> : null}
        {me.data ? <DeleteAccount email={me.data.email} /> : null}
      </div>
    </>
  );
}
