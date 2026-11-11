import { getRequestListener } from "@hono/node-server";
import { app } from "../backend/src/server.ts";

// One Vercel Node function for every API route. Hono owns routing, CORS,
// cookies, CSRF, authorization and error handling; the same app is mounted
// in-process by `vite dev` for local work.
export default getRequestListener(app.fetch);
