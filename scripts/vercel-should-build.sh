#!/bin/bash
# Vercel: exit 0 skips; exit 1 builds. Keep this compatibility entry point.
node "$(dirname "$0")/vercel-should-build.mjs"
