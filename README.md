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

Open `http://localhost:3000` for the resident portal. The Civil Office sign-in is at `http://localhost:3000/login.html`.

Before the first local run, configure `INITIAL_ADMIN_PASSWORD` and `SESSION_SECRET` as private environment variables. The initial administrator account is created only when the user database is empty; no password is embedded in the application source.

## Test

```powershell
npm test
```

The test suite launches the server on a test port and verifies authorization, resident tracking, complaint creation and updates, staff/SMS records, equipment updates, tenders, AI insights and logout.

## Firebase database migration

CAMS remains hosted on Render. Firebase is being introduced as the managed database layer; the application itself is **not** being moved to Firebase App Hosting.

The repository already contains the Firebase Admin SDK integration and Firestore configuration. Firestore is accessed by the Express backend using the Firebase Admin SDK, so the browser does not need direct database access. Firebase documents that server-side Admin SDK clients bypass Firestore Security Rules and authenticate through Google credentials/IAM; the project therefore keeps direct browser access locked down while the Render backend acts as the trusted data layer.

Configure the Render service with one of these credential options:

- `FIREBASE_SERVICE_ACCOUNT_JSON` containing the Firebase service-account JSON; or
- `GOOGLE_APPLICATION_CREDENTIALS` pointing to a securely mounted service-account file.

Never commit service-account credentials to GitHub.

To migrate the current SQLite database into Firestore from a trusted environment:

```powershell
npm run firestore:migrate
```

The migration reads `DATA_DIR/civil-affairs.db`, writes each SQLite table to a Firestore collection with the same name, uses stable SQLite IDs as document IDs when available, and performs upserts. It does **not** delete or modify the SQLite database.

The application is intentionally not switched to Firestore-only reads/writes yet. The migration is the first safe step; after the Firestore data is verified, the API data-access layer can be switched collection-by-collection without disrupting the existing Render deployment.

## Data and production hardening

The current application still stores its operational data in `data/civil-affairs.db`. Firebase Firestore is being prepared as the managed database target. TextBee SMS remains part of the existing notification architecture. Before the final database cutover, verify every collection and workflow, then remove the old SQLite seed/data path only after the Firestore-backed implementation is proven.
