"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import { ChevronDown } from "lucide-react";

interface CollapsibleProps {
  title: string;
  icon?: React.ReactNode;
  defaultOpen?: boolean;
  badge?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}

function Collapsible({ title, icon, defaultOpen = false, badge, children, className }: CollapsibleProps) {
  const [open, setOpen] = React.useState(defaultOpen);

  return (
    <div className={cn("rounded-xl border border-zinc-800 bg-zinc-950 overflow-hidden", className)}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex w-full items-center justify-between p-5 text-left transition-colors hover:bg-zinc-900/50"
      >
        <div className="flex items-center gap-3">
          {icon && <span className="text-zinc-400">{icon}</span>}
          <h3 className="text-sm font-semibold text-zinc-100">{title}</h3>
          {badge}
        </div>
        <ChevronDown
          className={cn(
            "h-4 w-4 text-zinc-500 transition-transform",
            open && "rotate-180"
          )}
        />
      </button>
      {open && (
        <div className="border-t border-zinc-800/50 p-5 pt-4">
          {children}
        </div>
      )}
    </div>
  );
}

export { Collapsible };
