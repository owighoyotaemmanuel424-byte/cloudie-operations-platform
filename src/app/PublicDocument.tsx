import { motion } from "framer-motion";
import { ArrowLeft, FileText, LayoutGrid } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useParams } from "react-router";
import { Button } from "@/components/ui/button";
import { lookupPublicDocument } from "@/platform/engine";
import type { TravelDocument } from "@/platform/model";
import { EASE } from "@/platform/ui";
import { DocumentSheet } from "./DocumentSheet";

export default function PublicDocument() {
  const { token } = useParams();
  const [document, setDocument] = useState<TravelDocument | null | undefined>(undefined);

  useEffect(() => {
    let alive = true;
    if (!token) {
      setDocument(null);
      return () => {
        alive = false;
      };
    }
    void lookupPublicDocument(token).then((result) => {
      if (alive) setDocument(result);
    });
    return () => {
      alive = false;
    };
  }, [token]);

  return (
    <div className="min-h-screen bg-background">
      <header className="no-print border-b border-border">
        <div className="page-gutter mx-auto flex h-16 max-w-3xl items-center justify-between">
          <Link to="/" className="flex items-center gap-2.5">
            <span className="grid h-8 w-8 place-items-center rounded-lg bg-primary text-primary-foreground">
              <LayoutGrid className="h-4 w-4" />
            </span>
            <span className="font-display text-sm font-semibold">Cloudie Documents</span>
          </Link>
          <Button asChild variant="ghost" size="sm">
            <Link to="/"><ArrowLeft className="h-4 w-4" /> Home</Link>
          </Button>
        </div>
      </header>

      <main className="page-gutter mx-auto max-w-3xl py-10">
        {document === undefined ? (
          <div className="flex justify-center py-16">
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-border border-t-primary" />
          </div>
        ) : document ? (
          <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, ease: EASE }}>
            <DocumentSheet document={document} />
          </motion.div>
        ) : (
          <div className="rounded-2xl border border-border bg-card p-10 text-center">
            <FileText className="mx-auto h-7 w-7 text-muted-foreground" />
            <h1 className="mt-3 font-display text-xl font-semibold">Document unavailable</h1>
            <p className="mt-1 text-sm text-muted-foreground">This share link is private or no longer valid.</p>
          </div>
        )}
      </main>
    </div>
  );
}
