import { screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { LONG, renderAt, resetHarness } from "@/test/harness";

afterEach(resetHarness);

describe("landing page", () => {
  it("opens on the hero statement and offers its two routes", async () => {
    renderAt("/");
    expect(
      await screen.findByRole("heading", { level: 1, name: /encrypted connection\. unverified identity/i }, LONG),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /check a website/i })).toHaveAttribute("href", "/app");
    expect(screen.getByRole("link", { name: /what it checks/i })).toHaveAttribute("href", "/features");
  });

  it("keeps one h1 and carries no footer", async () => {
    renderAt("/");
    await screen.findByRole("heading", { level: 1 }, LONG);
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(screen.queryByRole("navigation", { name: "Footer" })).toBeNull();
  });

  it("the floating nav reaches every promotional page", async () => {
    renderAt("/");
    const nav = await screen.findByRole("navigation", { name: "Main" }, LONG);
    for (const [name, href] of [
      ["Features", "/features"],
      ["Method", "/method"],
      ["Demo", "/demo"],
      ["Docs", "/docs"],
      ["About", "/about"],
      ["How it works", "/how-it-works"],
    ] as const) {
      expect(within(nav).getByRole("link", { name })).toHaveAttribute("href", href);
    }
  });
});

describe("promotional routes", () => {
  it("features page renders its own heading and the nav", async () => {
    renderAt("/features");
    expect(
      await screen.findByRole("heading", { level: 2, name: /six checks/i }, LONG),
    ).toBeInTheDocument();
  });

  it("docs page shows the SDK install command", async () => {
    renderAt("/docs");
    expect(await screen.findByText(/npm install @boredooms\/trustlens-sdk/i, undefined, LONG)).toBeInTheDocument();
  });

  it("about page states what the product will not claim", async () => {
    renderAt("/about");
    expect(
      await screen.findByRole("heading", { level: 3, name: /what we will not tell you/i }, LONG),
    ).toBeInTheDocument();
  });
});
