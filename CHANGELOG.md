# Changelog

## 1.2.0

- Replace the implicit 200-check audio limit with a configurable elapsed-time budget. Optionally supply audio duration to calculate a longer budget.
- Preserve explicitly configured polling intervals and attempt limits, including values previously mistaken for migration defaults.
- Bound HTTP requests and polling delays by the remaining wait time and respect execution cancellation.
- Preserve uploaded file names, MIME types and bytes.
- Authenticate polling and result downloads only on the configured API origin, disable automatic redirects, and download external results without API credentials.
- Enforce JSON Schema enum, const and null constraints. Report unsupported or malformed local validation rules instead of claiming success.
- Add GitLab checks and GitHub releases with npm provenance, regression tests and updated polling/retry documentation.

Existing workflows keep explicitly saved attempt limits. Set Max Poll Attempts to 0 to use only the time budget. Workflow and instance execution timeouts still apply.
