# Civil Affairs

Civil Affairs is a local web application for STPS township residents and the Civil Office.

## Included workflows

- Resident complaints for quarters, garbage, shops and public-area issues
- Browser-based reporting with optional photo name and browser location capture
- Complaint reference tracking verified with the registering mobile number
- Civil Office dashboard, complaint assignment and status workflow
- Staff attendance, task allocation and recorded SMS dispatches
- Equipment allocation, condition and return tracking
- Tender creation and stage/bid updates
- Complaint-based AI insight screen with human-approval guardrails
- Administrator sign-in, signed HTTP-only session, salted password hashing and logout

## Run locally

```powershell
npm install
npm start
```

Open [http://localhost:3000](http://localhost:3000) for the resident portal. The Civil Office sign-in is at [http://localhost:3000/login.html](http://localhost:3000/login.html).

Before the first local run, configure `INITIAL_ADMIN_PASSWORD` and `SESSION_SECRET` as private environment variables. The initial administrator account is created only when the user database is empty; no password is embedded in the application source.

## Test

```powershell
npm test
```

The test suite launches the server on a test port and verifies authorization, resident tracking, complaint creation and updates, staff/SMS records, equipment updates, tenders, AI insights and logout.

## Data and production hardening

The app stores data in `data/civil-affairs.db`; it is created automatically and seeded with demonstration records. This local build records SMS/email notification events but does not deliver messages yet. Before production use, deploy behind HTTPS, replace the session memory store with a persistent session store, integrate approved SMS/email providers, configure encrypted backups, define retention policies, and add organization-managed roles/MFA.
