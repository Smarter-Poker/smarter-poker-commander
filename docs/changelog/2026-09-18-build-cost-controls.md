# Build only relevant changes

Production keeps the existing Vercel Git source route. Preview builds require a `preview/` branch; all other branches still receive their normal GitHub checks. `git.deploymentEnabled` enforces this before a deployment queues.

The ignored-build step compares the complete change from Vercel's last successful deployment SHA. Missing history builds conservatively; one bounded fetch handles a baseline outside the shallow clone. Explicit redeployment of the same revision still builds. Only known documentation/test paths skip; runtime Markdown and unknown files build. Git metadata must remain available to this step.

Regression tests execute the real script against temporary repositories, covering unpublished changes followed by docs, missing history, preview opt-in and production changes. These tests run in the existing required CI.
