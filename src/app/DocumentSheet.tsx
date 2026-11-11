import { Download, Link2, Printer } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { renderPdf, type PdfBlock } from "@/lib/pdf";
import type { TravelDocument } from "@/platform/model";
import { dateTime, naira } from "@/platform/format";

export function downloadDocumentPdf(document: TravelDocument) {
  const blocks: PdfBlock[] = [
    { kind: "banner", text: "CLOUDIE OPERATIONS", tone: "dark" },
    { kind: "text", text: document.title, size: 16, bold: true },
    { kind: "spacer", height: 8 },
    { kind: "box", title: "Issued to", lines: [
      { label: "Passenger / client", value: document.passenger || "—" },
      { label: "Reference", value: document.reference || "—" },
      { label: "Issued", value: dateTime(document.createdAt) },
    ] },
    { kind: "heading", text: "Document detail" },
    { kind: "table", headers: ["Field", "Value"], rows: document.lines.map((line) => [line.label, line.value]) },
    ...(document.total !== null
      ? [
          { kind: "spacer" as const, height: 8 },
          { kind: "kv" as const, label: "Total", value: `${document.currency} ${document.total.toLocaleString()}` },
        ]
      : []),
    { kind: "spacer", height: 12 },
    { kind: "text", text: `Rendered by the Cloudie document engine · ${document.pointsCharged} pts charged`, size: 8, color: [0.45, 0.45, 0.45] },
  ];

  const result = renderPdf(blocks, { title: document.title, footer: "cloudie.africa · verified document" });
  const bytes = new Uint8Array(result.bytes);
  const blob = new Blob([bytes], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);
  const anchor = window.document.createElement("a");
  anchor.href = url;
  anchor.download = `${document.title.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.pdf`;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function DocumentSheet({ document }: { document: TravelDocument }) {
  async function copyLink() {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}/d/${document.publicToken}`);
      toast.success("Share link copied");
    } catch {
      toast.error("Clipboard unavailable");
    }
  }

  return (
    <div>
      <div className="no-print mb-3 flex flex-wrap gap-2">
        <Button size="sm" variant="outline" onClick={() => downloadDocumentPdf(document)}>
          <Download className="h-3.5 w-3.5" /> Download PDF
        </Button>
        <Button size="sm" variant="outline" onClick={() => window.print()}>
          <Printer className="h-3.5 w-3.5" /> Print
        </Button>
        <Button size="sm" variant="ghost" onClick={copyLink}>
          <Link2 className="h-3.5 w-3.5" /> Share link
        </Button>
      </div>

      <article className="print-sheet overflow-hidden rounded-xl border border-border bg-white text-[#14201b] shadow-sm">
        <div className="flex items-start justify-between border-b border-[#e5e0d3] bg-[#0f2a22] px-6 py-4 text-white">
          <div>
            <p className="font-mono text-[9px] uppercase tracking-[0.28em] text-white/60">Cloudie Operations</p>
            <p className="mt-1 font-display text-lg font-semibold">{document.title}</p>
          </div>
          <span className="rounded-full border border-white/25 px-2.5 py-1 font-mono text-[9px] uppercase tracking-[0.18em]">
            {document.kind}
          </span>
        </div>

        <div className="grid gap-4 px-6 py-5 sm:grid-cols-3">
          {[
            ["Issued to", document.passenger || "—"],
            ["Reference", document.reference || "—"],
            ["Issued", dateTime(document.createdAt)],
          ].map(([label, value]) => (
            <div key={label}>
              <p className="font-mono text-[8px] uppercase tracking-[0.2em] text-[#6b726b]">{label}</p>
              <p className="mt-0.5 text-[12px] font-medium">{value}</p>
            </div>
          ))}
        </div>

        <table className="w-full border-collapse text-[12px]">
          <tbody>
            {document.lines.map((line) => (
              <tr key={line.label} className="border-t border-[#eee9dc]">
                <td className="w-1/3 px-6 py-2.5 align-top font-mono text-[9px] uppercase tracking-[0.14em] text-[#6b726b]">
                  {line.label}
                </td>
                <td className="px-6 py-2.5 align-top">{line.value}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="flex items-center justify-between border-t border-[#eee9dc] px-6 py-4">
          <p className="font-mono text-[9px] uppercase tracking-[0.16em] text-[#6b726b]">
            {document.pointsCharged} pts · rendered by Cloudie
          </p>
          {document.total !== null ? (
            <p className="font-display text-base font-semibold">{naira(document.total)}</p>
          ) : null}
        </div>
      </article>
    </div>
  );
}
