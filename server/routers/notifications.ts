import { UserVisibleError } from "@shared/_core/errors";
import { z } from "zod";
import { adminProcedure, protectedProcedure, router } from "../_core/trpc";
import {
  createNotification,
  getUserNotifications,
  markAllNotificationsAsRead,
  markNotificationAsRead,
  getUnreadNotificationCount,
} from "../db";

/**
 * Notifications Router - Real-time notifications for users
 * Handles notification creation, retrieval, and marking as read
 */

export const notificationsRouter = router({
  /**
   * Get all notifications for current user
   */
  list: protectedProcedure
    .input(z.object({ limit: z.number().int().min(1).max(100).default(20) }))
    .query(async ({ input, ctx }) => {
      return getUserNotifications(ctx.user!.id, input.limit);
    }),

  /**
   * Get unread notification count
   */
  getUnreadCount: protectedProcedure.query(async ({ ctx }) => {
    const count = await getUnreadNotificationCount(ctx.user!.id);
    return { unreadCount: count };
  }),

  /**
   * Mark notification as read
   */
  markAsRead: protectedProcedure
    .input(z.object({ notificationId: z.number() }))
    .mutation(async ({ input, ctx }) => {
      try {
        await markNotificationAsRead(input.notificationId, ctx.user!.id);
        return { success: true };
      } catch (error) {
        console.error("[Notifications] Mark as read failed:", error);
        throw new UserVisibleError("Não foi possível marcar a notificação como lida.");
      }
    }),

  /**
   * Mark all notifications as read
   */
  markAllAsRead: protectedProcedure.mutation(async ({ ctx }) => {
    try {
      await markAllNotificationsAsRead(ctx.user!.id);
      return { success: true };
    } catch (error) {
      console.error("[Notifications] Mark all as read failed:", error);
      throw new UserVisibleError("Não foi possível limpar as notificações.");
    }
  }),

  /**
   * Send notification (for testing/admin)
   */
  send: adminProcedure
    .input(
      z.object({
        type: z.enum(["chapter_generated", "chapter_error", "library_created", "profile_updated", "review_completed", "system"]),
        title: z.string().min(1),
        message: z.string().min(1),
        data: z.string().optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      try {
        await createNotification(ctx.user!.id, {
          type: input.type,
          title: input.title,
          message: input.message,
          data: input.data ?? null,
          isRead: "false",
        });

        return { success: true, message: "Notificação enviada." };
      } catch (error) {
        console.error("[Notifications] Send failed:", error);
        throw new UserVisibleError("Não foi possível enviar a notificação.");
      }
    }),
});
