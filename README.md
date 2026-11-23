# ARC-1
React + Vite. Runs on sample data until you add your Power Automate URL.

## Add a month

On GitHub, open `mailbox/tx` for CCSTXBilling or `mailbox/co` for CCSCOBilling. Choose **Add file**, then **Upload files**, drop in the attachment, and commit it to `main`. GitHub encrypts the file during the deploy and removes the readable copy. The live site updates when that deploy finishes. Drop the file in the folder for the mailbox it belongs to.

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
