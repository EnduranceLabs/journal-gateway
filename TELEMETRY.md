# Telemetry & Audit

## What it does (for PMs)
- **Visibility:** The gateway emits OpenTelemetry traces/metrics/logs to a customer-owned OTLP endpoint so operators can see connectivity, tool-call activity, and health.
- **Auditability:** Every tool call and every outbound message to Journal is logged with metadata (what integration, tool, request id, outcome, duration). No secrets, arguments, or payload bodies are recorded.
- **Change tracking:** Config/env reloads and MCP process start/stop events are captured to show what the gateway is doing over time.
- **Safety:** Redaction-first—only metadata is exported by default. Customers control where telemetry goes; they can disable or redirect it entirely.

## Operators (installing in customer environments)
- Set a customer OTLP collector endpoint (HTTP): `OTEL_EXPORTER_OTLP_ENDPOINT=https://otel.example.com`
- Optional service name override: `OTEL_SERVICE_NAME=journal-gateway`
- Enable telemetry explicitly if no endpoint is set: `TELEMETRY_ENABLED=true`
- Write local audit log (JSONL, metadata only): `AUDIT_LOG_FILE=/var/log/journal-gateway-audit.log`
- Defaults: telemetry is off unless an OTLP endpoint is provided or `TELEMETRY_ENABLED=true`. Audit file is off unless `AUDIT_LOG_FILE` is set.
- Example:
  ```bash
  OTEL_EXPORTER_OTLP_ENDPOINT=https://otel.example.com \
  OTEL_SERVICE_NAME=journal-gateway-prod \
  AUDIT_LOG_FILE=/var/log/journal-gateway-audit.log \
  JOURNAL_GATEWAY_TOKEN=gw_xxx \
  JOURNAL_GATEWAY_CONFIG=/etc/journal/gateway.json \
  journal-gateway --config /etc/journal/gateway.json
  ```

## Gateway developers
- Telemetry bootstrap lives in `gateway/src/telemetry.ts` (OTLP/HTTP exporters for traces, metrics, logs; `service.name` defaults to `journal-gateway`).
- Audit logging is in `gateway/src/audit.ts` and only records metadata. Never add arguments, results, or secret material to audit events.
- Integration points:
  - Tool calls in `GatewayConnection` are wrapped with OTEL spans, counters, and histograms; audit events mark start/result/error (metadata only).
  - Outbound gateway → service messages emit audit metadata (type, requestId, integrationId when present).
  - Runtime config/env reloads and MCP process start/stop events emit audit records.
- Extend telemetry by adding attributes to spans/metrics/logs, but keep payloads and secrets out; prefer hashes/ids for identifiers. Use the existing audit logger for user-visible provenance.
