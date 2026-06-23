import { systemRouter } from './_core/systemRouter';
import { router } from './_core/trpc';
import { authRouter } from './routers/auth';
import { writingRouter } from './routers/writing';
import { libraryRouter } from './routers/library';
import { profileRouter } from './routers/profile';
import { searchRouter } from './routers/search';
import { notificationsRouter } from './routers/notifications';
import { statisticsRouter } from './routers/statistics';
import { versionsRouter } from './routers/versions';
import { exportRouter } from './routers/export';
import { charactersRouter } from './routers/characters';
import { promptTemplatesRouter } from './routers/promptTemplates';
import { draftsRouter } from './routers/drafts';
import { reviewRouter } from './routers/review';
import { storyAssistantRouter } from './routers/storyAssistant';
import { worksRouter } from './routers/works';
import { billingRouter } from './routers/billing';
import { ideasRouter } from './routers/ideas';
import { seriesRouter } from './routers/series';
import { generationJobsRouter } from './routers/generationJobs';
import { auditRouter } from './routers/audit';
import { improvementsRouter } from './routers/improvements';

export const appRouter = router({
  system: systemRouter,
  auth: authRouter,
  works: worksRouter,
  billing: billingRouter,
  ideas: ideasRouter,
  generationJobs: generationJobsRouter,
  audit: auditRouter,
  improvements: improvementsRouter,
  storyAssistant: storyAssistantRouter,
  series: seriesRouter,
  writing: writingRouter,
  drafts: draftsRouter,
  library: libraryRouter,
  profile: profileRouter,
  search: searchRouter,
  notifications: notificationsRouter,
  statistics: statisticsRouter,
  versions: versionsRouter,
  export: exportRouter,
  characters: charactersRouter,
  promptTemplates: promptTemplatesRouter,
  review: reviewRouter,
});

export type AppRouter = typeof appRouter;
