import { type CSSProperties, useEffect, useMemo, useState } from "react";
import { Link, useLocation } from "wouter";
import {
  BarChart3,
  BookOpen,
  CheckCircle,
  Coins,
  Download,
  Feather,
  FileText,
  FolderOpen,
  Layers,
  Library,
  Lightbulb,
  LogOut,
  Menu,
  Plus,
  Shield,
  User,
  X,
  type LucideIcon,
} from "lucide-react";
import { NotificationCenter } from "./NotificationCenter";
import { NotificationToast } from "./NotificationToast";
import { useAuth } from "@/_core/hooks/useAuth";
import { getLoginUrl } from "@/const";
import { Button } from "@/components/ui/button";
import { trpc } from "@/lib/trpc";
import { useActiveWork } from "@/_core/hooks/useActiveWork";
import {
  applyAmbientColor,
  colorToRgbValue,
  extractDominantCoverColor,
  getAppliedAmbientColor,
  getNextFallbackAmbientColor,
  type RgbColor,
} from "@/lib/ambientColor";
import { isDefaultCoverImage } from "@/components/DefaultCoverArt";

interface MainLayoutProps {
  children: React.ReactNode;
}

type NavItem = {
  id: string;
  label: string;
  icon: LucideIcon;
  href: string;
  description: string;
};

type NavGroup = {
  label: string;
  color: string;
  activeBg: string;
  activeText: string;
  items: NavItem[];
};

const navGroups: NavGroup[] = [
  {
    label: "Fluxo de Escrita",
    color: "text-sidebar-foreground",
    activeBg: "bg-blue-500/15",
    activeText: "text-blue-300",
    items: [
      {
        id: "home",
        label: "Mesa",
        icon: BookOpen,
        href: "/home",
        description: "Próxima ação",
      },
      {
        id: "ideas",
        label: "Ideia",
        icon: Lightbulb,
        href: "/ideas",
        description: "Desenvolver premissa",
      },
      {
        id: "draft",
        label: "Rascunho",
        icon: FileText,
        href: "/draft",
        description: "Texto bruto do autor",
      },
      {
        id: "writing",
        label: "Escrita",
        icon: Feather,
        href: "/writing",
        description: "IA gera e corrige",
      },
      {
        id: "review",
        label: "Revisão",
        icon: CheckCircle,
        href: "/review",
        description: "Aprovar cânone",
      },
      {
        id: "export",
        label: "Publicação",
        icon: Download,
        href: "/export",
        description: "Exportar e fechar",
      },
    ],
  },
  {
    label: "Organização",
    color: "text-sidebar-foreground",
    activeBg: "bg-amber-500/15",
    activeText: "text-amber-300",
    items: [
      {
        id: "works",
        label: "Obras",
        icon: FolderOpen,
        href: "/works",
        description: "Livros e configurações",
      },
      {
        id: "library",
        label: "Arquivo",
        icon: Library,
        href: "/library",
        description: "Conteúdo canônico",
      },
      {
        id: "series",
        label: "Séries",
        icon: Layers,
        href: "/series",
        description: "Universo conectado",
      },
      {
        id: "dashboard",
        label: "Dashboard",
        icon: BarChart3,
        href: "/dashboard",
        description: "Gargalos e progresso",
      },
    ],
  },
];

const adminGroup: NavGroup = {
  label: "Sistema",
  color: "text-sidebar-foreground",
  activeBg: "bg-red-500/15",
  activeText: "text-red-300",
  items: [
    {
      id: "admin",
      label: "Admin",
      icon: Shield,
      href: "/admin",
      description: "Gerenciar contas",
    },
  ],
};

const baseNavItems = navGroups.flatMap(g => g.items);

const pageMeta: Record<
  string,
  {
    title: string;
    subtitle: string;
    primaryAction?: { label: string; href: string };
  }
> = {
  "/ideas": {
    title: "Ideias",
    subtitle: "Desenvolvimento guiado antes de entrar em produção.",
    primaryAction: { label: "Ir para rascunho", href: "/draft" },
  },
  "/home": {
    title: "Mesa de trabalho",
    subtitle: "Continuidade, pendências e próxima ação.",
    primaryAction: { label: "Novo rascunho", href: "/draft" },
  },
  "/works": {
    title: "Obras",
    subtitle: "Livros, material, cânone e configurações.",
  },
  "/draft": {
    title: "Rascunho",
    subtitle: "Texto bruto do autor antes da IA.",
    primaryAction: { label: "Enviar para Escrita", href: "/writing" },
  },
  "/writing": {
    title: "Escrita",
    subtitle: "Gerar capítulo e corrigir efeitos no texto.",
    primaryAction: { label: "Ir para revisão", href: "/review" },
  },
  "/review": {
    title: "Revisão",
    subtitle: "Ler, revisar e aprovar como canônico.",
    primaryAction: { label: "Voltar para escrita", href: "/writing" },
  },
  "/profile": {
    title: "Obras",
    subtitle: "Livros, material, cânone e configurações.",
  },
  "/series": {
    title: "Séries",
    subtitle: "Livros do mesmo universo conectados.",
    primaryAction: { label: "Nova série", href: "/series" },
  },
  "/library": {
    title: "Biblioteca",
    subtitle: "Arquivo canônico pesquisável.",
    primaryAction: { label: "Nova entrada", href: "/library" },
  },
  "/dashboard": {
    title: "Dashboard",
    subtitle: "Gargalos, progresso e saúde da obra.",
    primaryAction: { label: "Continuar obra", href: "/home" },
  },
  "/export": {
    title: "Exportação",
    subtitle: "Arquivos finais, ordem editorial e fechamento.",
    primaryAction: { label: "Ver Obras", href: "/works" },
  },
  "/publication": {
    title: "Exportação",
    subtitle: "Arquivos finais, ordem editorial e fechamento.",
    primaryAction: { label: "Ver Obras", href: "/works" },
  },
  "/admin": {
    title: "Admin",
    subtitle: "Controle de contas e papéis.",
    primaryAction: { label: "Ver usuários", href: "/admin" },
  },
};

const INACTIVE_WORK_STATUSES = new Set(["paused", "completed", "archived"]);

function isProductionWork(work: { status?: string | null }) {
  return !INACTIVE_WORK_STATUSES.has(work.status || "");
}

export default function MainLayout({ children }: MainLayoutProps) {
  const [sidebarExpanded, setSidebarExpanded] = useState(true);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [fallbackAmbientColor] = useState<RgbColor>(
    () => getAppliedAmbientColor() ?? getNextFallbackAmbientColor()
  );
  const [ambientColor, setAmbientColor] = useState<RgbColor>(
    () => fallbackAmbientColor
  );
  const [location, navigate] = useLocation();
  const { logout, user } = useAuth();
  const billingQuery = trpc.billing.summary.useQuery();
  const { activeWorkId, activeWork, works, setActiveWorkId } = useActiveWork();
  const walletCredits =
    billingQuery.data?.data.credits?.wallet.balance ??
    billingQuery.data?.data.wallet.balance ??
    "...";
  const narrativeCredits = billingQuery.data?.data.credits?.narrative.remaining;

  const pathname = useMemo(() => location.split("?")[0] || "/home", [location]);
  const meta = pageMeta[pathname] || pageMeta["/home"];
  const productionWorks = useMemo(
    () => works.filter(isProductionWork),
    [works]
  );
  const primaryAction =
    !activeWork && pathname === "/home"
      ? undefined
      : works.length === 0
        ? { label: "Nova obra", href: "/works?createWork=1" }
        : !activeWork
          ? undefined
          : meta.primaryAction;
  const PrimaryActionIcon = activeWork ? Plus : FolderOpen;
  const navItems =
    user?.role === "admin"
      ? [...baseNavItems, ...adminGroup.items]
      : baseNavItems;

  const allGroups =
    user?.role === "admin" ? [...navGroups, adminGroup] : [...navGroups];

  useEffect(() => {
    setMobileMenuOpen(false);
    setUserMenuOpen(false);
  }, [pathname]);

  useEffect(() => {
    let cancelled = false;
    const coverImage = activeWork?.coverImage?.trim();

    if (!coverImage || isDefaultCoverImage(coverImage)) {
      setAmbientColor(fallbackAmbientColor);
      return;
    }

    extractDominantCoverColor(coverImage).then(color => {
      if (!cancelled) setAmbientColor(color ?? fallbackAmbientColor);
    });

    return () => {
      cancelled = true;
    };
  }, [activeWork?.coverImage, fallbackAmbientColor]);

  useEffect(() => {
    applyAmbientColor(ambientColor);
  }, [ambientColor]);

  const ambientStyle = useMemo(
    () =>
      ({
        "--ambient-rgb": colorToRgbValue(ambientColor),
        "--flare-rgb": colorToRgbValue(ambientColor),
      }) as CSSProperties,
    [ambientColor]
  );

  const handleLogout = async () => {
    await logout();
    window.location.href = getLoginUrl();
  };

  const handleCreateFirstWork = () => {
    navigate("/works?createWork=1");
  };

  return (
    <div
      className="literary-ambient flex h-screen overflow-hidden text-foreground"
      style={ambientStyle}
    >
      <NotificationToast />

      <aside
        className={`hidden h-screen shrink-0 md:flex flex-col border-r border-sidebar-border bg-sidebar/88 shadow-[16px_0_60px_rgba(0,0,0,0.2)] backdrop-blur-xl transition-colors duration-150 ${sidebarExpanded ? "w-72" : "w-20"}`}
      >
        <div className="flex items-center justify-between border-b border-sidebar-border px-4 py-4">
          {sidebarExpanded ? (
            <div>
              <div className="font-display text-lg text-sidebar-foreground">
                Literary Canvas
              </div>
              <div className="text-xs text-sidebar-foreground/72">
                Produção literária com escopo real
              </div>
            </div>
          ) : (
            <div className="w-8" />
          )}
          <button
            onClick={() => setSidebarExpanded(prev => !prev)}
            className="rounded-md p-2 text-sidebar-foreground/70 hover:bg-accent/15 hover:text-sidebar-foreground"
            aria-label="Alternar menu"
          >
            {sidebarExpanded ? <X size={18} /> : <Menu size={18} />}
          </button>
        </div>

        {sidebarExpanded ? (
          <div className="border-b border-sidebar-border px-4 py-4 space-y-3">
            {productionWorks.length > 0 ? (
              <div>
                <div className="flex items-center justify-between">
                  <div className="text-[10px] uppercase tracking-widest font-semibold text-sidebar-foreground/70">
                    Obra ativa
                  </div>
                  <Link
                    href="/works"
                    className="text-[10px] uppercase tracking-wider text-sidebar-foreground/75 hover:text-sidebar-foreground transition-colors"
                  >
                    Gerenciar
                  </Link>
                </div>
                <select
                  className="mt-2 w-full rounded-lg border border-sidebar-border bg-background/80 px-3 py-2 text-sm text-foreground"
                  value={activeWorkId ?? ""}
                  onChange={e =>
                    setActiveWorkId(
                      e.target.value ? Number(e.target.value) : null
                    )
                  }
                >
                  {productionWorks.map(work => (
                    <option key={work.id} value={work.id}>
                      {work.title}
                    </option>
                  ))}
                </select>
              </div>
            ) : works.length === 0 ? (
              <div>
                <div className="text-[10px] uppercase tracking-widest font-semibold text-sidebar-foreground/70">
                  Obra ativa
                </div>
                <button
                  type="button"
                  onClick={handleCreateFirstWork}
                  className="mt-2 block w-full rounded-lg border border-dashed border-sidebar-border px-3 py-2.5 text-center text-sm text-sidebar-foreground/85 hover:border-accent/50 hover:text-sidebar-foreground transition-colors"
                >
                  Criar primeira obra
                </button>
              </div>
            ) : null}
            <div className="flex items-center justify-between gap-3 rounded-lg bg-accent/85 px-3 py-2.5 text-sm text-accent-foreground shadow-[0_10px_30px_rgba(0,0,0,0.20)]">
              <span className="flex min-w-0 items-center gap-2 text-accent-foreground">
                <Coins className="h-4 w-4" />
                <span className="min-w-0">
                  <span className="block truncate">Flexíveis</span>
                  {typeof narrativeCredits === "number" ? (
                    <span className="block truncate text-[11px] text-accent-foreground/80">
                      Narrativa {narrativeCredits.toLocaleString("pt-BR")}
                    </span>
                  ) : null}
                </span>
              </span>
              <span className="shrink-0 font-semibold text-accent-foreground">
                {typeof walletCredits === "number"
                  ? walletCredits.toLocaleString("pt-BR")
                  : walletCredits}
              </span>
            </div>
          </div>
        ) : null}

        <nav className="flex-1 overflow-y-auto px-3 py-4">
          {allGroups.map(group => (
            <div key={group.label} className="mb-4">
              {sidebarExpanded ? (
                <div className="mb-2 px-3 text-[11px] font-semibold uppercase tracking-wider text-sidebar-foreground/75">
                  {group.label}
                </div>
              ) : (
                <div className="mx-auto mb-2 mt-2 h-px w-8 bg-sidebar-border" />
              )}
              <div className="space-y-1">
                {group.items.map(item => {
                  const Icon = item.icon;
                  const active =
                    pathname === item.href ||
                    (item.href === "/works" && pathname === "/profile");
                  return (
                    <Link
                      key={item.id}
                      href={item.href}
                      className={`group relative flex items-center gap-3 rounded-lg px-3 py-2.5 transition-all duration-150 ${
                        active
                          ? "bg-accent/85 text-accent-foreground font-medium ring-1 ring-accent/35 shadow-[0_10px_30px_rgba(0,0,0,0.18)]"
                          : "text-sidebar-foreground/85 hover:text-sidebar-foreground hover:bg-accent/15"
                      }`}
                    >
                      <Icon
                        size={18}
                        className={`shrink-0 ${active ? "" : "opacity-90 group-hover:opacity-100"}`}
                      />
                      {sidebarExpanded ? (
                        <span className="truncate text-sm">{item.label}</span>
                      ) : (
                        <span className="pointer-events-none absolute left-full z-50 ml-2 rounded-lg bg-card border border-border px-2.5 py-1.5 text-xs text-card-foreground opacity-0 shadow-lg group-hover:opacity-100 transition-opacity">
                          {item.label}
                        </span>
                      )}
                    </Link>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>

        <div className="border-t border-sidebar-border p-3">
          {primaryAction && sidebarExpanded ? (
            works.length === 0 ? (
              <Button
                type="button"
                onClick={handleCreateFirstWork}
                className="mb-3 w-full bg-accent text-accent-foreground hover:bg-accent/90 font-medium"
              >
                <PrimaryActionIcon className="mr-2 h-4 w-4" />
                {primaryAction.label}
              </Button>
            ) : (
              <Link href={primaryAction.href}>
                <Button className="mb-3 w-full bg-accent text-accent-foreground hover:bg-accent/90 font-medium">
                  <PrimaryActionIcon className="mr-2 h-4 w-4" />
                  {primaryAction.label}
                </Button>
              </Link>
            )
          ) : null}
          <button
            onClick={() => setUserMenuOpen(prev => !prev)}
            className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sidebar-foreground/90 hover:bg-accent/10 hover:text-sidebar-foreground transition-colors"
          >
            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-accent/85 text-accent-foreground">
              <User size={16} />
            </div>
            {sidebarExpanded ? (
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium text-sidebar-foreground">
                  {user?.name || "Autor"}
                </div>
                <div className="truncate text-xs text-sidebar-foreground/72">
                  {activeWork?.title || "Sem obra ativa"}
                  {activeWork?.status === "paused"
                    ? " · Pausada"
                    : activeWork?.status === "completed"
                      ? " · Concluída"
                      : activeWork?.status === "archived"
                        ? " · Arquivada"
                        : ""}
                </div>
              </div>
            ) : null}
          </button>
          {userMenuOpen && sidebarExpanded ? (
            <button
              onClick={handleLogout}
              className="mt-2 flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-sidebar-foreground/70 hover:bg-red-500/10 hover:text-red-400 transition-colors"
            >
              <LogOut size={16} />
              Sair
            </button>
          ) : null}
        </div>
      </aside>

      <main className="flex h-screen min-w-0 flex-1 flex-col overflow-hidden">
        <header className="literary-header border-b border-border px-4 py-3.5 md:px-6">
          <div className="flex items-center justify-between gap-4">
            <div className="min-w-0 flex items-center gap-3">
              <div>
                <h1 className="font-display text-xl text-foreground md:text-2xl">
                  {meta.title}
                </h1>
                <div className="flex items-center gap-2 mt-0.5">
                  <p className="text-xs text-muted-foreground md:text-sm">
                    {meta.subtitle}
                  </p>
                  {activeWork ? (
                    <span className="hidden md:inline-flex items-center gap-1 rounded-full bg-accent/85 px-2 py-0.5 text-xs text-accent-foreground">
                      {activeWork?.title}
                    </span>
                  ) : null}
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {primaryAction ? (
                works.length === 0 ? (
                  <Button
                    type="button"
                    onClick={handleCreateFirstWork}
                    variant="outline"
                    size="sm"
                    className="hidden border-border bg-background/60 text-foreground/95 hover:text-foreground md:inline-flex"
                  >
                    <PrimaryActionIcon className="mr-1.5 h-3.5 w-3.5" />
                    {primaryAction.label}
                  </Button>
                ) : (
                  <Link href={primaryAction.href} className="hidden md:block">
                    <Button
                      variant="outline"
                      size="sm"
                      className="border-border bg-background/60 text-foreground/95 hover:text-foreground"
                    >
                      <PrimaryActionIcon className="mr-1.5 h-3.5 w-3.5" />
                      {primaryAction.label}
                    </Button>
                  </Link>
                )
              ) : null}
              <NotificationCenter />
              <button
                onClick={() => setMobileMenuOpen(prev => !prev)}
                className="rounded-md p-2 text-foreground hover:bg-secondary md:hidden"
                aria-label="Abrir menu"
              >
                {mobileMenuOpen ? <X size={20} /> : <Menu size={20} />}
              </button>
            </div>
          </div>
        </header>

        {mobileMenuOpen ? (
          <nav className="literary-card border-b border-border px-3 py-3 md:hidden">
            <div className="mb-3 flex items-center justify-between rounded-lg bg-accent/85 px-3 py-2 text-sm text-accent-foreground">
              <span className="text-accent-foreground">
                {activeWork?.title || "Sem obra ativa"}
              </span>
              <span className="font-medium text-accent-foreground">
                {typeof walletCredits === "number"
                  ? walletCredits.toLocaleString("pt-BR")
                  : walletCredits}{" "}
                flex
              </span>
            </div>
            <div className="space-y-1">
              {navItems.map(item => {
                const Icon = item.icon;
                const active =
                  pathname === item.href ||
                  (item.href === "/works" && pathname === "/profile");
                return (
                  <Link
                    key={item.id}
                    href={item.href}
                    onClick={() => setMobileMenuOpen(false)}
                    className={`flex items-center gap-3 rounded-lg px-3 py-3 transition-colors ${active ? "bg-accent/85 text-accent-foreground" : "text-foreground/85 hover:bg-accent/10 hover:text-foreground"}`}
                  >
                    <Icon size={18} />
                    <div>
                      <div className="text-sm font-medium">{item.label}</div>
                      <div
                        className={`text-xs ${active ? "text-accent-foreground/80" : "text-muted-foreground"}`}
                      >
                        {item.description}
                      </div>
                    </div>
                  </Link>
                );
              })}
              <button
                onClick={handleLogout}
                className="flex w-full items-center gap-3 rounded-lg px-3 py-3 text-left text-foreground/70 hover:bg-red-500/10 hover:text-red-400 transition-colors"
              >
                <LogOut size={18} />
                <span className="text-sm font-medium">Sair</span>
              </button>
            </div>
          </nav>
        ) : null}

        <div className="min-h-0 flex-1 overflow-auto">
          <div className="relative p-4 md:p-6">{children}</div>
        </div>
      </main>
    </div>
  );
}
