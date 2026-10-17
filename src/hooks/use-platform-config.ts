import { useEffect, useState } from "react";
import { neonApi } from "@/lib/neonApi";
import {
  DEFAULT_BRAND,
  DEFAULT_QUICK_ACTIONS,
  DEFAULT_SUPPORT,
  type BrandConfig,
  type QuickActionConfig,
  type SupportConfig,
} from "@/lib/platformConfig";

/**
 * Public branding loads from the Neon-backed API. Defaults are applied first,
 * so a slow or unavailable API never blocks the public application shell.
 */
export function usePlatformConfig(): {
  brand: BrandConfig;
  support: SupportConfig;
  quickActions: QuickActionConfig[];
  hasCustomBrand: boolean;
  loaded: boolean;
} {
  const [brand, setBrand] = useState<BrandConfig>(DEFAULT_BRAND);
  const [support, setSupport] = useState<SupportConfig>(DEFAULT_SUPPORT);
  const [quickActions, setQuickActions] = useState<QuickActionConfig[]>(DEFAULT_QUICK_ACTIONS);
  const [hasCustomBrand, setHasCustomBrand] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let active = true;
    neonApi.publicConfig()
      .then(({ brand: remoteBrand, support: remoteSupport, quickActions: remoteQuickActions, hasCustomBrand: custom }) => {
        if (!active) return;
        setBrand({
          ...DEFAULT_BRAND,
          name: remoteBrand.name || DEFAULT_BRAND.name,
          tagline: remoteBrand.tagline || DEFAULT_BRAND.tagline,
          logoUrl: remoteBrand.logoUrl || DEFAULT_BRAND.logoUrl,
          accentColor: remoteBrand.accentColor || DEFAULT_BRAND.accentColor,
          footerNote: remoteBrand.footerNote || DEFAULT_BRAND.footerNote,
        });
        setSupport({ ...DEFAULT_SUPPORT, ...remoteSupport });
        setQuickActions(remoteQuickActions?.length ? remoteQuickActions : DEFAULT_QUICK_ACTIONS);
        setHasCustomBrand(custom);
      })
      .catch(() => {
        // Use safe local defaults when the API is temporarily unavailable.
      })
      .finally(() => { if (active) setLoaded(true); });
    return () => { active = false; };
  }, []);

  return { brand, support, quickActions, hasCustomBrand, loaded };
}
