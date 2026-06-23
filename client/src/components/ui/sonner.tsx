import React from "react";
import { useTheme } from "@/contexts/ThemeContext";
import { Toaster as Sonner, type ToasterProps } from "sonner";

const Toaster = ({ ...props }: ToasterProps) => {
  const { theme } = useTheme();

  return (
    <Sonner
      theme={theme as ToasterProps["theme"]}
      className="toaster group"
      closeButton
      expand={false}
      gap={10}
      position="bottom-right"
      visibleToasts={3}
      style={
        {
          "--normal-bg": "var(--popover)",
          "--normal-text": "var(--popover-foreground)",
          "--normal-border": "var(--border)",
        } as React.CSSProperties
      }
      toastOptions={{
        classNames: {
          toast:
            "group-[.toaster]:rounded-lg group-[.toaster]:border-border/80 group-[.toaster]:bg-popover/95 group-[.toaster]:text-popover-foreground group-[.toaster]:shadow-2xl group-[.toaster]:backdrop-blur-xl",
          title: "group-[.toast]:text-sm group-[.toast]:font-semibold",
          description:
            "group-[.toast]:text-xs group-[.toast]:leading-5 group-[.toast]:text-muted-foreground",
          closeButton:
            "group-[.toast]:border-border group-[.toast]:bg-secondary group-[.toast]:text-foreground",
        },
      }}
      {...props}
    />
  );
};

export { Toaster };
