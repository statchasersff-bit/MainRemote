---
name: Stale API listener
description: Preview workflow restarts can fail when an orphaned API process still owns the managed port.
---

When the API workflow reports `EADDRINUSE` after a restart, check the listener and its process before changing application code. A prior server process can survive a workflow termination and continue serving the preview while the new managed process fails.

**Why:** The application itself was healthy; the failure was caused by a leftover process binding the managed port.

**How to apply:** Identify the process listening on the artifact port, confirm its working directory and command belong to the affected artifact, stop only that stale process, then restart the managed workflow and verify its health endpoint.