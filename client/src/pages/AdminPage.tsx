import { useState } from "react";
import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Coins, Loader2, Shield, Users } from "lucide-react";
import { toast } from "sonner";
import { formatApiErrorMessage } from "@/lib/errorMessage";

type PlanCode = "weekly" | "monthly" | "yearly" | "none";
type SubscriptionStatus = "active" | "paused" | "canceled" | "trial" | "none";

const initialPlanState = {
  planCode: "monthly" as PlanCode,
  status: "active" as SubscriptionStatus,
};

export default function AdminPage() {
  const { user } = useAuth();
  const utils = trpc.useUtils();
  const usersQuery = trpc.auth.listUsers.useQuery(undefined, {
    enabled: user?.role === "admin",
  });
  const updateRoleMutation = trpc.auth.updateUserRole.useMutation({
    onSuccess: async () => {
      toast.success("Papel atualizado.");
      await utils.auth.listUsers.invalidate();
    },
    onError: error => toast.error(formatApiErrorMessage(error)),
  });
  const grantCreditsMutation = trpc.billing.grantCredits.useMutation({
    onSuccess: async () => {
      toast.success("Créditos flexíveis adicionados.");
      await utils.auth.listUsers.invalidate();
    },
    onError: error => toast.error(formatApiErrorMessage(error)),
  });
  const setPlanMutation = trpc.billing.setPlan.useMutation({
    onSuccess: async () => {
      toast.success("Plano atualizado.");
      await utils.auth.listUsers.invalidate();
    },
    onError: error => toast.error(formatApiErrorMessage(error)),
  });

  const [creditValues, setCreditValues] = useState<Record<number, string>>({});
  const [planValues, setPlanValues] = useState<
    Record<number, { planCode: PlanCode; status: SubscriptionStatus }>
  >({});

  if (user?.role !== "admin") {
    return (
      <Card className="border border-border bg-card p-6 text-sm text-muted-foreground">
        Esta área é só para administrador.
      </Card>
    );
  }

  const users = usersQuery.data || [];
  const adminCount = users.filter((item: any) => item.role === "admin").length;

  const getPlanState = (userId: number) =>
    planValues[userId] || initialPlanState;

  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-3">
        <Card className="border border-border bg-card p-5">
          <div className="text-xs uppercase tracking-wide text-muted-foreground">
            Contas
          </div>
          <div className="mt-2 flex items-center gap-2 text-2xl font-semibold text-foreground">
            <Users className="h-5 w-5 text-accent" />
            {users.length}
          </div>
        </Card>
        <Card className="border border-border bg-card p-5">
          <div className="text-xs uppercase tracking-wide text-muted-foreground">
            Admins
          </div>
          <div className="mt-2 flex items-center gap-2 text-2xl font-semibold text-foreground">
            <Shield className="h-5 w-5 text-accent" />
            {adminCount}
          </div>
        </Card>
        <Card className="border border-border bg-card p-5 text-sm text-muted-foreground">
          Agora esta area tambem controla créditos flexíveis e plano, sem
          misturar isso na interface do escritor.
        </Card>
      </div>

      <Card className="border border-border bg-card p-5">
        <div className="mb-4">
          <h2 className="font-display text-2xl text-foreground">Usuarios</h2>
          <p className="text-sm text-muted-foreground">
            Gerencie papeis, créditos flexíveis e planos da conta.
          </p>
        </div>

        {usersQuery.isLoading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Carregando...
          </div>
        ) : (
          <div className="space-y-4">
            {users.map((account: any) => {
              const localPlan = getPlanState(account.id);
              return (
                <div
                  key={account.id}
                  className="rounded-lg border border-border bg-secondary/30 p-4"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <div className="font-medium text-foreground">
                        {account.name || "Sem nome"}
                      </div>
                      <div className="text-sm text-muted-foreground">
                        {account.email || "Sem e-mail"}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="rounded-full bg-background/70 px-3 py-1 text-xs text-muted-foreground">
                        {account.role}
                      </div>
                      {account.role === "user" ? (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() =>
                            updateRoleMutation.mutate({
                              userId: account.id,
                              role: "admin",
                            })
                          }
                        >
                          Promover
                        </Button>
                      ) : (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() =>
                            updateRoleMutation.mutate({
                              userId: account.id,
                              role: "user",
                            })
                          }
                        >
                          Rebaixar
                        </Button>
                      )}
                    </div>
                  </div>

                  <div className="mt-4 grid gap-4 xl:grid-cols-[0.8fr_1.2fr]">
                    <div className="rounded-lg border border-border bg-background/60 p-4">
                      <div className="mb-3 flex items-center gap-2 text-sm font-medium text-foreground">
                        <Coins className="h-4 w-4 text-accent" />
                        Créditos flexíveis
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <Input
                          type="number"
                          min="1"
                          value={creditValues[account.id] || ""}
                          onChange={event =>
                            setCreditValues(current => ({
                              ...current,
                              [account.id]: event.target.value,
                            }))
                          }
                          placeholder="Ex: 250"
                          className="max-w-[140px]"
                        />
                        <Button
                          size="sm"
                          onClick={() => {
                            const amount = Number(
                              creditValues[account.id] || 0
                            );
                            if (!Number.isFinite(amount) || amount <= 0) {
                              toast.error(
                                "Informe um valor válido de créditos flexíveis."
                              );
                              return;
                            }
                            grantCreditsMutation.mutate({
                              userId: account.id,
                              amount,
                              reason: "Ajuste manual pelo admin",
                            });
                            setCreditValues(current => ({
                              ...current,
                              [account.id]: "",
                            }));
                          }}
                        >
                          Adicionar
                        </Button>
                      </div>
                    </div>

                    <div className="rounded-lg border border-border bg-background/60 p-4">
                      <div className="mb-3 text-sm font-medium text-foreground">
                        Plano da assinatura
                      </div>
                      <div className="grid gap-2 md:grid-cols-[1fr_1fr_auto]">
                        <select
                          className="rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs outline-none"
                          value={localPlan.planCode}
                          onChange={event =>
                            setPlanValues(current => ({
                              ...current,
                              [account.id]: {
                                ...getPlanState(account.id),
                                planCode: event.target.value as PlanCode,
                              },
                            }))
                          }
                        >
                          <option value="weekly">Semanal</option>
                          <option value="monthly">Mensal</option>
                          <option value="yearly">Anual</option>
                          <option value="none">Sem plano</option>
                        </select>
                        <select
                          className="rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs outline-none"
                          value={localPlan.status}
                          onChange={event =>
                            setPlanValues(current => ({
                              ...current,
                              [account.id]: {
                                ...getPlanState(account.id),
                                status: event.target
                                  .value as SubscriptionStatus,
                              },
                            }))
                          }
                        >
                          <option value="active">Ativo</option>
                          <option value="trial">Trial</option>
                          <option value="paused">Pausado</option>
                          <option value="canceled">Cancelado</option>
                          <option value="none">Sem status</option>
                        </select>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() =>
                            setPlanMutation.mutate({
                              userId: account.id,
                              ...getPlanState(account.id),
                            })
                          }
                        >
                          Salvar plano
                        </Button>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Card>
    </div>
  );
}
