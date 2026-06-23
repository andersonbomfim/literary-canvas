import { useNotifications } from "@/contexts/NotificationsContext";
import { useEffect, useRef } from "react";
import { toast } from "sonner";
import { CheckCircle, AlertCircle, Info } from "lucide-react";

/**
 * NotificationToast - Displays notifications as toasts
 * Uses a ref to track which notification IDs have already been toasted,
 * preventing the infinite loop caused by re-rendering with the same
 * unread notifications.
 */
export function NotificationToast() {
  const { notifications } = useNotifications();
  const shownIdsRef = useRef<Set<number>>(new Set());
  const isHydratedRef = useRef(false);

  useEffect(() => {
    if (!isHydratedRef.current) {
      notifications.forEach(notification => {
        shownIdsRef.current.add(notification.id);
      });
      isHydratedRef.current = true;
      return;
    }

    notifications.slice(0, 5).forEach(notification => {
      if (
        notification.isRead === "false" &&
        !shownIdsRef.current.has(notification.id)
      ) {
        shownIdsRef.current.add(notification.id);

        const icon =
          notification.type === "chapter_generated" ? (
            <CheckCircle className="w-5 h-5 text-green-500" />
          ) : notification.type === "chapter_error" ? (
            <AlertCircle className="w-5 h-5 text-red-500" />
          ) : (
            <Info className="w-5 h-5 text-blue-500" />
          );

        const notify =
          notification.type === "chapter_generated" ||
          notification.type === "review_completed"
            ? toast.success
            : notification.type === "chapter_error"
              ? toast.error
              : toast;

        notify(notification.title, {
          description: notification.message,
          icon,
          duration: 4200,
        });
      }
    });
  }, [notifications]);

  return null;
}
