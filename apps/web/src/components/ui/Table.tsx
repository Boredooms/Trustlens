import type { HTMLAttributes, ReactNode, TdHTMLAttributes, ThHTMLAttributes } from "react";
import { cn } from "@/lib/utils/cn";

export interface TableProps extends HTMLAttributes<HTMLTableElement> {
  caption?: string;
  children: ReactNode;
}

/** Semantic table. Low-priority columns should use `hidden md:table-cell` so 360 px never scrolls primary data. */
export function Table({ caption, className, children, ...rest }: TableProps) {
  return (
    <div className="w-full overflow-x-auto">
      <table className={cn("w-full border-collapse text-left text-sm", className)} {...rest}>
        {caption ? <caption className="sr-only">{caption}</caption> : null}
        {children}
      </table>
    </div>
  );
}

export function Th({ className, align = "left", ...rest }: ThHTMLAttributes<HTMLTableCellElement> & { align?: "left" | "right" }) {
  return (
    <th
      scope="col"
      className={cn(
        "sticky top-0 border-b border-border bg-surface-secondary px-4 py-2 text-xs font-medium text-muted",
        align === "right" ? "text-right" : "text-left",
        className,
      )}
      {...rest}
    />
  );
}

export function Td({ className, align = "left", ...rest }: TdHTMLAttributes<HTMLTableCellElement> & { align?: "left" | "right" }) {
  return (
    <td
      className={cn(
        "row-density border-b border-border px-4 align-middle",
        align === "right" ? "text-right tabular" : "text-left",
        className,
      )}
      {...rest}
    />
  );
}

export function Tr({ className, ...rest }: HTMLAttributes<HTMLTableRowElement>) {
  return <tr className={cn("transition-colors duration-150 hover:bg-surface-secondary", className)} {...rest} />;
}
