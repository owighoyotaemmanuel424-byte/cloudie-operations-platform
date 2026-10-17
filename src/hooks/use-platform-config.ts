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
  const [support] = useState<SupportConfig>(DEFAULT_SUPPORT);
  const [quickActions] = useState<QuickActionConfig[]>(DEFAULT_QUICK_ACTIONS);
  const [hasCustomBrand, setHasCustomBrand] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let active = true;
    neonApi.publicConfig()
      .then(({ config, source }) => {
        if (!active) return;
        setBrand({
          ...DEFAULT_BRAND,
          name: config.platformName || DEFAULT_BRAND.name,
          tagline: config.tagline || DEFAULT_BRAND.tagline,
          logoUrl: config.logoUrl || DEFAULT_BRAND.logoUrl,
        });
        setHasCustomBrand(source === "database");
      })
      .catch(() => {
        // Use safe local defaults when the API is temporarily unavailable.
      })
      .finally(() => { if (active) setLoaded(true); });
    return () => { active = false; };
  }, []);

  return { brand, support, quickActions, hasCustomBrand, loaded };
}
