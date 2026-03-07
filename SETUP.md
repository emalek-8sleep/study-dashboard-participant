# Study Participant Dashboard — Setup Guide

This dashboard is fully driven by your Google Sheet. Once it's deployed, you update everything — phases, docs, troubleshooting guides, participant data — just by editing the sheet. No code needed.

---

## Step 1: Set Up Your Google Sheet

Your sheet needs **5 tabs** with these exact names:

| Tab Name | Purpose |
|---|---|
| `Participants` | One row per participant — their ID and phase statuses |
| `Study Config` | Study name, contact email, welcome message |
| `Phases` | Definition of each study phase |
| `Docs` | Links to study documents and resources |
| `Troubleshooting` | Device help guides |

### Tab 1: `Participants`

| Column | Notes |
|---|---|
| `Subject ID` | **Required.** The ID participants type to log in (e.g. SBJ-001) |
| `First Name` | Optional — used in the welcome header |
| One column per phase | e.g. `Phase 1 Status`, `Phase 2 Status`, etc. |
| `Notes` | Optional — internal notes, not shown to participant |

**Valid status values** (what you type into a status cell):
- `Complete` — phase is done ✓
- `In Progress` — participant is currently in this phase
- `Pending` — upcoming, not started
- `Missed` — phase was not completed
- `Withdrawn` — participant withdrew

### Tab 2: `Study Config`

Two columns: `Key` and `Value`. Fill in the rows you want:

| Key | Example Value |
|---|---|
| `study_name` | Sleep Optimization Trial |
| `contact_email` | coordinator@yourinstitution.edu |
| `welcome_message` | Enter your Subject ID to view your study progress. |

### Tab 3: `Phases`

| Column | Notes |
|---|---|
| `Phase Number` | 1, 2, 3... (used for ordering) |
| `Phase Name` | e.g. Baseline, Intervention, Follow-Up |
| `Description` | What happens in this phase (shown when participant expands) |
| `Goal` | What the participant should achieve |
| `Start Week` | e.g. 1 |
| `End Week` | e.g. 2 |
| `Status Column` | **Exact column name** from Participants tab, e.g. `Phase 1 Status` |

### Tab 4: `Docs`

| Column | Notes |
|---|---|
| `Title` | Document name, e.g. Consent Form |
| `Description` | One-line description (optional) |
| `URL` | Full link to the document (Google Drive, PDF, etc.) |
| `Category` | Groups docs together, e.g. Protocol, Consent, Device, FAQ |

### Tab 5: `Troubleshooting`

| Column | Notes |
|---|---|
| `Device` | Device name — used for tabs, e.g. Eight Sleep Pod, Garmin Watch |
| `Issue Title` | Short description of the problem |
| `Steps` | Step-by-step instructions. Separate steps with a newline, ` | `, or `; ` |
| `Link` | Optional — link to a full guide or video |

---

## Step 2: Publish Your Sheet

1. In Google Sheets: **File → Share → Publish to web**
2. Select "Entire document" and "Comma-separated values (.csv)"
3. Click **Publish** and confirm
4. Also set sharing to **"Anyone with the link can view"** (File → Share → Share with others)

---

## Step 3: Get Your Sheet ID

Look at your Google Sheet URL:
```
https://docs.google.com/spreadsheets/d/THIS_IS_YOUR_SHEET_ID/edit
```
Copy that long string.

---

## Step 4: Run Locally (optional, to preview before deploying)

1. Make sure you have Node.js installed (https://nodejs.org)
2. Open a terminal, navigate to this folder
3. Run:
   ```bash
   cp .env.local.example .env.local
   ```
4. Open `.env.local` and paste your Sheet ID
5. Run:
   ```bash
   npm install
   npm run dev
   ```
6. Open http://localhost:3000

---

## Step 5: Deploy to Vercel

1. Push this folder to a GitHub repository
2. Go to https://vercel.com and sign in
3. Click **"Add New Project"** and import your GitHub repo
4. Under **"Environment Variables"**, add:
   - Name: `NEXT_PUBLIC_SHEET_ID`
   - Value: your Sheet ID from Step 3
5. Click **Deploy**
6. Your dashboard is live! Share the URL with participants.

---

## Updating Content

Everything updates automatically from the sheet:

| Want to... | Do this |
|---|---|
| Add a new participant | Add a row to the `Participants` tab |
| Update phase status | Change the status cell for that participant |
| Add a new document | Add a row to the `Docs` tab |
| Add troubleshooting help | Add a row to the `Troubleshooting` tab |
| Change study name | Update `study_name` in Study Config tab |
| Add a new phase | Add a row to `Phases` + add a status column to `Participants` |

No code deploys needed — the dashboard reads your sheet in real time.

---

## Tips

- **Tab names must match exactly** — copy them from this guide carefully
- **Status values are flexible** — the dashboard recognizes variations like "done", "active", "yes/no"
- **Subject IDs are case-insensitive** — SBJ-001 and sbj-001 both work
- **Doc links** can point to Google Drive, PDFs, YouTube videos, or any URL
- **Troubleshooting steps** can be plain text or numbered — the dashboard renders them as a clean list

---

*Questions? Contact your study coordinator.*
