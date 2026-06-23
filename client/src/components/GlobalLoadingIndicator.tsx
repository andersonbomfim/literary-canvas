import { useEffect, useState } from "react";
import { useIsFetching, useIsMutating } from "@tanstack/react-query";

/**
 * Indicador global de carregamento — barra fina no topo da janela que
 * aparece sempre que QUALQUER query ou mutation tRPC está em andamento.
 *
 * Antes o app tinha estados de loading espalhados (cada tela com seu próprio
 * spinner ou às vezes nenhum), o que dava ao usuário a impressão de
 * travamento quando uma ação demorava 2s sem feedback visual. Esta barra:
 *
 *   - Hookea diretamente no QueryClient (mesmo que o tRPC já usa), então
 *     captura QUALQUER chamada de rede sem precisar adaptar tela por tela.
 *   - Tem debounce de aparecer (150ms) para não piscar em requests instantâneos
 *     que terminam antes do usuário sequer notar.
 *   - Tem fade-out de 200ms para evitar tremor quando uma ação dispara várias
 *     queries em cascata (uma termina, a próxima começa).
 *   - É fixed top + z-index alto para ficar visível sobre modais e overlays.
 *   - Respeita prefers-reduced-motion: usuários com a flag não veem a
 *     animação shimmer; a barra apenas fica estática durante o load.
 */
export default function GlobalLoadingIndicator() {
  const fetchingCount = useIsFetching();
  const mutatingCount = useIsMutating();
  const isBusy = fetchingCount > 0 || mutatingCount > 0;

  // Visível "real": passou o debounce de aparecer e ainda não passou o debounce
  // de esconder. Separar `isBusy` do que o usuário vê evita flicker.
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (isBusy) {
      // Delay para evitar barra aparecendo por 80ms em queries triviais.
      const showTimer = window.setTimeout(() => setVisible(true), 150);
      return () => window.clearTimeout(showTimer);
    }
    // Pequeno delay para cobrir o gap entre uma query terminar e a próxima
    // do mesmo fluxo começar (ex.: refetch encadeado depois de invalidate).
    const hideTimer = window.setTimeout(() => setVisible(false), 200);
    return () => window.clearTimeout(hideTimer);
  }, [isBusy]);

  return (
    <div
      aria-hidden={!visible}
      role="progressbar"
      aria-busy={visible}
      aria-label="Carregando"
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        height: 2,
        zIndex: 9999,
        pointerEvents: "none",
        opacity: visible ? 1 : 0,
        transition: "opacity 200ms ease-out",
      }}
    >
      <div
        className="global-loading-bar"
        style={{
          height: "100%",
          width: "100%",
          background:
            "linear-gradient(90deg, transparent 0%, rgba(99, 102, 241, 0.9) 25%, rgba(168, 85, 247, 0.9) 50%, rgba(99, 102, 241, 0.9) 75%, transparent 100%)",
          backgroundSize: "200% 100%",
          animation: "global-loading-shimmer 1.2s linear infinite",
        }}
      />
      {/* Mantém o keyframe local para não depender de regra global no index.css.
          Em browsers com prefers-reduced-motion, o user-agent já ignora
          animation se a regra `@media (prefers-reduced-motion: reduce)`
          estiver presente — o `.no-motion` abaixo cobre o caso explícito. */}
      <style>{`
        @keyframes global-loading-shimmer {
          0% { background-position: 100% 0; }
          100% { background-position: -100% 0; }
        }
        @media (prefers-reduced-motion: reduce) {
          .global-loading-bar {
            animation: none !important;
            background: rgba(99, 102, 241, 0.9) !important;
          }
        }
      `}</style>
    </div>
  );
}
