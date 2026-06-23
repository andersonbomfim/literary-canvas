import React, { createContext, useContext, useEffect, useState } from "react";
import { toast } from "sonner";
import { formatApiErrorMessage } from "@/lib/errorMessage";
import { trpc } from "@/lib/trpc";

export interface Notification {
  id: number;
  userId: number;
  type:
    | "chapter_generated"
    | "chapter_error"
    | "library_created"
    | "profile_updated"
    | "review_completed"
    | "system"
    | "billing";
  title: string;
  message: string;
  data: string | null;
  isRead: "true" | "false" | null;
  createdAt: Date;
}

interface NotificationsContextType {
  notifications: Notification[];
  unreadCount: number;
  isLoading: boolean;
  addNotification: (notification: Notification) => void;
  markAsRead: (id: number) => void;
  markAllAsRead: () => void;
  refreshNotifications: () => void;
}

const NotificationsContext = createContext<
  NotificationsContextType | undefined
>(undefined);

export function NotificationsProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [isLoading, setIsLoading] = useState(true);

  const listQuery = trpc.notifications.list.useQuery({ limit: 50 });
  const unreadQuery = trpc.notifications.getUnreadCount.useQuery();
  const markAsReadMutation = trpc.notifications.markAsRead.useMutation();
  const markAllAsReadMutation = trpc.notifications.markAllAsRead.useMutation();

  // Load notifications on mount
  useEffect(() => {
    if (listQuery.data) {
      setNotifications(listQuery.data);
      setIsLoading(false);
    }
  }, [listQuery.data]);

  // Update unread count
  useEffect(() => {
    if (unreadQuery.data) {
      setUnreadCount(unreadQuery.data?.unreadCount);
    }
  }, [unreadQuery.data]);

  const addNotification = (notification: Notification) => {
    setNotifications(prev => [
      notification,
      ...prev.filter(item => item.id !== notification.id),
    ]);
    if (notification.isRead !== "true") {
      setUnreadCount(prev => prev + 1);
    }
  };

  const markAsRead = async (id: number) => {
    const wasUnread = notifications.some(
      notification => notification.id === id && notification.isRead === "false"
    );

    try {
      await markAsReadMutation.mutateAsync({ notificationId: id });
      setNotifications(prev =>
        prev.map(n => (n.id === id ? { ...n, isRead: "true" } : n))
      );
      if (wasUnread) {
        setUnreadCount(prev => Math.max(0, prev - 1));
      }
    } catch (error) {
      if (import.meta.env.DEV) {
        console.error("Failed to mark notification as read:", error);
      }
      // Antes só logava no console. O usuário clicava na notificação, nada
      // acontecia visualmente e o contador continuava errado sem motivo.
      toast.error(formatApiErrorMessage(error));
    }
  };

  const markAllAsRead = async () => {
    if (unreadCount === 0) return;

    try {
      await markAllAsReadMutation.mutateAsync();
      setNotifications(prev => prev.map(n => ({ ...n, isRead: "true" })));
      setUnreadCount(0);
    } catch (error) {
      if (import.meta.env.DEV) {
        console.error("Failed to mark all notifications as read:", error);
      }
      toast.error(formatApiErrorMessage(error));
    }
  };

  const refreshNotifications = () => {
    listQuery.refetch();
    unreadQuery.refetch();
  };

  return (
    <NotificationsContext.Provider
      value={{
        notifications,
        unreadCount,
        isLoading,
        addNotification,
        markAsRead,
        markAllAsRead,
        refreshNotifications,
      }}
    >
      {children}
    </NotificationsContext.Provider>
  );
}

export function useNotifications() {
  const context = useContext(NotificationsContext);
  if (!context) {
    throw new Error(
      "useNotifications must be used within NotificationsProvider"
    );
  }
  return context;
}
