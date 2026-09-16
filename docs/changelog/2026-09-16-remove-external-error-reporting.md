# Remove external error reporting

Owner requested complete removal of the paid monitoring integration. Remove
browser/server/edge bootstrap, transport configuration, the SDK dependency and
116 exclusively reachable locked packages. API imports now use a local error
handler; existing business handlers, authentication, HTTP status behavior and
venue health persistence are retained. The login probe no longer submits
monitoring envelopes; its normal application checks, failure response, logs and
existing cron execution record remain.

The shared source and vendored source are identical. Old external-reporting
helper exports were removed, and consumers migrated. The preserved historical
branch exclusions prevent old automation branches from being opened again.
Dated audit/changelog history remains evidence, not integration configuration.

Validation: 51 focused existing unit tests, eight direct integrity/behavior
checks, source parse and vendor/upstream checks passed. The retirement check
fails against the unchanged baseline and passes against this source. Required
full lint/build/runtime publication qualification remains the release owner's
responsibility; this source record is not a deployment claim.
