# Connect Google Sheets to Google Cloud

The quote calculator lives in the client’s Google Sheet. This NestJS app does **not** log in as a person. It talks to the **Google Sheets API**, which is a Google Cloud product. That is why **Google Cloud account access** is required to finish setup.

This is the client workbook:

`https://docs.google.com/spreadsheets/d/1vvx_jvLyjloC__AJ3vCHuJRE0hJjr_T6XVrtHUnRbRY/edit`

Spreadsheet ID (from the URL, between `/d/` and `/edit`):

```
1vvx_jvLyjloC__AJ3vCHuJRE0hJjr_T6XVrtHUnRbRY
```

---

## What to ask the client for

Ask for **both**. Sharing the sheet alone is not enough.

1. **Editor access on the spreadsheet** (link above), so you can confirm cell layout.
2. **Google Cloud Console access** on the project that will own the API:
   - Role: **Editor** or **Owner**
   - Ability to enable APIs, create a service account, and download a JSON key

If they will not grant Console access, they must create the service account themselves and send you the JSON key file (never commit that file).

---

## How the connection actually works

There is no “link this Sheet” button inside Google Cloud. The connection is three pieces:

```
Google Cloud project
  → enable Google Sheets API
  → create a service account (robot user)
       → share the Google Sheet with that robot email (Editor)
            → put the JSON key + spreadsheet ID in the backend .env
```

The backend then authenticates as:

`GOOGLE_SERVICE_ACCOUNT_EMAIL` (ends in `@….iam.gserviceaccount.com`)

and reads/writes the sheet by ID.

Do **not** share the sheet with a personal Gmail. A personal Gmail cannot be used as the API identity.

---

## Step 1 — Google Cloud project

1. Open [Google Cloud Console](https://console.cloud.google.com/).
2. Select the client’s project, or create one (example name: `affordable-movers`).
3. Confirm billing is attached if Google requires it for this project.

---

## Step 2 — Enable the Google Sheets API

1. In the same project, go to **APIs & Services → Library**.
2. Search for **Google Sheets API**.
3. Click **Enable**.

Without this, every quote request fails with `accessNotConfigured` / `403`.

---

## Step 3 — Create a service account

1. Go to **IAM & Admin → Service Accounts**.
2. **Create service account**.
3. Name it something like `moving-sheets-reader`.
4. Skip extra IAM roles on the GCP project (the sheet share is what grants access).
5. Open the new account → **Keys → Add key → Create new key → JSON**.
6. Download the JSON. It contains:

   - `client_email` → `GOOGLE_SERVICE_ACCOUNT_EMAIL`
   - `private_key` → `GOOGLE_PRIVATE_KEY`

Keep the JSON off git. Put values in `.env` / Render env vars only.

---

## Step 4 — Connect the Google Sheet (share with the service account)

This is the actual “connect Sheet to Google Cloud” step.

1. Open the Instant Estimate spreadsheet.
2. Click **Share**.
3. Paste the service-account email, for example:

   `moving-sheets-reader@YOUR-PROJECT.iam.gserviceaccount.com`

4. Role: **Editor** (the API writes customer inputs, then reads Instant Quote Price).
5. Uncheck **Notify people** (Google cannot email a service account).
6. Click **Share**. Ignore “email looks invalid” if it appears.

Until this share exists, the API returns `The caller does not have permission`.

---

## Step 5 — Put credentials in the backend

In `edwardmoll-backend/.env` (and the same keys on Render):

```env
GOOGLE_SPREADSHEET_ID="1vvx_jvLyjloC__AJ3vCHuJRE0hJjr_T6XVrtHUnRbRY"
GOOGLE_SERVICE_ACCOUNT_EMAIL="moving-sheets-reader@YOUR-PROJECT.iam.gserviceaccount.com"
GOOGLE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n....\n-----END PRIVATE KEY-----\n"
```

Private-key rules:

- Keep the `\n` characters as written in the JSON (one line in `.env`).
- `sheets.service.ts` converts `\\n` back to real newlines.
- Never use a key that contains the word `Mock` — that forces the local fallback calculator.

---

## Step 6 — Confirm it is live

1. Restart the API (`npm run start:dev`).
2. Log line you want:

   `Google Sheets service initialized successfully.`

3. If you see `Using mock estimator logic`, credentials are missing or look like mocks.
4. Post a quote. If Sheets is connected but the tab/cells do not match the code, you will still get a fallback price — that is a mapping job, not a Cloud connection job.

---

## Current app mapping (must match the workbook)

`src/sheets/sheets.service.ts` currently writes `Calculator!B2:B5` and reads `Calculator!C10`.

The client workbook uses a different layout (Residence Type, Bedrooms, access, Instant Quote Price, specialty panel). After Cloud access is working, those cell ranges have to be updated to this sheet’s real tab name and cells. Connecting Cloud does not change pricing formulas; it only lets the API reach the sheet.

---

## If something fails

| Symptom | Cause |
|---|---|
| `Using mock estimator logic` | Env vars missing, empty, or marked mock |
| `accessNotConfigured` | Google Sheets API not enabled |
| `The caller does not have permission` | Sheet not shared with the service-account email as Editor |
| `Requested entity was not found` | Wrong `GOOGLE_SPREADSHEET_ID` |
| `Unable to parse range` | Tab name in code does not match the sheet tab |
| Quote looks like a round $200–$900 number, not $761.03 | Cloud may be up, but the code is still on the local fallback or the wrong cells |
