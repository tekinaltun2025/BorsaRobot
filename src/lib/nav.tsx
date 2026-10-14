import {
  BarChart3,
  Bot,
  BrainCircuit,
  CandlestickChart,
  CircleHelp,
  Eye,
  Settings,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

/**
 * Ana gezinme tanımı (iyileştirme 8.2) — desktop header nav'ı ve mobil
 * hamburger menüsü aynı listeyi kullanır; tek kaynak.
 */
export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
}

export const navItems: readonly NavItem[] = [
  { href: "/", label: "Panel", icon: BarChart3 },
  { href: "/watchlist", label: "İzleme Listesi", icon: Eye },
  { href: "/trading", label: "Trading", icon: CandlestickChart },
  { href: "/ai-decisions", label: "AI Kararları", icon: BrainCircuit },
  { href: "/admin", label: "Yönetim", icon: Settings },
  { href: "/yardim", label: "Yardım", icon: CircleHelp },
] as const;

/** Logo markası — header ve mobil menüde ortak. */
export function BrandMark() {
  return (
    <span className="flex items-center gap-2 font-semibold">
      <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-600">
        <Bot className="h-5 w-5 text-white" aria-hidden />
      </span>
      <span className="text-lg tracking-tight">BorsaRobot</span>
    </span>
  );
}
