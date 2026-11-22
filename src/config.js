// ---- Edit this file to match your mailbox. No other code changes needed. ----

// Each shared mailbox has its own folder under mailbox/ and its own sealed file.
export const MAILBOXES = [
  { id: 'tx', name: 'CCSTXBilling', folder: 'mailbox/tx' },
  { id: 'co', name: 'CCSCOBilling', folder: 'mailbox/co' },
];

// Emails received before this date are ignored
export const START_DATE = '2026-01-01';

// Years offered in the dashboard filter. Add a year here when that data should appear.
export const AVAILABLE_YEARS = [2026];

// Folder paths (lowercase). Exactly "inbox" = Pending. Anything else = Completed,
// except the lists below. Subfolders of Inbox (e.g. "inbox/done") count as filed.
export const PENDING_FOLDERS = ['inbox'];
export const DELETED_FOLDERS = ['deleted items'];
export const EXCLUDED_FOLDERS = ['junk email', 'junk e-mail', 'drafts', 'sent items'];

// Request-type categories (matched ignoring case)
export const REQUEST_TYPES = [
  'Billing Change', 'Budget Change', 'Cancellation', 'COI', 'Collections Support',
  'General Inquiry', 'Invoice Adjustment', 'Invoice Approval', 'Invoice Copy',
  'Invoice Inquiry', 'Invoice Upload', 'New Project', 'Purchase Order', 'Remittance',
  'Tenant Inventory', 'Vendor Set-up',
];

// Workflow flags: shown separately, never counted as request types
export const FLAGS = ['VIP', 'Awaiting Reply', 'Out of Office / Undeliverable'];

// Owner categories start with this prefix, e.g. "Owner: Maciel Garcia"
export const OWNER_PREFIX = 'owner:';
