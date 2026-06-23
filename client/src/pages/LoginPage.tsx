import { type FormEvent, useState } from "react";
import { AuthShell } from "@/components/AuthShell";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { readJsonSafely, toFriendlyErrorMessage } from "@/lib/authClient";
import { Loader2, LogIn, ShieldCheck } from "lucide-react";
import { Link } from "wouter";
import { toast } from "sonner";

type LoginResponse = {
  success: boolean;
  redirectTo: string;
  error: string;
};

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const confirmSession = async () => {
    const response = await fetch("/api/auth/me", {
      credentials: "include",
      headers: {
        Accept: "application/json",
      },
    });

    const data = await readJsonSafely<{ user: unknown | null }>(response);

    if (!response.ok || !data.success || !data.user) {
      throw new Error(
        "Login aceito, mas a sessão não foi confirmada. Recarregue e tente novamente."
      );
    }
  };

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (isSubmitting) return;

    try {
      setIsSubmitting(true);

      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        credentials: "include",
        body: JSON.stringify({ email, password }),
      });

      const data = await readJsonSafely<LoginResponse>(response);

      if (!response.ok || !data.success) {
        throw new Error(data.error || "Não foi possível entrar agora.");
      }

      await confirmSession();
      toast.success("Login realizado.");
      window.location.assign(data.redirectTo || "/home");
    } catch (error) {
      toast.error(toFriendlyErrorMessage(error));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <AuthShell
      eyebrow="Acesso"
      title="Entrar na sua mesa"
      subtitle="Retome a obra ativa, as ideias em desenvolvimento e os capítulos que ainda precisam de revisão."
      footer={
        <div className="flex items-center justify-center gap-2">
          <ShieldCheck className="h-4 w-4 text-accent" />
          <span>Acesso local protegido por sessão.</span>
        </div>
      }
    >
      <form className="space-y-4" onSubmit={handleSubmit}>
        <div className="space-y-2">
          <Label htmlFor="email">E-mail</Label>
          <Input
            id="email"
            type="email"
            value={email}
            onChange={e => setEmail(e.target.value)}
            placeholder="você@exemplo.com"
            autoComplete="email"
            required
            className="bg-background/70"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="password">Senha</Label>
          <Input
            id="password"
            type="password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            placeholder="Sua senha"
            autoComplete="current-password"
            required
            className="bg-background/70"
          />
        </div>
        <Button
          type="submit"
          className="w-full bg-accent text-accent-foreground hover:bg-accent/90"
          disabled={isSubmitting}
        >
          {isSubmitting ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <LogIn className="mr-2 h-4 w-4" />
          )}
          Entrar
        </Button>
      </form>

      <div className="mt-5 flex items-center justify-between text-sm">
        <Link
          href="/forgot-password"
          className="text-muted-foreground hover:text-foreground"
        >
          Esqueci minha senha
        </Link>
        <Link
          href="/register"
          className="text-muted-foreground hover:text-foreground"
        >
          Criar conta
        </Link>
      </div>
    </AuthShell>
  );
}
