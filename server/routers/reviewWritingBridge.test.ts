import { describe, expect, it } from "vitest";
import { createChapter, createWork, upsertChapterReview } from "../db";
import type { TrpcContext } from "../_core/context";
import { reviewRouter } from "./review";
import { writingRouter } from "./writing";

type AuthenticatedUser = NonNullable<TrpcContext["user"]>;

function createTestContext(userId: number, activeWorkId: number): TrpcContext {
  const user: AuthenticatedUser = {
    id: userId,
    openId: `review-writing-${userId}`,
    email: `review-writing-${userId}@example.com`,
    name: "Review Writing",
    loginMethod: "local",
    role: "user",
    createdAt: new Date(),
    updatedAt: new Date(),
    lastSignedIn: new Date(),
  };

  return {
    user,
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: {} as TrpcContext["res"],
    activeWorkId,
  };
}

function uniqueUserId() {
  return Math.floor(900000 + Math.random() * 900000);
}

describe("review to writing bridge", () => {
  it("returns a server-side revision brief for selected review fixes", async () => {
    const userId = uniqueUserId();
    const work = await createWork(userId, { title: "Ponte editorial", status: "planning" });
    const chapter = await createChapter(userId, {
      title: "Cena em revisão",
      content: "A personagem muda de ideia sem causa clara.\nO desfecho chega antes da reação emocional.",
      draftId: null,
      bookNumber: null,
      chapterNumber: null,
      status: "in_development",
      generationPrompt: null,
      workId: work.id,
    }, work.id);

    await upsertChapterReview(userId, chapter.id, {
      status: "pending",
      alerts: JSON.stringify([
        { type: "warning", title: "Causa fraca", description: "A decisão central precisa de motivação visível." },
      ]),
      comments: JSON.stringify([
        {
          id: 1,
          type: "logic",
          severity: "high",
          line: 1,
          text: "A virada emocional acontece sem preparação.",
          suggestion: "Adicione uma reação intermediária antes da decisão.",
        },
      ]),
    });

    const ctx = createTestContext(userId, work.id);
    const sendBack = await reviewRouter.createCaller(ctx).sendBackToWriting({
      chapterId: chapter.id,
      alertIndexes: [0],
      commentIds: [1],
    });

    expect(sendBack.data.fixCount).toBe(2);
    expect(sendBack.data.revisionBrief).toContain("Correções recebidas da Revisão");
    expect(sendBack.data.revisionBrief).toContain("A virada emocional acontece sem preparação");

    const revisionContext = await writingRouter.createCaller(ctx).getRevisionContext({ chapterId: chapter.id });
    expect(revisionContext.status).toBe("revision_needed");
    expect(revisionContext.fixCount).toBeGreaterThan(0);
    expect(revisionContext.revisionBrief).toContain("Aplique os pontos abaixo");
  });

  it("persists only the selected fixes and resets the bridge on a new writing cycle", async () => {
    const userId = uniqueUserId();
    const work = await createWork(userId, {
      title: "Editorial state machine",
      status: "planning",
    });
    const chapter = await createChapter(
      userId,
      {
        title: "Chapter under review",
        content: "The choice has no visible cause.",
        draftId: null,
        bookNumber: null,
        chapterNumber: null,
        status: "in_development",
        generationPrompt: null,
        workId: work.id,
      },
      work.id
    );
    await upsertChapterReview(userId, chapter.id, {
      status: "pending",
      alerts: JSON.stringify([
        { type: "warning", title: "Selected alert", description: "Keep this fix." },
        { type: "warning", title: "Ignored alert", description: "Do not keep this fix." },
      ]),
      comments: JSON.stringify([
        {
          id: 1,
          type: "logic",
          severity: "high",
          line: 1,
          text: "Selected comment.",
          suggestion: "Keep this comment.",
        },
        {
          id: 2,
          type: "style",
          severity: "high",
          line: 1,
          text: "Ignored comment.",
          suggestion: "Do not keep this comment.",
        },
      ]),
    });

    const ctx = createTestContext(userId, work.id);
    await reviewRouter.createCaller(ctx).sendBackToWriting({
      chapterId: chapter.id,
      alertIndexes: [0],
      commentIds: [1],
    });

    const returnedContext = await writingRouter
      .createCaller(ctx)
      .getRevisionContext({ chapterId: chapter.id });
    expect(returnedContext.status).toBe("revision_needed");
    expect(returnedContext.fixCount).toBe(2);
    expect(returnedContext.revisionBrief).toContain("Selected alert");
    expect(returnedContext.revisionBrief).toContain("Selected comment.");
    expect(returnedContext.revisionBrief).not.toContain("Ignored alert");
    expect(returnedContext.revisionBrief).not.toContain("Ignored comment.");

    await writingRouter.createCaller(ctx).submitForReview({
      chapterId: chapter.id,
    });
    const submittedContext = await writingRouter
      .createCaller(ctx)
      .getRevisionContext({ chapterId: chapter.id });
    expect(submittedContext.status).toBe("pending");
    expect(submittedContext.fixCount).toBe(0);
    expect(submittedContext.revisionBrief).toBe("");

    await writingRouter.createCaller(ctx).save({
      chapterId: chapter.id,
      title: chapter.title,
      content: "The choice now has a visible cause.",
    });
    const editingContext = await writingRouter
      .createCaller(ctx)
      .getRevisionContext({ chapterId: chapter.id });
    expect(editingContext.status).toBe("in_writing");
    expect(editingContext.fixCount).toBe(0);
    expect(editingContext.revisionBrief).toBe("");
  });
});
