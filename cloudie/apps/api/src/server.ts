import "dotenv/config";
import Fastify, { type FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import Redis from "ioredis";
import { Server as SocketServer } from "socket.io";
import { createAdapter } from "@socket.io/redis-adapter";
import { prisma, TxType } from "@cloudie/db";
import { applyLedgerEntry, InsufficientPointsError, LedgerIdempotencyConflictError, setLedgerEventPublisher } from "@cloudie/db/ledger";
import { ACTION_WORKSPACE, POINTS_COST } from "@cloudie/config/points";
import { ledgerChargeSchema } from "@cloudie/types/schemas";
import { requireIdentity, requireRole, verifyAccessToken } from "./auth.js";
import { z } from "zod";

const envSchema = z.object({ NODE_ENV: z.enum(["development", "test", "production"]).default("development"), API_PORT: z.coerce.number().int().positive().default(4000), DATABASE_URL: z.string().min(1), REDIS_URL: z.string().min(1), WEB_ORIGIN: z.string().url().default("http://localhost:3000"), SOCKET_CORS_ORIGINS: z.string().default("http://localhost:3000") });
const env = envSchema.parse(process.env);
const app: FastifyInstance = Fastify({ logger: { level: env.NODE_ENV === "production" ? "info" : "debug", redact: ["req.headers.authorization", "req.headers.cookie"] }, trustProxy: true, requestIdHeader: "x-request-id" });
const redis = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null, enableReadyCheck: true });
const pub = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });
const sub = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });
const origins = env.SOCKET_CORS_ORIGINS.split(",").map((origin) => origin.trim()).filter(Boolean);
const io = new SocketServer(app.server, { cors: { origin: origins, credentials: true }, transports: ["websocket", "polling"] });

async function registerPlugins(): Promise<void> {
  await app.register(helmet, { contentSecurityPolicy: env.NODE_ENV === "production" ? undefined : false });
  await app.register(cors, { origin: [env.WEB_ORIGIN], credentials: true, methods: ["GET", "POST", "PUT", "PATCH", "DELETE"] });
  await app.register(rateLimit, { global: true, max: Number(process.env.RATE_LIMIT_MAX ?? 100), timeWindow: Number(process.env.RATE_LIMIT_WINDOW_MS ?? 60000), redis });
  await app.register(swagger, { openapi: { info: { title: "Cloudie API", version: "0.1.0", description: "Cloudie workspace and points ledger API" }, servers: [{ url: process.env.API_URL ?? "http://localhost:4000" }] } });
  await app.register(swaggerUi, { routePrefix: "/docs" });
}

io.adapter(createAdapter(pub, sub));
io.use(async (socket, next) => {
  const token = socket.handshake.auth.token;
  if (typeof token !== "string" || token.length < 10) { next(new Error("unauthorized")); return; }
  try { const identity = await verifyAccessToken(token); socket.data.userId = identity.userId; socket.data.role = identity.role; next(); }
  catch { next(new Error("unauthorized")); }
});
setLedgerEventPublisher(async (event) => {
  const message = JSON.stringify({ type: "points:update", ...event, at: new Date().toISOString() });
  await pub.publish(`points:update:${event.userId}`, message);
  io.to(`user:${event.userId}`).emit("points:update", { balance: event.balance, delta: event.delta, description: event.description, ledgerId: event.ledgerId });
});
io.on("connection", (socket) => {
  const userId = socket.data.userId;
  const role = socket.data.role;
  if (typeof userId === "string") socket.join(`user:${userId}`);
  if (role === "ADMIN") socket.join("admin:metrics");
  socket.emit("connection:ready", { authenticated: true });
  socket.on("disconnect", () => app.log.debug({ socketId: socket.id }, "socket disconnected"));
});

app.get("/health", { schema: { tags: ["Infrastructure"], response: { 200: { type: "object", properties: { status: { type: "string" }, timestamp: { type: "string" } }, required: ["status", "timestamp"] } } }, handler: async () => ({ status: "ok", timestamp: new Date().toISOString() }) });
app.get("/ready", async (_request, reply) => {
  try { await prisma.$queryRaw`SELECT 1`; await redis.ping(); return { status: "ready" }; }
  catch (error) { app.log.error({ err: error }, "readiness check failed"); return reply.code(503).send({ status: "not_ready" }); }
});
app.get("/api/v1/points/costs", { schema: { tags: ["Points"], response: { 200: { type: "object", additionalProperties: { type: "number" } } } }, handler: async () => POINTS_COST });
app.post("/api/v1/points/charge", { schema: { tags: ["Points"], description: "Charge the authenticated user's points using the canonical action cost schedule." } }, async (request, reply) => {
  const identity = await requireIdentity(request, reply);
  if (!identity) return;
  const parsed = ledgerChargeSchema.safeParse(request.body);
  if (!parsed.success) return reply.code(400).send({ error: { code: "VALIDATION_ERROR", message: "Invalid charge request.", fields: parsed.error.flatten().fieldErrors } });
  const idempotencyKey = request.headers["idempotency-key"];
  if (typeof idempotencyKey !== "string" || idempotencyKey.trim().length < 16 || idempotencyKey.length > 128) return reply.code(400).send({ error: { code: "VALIDATION_ERROR", message: "Provide an Idempotency-Key header between 16 and 128 characters." } });
  const cost = POINTS_COST[parsed.data.action];
  try {
    const result = await applyLedgerEntry({ userId: identity.userId, amount: -cost, type: TxType.CHARGE, description: parsed.data.description, workspace: parsed.data.workspace ?? ACTION_WORKSPACE[parsed.data.action], idempotencyKey, metadata: { action: parsed.data.action, ...(parsed.data.metadata ?? {}) } });
    return reply.code(result.duplicate ? 200 : 201).send({ data: { ledgerId: result.ledger.id, balance: result.balance, delta: result.ledger.amount, duplicate: result.duplicate, cost } });
  } catch (error) {
    if (error instanceof InsufficientPointsError) return reply.code(402).send({ error: { code: error.code, message: error.message, balance: error.balance, required: error.required } });
    if (error instanceof LedgerIdempotencyConflictError) return reply.code(409).send({ error: { code: error.code, message: error.message } });
    request.log.error({ err: error }, "points charge failed");
    return reply.code(500).send({ error: { code: "INTERNAL_ERROR", message: "Could not apply points charge." } });
  }
});
app.get("/api/v1/me/points", async (request, reply) => {
  const identity = await requireIdentity(request, reply);
  if (!identity) return;
  const user = await prisma.user.findUnique({ where: { id: identity.userId }, select: { pointsBalance: true } });
  if (!user) return reply.code(404).send({ error: { code: "NOT_FOUND", message: "User not found." } });
  return { data: { balance: user.pointsBalance } };
});
app.get("/api/v1/stream/points", async (request, reply) => {
  const parsed = z.object({ token: z.string().min(10).max(4096) }).safeParse(request.query);
  if (!parsed.success) return reply.code(401).send({ error: { code: "UNAUTHENTICATED", message: "A short-lived session token is required." } });
  let identity;
  try { identity = await verifyAccessToken(parsed.data.token); }
  catch { return reply.code(401).send({ error: { code: "INVALID_SESSION", message: "The session token is invalid or expired." } }); }
  reply.hijack();
  reply.raw.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive", "X-Accel-Buffering": "no" });
  reply.raw.write(`event: ready\ndata: ${JSON.stringify({ userId: identity.userId })}\n\n`);
  const stream = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });
  const channel = `points:update:${identity.userId}`;
  await stream.subscribe(channel);
  stream.on("message", (receivedChannel, message) => { if (receivedChannel === channel) reply.raw.write(`event: points:update\ndata: ${message}\n\n`); });
  request.raw.on("close", () => { void stream.unsubscribe(channel).finally(() => stream.quit()); });
});

async function start(): Promise<void> {
  await registerPlugins();
  await pub.subscribe("cloudie:admin:metrics");
  pub.on("message", (channel, message) => { if (channel === "cloudie:admin:metrics") io.to("admin:metrics").emit("admin:metrics", JSON.parse(message) as unknown); });
  const port = Number(process.env.PORT ?? process.env.API_PORT ?? 4000);
  await app.listen({ port, host: "0.0.0.0" });
  app.log.info({ port }, "Cloudie API listening");
}
async function shutdown(): Promise<void> { await app.close(); io.close(); await Promise.all([redis.quit(), pub.quit(), sub.quit()]); await prisma.$disconnect(); }
process.once("SIGINT", () => void shutdown());
process.once("SIGTERM", () => void shutdown());
start().catch((error: unknown) => { app.log.error({ err: error }, "API startup failed"); process.exitCode = 1; });
