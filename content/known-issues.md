# Known Issues (manual manifest)

Carried-forward platform known issues (from the previous build) plus any current ones. Known issues
tied to a specific code change may also come from `QA-Release-Note: known-issue` in `docs/changes`.
Leaving the table empty falls back to the built-in baseline list.

| Issue ID | Description | Workaround |
|---|---|---|
|  | Role Management Change Effect | Because some menu structures have changed, certain features may return a 403 status code. To resolve this, edit the role, select the platform feature, and save the role again. |
|  | Scheduler with Workflow Not Working | Use the conventional feature-wise approach wherever workflow scheduling is required. |
|  | Formula Builder UI – Field Insertion Through Typing | This works in current fields. For external feature fields, it won't work, as there could be fields with same names from multiple features. |
|  | Formula Builder – AI-Based Formula Writing/Editing Not Implemented | Use manual formula entry instead. |
| 364 | Organization Details → Basic Info: Website URL accepts invalid URL formats without validation. | Expected: Validate the URL format and show an error message for invalid values, such as www.example or example@123.www.example |
|  | Builder Tool Not Available on Mobile Web | The builder tool is not supported on mobile web. This is implemented as expected — builder functionality is restricted to desktop browsers by design. It should be available on Tab though. |
|  | Mobile – Formula Field Not Working in Tables & Charts | Formula fields are not evaluated correctly when used inside Tables and Charts on mobile. This is under review. |
|  | AI App Builder, AI Assistant (Create — application / module / feature) and AI Ask FAQ are not working. The AI credentials were moved from environment variables to Vault, but the values are not yet being fetched from Vault. | None at present — AI Create and AI Ask flows cannot be tested in this build. Fix in progress; retest once the Vault credential fetch is resolved. |
