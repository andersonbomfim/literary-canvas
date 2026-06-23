import { lazy, Suspense } from "react";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Route, Switch } from "wouter";
import ErrorBoundary from "./components/ErrorBoundary";
import GlobalLoadingIndicator from "./components/GlobalLoadingIndicator";
import MainLayout from "./components/MainLayout";
import { ProtectedRoute } from "./components/ProtectedRoute";
import { PageSkeleton } from "@/components/ui/feedback-state";
import { ThemeProvider } from "./contexts/ThemeContext";
import { NotificationsProvider } from "./contexts/NotificationsContext";

const Home = lazy(() => import("./pages/Home"));
const IdeasPage = lazy(() => import("./pages/IdeasPage"));
const DraftPage = lazy(() => import("./pages/DraftPage"));
const WritingPage = lazy(() => import("./pages/WritingPage"));
const LibraryPage = lazy(() => import("./pages/LibraryPage"));
const ReviewPage = lazy(() => import("./pages/ReviewPage"));
const ProfilePage = lazy(() => import("./pages/ProfilePage"));
const SeriesPage = lazy(() => import("./pages/SeriesPage"));
const DashboardPage = lazy(() => import("./pages/DashboardPage"));
const PublicationPage = lazy(() => import("./pages/PublicationPage"));
const AdminPage = lazy(() => import("./pages/AdminPage"));
const NotFound = lazy(() => import("./pages/NotFound"));
const LoginPage = lazy(() => import("./pages/LoginPage"));
const RegisterPage = lazy(() => import("./pages/RegisterPage"));
const ForgotPasswordPage = lazy(() => import("./pages/ForgotPasswordPage"));
const ResetPasswordPage = lazy(() => import("./pages/ResetPasswordPage"));
const LandingPage = lazy(() => import("./pages/LandingPage"));
const TermsPage = lazy(() => import("./pages/TermsPage"));
const PrivacyPage = lazy(() => import("./pages/PrivacyPage"));

function RouteFallback() {
  return <PageSkeleton />;
}

function PrivateApp() {
  return (
    <ProtectedRoute>
      <NotificationsProvider>
        <MainLayout>
          <Switch>
            <Route path="/home" component={Home} />
            <Route path="/ideas" component={IdeasPage} />
            <Route path="/draft" component={DraftPage} />
            <Route path="/writing" component={WritingPage} />
            <Route path="/works" component={ProfilePage} />
            <Route path="/library" component={LibraryPage} />
            <Route path="/review" component={ReviewPage} />
            <Route path="/profile" component={ProfilePage} />
            <Route path="/series" component={SeriesPage} />
            <Route path="/dashboard" component={DashboardPage} />
            <Route path="/export" component={PublicationPage} />
            <Route path="/publication" component={PublicationPage} />
            <Route path="/admin" component={AdminPage} />
            <Route component={NotFound} />
          </Switch>
        </MainLayout>
      </NotificationsProvider>
    </ProtectedRoute>
  );
}

function AppRouter() {
  return (
    <Suspense fallback={<RouteFallback />}>
      <Switch>
        <Route path="/" component={LandingPage} />
        <Route path="/login" component={LoginPage} />
        <Route path="/register" component={RegisterPage} />
        <Route path="/forgot-password" component={ForgotPasswordPage} />
        <Route path="/reset-password" component={ResetPasswordPage} />
        <Route path="/terms" component={TermsPage} />
        <Route path="/privacy" component={PrivacyPage} />
        <Route component={PrivateApp} />
      </Switch>
    </Suspense>
  );
}

function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider defaultTheme="dark">
        <TooltipProvider>
          {/* Indicador global de carregamento — barra fina no topo que aparece
              em qualquer fetching/mutating do tRPC, em qualquer rota. Antes
              vários fluxos não tinham feedback visual e o usuário achava que
              o app tinha travado. */}
          <GlobalLoadingIndicator />
          <Toaster />
          <AppRouter />
        </TooltipProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;
