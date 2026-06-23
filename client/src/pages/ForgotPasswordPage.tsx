import { type FormEvent, useState } from "react";
import { AuthShell } from "@/components/AuthShell";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { readJsonSafely, toFriendlyErrorMessage } from "@/lib/authClient";
import { Loader2, Mail } from "lucide-react";
import { Link } from "wouter";
import { toast } from "sonner";

type ForgotPasswordResponse = {
  success: boolean;
  message: string;
  resetUrl: string;
  error: string;
};

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [resetUrl, setResetUrl] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (isSubmitting) return;

    try {
      setIsSubmitting(true);

      const response = await fetch("/api/auth/request-password-reset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ email }),
      });

      const data = await readJsonSafely<ForgotPasswordResponse>(response);
      if (!response.ok || !data.success) {
        throw new Error(data.error || "Não foi possível gerar o link agora.");
      }

      toast.success(data.message || "Link gerado.");
      setResetUrl(data.resetUrl || null);
    } catch (error) {
      toast.error(toFriendlyErrorMessage(error));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <AuthShell
      eyebrow="Recuperação"
      title="Recuperar senha"
      subtitle="Informe o e-mail da conta. Em ambiente local, o link aparece aqui mesmo."
      footer={
        <Link href="/login" className="hover:text-foreground">
          Voltar para o login
        </Link>
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
        <Button
          type="submit"
          className="w-full bg-accent text-accent-foreground hover:bg-accent/90"
          disabled={isSubmitting}
        >
          {isSubmitting ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <Mail className="mr-2 h-4 w-4" />
          )}
          Enviar link
        </Button>
      </form>

      {resetUrl ? (
        <div className="mt-4 rounded-lg border border-border bg-background/45 p-4 text-sm">
          <div className="font-medium text-foreground">Link gerado</div>
          <Link
            href={resetUrl}
            className="mt-2 block break-all text-accent hover:underline"
          >
            {resetUrl}
          </Link>
        </div>
      ) : null}
    </AuthShell>
  );
}
