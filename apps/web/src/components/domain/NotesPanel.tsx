import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Clipboard, CloudOff, Keyboard, Loader2, NotebookPen } from "lucide-react";
import * as Popover from "@radix-ui/react-popover";
import { api, type Note, type NoteSubject } from "@/lib/api/endpoints";
import { isNotFound } from "@/lib/api/errors";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Skeleton } from "@/components/ui/Skeleton";
import { ErrorState } from "@/components/ui/States";
import { TimeText } from "./Text";
import { BlockEditor, blocksToMarkdown, toEditorBlocks, toWireBlocks, useDebouncedSave, type EditorBlock } from "./BlockEditor";

export const noteKey = (type: NoteSubject, id: string) => ["notes", type, id] as const;

type SaveState = "idle" | "saving" | "saved" | "error";

const HELP: Array<[string, string]> = [
  ["/", "Block menu"],
  ["# ## ###", "Headings"],
  ["- or 1.", "Lists"],
  ["[]", "To-do"],
  ["> or !", "Quote / callout"],
  ["``` ", "Code / indicator"],
  ["---", "Divider"],
  ["Alt+Shift+↑↓", "Move block"],
];

export interface NotesPanelProps {
  subjectType: NoteSubject;
  subjectId: string;
  title?: string;
  description?: string;
  className?: string;
}

/**
 * Private investigation notes next to a subject (PUT /api/v1/notes/{type}/{id}). Owns: loading
 * (skeleton), error (retry + request id), empty (blank editor), autosave state (saving / saved
 * <time> / not saved + retry), Markdown copy. Notes never change a finding or a decision.
 */
export function NotesPanel({ subjectType, subjectId, title = "Investigation notes", description = "Private to you. Autosaves. Never changes a decision.", className }: NotesPanelProps) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: noteKey(subjectType, subjectId), queryFn: () => api.notes.get(subjectType, subjectId), staleTime: 60_000, retry: false });
  const [blocks, setBlocks] = useState<EditorBlock[] | null>(null);
  const [state, setState] = useState<SaveState>("idle");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (q.data && blocks === null) setBlocks(toEditorBlocks(q.data.blocks));
  }, [q.data, blocks]);

  const save = useMutation({
    mutationFn: (b: EditorBlock[]) => api.notes.save(subjectType, subjectId, toWireBlocks(b)),
    onMutate: () => setState("saving"),
    onSuccess: (note: Note) => {
      qc.setQueryData(noteKey(subjectType, subjectId), note);
      void qc.invalidateQueries({ queryKey: ["notes", "recent"] });
      setState("saved");
    },
    onError: () => setState("error"),
  });

  useDebouncedSave(blocks, (b) => b && save.mutate(b), 900, blocks !== null);

  const status =
    state === "saving" ? (
      <span className="inline-flex items-center gap-1.5">
        <Loader2 aria-hidden className="h-3 w-3 animate-spin" strokeWidth={1.5} /> Saving…
      </span>
    ) : state === "error" ? (
      <span className="inline-flex items-center gap-1.5 text-danger">
        <CloudOff aria-hidden className="h-3 w-3" strokeWidth={1.5} /> Not saved
        <button type="button" className="underline underline-offset-2" onClick={() => blocks && save.mutate(blocks)}>
          Retry
        </button>
      </span>
    ) : q.data?.id ? (
      <span className="inline-flex items-center gap-1.5">
        <Check aria-hidden className="h-3 w-3" strokeWidth={1.5} /> Saved <TimeText iso={q.data.updated_at} />
      </span>
    ) : (
      <span>Not started</span>
    );

  return (
    <Card
      title={title}
      description={description}
      icon={NotebookPen}
      className={className}
      actions={
        <>
          <Popover.Root>
            <Popover.Trigger asChild>
              <Button variant="ghost" size="icon" className="h-7 w-7" aria-label="Editor shortcuts">
                <Keyboard aria-hidden className="h-3.5 w-3.5" strokeWidth={1.5} />
              </Button>
            </Popover.Trigger>
            <Popover.Portal>
              <Popover.Content align="end" sideOffset={6} className="z-50 w-64 rounded-lg border border-border bg-surface p-3 text-xs shadow-overlay">
                <p className="mb-2 font-medium text-foreground">Shortcuts</p>
                <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5">
                  {HELP.map(([k, v]) => (
                    <div key={k} className="contents">
                      <dt className="font-mono text-muted-strong">{k}</dt>
                      <dd className="text-muted">{v}</dd>
                    </div>
                  ))}
                </dl>
              </Popover.Content>
            </Popover.Portal>
          </Popover.Root>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            aria-label={copied ? "Copied as Markdown" : "Copy as Markdown"}
            disabled={!blocks}
            onClick={() => {
              if (!blocks) return;
              void navigator.clipboard?.writeText(blocksToMarkdown(blocks)).then(() => {
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              });
            }}
          >
            {copied ? <Check aria-hidden className="h-3.5 w-3.5" strokeWidth={1.5} /> : <Clipboard aria-hidden className="h-3.5 w-3.5" strokeWidth={1.5} />}
          </Button>
        </>
      }
      footer={<span role="status" aria-live="polite">{status}</span>}
    >
      {q.isPending ? (
        <div role="status" aria-label="Loading notes" className="flex flex-col gap-2">
          <Skeleton className="h-5 w-2/3" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-5/6" />
        </div>
      ) : q.isError && !isNotFound(q.error) ? (
        <ErrorState error={q.error} title="We could not load your notes" onRetry={() => void q.refetch()} retrying={q.isFetching} compact />
      ) : q.isError ? (
        <p className="text-sm text-muted-strong">Notes are available once this item is visible to you.</p>
      ) : blocks ? (
        <BlockEditor blocks={blocks} onChange={setBlocks} label={`${title} editor`} />
      ) : null}
    </Card>
  );
}
