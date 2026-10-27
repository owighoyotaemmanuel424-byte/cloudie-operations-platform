// Vercel catch-all API entrypoint when this repository is deployed from its root.
// The API's own package and TypeScript build live in ./api/package.json.
import app from "./src/server";

export default app;
