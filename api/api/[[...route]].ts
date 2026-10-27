// Vercel catch-all function for the Cloudie Neon API.
// The project root is configured as /api, so this file maps /api/* requests
// into the Hono router while keeping the existing route paths unchanged.
import app from "../src/server";

export default app;
