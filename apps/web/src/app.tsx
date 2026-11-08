import { lazy } from "react";
import { createBrowserRouter, Navigate, RouterProvider, useParams, type RouteObject } from "react-router-dom";
import { AppShell } from "@/components/layout/AppShell";
import { PublicShell } from "@/components/layout/PublicShell";
import { RequireAuth, RouteError } from "@/components/layout/Guards";
import { Landing } from "@/routes/public/Landing";
import { Login, Register } from "@/routes/public/Login";
import { NotFound } from "@/routes/public/NotFound";

// Every /app/* route is code-split (FRONTEND_ARCHITECTURE.md §2).
const Overview = lazy(() => import("@/routes/app/Overview"));
const ScanIndex = lazy(() => import("@/routes/app/ScanIndex"));
const ScanReport = lazy(() => import("@/routes/app/ScanReport"));
const Messages = lazy(() => import("@/routes/app/Messages"));
const InvestigationView = lazy(() => import("@/routes/app/Investigation"));
const Intelligence = lazy(() => import("@/routes/app/Intelligence"));
const Campaigns = lazy(() => import("@/routes/app/Campaigns"));
const CampaignDetail = lazy(() => import("@/routes/app/CampaignDetail"));
const Organisations = lazy(() => import("@/routes/app/Organisations"));
const OrganisationDetail = lazy(() => import("@/routes/app/OrganisationDetail"));
const Certificates = lazy(() => import("@/routes/app/Certificates"));
const Reports = lazy(() => import("@/routes/app/Reports"));
const ReportDetail = lazy(() => import("@/routes/app/ReportDetail"));
const Developers = lazy(() => import("@/routes/app/Developers"));
const Settings = lazy(() => import("@/routes/app/Settings"));
const CertificateDetail = lazy(() => import("@/routes/app/CertificateDetail"));
const AuditLogs = lazy(() => import("@/routes/app/AuditLogs"));
const Appeals = lazy(() => import("@/routes/app/Appeals"));
const AppealDetail = lazy(() => import("@/routes/app/AppealDetail"));
const AcceptInvite = lazy(() => import("@/routes/app/AcceptInvite"));
const Appeal = lazy(() => import("@/routes/public/Appeal").then((m) => ({ default: m.Appeal })));
const Verify = lazy(() => import("@/routes/public/Verify").then((m) => ({ default: m.Verify })));
const HowItWorks = lazy(() => import("@/routes/public/InfoPages").then((m) => ({ default: m.HowItWorks })));
const PublicDevelopers = lazy(() => import("@/routes/public/InfoPages").then((m) => ({ default: m.PublicDevelopers })));
const SecurityPage = lazy(() => import("@/routes/public/InfoPages").then((m) => ({ default: m.SecurityPage })));

/** Emailed invitation links (`/invites/:token`) hand off to the authenticated accept route. */
function InviteRedirect() {
  const { token = "" } = useParams();
  return <Navigate to={`/app/invites/${encodeURIComponent(token)}`} replace />;
}

export const routes: RouteObject[] = [
  {
    path: "/",
    element: <PublicShell />,
    errorElement: <RouteError />,
    children: [
      { index: true, element: <Landing /> },
      { path: "login", element: <Login /> },
      { path: "register", element: <Register /> },
      { path: "how-it-works", element: <HowItWorks /> },
      { path: "developers", element: <PublicDevelopers /> },
      { path: "security", element: <SecurityPage /> },
      { path: "appeal", element: <Appeal /> },
      { path: "verify/:reportId", element: <Verify /> },
      { path: "invites/:token", element: <InviteRedirect /> },
      { path: "invite/:token", element: <InviteRedirect /> },
      { path: "*", element: <NotFound /> },
    ],
  },
  {
    path: "/app",
    element: (
      <RequireAuth>
        <AppShell />
      </RequireAuth>
    ),
    errorElement: <RouteError />,
    children: [
      { index: true, element: <Overview />, errorElement: <RouteError /> },
      { path: "scan", element: <ScanIndex />, errorElement: <RouteError /> },
      { path: "scan/:scanId", element: <ScanReport />, errorElement: <RouteError /> },
      { path: "messages", element: <Messages />, errorElement: <RouteError /> },
      { path: "investigations/:investigationId", element: <InvestigationView />, errorElement: <RouteError /> },
      { path: "intelligence", element: <Intelligence />, errorElement: <RouteError /> },
      { path: "campaigns", element: <Campaigns />, errorElement: <RouteError /> },
      { path: "campaigns/:campaignId", element: <CampaignDetail />, errorElement: <RouteError /> },
      { path: "organisations", element: <Organisations />, errorElement: <RouteError /> },
      { path: "organisations/:orgId", element: <OrganisationDetail />, errorElement: <RouteError /> },
      { path: "certificates", element: <Certificates />, errorElement: <RouteError /> },
      { path: "certificates/:certificateId", element: <CertificateDetail />, errorElement: <RouteError /> },
      { path: "appeals", element: <Appeals />, errorElement: <RouteError /> },
      { path: "appeals/:appealId", element: <AppealDetail />, errorElement: <RouteError /> },
      { path: "audit", element: <AuditLogs />, errorElement: <RouteError /> },
      { path: "invites/:token", element: <AcceptInvite />, errorElement: <RouteError /> },
      { path: "reports", element: <Reports />, errorElement: <RouteError /> },
      { path: "reports/:reportId", element: <ReportDetail />, errorElement: <RouteError /> },
      { path: "developers", element: <Developers />, errorElement: <RouteError /> },
      { path: "settings", element: <Settings />, errorElement: <RouteError /> },
      { path: "*", element: <NotFound inApp /> },
    ],
  },
];

const router = createBrowserRouter(routes);

export function App() {
  return <RouterProvider router={router} />;
}
