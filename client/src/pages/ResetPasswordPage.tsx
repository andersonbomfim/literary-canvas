import { type FormEvent, useMemo, useState } from "react";
import { AuthShell } from "@/components/AuthShell";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { readJsonSafely, toFriendlyErrorMessage } from "@/lib/authClient";
import { Loader2, Lock } from "lucide-react";
import { Link, useLocation } from "wouter";
import { toast } from "sonner";

type ResetPasswordResponse = {
  success: boolean;
  redirectTo: string;
  error: string;
};

export default function ResetPasswordPage() {
  const [location, navigate] = useLocation();
  // wouter's useLocation returns only the pathname; query string lives in
  // window.location.search. Previous code did `location.split("")[1]` which
  // returned the second character of the path, so the token was never read.
  const params = useMemo(
    () =>
      new URLSearchParams(
        typeof window !== "undefined" ? window.location.search : ""
      ),
    [location]
  );
  const token = params.get("token") || "";
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const passwordMeetsRules = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{8,}$/.test(
    password
  );
  const passwordsMatch =
    confirmPassword.length === 0 || password === confirmPassword;
  const canSubmit = Boolean(token && passwordMeetsRules && passwordsMatch);

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (isSubmitting || !token) return;

    try {
      setIsSubmitting(true);
      const response = await fetch("/api/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ token, password, confirmPassword }),
      });

      const data = await readJsonSafely<ResetPasswordResponse>(response);
      if (!response.ok || !data.success) {
        throw new Error(
          data.error || "Não foi possível redefinir a senha agora."
        );
      }

      toast.success("Senha redefinida.");
      navigate(data.redirectTo || "/home");
    } catch (error) {
      toast.error(toFriendlyErrorMessage(error));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <AuthShell
      eyebrow="Segurança"
      title="Nova senha"
      subtitle="Defina uma senha nova para voltar à sua mesa de escrita."
      footer={
        <Link href="/login" className="hover:text-foreground">
          Voltar para o login
        </Link>
      }
    >
      <form className="space-y-4" onSubmit={handleSubmit}>
        <div className="space-y-2">
          <Label htmlFor="password">Nova senha</Label>
          <Input
            id="password"
            type="password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            placeholder="Sua nova senha"
            autoComplete="new-password"
            required
            minLength={8}
            aria-describedby="password-help"
            className="bg-background/70"
          />
          <p
            id="password-help"
            className={
              password && !passwordMeetsRules
                ? "text-xs text-destructive"
                : "text-xs text-muted-foreground"
            }
          >
            Use no mínimo 8 caracteres, com maiúscula, minúscula e número.
          </p>
        </div>
        <div className="space-y-2">
          <Label htmlFor="confirmPassword">Confirmar senha</Label>
          <Input
            id="confirmPassword"
            type="password"
            value={confirmPassword}
            onChange={e => setConfirmPassword(e.target.value)}
            placeholder="Repita a senha"
            autoComplete="new-password"
            required
            minLength={8}
            aria-invalid={!passwordsMatch}
            aria-describedby="confirm-password-help"
            className="bg-background/70"
          />
          {!passwordsMatch ? (
            <p id="confirm-password-help" className="text-xs text-destructive">
              As senhas precisam ser iguais.
            </p>
          ) : null}
        </div>
        <Button
          type="submit"
          className="w-full bg-accent text-accent-foreground hover:bg-accent/90"
          disabled={isSubmitting || !canSubmit}
        >
          {isSubmitting ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <Lock className="mr-2 h-4 w-4" />
          )}
          Redefinir senha
        </Button>
      </form>

      {!token ? (
        <div className="mt-4 rounded-lg border border-destructive/35 bg-destructive/10 p-3 text-sm text-destructive">
          Token ausente ou inválido.
        </div>
      ) : null}
    </AuthShell>
  );
}
