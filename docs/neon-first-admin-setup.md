# Neon first-administrator setup

This procedure is for the Cloudie Neon API and must first be tested against the disposable Neon test branch. It does not authorize a production cutover.

## Safety properties

- `POST /api/auth/bootstrap-admin` is disabled unless `CLOUDIE_ADMIN_BOOTSTRAP_TOKEN` is configured with at least 32 UTF-8 bytes.
- The submitted token is compared in constant time and is never returned by the endpoint.
- Passwords must be at least 12 characters; they are stored using the API's scrypt password-hash format.
- A PostgreSQL transaction-level advisory lock serializes bootstrap attempts. If any admin account already exists (including suspended or terminated accounts), bootstrap returns HTTP 409 and creates nothing.
- The new admin, session, and audit record are committed in one transaction.
- Public registration still assigns only the `user` role. Never add a public role parameter to registration.
- Remove the bootstrap secret from the hosting environment immediately after the first successful setup.

## Operator procedure

1. Confirm the API deployment is connected to the disposable Neon test branch, not the production branch. Confirm `/ready` returns HTTP 200.
2. Generate a random token locally with `openssl rand -hex 32`. Do not paste it into source control, chat, tickets, logs, or screenshots.
3. Add that value as the hosting provider's secret/environment variable `CLOUDIE_ADMIN_BOOTSTRAP_TOKEN`, then redeploy the API. Do not expose it as a frontend/Vite variable.
4. From a trusted device, send a POST request to the API base URL plus `/api/auth/bootstrap-admin` with JSON fields `name`, `email`, `password`, and `token`. Use a unique administrator email and a unique password of at least 12 characters. Do not save the request body in shell history or logs. Prefer a REST client with a secure secret store; if using a shell, read secrets interactively rather than putting them in command-line arguments.
5. Require HTTP 201 and a response user whose `role` is `admin`. The response includes a session token; treat it as a password and never share it. The endpoint also sets the HttpOnly session cookie and CSRF cookie.
6. Immediately remove `CLOUDIE_ADMIN_BOOTSTRAP_TOKEN` from the hosting environment and redeploy/restart the API. Verify a fresh request to the bootstrap endpoint now returns HTTP 503.
7. Sign in through the supported UI, then verify `GET /api/me` reports role `admin` and that a known administrator-only endpoint returns an authorized response. Verify an ordinary user receives HTTP 403 from the same admin-only endpoint.
8. Record only non-secret evidence: deployment identifier, timestamp, HTTP statuses, and the admin role check. Never record passwords, bootstrap tokens, cookies, or bearer tokens.

## Failure handling

- HTTP 503: the bootstrap token is absent or too short; do not weaken the minimum.
- HTTP 400: validate the name, email, password length, and JSON shape.
- HTTP 401: token mismatch; do not retry repeatedly. Confirm the hosting secret was set correctly without revealing it.
- HTTP 409: an admin already exists or the email conflicts with an existing account. Stop and investigate; do not delete accounts or bypass the guard.
- HTTP 429: wait before retrying.
- HTTP 500 or a deployment health failure: inspect redacted server logs and database connectivity; do not expose secrets or disable authorization checks.

## Before production use

The bootstrap code and CI tests must pass on the PR branch. Perform the full flow against the disposable branch first, including confirmation that a second bootstrap attempt is refused. Review the hosting provider's environment-variable and redeploy behavior. Do not switch production traffic or alter production data as part of this setup.
