---
"agent-maestro": patch
---

Refresh Copilot model discovery when the available models change, when opening a model picker, and before substituting a missing model. Newly available models now take precedence over stale fuzzy matches without reloading VS Code. Concurrent refreshes share one discovery request, and a failed refresh preserves the last successful catalog.
