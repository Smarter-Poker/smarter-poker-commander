# Native Home Game member-feed privacy

The direct Commander post-list route bypassed post RLS through its service client and did not exclude hidden content. An approved member could therefore read a moderated post directly even when the World Hub reader withheld it.

GET now checks the active group, reads posts with the existing caller-JWT-scoped client, and explicitly excludes hidden and unpublished posts. Visible legacy NULL states remain readable. Approved-member authentication, member-only posts, author projection, bounded pagination, and the entire canonical POST creation path are preserved. Responses are private/no-store so moderation cannot remain publicly cached.

The directly CI-discovered native-post privacy regression executes the real route and covers hidden, unpublished, foreign-group, legacy NULL, inactive, unavailable, anonymous, pending/banned, and unchanged creation behavior. Production qualification and deployment evidence are recorded in the owning Poker Near Me Phase 3 checkpoint; local tests are not a live certificate.
