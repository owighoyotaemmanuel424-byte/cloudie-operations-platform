import { getRequestListener } from "@hono/node-server";
import { app } from "../backend/src/server.ts";

// Keep a single Vercel function for all API routes. Hono owns routing,
// CORS, cookies, CSRF, authorization, and error handling.
export default getRequestListener(app.fetch);
