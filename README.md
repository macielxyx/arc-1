# Billing Mailbox Dashboard
React + Vite. Runs on sample data until you add your Power Automate URL.

## Deploy (no local install)
1. Push this folder to GitHub (branch `main`, include the hidden `.github` folder).
2. Settings → Pages → Source: **GitHub Actions**. Every push auto-builds and deploys.

## Connect real data
Settings → Secrets and variables → Actions:
- Secret `VITE_FLOW_URL` = HTTP GET URL of the "Dashboard Feed" flow
- Variable `VITE_REFRESH_SECONDS` = 60
Then re-run the workflow.

## Customize
Folders counted as pending/deleted/excluded, request-type names, flags and the start date are all in `src/config.js`.

## Expected feed (JSON array, one object per email)
`{ "id", "messageId", "subject", "received", "categories": ["Invoice Adjustment","Owner: Maciel Garcia"], "folder": "Inbox" }`
