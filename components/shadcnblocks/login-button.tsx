import * as React from "react";
import { LogOut, LogIn } from "lucide-react";
import { cn } from "@/lib/utils";

export interface LoginButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "default" | "outline" | "secondary" | "ghost" | "destructive";
  iconType?: "login" | "logout" | "none";
  icon?: React.ReactNode;
}

export const LoginButton = React.forwardRef<
  HTMLButtonElement,
  LoginButtonProps
>(({ className, variant = "default", iconType = "logout", icon, children, ...props }, ref) => {
  const renderIcon = () => {
    if (icon) return icon;
    if (iconType === "logout") return <LogOut className="h-4 w-4 shrink-0 transition-transform group-hover:-translate-x-0.5" />;
    if (iconType === "login") return <LogIn className="h-4 w-4 shrink-0 transition-transform group-hover:translate-x-0.5" />;
    return null;
  };

  return (
    <button
      ref={ref}
      className={cn(
        "group inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-xl text-xs font-bold tracking-wide transition-all cursor-pointer focus-visible:outline-hidden disabled:pointer-events-none disabled:opacity-50 px-4 py-2.5 active:scale-[0.98]",
        variant === "default" &&
          "bg-white text-zinc-950 hover:bg-zinc-100 border border-zinc-200 dark:bg-white dark:text-zinc-900 dark:hover:bg-zinc-100 dark:border-zinc-200 shadow-sm",
        variant === "outline" &&
          "border border-[#27272A] bg-[#121214] text-white hover:bg-[#1C1C1F] hover:border-gray-500",
        variant === "secondary" &&
          "bg-[#1C1C1F] text-white hover:bg-[#27272A] border border-[#27272A]",
        variant === "ghost" &&
          "text-gray-300 hover:text-white hover:bg-[#1C1C1F]",
        variant === "destructive" &&
          "bg-rose-500/10 hover:bg-rose-500/20 text-rose-300 border border-rose-500/30",
        className
      )}
      {...props}
    >
      {renderIcon()}
      <span>{children}</span>
    </button>
  );
});

LoginButton.displayName = "LoginButton";
