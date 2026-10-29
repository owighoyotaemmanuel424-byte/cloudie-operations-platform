import { getRequestListener } from "@hono/node-server";
import { app } from "./src/server.ts";

// Vercel JavaScript entrypoint; Hono owns routing, CORS, cookies, CSRF,
// authorization, and error handling for every /api/* request.
export default getRequestListener(app.fetch);
