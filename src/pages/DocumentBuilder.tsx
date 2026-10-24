import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router";
import { useMutation, useQuery } from "convex/react";
import { toast } from "sonner";
import { AnimatePresence, motion } from "framer-motion";
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  Coins,
  Download,
  Loader2,
  RefreshCw,
  Save,
  Sparkles,
  Wand2,
} from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import {
  isSafeImageDataUrl,
  validateValues,
  type DocumentValues,
} from "@/lib/docTemplateEngine";
import { checkDocumentTotals, formatAmount, formatDifference, pruneBriefRowDefaults, type TotalsCheck } from "@/lib/documentTotals";
import {
  newAttemptId,
  renderDocumentArtifacts,
  uploadArtifact,
} from "@/lib/renderClient";
import { useTemplateArtwork } from "@/hooks/use-template-artwork";
import { DocumentPreview } from "@/components/documents/DocumentPreview";
import { TemplateForm } from "@/components/documents/TemplateForm";
import { PageHeader } from "@/components/documents/ui";

/**
 * Document builder.
 *
 * Fill the dynamic form → the preview re-renders instantly from the same
 * engine used for export → Generate rasterizes PNG + assembles the PDF in the
 * browser, uploads both, and the server validates + charges + records.
 */
export default function DocumentBuilder() {
  const params = useParams<{ templateId: string }>();
  const templateId = params.templateId as Id<"documentTemplates"> | undefined;
  const navigate = useNavigate();
  const location = useLocation();
  // Values extracted from a brief generator run are handed over through router
  // state so the form opens pre-filled instead of blank.
  const briefValues = (location.state as { briefValues?: Record<string, string> } | null)?.briefValues;
  const prefillNotified = useRef(false);

  const template = useQuery(
    api.docTemplates.getTemplate,
    templateId ? { templateId } : "skip",
  );
  const quote = useQuery(
    api.docTemplates.getRenderQuote,
    templateId ? { templateId } : "skip",
  );

  const createDocument = useMutation(api.docTemplates.createDocument);
  const updateDocumentValues = useMutation(api.docTemplates.updateDocumentValues);
  const finalizeDocument = useMutation(api.docTemplates.finalizeDocument);
  const generateUploadUrl = useMutation(api.storage.generateUploadUrl);

  const [title, setTitle] = useState("");
  const [values, setValues] = useState<DocumentValues>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [draftId, setDraftId] = useState<Id<"renderedDocuments"> | null>(null);
  const [saving, setSaving] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [stage, setStage] = useState("");
  // Set once the user chooses to render a document whose totals still disagree.
  const [mismatchAccepted, setMismatchAccepted] = useState(false);

  // Seed the form from the template once it loads, layering any values
  // extracted from a brief on top of the template defaults. Row slots the brief
  // left alone are cleared rather than kept, so a one-line brief does not
  // arrive carrying the template's sample lines.
  useEffect(() => {
    if (!template) return;
    setTitle((current) => current || template.name);
    setValues((current) => {
      if (Object.keys(current).length > 0) return current;
      // Never prefill a new customer document with fabricated names, dates,
      // references, balances, bookings or transaction values. Keep visual color
      // choices and required hidden fields, and retain explicit authenticity
      // notices where a template needs them.
      const neutralDefaults: Record<string, unknown> = {};
      // A template served by an older backend revision may predate `defaults`
      // (or even `schema`); the page must render an empty form for it rather
      // than crash with "undefined is not an object".
      const templateSchema = template.schema ?? { fields: [] };
      const defaults = template.defaults ?? {};
      const fields = templateSchema.fields ?? [];
      for (const field of fields) {
        const raw = defaults[field.id] ?? field.default ?? "";
        if (field.hidden) {
          neutralDefaults[field.id] = raw;
        } else if (field.type === "color") {
          neutralDefaults[field.id] = raw;
        } else if (field.type === "checkbox") {
          neutralDefaults[field.id] = false;
        } else if (typeof raw === "string" && /not government issued|demo profile/i.test(raw)) {
          neutralDefaults[field.id] = "This is not a government-issued document.";
        } else if (typeof raw === "string" && /sample itinerary|not proof of ticket issuance|sample details/i.test(raw)) {
          neutralDefaults[field.id] = "This generated itinerary does not confirm a booking or ticket issuance. Verify details with the provider.";
        } else if (typeof raw === "string" && /not proof|not a real|not official|not valid|does not confirm|verification required|fictional|illustrative/i.test(raw)) {
          neutralDefaults[field.id] = "Verify these details against the original source records. This document does not independently confirm the underlying transaction.";
        } else {
          neutralDefaults[field.id] = "";
        }
      }
      const seeded = { ...neutralDefaults, ...(briefValues ?? {}) };
      return briefValues ? pruneBriefRowDefaults(templateSchema, seeded, briefValues) : seeded;
    });
  }, [template, briefValues]);

  useEffect(() => {
    if (!template || prefillNotified.current) return;
    const count = Object.keys(briefValues ?? {}).length;
    if (count === 0) return;
    prefillNotified.current = true;
    toast.success(`${count} field${count === 1 ? "" : "s"} pre-filled from your brief`);
  }, [template, briefValues]);

  const schema = template?.schema ?? { fields: [] };
  const configuration = template?.configuration ?? { pages: [] };
  // Artwork traced from an upload is injected at render time, never stored in
  // the layout. Export waits for it so a page never loses its background.
  const artwork = useTemplateArtwork(configuration.pages, template?.artworkUrl);
  const renderConfiguration = useMemo(
    () => ({ ...configuration, pages: artwork.pages }),
    [configuration, artwork.pages],
  );
  const cost = quote?.cost ?? template?.requiredCredits ?? 0;
  const balance = quote?.balance ?? 0;
  const affordable = quote?.affordable ?? balance >= cost;

  const imageDataUrls = useMemo(() => {
    const out: Record<string, string> = {};
    for (const field of schema.fields) {
      if (field.type !== "image") continue;
      const value = values[field.id];
      if (isSafeImageDataUrl(value)) out[field.id] = value;
    }
    return out;
  }, [schema, values]);

  // Totals are reconciled on every keystroke, so a manual edit that breaks the
  // arithmetic is caught before the document is ever rendered.
  const totals = useMemo(
    () => checkDocumentTotals(schema, values, template?.slug),
    [schema, values, template?.slug],
  );

  const applyTotal = (check: TotalsCheck) => {
    handleChange(check.fieldId, check.expected.toFixed(2));
    toast.success(`${check.label} set to ${formatAmount(check.expected, totals?.currency ?? "USD")}`);
  };

  const openMismatch = () => setMismatchAccepted(false);

  const handleChange = (fieldId: string, value: unknown) => {
    setValues((prev) => ({ ...prev, [fieldId]: value }));
    openMismatch();
    setErrors((prev) => {
      if (!prev[fieldId]) return prev;
      const next = { ...prev };
      delete next[fieldId];
      return next;
    });
  };

  // Points are charged when the document is first created, so the amount the
  // customer paid is captured here and carried into the generate receipt.
  const chargedRef = useRef(0);

  const persistDraft = async (): Promise<Id<"renderedDocuments"> | null> => {
    if (!templateId) return null;
    if (draftId) {
      await updateDocumentValues({ documentId: draftId, title, values });
      return draftId;
    }
    const created = await createDocument({ templateId, title, values });
    setDraftId(created.documentId);
    chargedRef.current = created.charged;
    return created.documentId;
  };

  const onSaveDraft = async () => {
    if (!template) return;
    // Creating the draft is the chargeable step, so a customer who cannot
    // afford it is told before the click rather than after it fails.
    if (!draftId && !affordable) {
      toast.error(`Insufficient points — creating a document costs ${cost} points`, {
        description: "Your draft has not been saved.",
      });
      return;
    }
    setSaving(true);
    try {
      const created = await persistDraft();
      toast.success(
        created && chargedRef.current > 0
          ? `Draft saved — ${chargedRef.current} points used`
          : "Draft saved",
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not save the draft");
    } finally {
      setSaving(false);
    }
  };

  const onGenerate = async () => {
    if (!template) return;
    // Mismatched totals mean the printed document contradicts its own lines.
    // Rendering is chargeable, so the mismatch is confirmed once, not bypassed.
    if (totals && totals.mismatches.length > 0 && !mismatchAccepted) {
      setMismatchAccepted(true);
      const names = totals.mismatches.map((check) => check.label).join(", ");
      toast.error(`Totals do not add up: ${names}`, {
        description: "Apply the suggested figures, or press Generate again to render anyway.",
        duration: 7000,
      });
      return;
    }
    if (totals && totals.mismatches.length > 0) setMismatchAccepted(false);
    const result = validateValues(schema, values);
    if (!result.ok) {
      const map: Record<string, string> = {};
      for (const issue of result.issues) map[issue.field] = issue.message;
      setErrors(map);
      toast.error(`Fix ${result.issues.length} field${result.issues.length === 1 ? "" : "s"} before generating`);
      return;
    }
    if (!affordable) {
      toast.error(`Insufficient points — this render costs ${cost} points`);
      return;
    }

    setGenerating(true);
    try {
      setStage("Rendering pages…");
      const artifacts = await renderDocumentArtifacts(renderConfiguration, schema, result.values, {
        images: imageDataUrls,
        title: title || template.name,
        creationDate: Date.now(),
      });

      setStage("Uploading artifacts…");
      const [imageUploadUrl, pdfUploadUrl] = await Promise.all([
        generateUploadUrl({}),
        generateUploadUrl({}),
      ]);
      const [imageStorageId, pdfStorageId] = await Promise.all([
        uploadArtifact(imageUploadUrl, artifacts.imagePng),
        uploadArtifact(
          pdfUploadUrl,
          new Blob([artifacts.pdfBytes.slice().buffer as ArrayBuffer], { type: "application/pdf" }),
        ),
      ]);

      setStage("Finalizing…");
      const documentId = await persistDraft();
      if (!documentId) throw new Error("Could not create the document record");

      const outcome = await finalizeDocument({
        documentId,
        attemptId: newAttemptId(),
        imageStorageId: imageStorageId as Id<"_storage">,
        pdfStorageId: pdfStorageId as Id<"_storage">,
        pageCount: artifacts.pageCount,
        sizeBytes: artifacts.sizeBytes,
      });

      // What THIS generate cost: the render charge for a re-render, otherwise
      // the creation charge that paid for this document's first render.
      const spent = outcome.charged > 0 ? outcome.charged : chargedRef.current;
      toast.success(
        spent > 0 ? `Document generated — ${spent} points used` : "Document generated",
      );
      navigate(`/documents/${documentId}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Generation failed");
    } finally {
      setGenerating(false);
      setStage("");
    }
  };

  if (template === undefined) {
    return (
      <div className="space-y-6">
        <PageHeader title="Document builder" description="Loading template…" />
        <div className="grid gap-6 lg:grid-cols-[1.1fr_1fr]">
          <Skeleton className="h-[520px]" />
          <Skeleton className="h-[420px]" />
        </div>
      </div>
    );
  }

  if (template === null) {
    return (
      <div className="space-y-6">
        <PageHeader title="Template unavailable" description="This template may have been archived or removed." />
        <Button asChild variant="outline">
          <Link to="/documents/templates" className="gap-1.5">
            <ArrowLeft className="h-4 w-4" /> Back to the library
          </Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title={template.name}
        description={template.description}
        actions={
          <>
            <Button variant="outline" asChild>
              <Link to="/documents/templates" className="gap-1.5">
                <ArrowLeft className="h-4 w-4" /> Library
              </Link>
            </Button>
            <Button
              variant="outline"
              onClick={onSaveDraft}
              disabled={saving || generating || (!draftId && !affordable)}
              className="gap-1.5"
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              {draftId ? "Save draft" : `Save draft (${cost} pts)`}
            </Button>
            <Button
              onClick={onGenerate}
              disabled={generating || !affordable || !artwork.ready}
              className="gap-1.5"
            >
              {generating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
              Generate ({cost} pts)
            </Button>
          </>
        }
      />

      {artwork.failed && (
        <div className="flex items-start gap-2 rounded-xl border border-amber-500/30 bg-amber-500/[0.07] px-4 py-3">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
          <p className="text-[11px] leading-relaxed text-amber-700 dark:text-amber-400">
            The artwork file for this template could not be loaded, so the page background is missing. Your text and
            fields still render. Reload the page or re-attach the artwork in the editor.
          </p>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[1.05fr_1fr]">
        {/* Form */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.25 }}
          className="space-y-5 rounded-xl border border-border bg-card p-5 shadow-sm"
        >
          <div className="space-y-1.5">
            <Label htmlFor="doc-title" className="text-xs font-medium text-muted-foreground">
              Document title
            </Label>
            <Input
              id="doc-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={120}
              placeholder="Document title"
            />
            <p className="text-[11px] text-muted-foreground">Used for the file name and your document list.</p>
          </div>

          <div className="h-px bg-border" />

          <TemplateForm
            schema={schema}
            values={values}
            errors={errors}
            onChange={handleChange}
            className="sm:grid-cols-2"
          />

          <AnimatePresence initial={false}>
            {totals && (
              <motion.div
                key={totals.mismatches.length > 0 ? "mismatch" : "ok"}
                initial={{ opacity: 0, y: -6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                transition={{ duration: 0.2 }}
                className={cn(
                  "space-y-3 rounded-xl border px-4 py-3",
                  totals.mismatches.length > 0
                    ? "border-amber-500/40 bg-amber-500/[0.07]"
                    : "border-emerald-500/30 bg-emerald-500/[0.06]",
                )}
              >
                {totals.mismatches.length === 0 ? (
                  <p className="flex items-center gap-2 text-[11px] text-emerald-700 dark:text-emerald-400">
                    <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
                    <span>
                      {totals.rowIds.length > 0
                        ? `Totals check out — ${totals.rowLabel.toLowerCase()} add to ${formatAmount(totals.rowTotal, totals.currency)} and `
                        : "Totals check out — "}
                      every declared total agrees.
                    </span>
                  </p>
                ) : (
                  <>
                    <p className="flex items-start gap-2 text-[11px] font-medium leading-relaxed text-amber-700 dark:text-amber-400">
                      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                      <span>
                        {totals.mismatches.length === 1
                          ? "One total does not add up"
                          : `${totals.mismatches.length} totals do not add up`}{" "}
                        after your edits.
                      </span>
                    </p>
                    <ul className="space-y-2">
                      {totals.mismatches.map((check) => (
                        <li
                          key={check.fieldId}
                          className="flex flex-col gap-2 rounded-lg border border-amber-500/25 bg-background/60 px-3 py-2 sm:flex-row sm:items-center sm:justify-between"
                        >
                          <div className="min-w-0 text-[11px] leading-relaxed">
                            <p className="font-semibold text-foreground">{check.label}</p>
                            <p className="text-muted-foreground">
                              {check.basis} ={" "}
                            <span className="tabular-nums text-foreground">
                              {formatAmount(check.expected, totals.currency)}
                            </span>{" "}
                            · you entered{" "}
                            <span className="tabular-nums text-foreground">
                              {formatAmount(check.declared, totals.currency)}
                            </span>{" "}
                            <span className="text-amber-700 dark:text-amber-400">
                              ({formatDifference(check.difference, totals.currency)})
                            </span>
                            </p>
                          </div>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => applyTotal(check)}
                            className="shrink-0 gap-1.5"
                          >
                            <Wand2 className="h-3.5 w-3.5" />
                            Use {formatAmount(check.expected, totals.currency)}
                          </Button>
                        </li>
                      ))}
                    </ul>
                  </>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>

        {/* Preview + summary */}
        <div className="space-y-4 lg:sticky lg:top-6 lg:self-start">
          <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
            <div className="mb-3 flex items-center justify-between">
              <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Live preview</p>
              <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
                <Wand2 className="h-3 w-3" /> updates instantly
              </span>
            </div>
            <DocumentPreview
              configuration={renderConfiguration}
              schema={schema}
              values={values}
            />
          </div>

          <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground">Cost per document</span>
              <span className="flex items-center gap-1 font-semibold text-foreground">
                <Coins className="h-3.5 w-3.5 text-primary" /> {cost} pts
              </span>
            </div>
            <div className="mt-2 flex items-center justify-between text-xs">
              <span className="text-muted-foreground">Points balance</span>
              <span className="font-semibold tabular-nums text-foreground">{balance.toLocaleString()}</span>
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button
                onClick={onGenerate}
                disabled={generating || !affordable || !artwork.ready}
                className="flex-1 gap-1.5"
              >
                {generating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                {generating ? stage || "Generating…" : artwork.ready ? "Generate document" : "Preparing artwork…"}
              </Button>
              {!affordable && (
                <Button variant="outline" asChild>
                  <Link to="/buy-points">Top up</Link>
                </Button>
              )}
            </div>
            <p className="mt-2 text-[11px] text-muted-foreground">
              Charged once when the document is created, so saving a draft spends these points too. Generates a
              high-resolution PNG and a multi-page PDF, stored in your workspace and shareable by link.
            </p>
          </div>

          <div className="flex items-center gap-2 rounded-xl border border-border bg-muted/40 px-4 py-3 text-[11px] text-muted-foreground">
            <RefreshCw className="h-3.5 w-3.5" />
            Drafts are free — points are only charged when a document is generated.
          </div>

          <div className="flex items-center gap-2 rounded-xl border border-border bg-muted/40 px-4 py-3 text-[11px] text-muted-foreground">
            <Download className="h-3.5 w-3.5" />
            Exports live on the document page after generation.
          </div>
        </div>
      </div>
    </div>
  );
}
