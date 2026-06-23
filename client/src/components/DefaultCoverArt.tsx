import { HTMLAttributes } from "react";

import { cn } from "@/lib/utils";

export const DEFAULT_COVER_IMAGE = `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(`
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 720">
  <defs>
    <linearGradient id="bg" x1="0" x2="1" y1="0" y2="1">
      <stop offset="0" stop-color="#211713"/>
      <stop offset="0.52" stop-color="#120f0d"/>
      <stop offset="1" stop-color="#080706"/>
    </linearGradient>
    <radialGradient id="light" cx="70%" cy="35%" r="56%">
      <stop offset="0" stop-color="#b54b3e" stop-opacity="0.36"/>
      <stop offset="0.42" stop-color="#35201b" stop-opacity="0.22"/>
      <stop offset="1" stop-color="#050403" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="1200" height="720" fill="url(#bg)"/>
  <rect width="1200" height="720" fill="url(#light)"/>
  <path d="M228 190h342c42 0 76 34 76 76v320H304c-42 0-76-34-76-76V190Z" fill="#070504" opacity=".70"/>
  <path d="M646 266c0-42 34-76 76-76h250v396H646V266Z" fill="#18120f" opacity=".78"/>
  <path d="M304 246h206M304 306h270M304 366h228M304 426h288" stroke="#f3e9dc" stroke-width="18" stroke-linecap="round" opacity=".20"/>
  <path d="M740 258h150M740 320h108M740 382h176M740 444h132" stroke="#d08a70" stroke-width="16" stroke-linecap="round" opacity=".28"/>
  <rect x="228" y="190" width="744" height="396" rx="28" fill="none" stroke="#ffffff" stroke-opacity=".10" stroke-width="2"/>
</svg>
`)}`;

const LEGACY_DEFAULT_COVER_MARKERS = [
  "%2360a5fa",
  "%2393c5fd",
  "%236b9bf7",
  "#60a5fa",
  "#93c5fd",
  "#6b9bf7",
];

export function isDefaultCoverImage(source?: string | null) {
  if (!source?.trim()) return true;
  const normalized = source.toLowerCase();
  return (
    normalized === DEFAULT_COVER_IMAGE.toLowerCase() ||
    LEGACY_DEFAULT_COVER_MARKERS.some(marker => normalized.includes(marker))
  );
}

type DefaultCoverArtProps = HTMLAttributes<HTMLDivElement>;

export function DefaultCoverArt({ className, ...props }: DefaultCoverArtProps) {
  return (
    <div
      aria-hidden="true"
      className={cn("default-cover-art", className)}
      {...props}
    />
  );
}
