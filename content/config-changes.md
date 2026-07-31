# Configuration Changes (optional manual manifest)

Prefer `QA-Release-Note: config` in the relevant `docs/changes` entry for config changes tied to a
commit. Use this file only for config notes with no code-change entry. Empty table → shows "None".

| Configuration | Description | Impact |
|---|---|---|
| Re-seed componentProperties | Re-seed `componentProperties` in the target environment so the new component styling/config keys (table column display mode & number format, and label styling authored under `advanced.*`) persist on Save. | Without the re-seed, these styling/config keys are stripped on save. |
