import { useState } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { MotionProvider } from "@/components/motion/Motion";
import { BlockEditor, blocksToMarkdown, toEditorBlocks, toWireBlocks, type EditorBlock } from "./BlockEditor";

function Harness({ initial, onState }: { initial: EditorBlock[]; onState: (b: EditorBlock[]) => void }) {
  const [blocks, setBlocks] = useState(initial);
  return (
    <MotionProvider>
      <BlockEditor
        blocks={blocks}
        label="Notes editor"
        onChange={(b) => {
          setBlocks(b);
          onState(b);
        }}
      />
    </MotionProvider>
  );
}

function setup(initial = toEditorBlocks([])) {
  let latest = initial;
  render(<Harness initial={initial} onState={(b) => (latest = b)} />);
  return { get: () => latest, user: userEvent.setup() };
}

describe("BlockEditor (notes; plain text only)", () => {
  it("turns markdown shortcuts into typed blocks", async () => {
    const { get, user } = setup();
    await user.type(screen.getByRole("textbox"), "## Infrastructure");
    expect(get()[0]).toMatchObject({ type: "heading", level: 2, text: "Infrastructure" });
  });

  it("Enter adds a block, lists continue, an empty list item ends the list", async () => {
    const { get, user } = setup();
    await user.type(screen.getByRole("textbox"), "- first{Enter}second{Enter}{Enter}after");
    expect(get().map((b) => [b.type, b.text])).toEqual([
      ["bullet", "first"],
      ["bullet", "second"],
      ["paragraph", "after"],
    ]);
  });

  it("Backspace on an empty block removes it and keeps one block at minimum", async () => {
    const { get, user } = setup([
      { id: "a", type: "paragraph", text: "keep" },
      { id: "b", type: "paragraph", text: "" },
    ]);
    const boxes = screen.getAllByRole("textbox");
    await user.click(boxes[1] as HTMLElement);
    await user.keyboard("{Backspace}");
    expect(get().map((b) => b.id)).toEqual(["a"]);
  });

  it("the slash menu changes the block type from the keyboard", async () => {
    const { get, user } = setup();
    await user.type(screen.getByRole("textbox"), "/");
    expect(screen.getByRole("listbox", { name: "Block type" })).toBeInTheDocument();
    await user.keyboard("{ArrowDown}{ArrowDown}{ArrowDown}{ArrowDown}{ArrowDown}{ArrowDown}{Enter}");
    expect(get()[0]?.type).toBe("todo");
  });

  it("stores markup as inert text and exports Markdown", () => {
    const blocks: EditorBlock[] = [
      { id: "1", type: "heading", level: 1, text: "Case" },
      { id: "2", type: "todo", text: "Report payee", checked: true },
      { id: "3", type: "code", text: "<img src=x onerror=alert(1)>" },
      { id: "4", type: "divider", text: "" },
      { id: "5", type: "paragraph", text: "" },
    ];
    const wire = toWireBlocks(blocks);
    expect(wire.map((b) => b.type)).toEqual(["heading", "todo", "code", "divider"]);
    expect(wire[2]?.text).toBe("<img src=x onerror=alert(1)>");
    expect(blocksToMarkdown(blocks)).toContain("- [x] Report payee");
  });

  it("renders a pasted HTML payload as text, never as markup", async () => {
    const { user } = setup();
    const box = screen.getByRole("textbox");
    await user.click(box);
    await user.paste("<img src=x onerror=alert(1)>");
    expect(document.querySelector("img")).toBeNull();
    expect((box as HTMLTextAreaElement).value).toBe("<img src=x onerror=alert(1)>");
  });
});
