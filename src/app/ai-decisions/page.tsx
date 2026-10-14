import { BrainCircuit } from "lucide-react";
import { DecisionsClient } from "@/components/ai-decisions/DecisionsClient";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "AI Kararları",
};

/**
 * /ai-decisions — AI Kararları ekranı (server component).
 *
 * Kullanıcının tarifi: otomatik alım-satım AI'ının araştırma sonuçları,
 * değerlendirmeleri, neden aldığı/sattığı — aşağı doğru kayan akış (feed)
 * olarak; en altta yazma kutusu ile AI'ya bu işlemler hakkında soru
 * sorulabilen sohbet. Mevcut sayfalara (trading, watchlist) EKLENMEZ —
 * ayrı sayfadır; veri client tarafında API route'larından akar.
 */
export default function AiDecisionsPage() {
  return (
    <div className="space-y-6">
      <section className="space-y-2">
        <div className="flex items-center gap-2">
          <BrainCircuit className="h-7 w-7 text-blue-400" aria-hidden />
          <h1 className="text-3xl font-bold tracking-tight">AI Kararları</h1>
        </div>
        <p className="max-w-2xl text-sm text-gray-400">
          Otomatik alım-satım yapay zekâsının araştırma bulguları,
          değerlendirmeleri ve kararları — neden aldığını, neden sattığını ve
          iç konuşmasını bu akışta görebilirsiniz. Alttaki sohbet kutusundan
          yapay zekâya bu işlemler hakkında soru sorabilirsiniz.
        </p>
      </section>

      <DecisionsClient />
    </div>
  );
}
