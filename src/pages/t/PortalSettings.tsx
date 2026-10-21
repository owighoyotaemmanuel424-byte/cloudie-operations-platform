import { useState } from "react";
import { useMutation } from "convex/react";
import { useAuthActions } from "@convex-dev/auth/react";
import { toast } from "sonner";
import { api } from "@/convex/_generated/api";
import { TenantPortalShell, usePortal } from "@/components/tenant/TenantPortalShell";
import { AlertCircle, Check, Loader2, LogOut, Mail, ShieldCheck, User } from "lucide-react";

export default function PortalSettings() {
  return (
    <TenantPortalShell>
      <SettingsBody />
    </TenantPortalShell>
  );
}

function SettingsBody() {
  const { data, theme } = usePortal();
  const { tenant, viewer, membership } = data;
  const updateProfile = useMutation(api.tenantPortal.updateProfile);
  const { signOut } = useAuthActions();

  const [tab, setTab] = useState<"profile" | "security">("profile");
  const [name, setName] = useState(viewer?.name ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const dirty = name.trim() !== (viewer?.name ?? "");

  async function saveProfile(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (name.trim().length < 2) {
      setError("Enter your full name.");
      return;
    }
    setSaving(true);
    try {
      await updateProfile({ name: name.trim() });
      toast.success("Profile updated");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save your profile.");
    } finally {
      setSaving(false);
    }
  }

  const field = {
    background: theme.inputBg,
    borderColor: theme.border,
    color: theme.text,
    borderRadius: theme.radius,
  } as const;

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Settings</h1>
        <p className="mt-0.5 text-xs" style={{ color: theme.muted }}>
          Your details at {tenant.displayName}.
        </p>
      </div>

      <div
        role="tablist"
        aria-label="Settings sections"
        className="flex gap-1 border-b"
        style={{ borderColor: theme.border }}
      >
        {[
          { id: "profile" as const, label: "Profile", icon: User },
          { id: "security" as const, label: "Security", icon: ShieldCheck },
        ].map((item) => (
          <button
            key={item.id}
            role="tab"
            aria-selected={tab === item.id}
            onClick={() => setTab(item.id)}
            className="inline-flex items-center gap-1.5 border-b-2 px-3 py-2 text-xs font-medium transition-colors"
            style={{
              borderColor: tab === item.id ? theme.primary : "transparent",
              color: tab === item.id ? theme.text : theme.muted,
            }}
          >
            <item.icon className="h-3.5 w-3.5" /> {item.label}
          </button>
        ))}
      </div>

      {tab === "profile" ? (
        <form
          onSubmit={saveProfile}
          className="border p-5"
          style={{ background: theme.panel, borderColor: theme.border, borderRadius: theme.radius }}
        >
          <div className="space-y-4">
            <div>
              <label htmlFor="profile-name" className="mb-1 block text-[11px] font-medium" style={{ color: theme.muted }}>
                Full name
              </label>
              <input
                id="profile-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full border px-3 py-2 text-sm outline-none"
                style={field}
              />
            </div>
            <div>
              <label htmlFor="profile-email" className="mb-1 block text-[11px] font-medium" style={{ color: theme.muted }}>
                Email (sign-in identity)
              </label>
              <input
                id="profile-email"
                value={viewer?.email ?? ""}
                readOnly
                className="w-full cursor-not-allowed border px-3 py-2 text-sm opacity-70 outline-none"
                style={field}
              />
            </div>
            <dl className="grid grid-cols-2 gap-3 text-[11px]">
              <div>
                <dt style={{ color: theme.muted }}>Member since</dt>
                <dd className="mt-0.5 font-medium">
                  {viewer?.createdAt ? new Date(viewer.createdAt).toLocaleDateString() : "—"}
                </dd>
              </div>
              <div>
                <dt style={{ color: theme.muted }}>Role</dt>
                <dd className="mt-0.5 font-medium capitalize">{membership?.role ?? "customer"}</dd>
              </div>
            </dl>

            {error && (
              <p className="flex items-start gap-1.5 text-[11px]" style={{ color: "#b91c1c" }}>
                <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {error}
              </p>
            )}

            <div className="flex items-center gap-2">
              <button
                type="submit"
                disabled={saving || !dirty}
                className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white disabled:opacity-50"
                style={{ background: theme.primary, borderRadius: theme.radius }}
              >
                {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                Save changes
              </button>
              {dirty && (
                <button
                  type="button"
                  onClick={() => setName(viewer?.name ?? "")}
                  className="text-[11px]"
                  style={{ color: theme.muted }}
                >
                  Reset
                </button>
              )}
            </div>
          </div>
        </form>
      ) : (
        <div
          className="divide-y border"
          style={{ background: theme.panel, borderColor: theme.border, borderRadius: theme.radius }}
        >
          <div className="flex items-start gap-3 p-5">
            <Mail className="mt-0.5 h-4 w-4 shrink-0" style={{ color: theme.primary }} />
            <div className="min-w-0">
              <p className="text-sm font-medium">Sign-in email</p>
              <p className="mt-0.5 text-xs" style={{ color: theme.muted }}>
                {viewer?.email}
              </p>
            </div>
          </div>

          <div className="p-5">
            <p className="text-sm font-medium">Password</p>
            <p className="mt-0.5 text-xs" style={{ color: theme.muted }}>
              Password recovery for this account is handled by the site owner's support team. Contact{" "}
              {tenant.supportEmail ? (
                <a href={`mailto:${tenant.supportEmail}`} className="underline" style={{ color: theme.primary }}>
                  {tenant.supportEmail}
                </a>
              ) : (
                `${tenant.displayName} support`
              )}{" "}
              to reset access.
            </p>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 p-5">
            <div>
              <p className="text-sm font-medium">This device</p>
              <p className="mt-0.5 text-xs" style={{ color: theme.muted }}>
                Signed in as {viewer?.name || viewer?.email}. Signing out ends this session only.
              </p>
            </div>
            <button
              type="button"
              onClick={() => {
                void signOut().then(() => {
                  window.location.assign(`/t/${tenant.subdomain}/login`);
                });
              }}
              className="inline-flex items-center gap-1.5 border px-3 py-1.5 text-[11px] font-semibold"
              style={{ borderColor: theme.border, color: theme.text, borderRadius: theme.radius }}
            >
              <LogOut className="h-3.5 w-3.5" /> Sign out
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
