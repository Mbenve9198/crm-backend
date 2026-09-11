# Grader CRM integration

Requires the linked MenuChat v2 bootstrap and CRM frontend changes.

- Keep `INBOUND_LEAD_SECRET` equal to worker `CRM_INBOUND_SECRET`. New message/state/landing routes fail closed; legacy callers must include `X-Inbound-Secret` too.
- Run `node scripts/reconcileGraderCrm.js` to list candidate callbacks, ambiguous grader identities and preview-only contacted statuses. It logs IDs, never message content or phone numbers.
- Run it with `--apply-indexes` to install the three sparse unique indexes before accepting concurrent traffic. Resolve reported duplicate identities first. This does not edit commercial states.
- Apply v2 migration and worker before backend; frontend follows backend. Use the v2 reconciliation script to resubmit historical bookings and reconstruct retained conversations.
- Do not bulk-reset `contattato`: legacy preview activities omitted the previous status. Review the IDs in `previewStatusNeedsReview`, since existing manual contact attempts must be preserved.
- Imported v2 conversations are paused/read-only for CRM automation. They remain visible on the contact and are scoped to the contact's access permissions.
- The `propertyUpdates` field updates individual contact properties; it preserves simultaneous message/booking data. The old `properties` replacement remains for existing callers.
