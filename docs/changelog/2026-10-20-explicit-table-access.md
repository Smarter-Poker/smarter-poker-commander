# Explicit new-table access

New public CREATE TABLE migrations must declare explicit role revokes and RLS before narrow caller-specific grants. The static declaration checker runs in the existing required build check and normal push hook; eight Node regressions cover role omissions, multiple/quoted tables, DO declarations, comments/strings and uncalled functions.

This does not change production ACLs or application behavior and does not certify arbitrary dynamic SQL or historical schema replay. Historical table/RPC/trigger permissions remain under the separate shared-database audit.

The forward declaration checker also covers public VIEW and MATERIALIZED VIEW creation/replacement, requiring explicit role boundaries without a table-RLS requirement. Ten Node declaration cases now pass. View ownership/security options and underlying permissions still need caller-specific review; this static check does not certify them.
