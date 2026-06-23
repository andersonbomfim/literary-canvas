import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { AlertCircle, Home } from "lucide-react";
import { useLocation } from "wouter";

const LOCAL_AUTH_PATHS = new Set([
  "/login",
  "/register",
  "/forgot-password",
  "/reset-password",
]);

export default function NotFound() {
  const [location, setLocation] = useLocation();

  useEffect(() => {
    if (LOCAL_AUTH_PATHS.has(location)) {
      setLocation("/home");
    }
  }, [location, setLocation]);

  const handleGoHome = () => {
    setLocation("/home");
  };

  return (
    <div className="literary-ambient flex min-h-screen w-full items-center justify-center p-4">
      <Card className="w-full max-w-lg border-border bg-card">
        <CardContent className="pt-8 pb-8 text-center">
          <div className="mb-6 flex justify-center">
            <div className="relative">
              <div className="absolute inset-0 rounded-full bg-destructive/15" />
              <AlertCircle className="relative h-16 w-16 text-destructive" />
            </div>
          </div>

          <h1 className="mb-2 text-4xl font-bold text-foreground">404</h1>
          <h2 className="mb-4 text-xl font-semibold text-foreground">
            Página não encontrada
          </h2>

          <p className="mb-8 leading-relaxed text-muted-foreground">
            A rota que você abriu não existe neste modo local.
            <br />
            Use a mesa de trabalho para seguir no sistema.
          </p>

          <Button
            onClick={handleGoHome}
            className="bg-accent px-6 py-2.5 text-accent-foreground hover:bg-accent/90"
          >
            <Home className="mr-2 h-4 w-4" />
            Ir para a mesa
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
