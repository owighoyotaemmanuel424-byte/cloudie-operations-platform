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
import { prisma } from "@cloudie/db";
import { setLedgerEventPublisher } from "@cloudie/db/ledger";
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
setLedgerEventPublisher(async (event) => {
  const message = JSON.stringify({ type: "points:update", ...event, at: new Date().toISOString() });
  await pub.publish(`points:update:${event.userId}`, message);
  io.to(`user:${event.userId}`).emit("points:update", { balance: event.balance, delta: event.delta, description: event.description, ledgerId: event.ledgerId });
});

io.on("connection", (socket) => {
  // Authentication is deliberately not inferred from a client-supplied userId.
  // The authenticated NextAuth/JWT token verifier must be wired before rooms are joined.
  socket.emit("connection:ready", { authenticated: false, message: "Authenticate before subscribing to private rooms." });
  socket.on("disconnect", () => app.log.debug({ socketId: socket.id }, "socket disconnected"));
});

app.get("/health", { schema: { tags: ["Infrastructure"], response: { 200: { type: "object", properties: { status: { type: "string" }, timestamp: { type: "string" } }, required: ["status", "timestamp"] } } }, handler: async () => ({ status: "ok", timestamp: new Date().toISOString() }) });
app.get("/ready", async (_request, reply) => {
  try { await prisma.$queryRaw`SELECT 1`; await redis.ping(); return { status: "ready" }; }
  catch (error) { app.log.error({ err: error }, "readiness check failed"); return reply.code(503).send({ status: "not_ready" }); }
});
app.get("/api/v1/points/costs", { schema: { tags: ["Points"], response: { 200: { type: "object", additionalProperties: { type: "number" } } } }, handler: async () => ({ SHIPMENT_CREATE: 10, SHIPMENT_TRACK_UPDATE: 2, PDF_GENERATE: 15, EMAIL_SEND: 1, IMAGE_RENDER: 3, TENANT_MONTHLY: 200 }) });
app.get("/api/v1/stream/points", async (request, reply) => {
  // SSE fallback; requires a verified session token before enabling user-scoped streams.
  const query = z.object({ token: z.string().min(1).optional() }).safeParse(request.query);
  if (!query.success || !query.data.token) return reply.code(401).send({ error: { code: "UNAUTHENTICATED", message: "A valid session is required." } });
  return reply.code(501).send({ error: { code: "STREAM_AUTH_NOT_CONFIGURED", message: "Configure the shared session verifier before subscribing." } });
});

async function start(): Promise<void> {
  await registerPlugins();
  await pub.subscribe("cloudie:admin:metrics");
  pub.on("message", (channel, message) => {
    if (channel === "cloudie:admin:metrics") io.to("admin:metrics").emit("admin:metrics", JSON.parse(message) as unknown);
  });
  const port = Number(process.env.PORT ?? process.env.API_PORT ?? 4000);
  await app.listen({ port, host: "0.0.0.0" });
  app.log.info({ port }, "Cloudie API listening");
}

async function shutdown(): Promise<void> {
  await app.close();
  io.close();
  await Promise.all([redis.quit(), pub.quit(), sub.quit()]);
  await prisma.$disconnect();
}
process.once("SIGINT", () => void shutdown());
process.once("SIGTERM", () => void shutdown());
start().catch((error: unknown) => { app.log.error({ err: error }, "API startup failed"); process.exitCode = 1; });
