import { type FormEvent, useState } from "react";
import { AuthShell } from "@/components/AuthShell";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { readJsonSafely, toFriendlyErrorMessage } from "@/lib/authClient";
import { Loader2, UserPlus } from "lucide-react";
import { Link, useLocation } from "wouter";
import { toast } from "sonner";

export default function RegisterPage() {
  const [, navigate] = useLocation();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const passwordMeetsRules = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{8,}$/.test(
    password
  );
  const passwordsMatch =
    confirmPassword.length === 0 || password === confirmPassword;
  const canSubmit =
    acceptedTerms &&
    passwordMeetsRules &&
    passwordsMatch &&
    name.trim() &&
    email.trim();

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (isSubmitting) return;

    try {
      setIsSubmitting(true);

      const response = await fetch("/api/auth/register", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        credentials: "include",
        body: JSON.stringify({ name, email, password, confirmPassword }),
      });

      const data = await readJsonSafely<{
        success: boolean;
        redirectTo: string;
        error: string;
      }>(response);

      if (!response.ok || !data.success) {
        throw new Error(data.error || "Não foi possível criar a conta agora.");
      }

      toast.success("Conta criada com sucesso.");
      navigate(data.redirectTo || "/home");
    } catch (error) {
      toast.error(toFriendlyErrorMessage(error));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <AuthShell
      eyebrow="Nova conta"
      title="Criar espaço de escrita"
      subtitle="Prepare uma área local para desenvolver ideias, obras, rascunhos e revisões."
      footer={
        <>
          Já tem conta?{" "}
          <Link href="/login" className="text-foreground hover:underline">
            Entre aqui
          </Link>
        </>
      }
    >
      <form className="space-y-4" onSubmit={handleSubmit}>
        <div className="space-y-2">
          <Label htmlFor="name">Nome</Label>
          <Input
            id="name"
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="Seu nome"
            autoComplete="name"
            required
            className="bg-background/70"
          />
        </div>
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
            placeholder="Mínimo 8, com maiúscula, minúscula e número"
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
        <div className="flex items-start gap-2 rounded-lg border border-border/70 bg-background/35 p-3">
          <input
            type="checkbox"
            id="terms"
            checked={acceptedTerms}
            onChange={e => setAcceptedTerms(e.target.checked)}
            required
            className="mt-1 h-4 w-4 rounded border-border"
          />
          <label
            htmlFor="terms"
            className="text-xs leading-5 text-muted-foreground"
          >
            Li e concordo com os{" "}
            <Link href="/terms" className="text-foreground hover:underline">
              Termos de Uso
            </Link>{" "}
            e a{" "}
            <Link href="/privacy" className="text-foreground hover:underline">
              Política de Privacidade
            </Link>
            .
          </label>
        </div>
        <Button
          type="submit"
          className="w-full bg-accent text-accent-foreground hover:bg-accent/90"
          disabled={isSubmitting || !canSubmit}
        >
          {isSubmitting ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <UserPlus className="mr-2 h-4 w-4" />
          )}
          Criar conta
        </Button>
      </form>
    </AuthShell>
  );
}
