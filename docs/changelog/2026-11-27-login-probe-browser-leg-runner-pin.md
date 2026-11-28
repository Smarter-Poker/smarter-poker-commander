# 2026-11-27 - The login-bridge browser leg runs again

The "Handshake works in a real browser" job of `login-bridge-probe.yml` failed
at "Install Chromium" on every run since 2026-11-13, so the Chromium / WebKit /
iPhone Safari walk of the hub -> Commander hop had not executed for two weeks
(the structural and signed-in HTTP legs kept passing). Cause: GitHub migrated
`ubuntu-latest` to Ubuntu 26.04 between Oct 19 and Nov 19, 2026, and Playwright
1.50-1.60 ships no browser builds for 26.04. The job is pinned to
`ubuntu-24.04` until Playwright is upgraded alongside a move to 26.04.
