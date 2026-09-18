---
name: Generated asset watcher
description: Filesystem watcher behavior when generated frontend assets are rebuilt in place.
---

Development file watchers can receive an `ENOENT` error when a generated asset directory is removed and recreated during a rebuild. That error must be handled and the watcher retried rather than allowed to become an unhandled process error.

**Why:** A healthy HTTP server can otherwise crash after serving successfully, making the preview appear unavailable even though the underlying application code and port configuration are correct.

**How to apply:** Whenever a development server watches a directory containing generated frontend output, attach an error handler and restart the watcher after transient directory replacement.