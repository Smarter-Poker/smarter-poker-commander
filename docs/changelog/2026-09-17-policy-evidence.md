# Policy evidence and direct delivery

Version 2.9 consolidates authorization, continuity, hardening and reference roles. The portable reader checks reviewed hashes, emits full policy text and identifies exact candidate components. Reports preserve unknown/missing evidence, distinguish execution phases and keep provider/live proof separate. Existing required CI and the ordinary pre-push hook execute the same dependency-free scenarios; hook results are retained in private per-worktree Git metadata.

The scenario suite exercises policy corruption, missing files, non-engine publication, engine-contract evidence, failed prechecks, missing access/helpers, interrupted operations, missing live proof, actual Git rename/deletion input, provider timing and actual receipt/CI commands. It tests deterministic tooling, not universal agent obedience. Source-only policy/tooling changes need protected source verification; they do not require a poker-engine cutover.
