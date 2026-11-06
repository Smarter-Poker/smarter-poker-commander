# Agent execution preview

The normal pre-push hook and existing required CI policy step now invoke a shadow execution preview. It reads the actual candidate through the maintained policy classifier, records an adapter fingerprint, and reports unknown access/cost inputs explicitly. Working-tree advisory mode includes pending tracked and untracked edits before expensive checks. Existing check selection and publication controls are unchanged.

The adapter consumes the exact Node-only shared source protected in commander-shared PR87, commit a0da119061eb120a24bea30f79a9ce1d44345cb0. Package metadata is unchanged; the tool reads the reviewed vendor source directly, so no package or lockfile change is required. Interrupted prechecks discard stale receipts and retain nonzero signal exits. Focused consumer tests exercise the real CLI and signal handlers in isolation. This source/tooling delivery does not claim reduced application coverage or a new runtime deployment.
