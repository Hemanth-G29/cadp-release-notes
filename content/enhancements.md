# Enhancements / Improvements (manual manifest)

Table columns: **Module | Description | Benefit**. Derived from hemanth.a's changes merged 2026-07-30
(docs/changes `QA-Release-Note: enhancement` entries), curated to the substantive items. Empty table
→ Enhancements shows "None".

| Module | Description | Benefit |
|---|---|---|
| Formula Engine | DISTINCT aggregates now run as a MongoDB group query — a ~12k-row distinct count drops from ~16.8s to ~0.55s. | Much faster distinct-aggregate dashboards. |
| Formula Engine | DISTINCT aggregates now appear in autocomplete/help; an Expression Builder render loop was fixed. | Discoverable DISTINCT functions. |
| Reports / Extraction | Projection-formula rows are evaluated with bounded parallelism, fetching only the reference fields a response needs. | Faster projection and extraction. |
| Data Table | Formula columns support Sum / Average / Min / Max footer totals, not just Count. | Richer totals rows. |
| Tax Summary | Pivot headers show readable labels instead of raw field keys, with an opt-in modern (Figma) style. | Readable, polished tax summary. |
| Button | Button icons persist on Save/Publish; the icon picker uses the tenant brand colour with proper alignment. | Reliable, on-brand button icons. |
| Components | Column width is now single-source — a width set to 20% no longer reverts to 35%. | Predictable column widths. |
| Transactions | Line items (including quantities) can be copied from another feature via a header lookup. | Faster line-item entry. |
| Transaction Layout | Desktop preview scrolls only the form body; tall columns scroll internally (no global page scrollbar); tighter header/padding; the summary/right column stays fully visible. | Cleaner, more usable transaction forms. |
| Save Properties Modal | Sits below the fixed app header, clips to its rounded corners, shows the real data-field count, and themes the Device Visibility card to brand. | Polished Save Properties dialog. |
| Import Feature Modal | Clears the fixed app header and scrolls tall content internally. | Usable import dialog. |
| JSON Preview | Shows the true recursive component count and matches the Save modal's size and position. | Accurate JSON preview. |
| Lookup / Dropdown | Feature-backed dropdowns open in the correct position without flicker, show a single brand focus ring, and no longer flash on selection. | Smoother dropdowns. |
| Transaction Management | Display-only components (labels/headings/dividers) no longer appear as empty columns and are excluded from the submitted payload. | Cleaner listings and saved data. |
| Payment Mode | The payment value renders as method chips with Paid/Balance (not raw JSON); Confirm Payment shows a spinner and disables during submit. | Readable payment cells; no double-submit. |
| Layout | Sections reflow when a nested accordion collapses; the accordion header title aligns with its chevron. | Tighter, responsive layouts. |
| Builder | The "Save as Draft" button label is editable and persists. | Custom draft-button text. |
| Properties Panel | Advanced Layout toggles can be deselected by clicking the active option. | More flexible layout configuration. |
| Overflow Menu | Compact, aligned default layout with themed line-icons that follow the text colour. | Consistent overflow menu. |
| Workspace Switcher | Inactive workspaces show a neutral gray icon chip; only the active one keeps the brand tint. | Clearer active-workspace cue. |
