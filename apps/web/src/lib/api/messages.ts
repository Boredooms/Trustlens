// Message analysis (docs/03-backend/MESSAGE_ANALYSIS.md). Types are generated from OpenAPI.
import type { components } from "@trustlens/shared-types";
import { request } from "./client";

export type MessageAnalysis = components["schemas"]["MessageAnalysisOut"];
export type MessageAnalyseBody = components["schemas"]["MessageAnalyseRequest"];

export const messages = {
  analyse: (body: MessageAnalyseBody) =>
    request<MessageAnalysis>("POST", "/api/v1/messages/analyse", { body, idempotent: true }),
};

/** Problem-statement vocabulary, as returned by the API (never derived client-side). */
export const RISK_CLASS_LABEL: Record<string, string> = {
  confirmed_malicious: "Confirmed malicious",
  high: "High risk",
  suspicious: "Suspicious",
  low: "Low risk",
  inconclusive: "Inconclusive",
};

/** Demo samples (simulated). Mirrors apps/api/tests/fixtures/messages. */
export const SAMPLE_MESSAGES: { label: string; text: string; channel: "email" | "sms" }[] = [
  {
    label: "Fake fee demand (scam)",
    channel: "sms",
    text:
      "Northstar Admissions: Congratulations, your seat is provisionally allotted!\n" +
      "Pay the seat confirmation fee of Rs. 2,500 to fees@okaxis today only, or you will lose your seat.\n" +
      "Form: hxxps://apply[.]northstar-admissions[.]example/register",
  },
  {
    label: "Portal OTP phish (scam)",
    channel: "email",
    text:
      "From: Northstar University IT Desk <it-helpdesk@northstar-placement.example>\n\n" +
      "Dear student, your Northstar University portal account will be deactivated within 24 hours.\n" +
      "To keep access, log in at https://portal.northstar-placement.example/login and enter your password.\n" +
      "Then reply with the OTP sent to your phone to confirm your identity.",
  },
  {
    label: "Pushy but genuine fee reminder",
    channel: "email",
    text:
      "From: Northstar University Accounts <accounts@northstar-demo.example>\n\n" +
      "Final reminder: your semester fee of Rs 45,000 is due within 24 hours.\n" +
      "Pay only through the official portal https://pay.northstar-demo.example/fees or by UPI to fees@northstar-demo.\n" +
      "Northstar University will never ask for your OTP or password. Never share them with anyone.",
  },
  {
    label: "Urgent wording, no evidence",
    channel: "sms",
    text: "URGENT!!! Your account will be suspended within 24 hours.\nAct now to avoid losing access. This is your final notice.",
  },
];
