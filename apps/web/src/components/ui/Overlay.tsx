import type { ReactNode } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import * as RTooltip from "@radix-ui/react-tooltip";
import { X } from "lucide-react";
import { cn } from "@/lib/utils/cn";

export interface ModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  /** Prevent closing on backdrop click (destructive action in progress). */
  dismissable?: boolean;
}

/** Radix Dialog: focus trapped and restored, Esc closes. Max width 560 px. */
export function Modal({ open, onOpenChange, title, description, children, footer, dismissable = true }: ModalProps) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-backdrop" />
        <Dialog.Content
          onPointerDownOutside={(e) => {
            if (!dismissable) e.preventDefault();
          }}
          onEscapeKeyDown={(e) => {
            if (!dismissable) e.preventDefault();
          }}
          className="fixed left-1/2 top-1/2 z-50 flex max-h-[90vh] w-[calc(100vw-32px)] max-w-modal -translate-x-1/2 -translate-y-1/2 flex-col rounded-lg border border-border bg-surface shadow-overlay"
        >
          <div className="flex items-start justify-between gap-4 border-b border-border px-5 py-4">
            <div>
              <Dialog.Title className="text-lg font-medium">{title}</Dialog.Title>
              {description ? (
                <Dialog.Description className="mt-1 text-sm text-muted-strong">{description}</Dialog.Description>
              ) : (
                <Dialog.Description className="sr-only">{title}</Dialog.Description>
              )}
            </div>
            <Dialog.Close
              aria-label="Close"
              className="rounded-sm p-1 text-muted-strong hover:bg-surface-secondary hover:text-foreground"
            >
              <X aria-hidden className="h-4 w-4" strokeWidth={1.5} />
            </Dialog.Close>
          </div>
          <div className="overflow-y-auto px-5 py-4">{children}</div>
          {footer ? (
            <div className="flex justify-end gap-3 border-t border-border px-5 py-3">{footer}</div>
          ) : null}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export interface DrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: ReactNode;
  children: ReactNode;
  side?: "right" | "left";
  widthClass?: string;
}

/** 480 px drawer from the right (evidence, node detail). Left variant used for the mobile nav. */
export function Drawer({ open, onOpenChange, title, description, children, side = "right", widthClass }: DrawerProps) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-backdrop" />
        <Dialog.Content
          className={cn(
            "fixed inset-y-0 z-50 flex w-full flex-col border-border bg-surface shadow-overlay",
            side === "right" ? "right-0 border-l" : "left-0 border-r",
            widthClass ?? "max-w-drawer",
          )}
        >
          <div className="flex items-start justify-between gap-4 border-b border-border px-5 py-4">
            <div>
              <Dialog.Title className="text-lg font-medium">{title}</Dialog.Title>
              {description ? (
                <Dialog.Description className="mt-1 text-sm text-muted-strong">{description}</Dialog.Description>
              ) : (
                <Dialog.Description className="sr-only">{title}</Dialog.Description>
              )}
            </div>
            <Dialog.Close
              aria-label="Close"
              className="rounded-sm p-1 text-muted-strong hover:bg-surface-secondary hover:text-foreground"
            >
              <X aria-hidden className="h-4 w-4" strokeWidth={1.5} />
            </Dialog.Close>
          </div>
          <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export interface TooltipProps {
  content: ReactNode;
  children: ReactNode;
  side?: "top" | "bottom" | "left" | "right";
}

/** Hover and keyboard-focus tooltip. The trigger must be focusable (button or link). */
export function Tooltip({ content, children, side = "top" }: TooltipProps) {
  return (
    <RTooltip.Root>
      <RTooltip.Trigger asChild>{children}</RTooltip.Trigger>
      <RTooltip.Portal>
        <RTooltip.Content
          side={side}
          sideOffset={6}
          collisionPadding={12}
          className="z-50 max-w-xs rounded-md border border-border bg-surface px-3 py-2 text-xs text-foreground shadow-overlay"
        >
          {content}
        </RTooltip.Content>
      </RTooltip.Portal>
    </RTooltip.Root>
  );
}

export const TooltipProvider = RTooltip.Provider;
