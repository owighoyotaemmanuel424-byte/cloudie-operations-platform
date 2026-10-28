import { getRequestListener } from "@hono/node-server";
import { app } from "./src/server.js";

// Vercel Node.js catch-all function. Hono owns routing, CORS, cookies, CSRF,
// authorization, and error handling for every /api/* request.
export default getRequestListener(app.fetch);
