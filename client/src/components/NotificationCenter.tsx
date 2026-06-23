import {
  AlertCircle,
  Bell,
  CheckCheck,
  CheckCircle,
  Inbox,
  Info,
  Loader2,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";

import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import {
  type Notification,
  useNotifications,
} from "@/contexts/NotificationsContext";

const toneByType = {
  chapter_generated: {
    icon: CheckCircle,
    iconClass: "text-emerald-300",
    shellClass: "bg-emerald-500/10 ring-emerald-400/20",
  },
  review_completed: {
    icon: CheckCircle,
    iconClass: "text-emerald-300",
    shellClass: "bg-emerald-500/10 ring-emerald-400/20",
  },
  chapter_error: {
    icon: AlertCircle,
    iconClass: "text-red-300",
    shellClass: "bg-red-500/10 ring-red-400/20",
  },
  system: {
    icon: Info,
    iconClass: "text-sky-300",
    shellClass: "bg-sky-500/10 ring-sky-400/20",
  },
} as const;

function getTone(type: Notification["type"]) {
  return (
    toneByType[type as keyof typeof toneByType] ?? {
      icon: Info,
      iconClass: "text-sky-300",
      shellClass: "bg-sky-500/10 ring-sky-400/20",
    }
  );
}

function formatDate(value: Date | string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";

  return formatDistanceToNow(date, {
    addSuffix: true,
    locale: ptBR,
  });
}

/**
 * NotificationCenter - painel compacto e previsível para notificações recentes.
 */
export function NotificationCenter() {
  const { notifications, unreadCount, isLoading, markAsRead, markAllAsRead } =
    useNotifications();
  const unreadLabel = unreadCount > 99 ? "99+" : String(unreadCount);

  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <button
              aria-label={
                unreadCount > 0
                  ? `Abrir notificações, ${unreadCount} não lidas`
                  : "Abrir notificações"
              }
              className="relative inline-flex h-9 w-9 items-center justify-center rounded-md border border-border/70 bg-background/45 text-foreground/86 transition hover:border-accent/50 hover:bg-accent/10 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70"
              type="button"
            >
              <Bell className="h-[18px] w-[18px]" />
              {unreadCount > 0 && (
                <span className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full border border-background bg-accent px-1 text-[10px] font-bold leading-none text-white shadow-[0_0_0_2px_rgba(15,13,11,0.72)]">
                  {unreadLabel}
                </span>
              )}
            </button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent>Abrir notificações</TooltipContent>
      </Tooltip>

      <DropdownMenuContent
        align="end"
        className="w-[min(390px,calc(100vw-2rem))] overflow-hidden rounded-lg border-border/80 bg-popover/95 p-0 shadow-2xl backdrop-blur-xl"
        sideOffset={10}
      >
        <header className="flex items-start justify-between gap-3 border-b border-border/70 px-4 py-3">
          <div className="min-w-0">
            <h3 className="font-serif text-base font-semibold leading-tight text-foreground">
              Notificações
            </h3>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {unreadCount > 0
                ? `${unreadCount} pendente${unreadCount === 1 ? "" : "s"}`
                : "Tudo lido"}
            </p>
          </div>

          {unreadCount > 0 && (
            <button
              className="inline-flex items-center gap-1.5 rounded-md border border-border/70 px-2.5 py-1.5 text-xs font-semibold text-foreground/84 transition hover:border-accent/45 hover:bg-accent/10 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70"
              onClick={markAllAsRead}
              type="button"
            >
              <CheckCheck className="h-3.5 w-3.5" />
              Limpar
            </button>
          )}
        </header>

        {isLoading ? (
          <div className="flex items-center justify-center gap-2 px-4 py-10 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Carregando
          </div>
        ) : notifications.length === 0 ? (
          <div className="px-4 py-10 text-center">
            <Inbox className="mx-auto h-8 w-8 text-muted-foreground/55" />
            <p className="mt-3 text-sm font-medium text-foreground">
              Nenhuma notificação
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              Avisos importantes aparecem aqui.
            </p>
          </div>
        ) : (
          <div className="notification-list-scroll max-h-[430px] overflow-y-auto">
            {notifications.slice(0, 12).map(notification => {
              const tone = getTone(notification.type);
              const Icon = tone.icon;
              const isUnread = notification.isRead === "false";
              const relativeDate = formatDate(notification.createdAt);

              return (
                <button
                  key={notification.id}
                  className={cn(
                    "grid w-full grid-cols-[2.25rem_minmax(0,1fr)_auto] gap-3 border-b border-border/55 px-4 py-3 text-left transition last:border-b-0 hover:bg-accent/10 focus-visible:bg-accent/10 focus-visible:outline-none",
                    isUnread ? "bg-accent/10" : "bg-transparent"
                  )}
                  onClick={() => {
                    if (isUnread) {
                      markAsRead(notification.id);
                    }
                  }}
                  type="button"
                >
                  <span
                    className={cn(
                      "mt-0.5 flex h-9 w-9 items-center justify-center rounded-md ring-1",
                      tone.shellClass
                    )}
                  >
                    <Icon className={cn("h-[18px] w-[18px]", tone.iconClass)} />
                  </span>

                  <span className="min-w-0">
                    <span className="block truncate text-sm font-semibold leading-5 text-foreground">
                      {notification.title}
                    </span>
                    <span className="mt-0.5 line-clamp-2 block text-xs leading-5 text-muted-foreground">
                      {notification.message}
                    </span>
                    {relativeDate && (
                      <span className="mt-1 block text-[11px] font-medium text-muted-foreground/78">
                        {relativeDate}
                      </span>
                    )}
                  </span>

                  <span
                    aria-hidden="true"
                    className={cn(
                      "mt-2 h-2 w-2 rounded-full",
                      isUnread ? "bg-accent" : "bg-transparent"
                    )}
                  />
                </button>
              );
            })}
          </div>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
