// shadcn/ui Sheet (Radix Dialog), adapted: token colours, and slide/fade keyframes from globals.css
// (`data-sheet-*`) instead of the tailwindcss-animate plugin. Reduced motion zeroes the animation.
import * as React from "react";
import * as SheetPrimitive from "@radix-ui/react-dialog";
import { cva, type VariantProps } from "class-variance-authority";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

const Sheet = SheetPrimitive.Root;
const SheetTrigger = SheetPrimitive.Trigger;
const SheetClose = SheetPrimitive.Close;
const SheetPortal = SheetPrimitive.Portal;

const SheetOverlay = React.forwardRef<
  React.ElementRef<typeof SheetPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof SheetPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <SheetPrimitive.Overlay data-sheet-overlay="" className={cn("fixed inset-0 z-50 bg-backdrop", className)} {...props} ref={ref} />
));
SheetOverlay.displayName = SheetPrimitive.Overlay.displayName;

const sheetVariants = cva("fixed z-50 flex flex-col gap-4 bg-surface shadow-overlay", {
  variants: {
    side: {
      left: "inset-y-0 left-0 h-full w-3/4 border-r border-border sm:max-w-xs",
      right: "inset-y-0 right-0 h-full w-3/4 border-l border-border sm:max-w-sm",
    },
  },
  defaultVariants: { side: "right" },
});

interface SheetContentProps
  extends React.ComponentPropsWithoutRef<typeof SheetPrimitive.Content>,
    VariantProps<typeof sheetVariants> {
  hideClose?: boolean;
}

const SheetContent = React.forwardRef<React.ElementRef<typeof SheetPrimitive.Content>, SheetContentProps>(
  ({ side = "right", className, children, hideClose, ...props }, ref) => (
    <SheetPortal>
      <SheetOverlay />
      <SheetPrimitive.Content ref={ref} data-sheet-side={side ?? "right"} className={cn(sheetVariants({ side }), className)} {...props}>
        {children}
        {hideClose ? null : (
          <SheetPrimitive.Close className="absolute right-4 top-4 rounded-md p-1 text-muted-strong transition-colors hover:bg-surface-secondary hover:text-foreground">
            <X aria-hidden className="h-4 w-4" strokeWidth={1.5} />
            <span className="sr-only">Close</span>
          </SheetPrimitive.Close>
        )}
      </SheetPrimitive.Content>
    </SheetPortal>
  ),
);
SheetContent.displayName = SheetPrimitive.Content.displayName;

const SheetHeader = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn("flex flex-col gap-1.5 text-left", className)} {...props} />
);
SheetHeader.displayName = "SheetHeader";

const SheetFooter = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn("flex flex-col-reverse gap-2 sm:flex-row sm:justify-end", className)} {...props} />
);
SheetFooter.displayName = "SheetFooter";

const SheetTitle = React.forwardRef<
  React.ElementRef<typeof SheetPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof SheetPrimitive.Title>
>(({ className, ...props }, ref) => <SheetPrimitive.Title ref={ref} className={cn("text-lg font-medium text-foreground", className)} {...props} />);
SheetTitle.displayName = SheetPrimitive.Title.displayName;

const SheetDescription = React.forwardRef<
  React.ElementRef<typeof SheetPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof SheetPrimitive.Description>
>(({ className, ...props }, ref) => <SheetPrimitive.Description ref={ref} className={cn("text-sm text-muted-strong", className)} {...props} />);
SheetDescription.displayName = SheetPrimitive.Description.displayName;

export { Sheet, SheetPortal, SheetOverlay, SheetTrigger, SheetClose, SheetContent, SheetHeader, SheetFooter, SheetTitle, SheetDescription };
