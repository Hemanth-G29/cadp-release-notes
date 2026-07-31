# New Features (manual manifest)

Table columns: **Feature Name | Description | Impact**. Derived from hemanth.a's changes merged
2026-07-30 (docs/changes `QA-Release-Note: feature` entries). Empty table → New Features shows "None".

| Feature Name | Description | Impact |
|---|---|---|
| Payment Mode | New Payment Mode component and flow — method cards sourced from feature data, amount entry, a denomination sub-modal, and Bill/Paid/Balance totals; Confirm Payment submits the transaction. | End-to-end in-form payment capture. |
| Overflow (⋮) Menu | New kebab-menu component that groups actions (Import, Email, Print, Hold, Recall) behind one trigger; items persist on Save and render in the action toolbar. | Declutters the action bar. |
| Discount Coupon | Discount Coupon component — shoppers enter a code that is validated against configured coupons and applies a discount (builder + runtime); the computed discount can be written to a referenceable field. | Coupon/discount support at runtime. |
| DISTINCT formula aggregates | New DISTINCT aggregate family — DISTINCT_COUNT / SUM / AVG / MIN / MAX_OF_RECORDS plus a SQL-style DISTINCT({field}) modifier — for unique-value calculations (e.g. unique outlets, active users). | Distinct-count metrics the engine previously couldn't express. |
| Button – link & open-modal | Buttons support a text "link" variant and an "open-modal" action that opens any modal on the page. | More flexible button behaviour. |
| Table cell display mode | Table columns can render as a read-only label that becomes editable on click, with per-column Cell Display, output decimals, and footer decimals. | Cleaner, configurable table cells. |
| Adjustable column width in Preview | Column widths are respected and columns can be marked "adjustable" for Excel-style drag-resizing in Preview. | Tune table columns directly in preview. |
| Formula field "Show As: Label" | Formula fields can render as a label row (label-left / value-right) with optional inline editing and summary-row styling (sign prefixes, coloured/emphasised values). | Presentable bill-summary style formula rows. |
| Configurable modal styling & footer | Per-modal flat/Figma style overrides, a configurable set of footer action buttons, and custom Submit/Cancel labels. | Fully configurable modals. |
| Builder Preview guard | Previewing an unpublished form shows a "Back to Builder" button and is view-only — Submit and Save-as-Draft are blocked. | Safe preview of unpublished forms. |
