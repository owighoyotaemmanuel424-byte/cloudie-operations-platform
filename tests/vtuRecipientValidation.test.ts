import { describe, expect, test } from "bun:test";
import { convexTest } from "convex-test";
import schema from "../src/convex/schema";
import { api, internal } from "../src/convex/_generated/api";
import { registerAdapter } from "../src/convex/vtuRegistry";
import { encrypt } from "../src/convex/lib/encryption";
import {
  aidapayAdapter,
  mapValidationResponse,
} from "../src/convex/providers/aidapay";
import { AIDAPAY_PRESET } from "../src/lib/vtuProviderPresets";
import type {
  ProviderCallOptions,
  ProviderRecipientCheck,
  ProviderRecipientRequest,
  VtuProviderAdapter,
} from "../src/convex/vtuShared";

/**
 * The two things this suite exists to pin down.
 *
 * 1. THE PRE-PURCHASE LOOKUP. A meter or smartcard number is the one field a
 *    customer cannot verify by eye, and a wrong one delivers a top-up to a
 *    stranger with nothing to refund. AidaPay exposes
 *    `GET /validation/{provider_code}/{recipient}` for exactly that, and the
 *    three outcomes it can produce must stay distinguishable: a name, a
 *    refusal, and "we could not ask". Collapsing the last into the second
 *    would block purchases whenever the provider were slow.
 *
 * 2. THE ENVIRONMENT SEED. The operator path that puts AidaPay's credentials
 *    into the provider row from `AIDAPAY_*` variables. The load-bearing
 *    property is that it is NON-DESTRUCTIVE: re-running must never rotate a
 *    credential that is already sealed, because that would silently break a
 *    live integration on the next deploy.
 *
 * Driven against a real Convex implementation with a stub adapter registered
 * under AidaPay's name, so the assertions are about the wiring (routing,
 * credential opening, the three-state result) rather than about AidaPay's HTTP.
 * The HTTP half is exercised separately below against a fake fetch.
 */

const modules = {
  "src/convex/_generated/api.js": () => import("../src/convex/_generated/api.js"),
  "src/convex/_generated/server.js": () => import("../src/convex/_generated/server.js"),
  "src/convex/schema.ts": () => import("../src/convex/schema"),
  "src/convex/vtuHttp.ts": () => import("../src/convex/vtuHttp"),
  "src/convex/vtuCatalog.ts": () => import("../src/convex/vtuCatalog"),
  "src/convex/vtuProviderCall.ts": () => import("../src/convex/vtuProviderCall"),
  "src/convex/vtuProviderConfig.ts": () => import("../src/convex/vtuProviderConfig"),
  "src/convex/vtuProviderAdmin.ts": () => import("../src/convex/vtuProviderAdmin"),
  "src/convex/vtuRegistry.ts": () => import("../src/convex/vtuRegistry"),
  "src/convex/vtuInternal.ts": () => import("../src/convex/vtuInternal"),
  "src/convex/vtuServiceRouting.ts": () => import("../src/convex/vtuServiceRouting"),
  "src/convex/vtuShared.ts": () => import("../src/convex/vtuShared"),
  "src/convex/lib/encryption.ts": () => import("../src/convex/lib/encryption"),
  "src/convex/points.ts": () => import("../src/convex/points"),
  "src/convex/pricing.ts": () => import("../src/convex/pricing"),
  "src/convex/adminApi.ts": () => import("../src/convex/adminApi"),
  "src/convex/storage.ts": () => import("../src/convex/storage"),
};

type Harness = ReturnType<typeof convexTest>;

const MASTER = "test-master-key-0123456789abcdef";
const METER = "45012345678";
const PHONE = "08031234567";
const ELEC_PRODUCT = "electricity-ikeja-electric";
const DATA_PRODUCT = "data-mtn-1gb-30-days";

async function withMasterKey<T>(fn: () => Promise<T>): Promise<T> {
  const previous = process.env.APP_MASTER_KEY;
  process.env.APP_MASTER_KEY = MASTER;
  try {
    return await fn();
  } finally {
    if (previous === undefined) delete process.env.APP_MASTER_KEY;
    else process.env.APP_MASTER_KEY = previous;
  }
}

/** Run `fn` with a set of environment variables, restoring them afterwards. */
async function withEnv<T>(
  vars: Record<string, string | undefined>,
  fn: () => Promise<T>,
): Promise<T> {
  const previous = new Map<string, string | undefined>();
  for (const key of Object.keys(vars)) previous.set(key, process.env[key]);
  for (const [key, value] of Object.entries(vars)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    return await fn();
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

function seedUser(t: Harness) {
  return t.run(async (ctx) =>
    ctx.db.insert("users", {
      name: "Ada",
      email: "ada@example.com",
      walletBalanceNgn: 50_000,
      createdAt: Date.now(),
    }),
  );
}

/** A row, the electricity product, and the route that serves it. */
async function seedRoutedProduct(t: Harness, providerStatus = "active") {
  const now = Date.now();
  await t.run(async (ctx) => {
    await ctx.db.insert("vtuProviders", {
      name: "aidapay",
      displayName: "AidaPay",
      status: providerStatus,
      baseUrl: "https://aidapay.ng",
      authHeader: "Authorization",
      authScheme: "bearer",
      encryptedApiKey: await encrypt("ap_access_token"),
      encryptedWebhookSecret: await encrypt("ap_access_token"),
      encryptedAccountPin: await encrypt("1234"),
      priority: 50,
      createdAt: now,
      updatedAt: now,
    } as any);

    await ctx.db.insert("vtuServiceCatalog", {
      serviceType: "electricity",
      productCode: ELEC_PRODUCT,
      displayName: "Ikeja Electric (prepaid)",
      customerIdentifierLabel: "Meter number",
      requiresAmount: true,
      requiresPackageCode: false,
      minAmount: 500,
      maxAmount: 50_000,
      active: true,
      createdAt: now,
      updatedAt: now,
    } as any);

    await ctx.db.insert("vtuServiceRouting", {
      productCode: ELEC_PRODUCT,
      provider: "aidapay",
      providerProductCode: "ikeja-electric",
      priority: 1,
      active: true,
      createdAt: now,
      updatedAt: now,
    });
  });
}

/** A method-complete stub, plus everything it was handed. */
function stubAidaPay(options: {
  recipient?: (req: ProviderRecipientRequest, opts: ProviderCallOptions) => Promise<any>;
}) {
  const seen = {
    requests: [] as ProviderRecipientRequest[],
    opts: [] as ProviderCallOptions[],
  };
  const stub: any = {
    name: "aidapay",
    displayName: "AidaPay (stub)",
    async purchase() {
      return { status: "unknown" as const, message: "unused", raw: {} };
    },
    verifyAndParseCallback() {
      return null;
    },
    async verify() {
      return { status: "unknown" as const, message: "unused", raw: {} };
    },
  };
  if (options.recipient) {
    stub.verifyRecipient = async (req: ProviderRecipientRequest, opts: ProviderCallOptions) => {
      seen.requests.push(req);
      seen.opts.push(opts);
      return options.recipient!(req, opts);
    };
  }
  registerAdapter(stub as VtuProviderAdapter);
  return seen;
}

const validate = (t: Harness, userId: any, serviceCode: string, customerIdentifier: string) =>
  t.withIdentity({ subject: userId }).action(api.vtuProviderCall.validateVtuRecipient, {
    serviceCode,
    customerIdentifier,
  });

// ─── 1. The response mapper ──────────────────────────────────────────

describe("AidaPay validation responses are read defensively", () => {
  test("a name under data.customer_name is a valid account", () => {
    const check = mapValidationResponse({
      success: true,
      data: { customer_name: "ADEBAYO O OLUWASEUN" },
    });
    expect(check).toEqual({ valid: true, customerName: "ADEBAYO O OLUWASEUN" });
  });

  test("a FLAT body is read too, because the envelope is not documented", () => {
    // The lookup's field-level schema is not published. A response shape we
    // have not seen must still produce a name rather than an empty verdict.
    const check = mapValidationResponse({ name: "JOHN DOE" });
    expect(check?.valid).toBe(true);
    expect(check?.customerName).toBe("JOHN DOE");
  });

  test("an explicit negative is a refusal, with the provider's own words", () => {
    const check = mapValidationResponse({
      success: false,
      data: { success: false, message: "Meter number not found" },
    });
    expect(check).toEqual({ valid: false, message: "Meter number not found" });
  });

  test("a terminal status word is a refusal even without a flag", () => {
    const check = mapValidationResponse({ data: { status: "Cancelled" } });
    expect(check?.valid).toBe(false);
  });

  test("an unrecognised body yields NO verdict rather than a guess", () => {
    // This is the assertion that keeps the feature from blocking purchases:
    // `null` means "we could not ask", which is not "the meter is wrong".
    expect(mapValidationResponse({ data: { status: "Pending" } })).toBeNull();
    expect(mapValidationResponse({})).toBeNull();
    expect(mapValidationResponse(null)).toBeNull();
    expect(mapValidationResponse({ data: { balance: 100 } })).toBeNull();
  });
});

// ─── 2. The adapter's HTTP call ──────────────────────────────────────

function callOpts(
  fetchImpl: any,
  overrides: Partial<ProviderCallOptions> = {},
): ProviderCallOptions {
  return {
    baseUrl: "https://aidapay.ng",
    apiKey: "ap_access_token",
    authHeader: "Authorization",
    authScheme: "bearer",
    timeoutMs: 5_000,
    fetchImpl,
    ...overrides,
  };
}

function responseOf(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async text() {
      return typeof body === "string" ? body : JSON.stringify(body);
    },
  };
}

describe("the adapter calls AidaPay's documented validation endpoint", () => {
  test("it GETs /api/v1/validation/{provider_code}/{recipient} with the row's auth header", async () => {
    const calls: Array<{ url: string; init: any }> = [];
    const fetchImpl = (async (url: string, init: any) => {
      calls.push({ url, init });
      return responseOf(200, { data: { customer_name: "ADA LOVELACE" } });
    }) as any;

    const check = await aidapayAdapter.verifyRecipient!(
      {
        serviceType: "electricity",
        productCode: ELEC_PRODUCT,
        providerProductCode: "ikeja-electric",
        customerIdentifier: METER,
      },
      callOpts(fetchImpl),
    );

    expect(calls[0]!.url).toBe(
      `https://aidapay.ng/api/v1/validation/ikeja-electric/${METER}`,
    );
    expect(calls[0]!.init.method).toBe("GET");
    // Composed from the ROW, so a bearer-configured provider is called the way
    // it will be called for a real purchase.
    expect(calls[0]!.init.headers.Authorization).toBe("Bearer ap_access_token");
    // A refused credential arrives as a 302, so a followed redirect would land
    // on HTML and read as a network failure.
    expect(calls[0]!.init.redirect).toBe("manual");
    expect(check).toEqual({ valid: true, customerName: "ADA LOVELACE" });
  });

  test("a base URL with a trailing slash does not double up", async () => {
    let url = "";
    const fetchImpl = (async (u: string) => {
      url = u;
      return responseOf(200, { name: "X" });
    }) as any;
    await aidapayAdapter.verifyRecipient!(
      {
        serviceType: "cable",
        productCode: "cable-dstv-compact",
        providerProductCode: "dstv",
        customerIdentifier: "1234567890",
      },
      callOpts(fetchImpl, { baseUrl: "https://aidapay.ng/" }),
    );
    expect(url).toBe("https://aidapay.ng/api/v1/validation/dstv/1234567890");
  });

  test("a refused or unsupported lookup is null, never a refusal of the destination", async () => {
    // Each of these is a real AidaPay response: a 302 to the account page for
    // a bad token, a 404 for a biller with no lookup, and a transport failure.
    for (const fetchImpl of [
      (async () => responseOf(302, "")) as any,
      (async () => responseOf(404, "not found")) as any,
      (async () => responseOf(500, { message: "boom" })) as any,
      (async () => {
        throw new Error("ECONNRESET");
      }) as any,
    ]) {
      const check = await aidapayAdapter.verifyRecipient!(
        {
          serviceType: "electricity",
          productCode: ELEC_PRODUCT,
          providerProductCode: "ikeja-electric",
          customerIdentifier: METER,
        },
        callOpts(fetchImpl),
      );
      expect(check).toBeNull();
    }
  });

  test("a missing provider code or recipient is not sent at all", async () => {
    let called = false;
    const fetchImpl = (async () => {
      called = true;
      return responseOf(200, { name: "X" });
    }) as any;
    const req = {
      serviceType: "electricity" as const,
      productCode: ELEC_PRODUCT,
      providerProductCode: "  ",
      customerIdentifier: METER,
    };
    expect(await aidapayAdapter.verifyRecipient!(req, callOpts(fetchImpl))).toBeNull();
    expect(
      await aidapayAdapter.verifyRecipient!(
        { ...req, providerProductCode: "ikeja-electric", customerIdentifier: "" },
        callOpts(fetchImpl),
      ),
    ).toBeNull();
    expect(called).toBe(false);
  });
});

// ─── 3. The action ───────────────────────────────────────────────────

describe("validateVtuRecipient", () => {
  test("an unauthenticated caller is told to sign in and no provider is called", async () => {
    const t = convexTest(schema, modules);
    const seen = stubAidaPay({ recipient: async () => ({ valid: true }) });
    const result = await t.action(api.vtuProviderCall.validateVtuRecipient, {
      serviceCode: `electricity.ikeja-electric.5000`,
      customerIdentifier: METER,
    });
    expect(result).toEqual({ checked: false, valid: false, reason: "AUTH_REQUIRED" });
    expect(seen.requests).toHaveLength(0);
  });

  test("the account holder is named, and both the provider code and the PIN stay server-side", async () => {
    await withMasterKey(async () => {
      const t = convexTest(schema, modules);
      await seedRoutedProduct(t);
      const userId = await seedUser(t);
      const seen = stubAidaPay({ recipient: async () => ({ valid: true, customerName: "ADEBAYO O OLUWASEUN" }) });

      const result = await validate(t, userId, "electricity.ikeja-electric.5000", METER);

      expect(result).toEqual({
        checked: true,
        valid: true,
        customerName: "ADEBAYO O OLUWASEUN",
      });
      // The provider's own code, resolved from the ROUTE — validating against a
      // different biller than the purchase would use is the whole failure this
      // prevents.
      expect(seen.requests[0]!.providerProductCode).toBe("ikeja-electric");
      expect(seen.requests[0]!.serviceType).toBe("electricity");
      // The lookup is read-only, so it must not open the spend credential.
      expect(seen.opts[0]!.accountPin).toBeUndefined();
      expect(seen.opts[0]!.apiKey).toBe("ap_access_token");
      // Nothing about the provider crosses the wire.
      expect(Object.keys(result)).not.toContain("provider");
    });
  });

  test("a destination the provider refuses is a checked refusal, not silence", async () => {
    await withMasterKey(async () => {
      const t = convexTest(schema, modules);
      await seedRoutedProduct(t);
      const userId = await seedUser(t);
      stubAidaPay({ recipient: async () => ({ valid: false, message: "Meter number not found" }) });

      const result = await validate(t, userId, "electricity.ikeja-electric.5000", METER);
      expect(result.checked).toBe(true);
      expect(result.valid).toBe(false);
      expect(result.message).toBe("Meter number not found");
    });
  });

  test("a malformed destination is refused locally, without spending a lookup", async () => {
    await withMasterKey(async () => {
      const t = convexTest(schema, modules);
      await seedRoutedProduct(t);
      const userId = await seedUser(t);
      const seen = stubAidaPay({ recipient: async () => ({ valid: true }) });

      const result = await validate(t, userId, "electricity.ikeja-electric.5000", "12");
      expect(result.checked).toBe(false);
      expect(result.reason).toBe("BAD_IDENTIFIER");
      expect(result.message).toContain("meter number");
      expect(seen.requests).toHaveLength(0);
    });
  });

  test("a product with no route is reported as unchecked, never as invalid", async () => {
    await withMasterKey(async () => {
      const t = convexTest(schema, modules);
      await seedRoutedProduct(t);
      const userId = await seedUser(t);
      stubAidaPay({ recipient: async () => ({ valid: true }) });

      const result = await validate(t, userId, "electricity.unknown-disco.5000", METER);
      expect(result.checked).toBe(false);
      expect(result.reason).toBe("NO_ROUTE");
    });
  });

  test("a provider with no lookup endpoint is 'cannot check', not a rejection", async () => {
    await withMasterKey(async () => {
      const t = convexTest(schema, modules);
      await seedRoutedProduct(t);
      const userId = await seedUser(t);
      // Registered WITHOUT verifyRecipient — an aggregator that simply has no
      // validation endpoint is a legitimate provider, not a broken adapter.
      stubAidaPay({});

      const result = await validate(t, userId, "electricity.ikeja-electric.5000", METER);
      expect(result.checked).toBe(false);
      expect(result.valid).toBe(false);
      expect(result.reason).toBe("ADAPTER_INCOMPLETE");
    });
  });

  test("a thrown lookup is a transport fault, reported as unchecked", async () => {
    await withMasterKey(async () => {
      const t = convexTest(schema, modules);
      await seedRoutedProduct(t);
      const userId = await seedUser(t);
      stubAidaPay({
        recipient: async () => {
          throw new Error("socket hang up");
        },
      });

      const result = await validate(t, userId, "electricity.ikeja-electric.5000", METER);
      expect(result.checked).toBe(false);
      expect(result.reason).toBe("LOOKUP_FAILED");
    });
  });

  test("a disabled provider cannot be looked up, because it cannot be bought from", async () => {
    await withMasterKey(async () => {
      const t = convexTest(schema, modules);
      // Routing skips a non-active provider, so the product stops resolving.
      await seedRoutedProduct(t, "disabled");
      const userId = await seedUser(t);
      stubAidaPay({ recipient: async () => ({ valid: true }) });

      const result = await validate(t, userId, "electricity.ikeja-electric.5000", METER);
      expect(result.checked).toBe(false);
      expect(result.reason).toBe("NO_ROUTE");
    });
  });

  test("lookups are rate limited per user", async () => {
    await withMasterKey(async () => {
      const t = convexTest(schema, modules);
      await seedRoutedProduct(t);
      const userId = await seedUser(t);
      stubAidaPay({ recipient: async () => ({ valid: true, customerName: "ADA" }) });

      // The budget is 30/minute. The 31st in the same window is refused, which
      // is what stops a metered provider call becoming a free oracle.
      let rateLimited: any = null;
      for (let i = 0; i < 31; i += 1) {
        const result = await validate(t, userId, "electricity.ikeja-electric.5000", METER);
        if (result.reason === "RATE_LIMITED") {
          rateLimited = result;
          break;
        }
      }
      expect(rateLimited).not.toBeNull();
      expect(rateLimited.checked).toBe(false);
      expect(rateLimited.message).toContain("Too many checks");
    });
  });

  test("a second call still resolves the target through the real routing table", async () => {
    await withMasterKey(async () => {
      const t = convexTest(schema, modules);
      await seedRoutedProduct(t);
      const userId = await seedUser(t);

      // The pure routing lookup the action depends on, asserted directly so a
      // future routing change cannot silently stop the lookup resolving.
      const target: any = await t.query(internal.vtuInternal.resolveValidationTarget, {
        serviceCode: "electricity.ikeja-electric.5000",
      });
      expect(target.provider).toBe("aidapay");
      expect(target.providerProductCode).toBe("ikeja-electric");
      expect(target.productCode).toBe(ELEC_PRODUCT);
      expect(target.serviceType).toBe("electricity");

      // An amount-token route carries the amount into the provider's code, and
      // a package product's code has no token to fill.
      expect(
        await t.query(internal.vtuInternal.resolveValidationTarget, {
          serviceCode: "data.mtn.1gb-30-days",
        }),
      ).toBeNull();
    });
  });
});

// ─── 4. The environment seed ─────────────────────────────────────────

const seedAdmin = (t: Harness) =>
  t.run(async (ctx) =>
    ctx.db.insert("users", {
      name: "Root",
      email: "root@example.com",
      role: "admin",
      pointsBalance: 0,
      createdAt: Date.now(),
    }),
  );

const providerRow = (t: Harness) =>
  t.run(async (ctx) =>
    ctx.db
      .query("vtuProviders")
      .withIndex("by_name", (q: any) => q.eq("name", "aidapay"))
      .unique(),
  );

const seedFromEnv = (t: Harness, adminId: any) =>
  t
    .withIdentity({ subject: adminId })
    .mutation(api.vtuProviderAdmin.migrateAidaPayFromEnv, {});

describe("AidaPay credentials can be seeded from the environment", () => {
  test("a missing API key is reported and writes nothing", async () => {
    await withMasterKey(async () => {
      const t = convexTest(schema, modules);
      const adminId = await seedAdmin(t);

      const result = await withEnv({ AIDAPAY_API_KEY: undefined }, () =>
        seedFromEnv(t, adminId),
      );
      expect(result.action).toBe("no_env");
      expect(await providerRow(t)).toBeNull();
    });
  });

  test("seeding writes the preset constants, seals the key, and defaults the webhook secret to the token", async () => {
    await withMasterKey(async () => {
      const t = convexTest(schema, modules);
      const adminId = await seedAdmin(t);

      const result = await withEnv(
        {
          AIDAPAY_API_KEY: "ap_live_token",
          AIDAPAY_ACCOUNT_PIN: "1234",
          AIDAPAY_WEBHOOK_SECRET: undefined,
          AIDAPAY_STATUS: undefined,
        },
        () => seedFromEnv(t, adminId),
      );

      expect(result.action).toBe("inserted");
      expect(result.hasAccountPin).toBe(true);

      const row: any = await providerRow(t);
      // Every constant comes from the preset, NOT from the deployment. A
      // hand-set base URL is how `/api/v1/api/v1/buy` happened.
      expect(row.baseUrl).toBe(AIDAPAY_PRESET.baseUrl);
      expect(row.baseUrl).not.toContain("/api");
      expect(row.healthPath).toBe(AIDAPAY_PRESET.healthPath);
      expect(row.authHeader).toBe("Authorization");
      expect(row.authScheme).toBe("bearer");
      expect(row.callbackSignatureHeader).toBe("Signature");
      // AidaPay has no sandbox environment, so a fresh row is never live.
      expect(row.status).toBe("sandbox");
      // Sealed, not plaintext.
      expect(row.encryptedApiKey).not.toBe("ap_live_token");
      expect(row.encryptedWebhookSecret).not.toBe("ap_live_token");
    });
  });

  test("the webhook secret defaults to the API key, which is what AidaPay signs with", async () => {
    await withMasterKey(async () => {
      const t = convexTest(schema, modules);
      const adminId = await seedAdmin(t);

      await withEnv(
        {
          AIDAPAY_API_KEY: "ap_live_token",
          AIDAPAY_ACCOUNT_PIN: "1234",
          AIDAPAY_WEBHOOK_SECRET: undefined,
        },
        () => seedFromEnv(t, adminId),
      );

      // A real callback signed with the access token must verify against the
      // sealed secret. Read through the same query the webhook handler uses.
      const opened = await t.run(async (ctx) => {
        const { decrypt } = await import("../src/convex/lib/encryption");
        const row: any = await ctx.db
          .query("vtuProviders")
          .withIndex("by_name", (q: any) => q.eq("name", "aidapay"))
          .unique();
        return decrypt(row.encryptedWebhookSecret);
      });
      expect(opened).toBe("ap_live_token");
    });
  });

  test("re-running fills what is missing and NEVER overwrites a sealed credential", async () => {
    await withMasterKey(async () => {
      const t = convexTest(schema, modules);
      const adminId = await seedAdmin(t);

      await withEnv(
        {
          AIDAPAY_API_KEY: "ap_first_token",
          AIDAPAY_ACCOUNT_PIN: undefined,
          AIDAPAY_WEBHOOK_SECRET: undefined,
        },
        () => seedFromEnv(t, adminId),
      );
      const before: any = await providerRow(t);
      expect(before.encryptedAccountPin).toBeUndefined();

      // The environment moves on, and a PIN appears. The key must NOT be
      // rewritten: a deploy that re-runs this would otherwise rotate a live
      // credential and take every purchase down.
      const second = await withEnv(
        {
          AIDAPAY_API_KEY: "ap_rotated_token",
          AIDAPAY_ACCOUNT_PIN: "4321",
          AIDAPAY_WEBHOOK_SECRET: undefined,
        },
        () => seedFromEnv(t, adminId),
      );

      expect(second.action).toBe("updated");
      expect(second.filled.apiKey).toBe(false);
      expect(second.filled.accountPin).toBe(true);
      expect(second.hasAccountPin).toBe(true);

      const after: any = await providerRow(t);
      expect(after.encryptedApiKey).toBe(before.encryptedApiKey);
      expect(after.encryptedAccountPin).toBeDefined();
      // Exactly one row, ever.
      const count = await t.run(async (ctx) =>
        ctx.db.query("vtuProviders").collect(),
      );
      expect(count).toHaveLength(1);
    });
  });

  test("AIDAPAY_STATUS can promote the row to live, and anything else is ignored", async () => {
    await withMasterKey(async () => {
      const t = convexTest(schema, modules);
      const adminId = await seedAdmin(t);

      await withEnv(
        {
          AIDAPAY_API_KEY: "ap_live_token",
          AIDAPAY_ACCOUNT_PIN: "1234",
          AIDAPAY_STATUS: "active",
        },
        () => seedFromEnv(t, adminId),
      );
      expect((await providerRow(t))!.status).toBe("active");

      // A typo does not invent a status; the row keeps what it had.
      await withEnv({ AIDAPAY_STATUS: "live-please" }, () => seedFromEnv(t, adminId));
      expect((await providerRow(t))!.status).toBe("active");
    });
  });

  test("a non-admin cannot seed credentials", async () => {
    await withMasterKey(async () => {
      const t = convexTest(schema, modules);
      const userId = await seedUser(t);
      await withEnv({ AIDAPAY_API_KEY: "ap_live_token" }, async () => {
        await expect(seedFromEnv(t, userId)).rejects.toThrow();
      });
      expect(await providerRow(t)).toBeNull();
    });
  });
});
