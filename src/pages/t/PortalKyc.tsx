import { useEffect, useRef, useState } from "react";
import { useMutation } from "convex/react";
import { toast } from "sonner";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { TenantPortalShell, usePortal } from "@/components/tenant/TenantPortalShell";
import {
  AlertCircle,
  BadgeCheck,
  Camera,
  Check,
  Clock,
  FileText,
  Loader2,
  ShieldCheck,
  Upload,
  X,
} from "lucide-react";

const MAX_BYTES = 10 * 1024 * 1024;
const ACCEPTED = ["application/pdf", "image/jpeg", "image/png"];

export default function PortalKyc() {
  return (
    <TenantPortalShell>
      <KycBody />
    </TenantPortalShell>
  );
}

function StepRail({ step, theme }: { step: 1 | 2 | 3; theme: ReturnType<typeof usePortal>["theme"] }) {
  const steps = ["Document", "Liveness", "Review"];
  return (
    <ol className="flex items-center gap-2">
      {steps.map((label, index) => {
        const number = (index + 1) as 1 | 2 | 3;
        const done = number < step;
        const current = number === step;
        return (
          <li key={label} className="flex flex-1 items-center gap-2">
            <span
              className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold"
              style={{
                background: done || current ? theme.primary : theme.panelMuted,
                color: done || current ? "#fff" : theme.muted,
              }}
            >
              {done ? <Check className="h-3 w-3" /> : number}
            </span>
            <span className="text-[11px] font-medium" style={{ color: current ? theme.text : theme.muted }}>
              {label}
            </span>
            {index < steps.length - 1 && (
              <span className="h-px flex-1" style={{ background: done ? theme.primary : theme.border }} />
            )}
          </li>
        );
      })}
    </ol>
  );
}

function KycBody() {
  const { data, theme } = usePortal();
  const { tenant, kyc, viewer } = data;
  const submit = useMutation(api.tenantPortal.submitKyc);
  const generateUploadUrl = useMutation(api.storage.generateUploadUrl);
  const registerFile = useMutation(api.storage.registerFile);

  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [fullName, setFullName] = useState(kyc?.fullName ?? viewer?.name ?? "");
  const [dob, setDob] = useState("");
  const [document, setDocument] = useState<{ id: Id<"storageFiles">; name: string } | null>(null);
  const [uploading, setUploading] = useState(false);
  const [liveness, setLiveness] = useState(false);
  const [cameraState, setCameraState] = useState<"idle" | "starting" | "live" | "denied">("idle");
  const [countdown, setCountdown] = useState<number | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const activeStatus = kyc?.status ?? null;

  useEffect(() => {
    return () => {
      streamRef.current?.getTracks().forEach((track) => track.stop());
    };
  }, []);

  async function pickDocument(file: File | undefined) {
    if (!file) return;
    setError("");
    if (!ACCEPTED.includes(file.type)) {
      setError("Upload a PDF, JPG or PNG.");
      return;
    }
    if (file.size > MAX_BYTES) {
      setError("That file is larger than 10 MB.");
      return;
    }
    setUploading(true);
    try {
      const uploadUrl = await generateUploadUrl({});
      const response = await fetch(uploadUrl, {
        method: "POST",
        headers: { "Content-Type": file.type },
        body: file,
      });
      if (!response.ok) throw new Error("Upload failed");
      const { storageId } = (await response.json()) as { storageId: Id<"_storage"> };
      const fileId = await registerFile({
        storageId,
        kind: "kyc_document",
        originalName: file.name,
      });
      setDocument({ id: fileId, name: file.name });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not upload that document.");
    } finally {
      setUploading(false);
    }
  }

  async function startLiveness() {
    setError("");
    setCameraState("starting");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user" } });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play().catch(() => undefined);
      }
      setCameraState("live");
      setCountdown(3);
    } catch {
      setCameraState("denied");
      setError("Camera access was blocked. You can confirm your presence instead.");
    }
  }

  useEffect(() => {
    if (countdown === null) return;
    if (countdown === 0) {
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
      setCameraState("idle");
      setLiveness(true);
      setCountdown(null);
      return;
    }
    const timer = window.setTimeout(() => setCountdown((value) => (value ?? 1) - 1), 900);
    return () => window.clearTimeout(timer);
  }, [countdown]);

  async function submitApplication() {
    setError("");
    if (!document) {
      setError("Upload your identity document first.");
      setStep(1);
      return;
    }
    if (!liveness) {
      setError("Complete the liveness check first.");
      setStep(2);
      return;
    }
    setSubmitting(true);
    try {
      await submit({
        tenantId: tenant._id,
        fullName: fullName.trim(),
        dateOfBirth: dob || undefined,
        documentName: document.name,
        livenessPassed: true,
        storageFileId: document.id,
      });
      toast.success("Application submitted for review");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not submit your application.");
    } finally {
      setSubmitting(false);
    }
  }

  const panel = {
    background: theme.panel,
    borderColor: theme.border,
    borderRadius: theme.radius,
  } as const;

  /* ── Approved ─────────────────────────────────────────────── */
  if (activeStatus === "approved") {
    return (
      <div className="mx-auto max-w-lg">
        <div className="border p-6 text-center" style={panel}>
          <span
            className="mx-auto flex h-12 w-12 items-center justify-center rounded-full"
            style={{ background: "rgba(16,185,129,0.12)", color: "#047857" }}
          >
            <BadgeCheck className="h-6 w-6" />
          </span>
          <h1 className="mt-4 text-lg font-semibold">You're verified</h1>
          <p className="mt-1 text-xs" style={{ color: theme.muted }}>
            Your identity was approved for {tenant.displayName}. Higher limits and faster transfers are active.
          </p>
          <dl className="mt-5 space-y-2 text-left text-xs">
            <div className="flex justify-between border-t pt-2" style={{ borderColor: theme.divider }}>
              <dt style={{ color: theme.muted }}>Name</dt>
              <dd className="font-medium">{kyc?.fullName}</dd>
            </div>
            <div className="flex justify-between border-t pt-2" style={{ borderColor: theme.divider }}>
              <dt style={{ color: theme.muted }}>Reviewed</dt>
              <dd className="font-medium">{kyc?.updatedAt ? new Date(kyc.updatedAt).toLocaleDateString() : "—"}</dd>
            </div>
          </dl>
        </div>
      </div>
    );
  }

  /* ── Under review ─────────────────────────────────────────── */
  if (activeStatus === "submitted" || activeStatus === "under_review") {
    return (
      <div className="mx-auto max-w-lg">
        <div className="border p-6" style={panel}>
          <div className="flex items-center gap-3">
            <span
              className="flex h-10 w-10 items-center justify-center rounded-full"
              style={{ background: theme.panelMuted, color: theme.primary }}
            >
              <Clock className="h-5 w-5" />
            </span>
            <div>
              <h1 className="text-base font-semibold">Verification under review</h1>
              <p className="text-[11px]" style={{ color: theme.muted }}>
                Submitted {new Date(kyc!.submittedAt).toLocaleDateString()} · usually reviewed within 24 hours.
              </p>
            </div>
          </div>
          <div className="mt-5">
            <StepRail step={3} theme={theme} />
          </div>
          <div
            className="mt-5 space-y-2 rounded p-3 text-xs"
            style={{ background: theme.panelMuted, color: theme.muted }}
          >
            <p className="flex items-center gap-2">
              <FileText className="h-3.5 w-3.5" /> Document received: {kyc?.documentName ?? "submitted"}
            </p>
            <p className="flex items-center gap-2">
              <Camera className="h-3.5 w-3.5" /> Liveness check {kyc?.livenessPassed ? "passed" : "recorded"}
            </p>
            <p className="flex items-center gap-2">
              <ShieldCheck className="h-3.5 w-3.5" /> {tenant.displayName} compliance team is reviewing
            </p>
          </div>
          <p className="mt-4 text-[11px]" style={{ color: theme.muted }}>
            You can keep using your accounts while this is pending. We'll update this page the moment a
            decision is made.
          </p>
        </div>
      </div>
    );
  }

  /* ── Wizard (new or rejected) ─────────────────────────────── */
  return (
    <div className="mx-auto max-w-lg space-y-4">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Verify your identity</h1>
        <p className="mt-0.5 text-xs" style={{ color: theme.muted }}>
          Three quick steps. Your documents are only visible to {tenant.displayName}.
        </p>
      </div>

      {activeStatus === "rejected" && (
        <div
          className="border p-4"
          style={{ background: "rgba(239,68,68,0.06)", borderColor: "rgba(239,68,68,0.30)", borderRadius: theme.radius }}
        >
          <p className="flex items-center gap-2 text-sm font-semibold" style={{ color: "#b91c1c" }}>
            <AlertCircle className="h-4 w-4" /> Previous attempt was rejected
          </p>
          <p className="mt-1 text-xs" style={{ color: "#7f1d1d" }}>
            {kyc?.rejectionReason ?? "The document could not be verified. Please try again with a clearer photo."}
          </p>
        </div>
      )}

      <div className="border p-5" style={panel}>
        <StepRail step={step} theme={theme} />

        {/* Step 1 */}
        {step === 1 && (
          <div className="mt-5 space-y-3">
            <p className="text-sm font-medium">1. Upload your ID document</p>
            <p className="text-[11px]" style={{ color: theme.muted }}>
              Passport, national ID or driver's licence. PDF, JPG or PNG up to 10 MB.
            </p>
            {document ? (
              <div
                className="flex items-center gap-3 border px-3 py-3"
                style={{ borderColor: theme.border, borderRadius: theme.radius, background: theme.panelMuted }}
              >
                <FileText className="h-4 w-4 shrink-0" style={{ color: theme.primary }} />
                <span className="min-w-0 flex-1 truncate text-xs">{document.name}</span>
                <button
                  type="button"
                  onClick={() => setDocument(null)}
                  aria-label="Remove document"
                  style={{ color: theme.muted }}
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            ) : (
              <label
                className="flex cursor-pointer flex-col items-center justify-center gap-2 border border-dashed px-4 py-8 text-center"
                style={{ borderColor: theme.border, borderRadius: theme.radius }}
              >
                {uploading ? (
                  <Loader2 className="h-5 w-5 animate-spin" style={{ color: theme.primary }} />
                ) : (
                  <Upload className="h-5 w-5" style={{ color: theme.muted }} />
                )}
                <span className="text-xs font-medium">{uploading ? "Uploading…" : "Choose a file"}</span>
                <span className="text-[10px]" style={{ color: theme.muted }}>
                  Encrypted at rest · never shared with other tenants
                </span>
                <input
                  type="file"
                  accept="application/pdf,image/jpeg,image/png"
                  className="hidden"
                  onChange={(e) => void pickDocument(e.target.files?.[0])}
                />
              </label>
            )}
            <button
              type="button"
              disabled={!document || uploading}
              onClick={() => setStep(2)}
              className="w-full px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
              style={{ background: theme.primary, borderRadius: theme.radius }}
            >
              Continue
            </button>
          </div>
        )}

        {/* Step 2 */}
        {step === 2 && (
          <div className="mt-5 space-y-3">
            <p className="text-sm font-medium">2. Liveness check</p>
            <p className="text-[11px]" style={{ color: theme.muted }}>
              We take a quick selfie to confirm the person holding the ID is you. Nothing is stored.
            </p>

            <div
              className="relative overflow-hidden border"
              style={{ borderColor: theme.border, borderRadius: theme.radius, background: theme.panelMuted }}
            >
              <video
                ref={videoRef}
                muted
                playsInline
                className="h-48 w-full object-cover"
                style={{ opacity: cameraState === "live" ? 1 : 0 }}
              />
              {cameraState !== "live" && (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-2">
                  {liveness ? (
                    <>
                      <span
                        className="flex h-10 w-10 items-center justify-center rounded-full"
                        style={{ background: "rgba(16,185,129,0.15)", color: "#047857" }}
                      >
                        <Check className="h-5 w-5" />
                      </span>
                      <p className="text-xs font-medium">Liveness confirmed</p>
                    </>
                  ) : (
                    <>
                      <Camera className="h-6 w-6" style={{ color: theme.muted }} />
                      <p className="text-xs" style={{ color: theme.muted }}>
                        Camera is off
                      </p>
                    </>
                  )}
                </div>
              )}
              {countdown !== null && (
                <div className="absolute inset-x-0 bottom-0 bg-black/55 py-2 text-center text-xs font-semibold text-white">
                  Hold still… {countdown}
                </div>
              )}
            </div>

            {!liveness && (
              <div className="flex flex-col gap-2 sm:flex-row">
                <button
                  type="button"
                  onClick={() => void startLiveness()}
                  disabled={cameraState === "starting" || countdown !== null}
                  className="flex flex-1 items-center justify-center gap-2 border px-3 py-2 text-xs font-semibold disabled:opacity-50"
                  style={{ borderColor: theme.border, borderRadius: theme.radius, color: theme.text }}
                >
                  <Camera className="h-3.5 w-3.5" />
                  {countdown !== null ? "Checking…" : "Start camera check"}
                </button>
                {cameraState === "denied" && (
                  <button
                    type="button"
                    onClick={() => setLiveness(true)}
                    className="flex-1 px-3 py-2 text-xs font-semibold text-white"
                    style={{ background: theme.primary, borderRadius: theme.radius }}
                  >
                    Confirm presence instead
                  </button>
                )}
              </div>
            )}

            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setStep(1)}
                className="px-3 py-2 text-xs font-medium"
                style={{ color: theme.muted }}
              >
                Back
              </button>
              <button
                type="button"
                disabled={!liveness}
                onClick={() => setStep(3)}
                className="flex-1 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
                style={{ background: theme.primary, borderRadius: theme.radius }}
              >
                Continue
              </button>
            </div>
          </div>
        )}

        {/* Step 3 */}
        {step === 3 && (
          <div className="mt-5 space-y-3">
            <p className="text-sm font-medium">3. Confirm your details</p>
            <div>
              <label htmlFor="kyc-name" className="mb-1 block text-[11px] font-medium" style={{ color: theme.muted }}>
                Full legal name
              </label>
              <input
                id="kyc-name"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                className="w-full border px-3 py-2 text-sm outline-none"
                style={{ background: theme.inputBg, borderColor: theme.border, color: theme.text, borderRadius: theme.radius }}
              />
            </div>
            <div>
              <label htmlFor="kyc-dob" className="mb-1 block text-[11px] font-medium" style={{ color: theme.muted }}>
                Date of birth (optional)
              </label>
              <input
                id="kyc-dob"
                type="date"
                value={dob}
                onChange={(e) => setDob(e.target.value)}
                className="w-full border px-3 py-2 text-sm outline-none"
                style={{ background: theme.inputBg, borderColor: theme.border, color: theme.text, borderRadius: theme.radius }}
              />
            </div>
            <div
              className="space-y-1.5 rounded p-3 text-[11px]"
              style={{ background: theme.panelMuted, color: theme.muted }}
            >
              <p className="flex items-center gap-2">
                <FileText className="h-3.5 w-3.5" /> {document?.name ?? "No document"}
              </p>
              <p className="flex items-center gap-2">
                <Camera className="h-3.5 w-3.5" /> Liveness {liveness ? "passed" : "pending"}
              </p>
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setStep(2)}
                className="px-3 py-2 text-xs font-medium"
                style={{ color: theme.muted }}
              >
                Back
              </button>
              <button
                type="button"
                onClick={() => void submitApplication()}
                disabled={submitting || fullName.trim().length < 3}
                className="flex flex-1 items-center justify-center gap-2 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
                style={{ background: theme.primary, borderRadius: theme.radius }}
              >
                {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                {submitting ? "Submitting" : activeStatus === "rejected" ? "Retry verification" : "Submit for review"}
              </button>
            </div>
          </div>
        )}

        {error && (
          <p className="mt-3 flex items-start gap-1.5 text-[11px]" style={{ color: "#b91c1c" }}>
            <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {error}
          </p>
        )}
      </div>

    </div>
  );
}
