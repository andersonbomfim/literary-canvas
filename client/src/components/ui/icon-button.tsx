import * as React from "react";

import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

type IconButtonProps = Omit<
  React.ComponentProps<typeof Button>,
  "children" | "aria-label"
> & {
  label: string;
  tooltip?: string;
  children: React.ReactNode;
  side?: React.ComponentProps<typeof TooltipContent>["side"];
};

function IconButton({
  label,
  tooltip,
  children,
  side = "top",
  ...props
}: IconButtonProps) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button aria-label={label} title={undefined} {...props}>
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent side={side}>{tooltip ?? label}</TooltipContent>
    </Tooltip>
  );
}

export { IconButton };
