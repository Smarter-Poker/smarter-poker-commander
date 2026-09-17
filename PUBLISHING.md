# Commander publishing

**Non-engine delivery: push, publish, verify and finish without waiting for `:55`.** Apply the maintenance cutover only to an actual engine replacement or a specifically identified dependency on new engine behavior. A Club Arena client using existing engine APIs, an unrelated pending engine release, and a generic engine-health check do not create that dependency. Required checks and normal client publication/live proof still apply.

Read `AGENTS.md`, `AGENT-PLAYBOOK.md` and `docs/agent-policy/OPERATING-LAW.md`. Own the assigned delivery: recover the existing worktree/branch/PR, commit explicit paths with normal hooks, push, pass the current required checks and complete protected squash merge. Preserve actual dependencies, product rules and other tasks' work. No autopilot, human approval label or numbered queue is required.

The existing application uses Vercel Git source deployment for `smarter-poker-commander`. Verify the configured project/domain and actual deployment record before acting. Production is `https://commander.smarter.poker`; World Hub proxies the Commander paths. For a runtime release, require the applicable successful production deployment, expected commit at `https://commander.smarter.poker/api/health`, and affected behavior on the direct/proxied paths as relevant. Do not substitute Club Arena's publisher, a laptop/prebuilt upload, or a new project.

The tracked `ci.yml` runs the vendor drift and upstream synchronization checks, installation, blocking lint, tests and build. Use actual current branch-protection results; do not infer green checks from a workflow file. `vercel.json` intentionally ignores some changes outside application inputs. A docs-only merge is source publication, not a new runtime deployment; do not add dummy application changes to force one.

Shared code is installed from `file:vendor/commander-shared`. When that code is assigned, land upstream first, then sync the reviewed consumer files and lockfile under the existing drift rules. An upstream merge or package publication alone does not update the consumer.

A failed deployment enters immediate recovery: compare the last successful equivalent, fix the actual blocker, rerun affected/required checks and retry the existing eligible stage promptly. Establish uncertain remote outcomes first. Do not add a watcher or recurring retry. Retain source, checks, merge, provider and live evidence separately. Preserve credentials, existing schedules and required production safeguards.

## Publication timing

Push ready changes, run checks, complete protected merge, build and stage as soon as their prerequisites pass, throughout the hour. Do not hold these stages until `:55`. World Hub and Club Arena client publication have no hourly gate. Only game-engine activation uses its certified maintenance window; the immutable image must be prepared beforehand, followed by immediate live identity, behavior and rollback-budget verification at cutover. Commander and shared-package delivery retain their own component rules above. See the operating law for failed-attempt recovery.
