import {
  diag,
  DiagConsoleLogger,
  DiagLogLevel,
  trace,
  metrics,
  logs as otelLogs,
  context,
} from "@opentelemetry/api";
import { NodeSDK } from "@opentelemetry/sdk-node";
import { Resource } from "@opentelemetry/resources";
import { SemanticResourceAttributes } from "@opentelemetry/semantic-conventions";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { OTLPMetricExporter } from "@opentelemetry/exporter-metrics-otlp-http";
import { OTLPLogExporter } from "@opentelemetry/exporter-logs-otlp-http";
import { PeriodicExportingMetricReader } from "@opentelemetry/sdk-metrics";
import { BatchLogRecordProcessor, LoggerProvider } from "@opentelemetry/sdk-logs";

export interface TelemetryOptions {
  enabled: boolean;
  endpoint?: string;
  serviceName?: string;
  resourceAttributes?: Record<string, string>;
}

type Attributes = Record<string, string | number | boolean | null | undefined>;

/**
  * Minimal OTEL bootstrapper for traces/metrics/logs.
  * Defaults to OTLP/HTTP exporters and respects standard OTEL_* env overrides.
  */
export class Telemetry {
  private sdk: NodeSDK | null = null;
  private started = false;
  private toolCallHistogram = metrics.getMeter("gateway").createHistogram("gateway.tool_call.duration", {
    description: "Tool call duration in milliseconds",
    unit: "ms",
  });
  private toolCallCounter = metrics.getMeter("gateway").createCounter("gateway.tool_call.count", {
    description: "Count of tool calls by outcome",
  });
  private loggerProvider: LoggerProvider | null = null;

  async start(options: TelemetryOptions): Promise<void> {
    if (this.started || !options.enabled) return;

    diag.setLogger(new DiagConsoleLogger(), DiagLogLevel.WARN);

    const resource = new Resource({
      [SemanticResourceAttributes.SERVICE_NAME]: options.serviceName ?? "journal-gateway",
      ...options.resourceAttributes,
    });

    const traceExporter = new OTLPTraceExporter(options.endpoint ? { url: options.endpoint + "/v1/traces" } : undefined);
    const metricExporter = new OTLPMetricExporter(options.endpoint ? { url: options.endpoint + "/v1/metrics" } : undefined);
    const logExporter = new OTLPLogExporter(options.endpoint ? { url: options.endpoint + "/v1/logs" } : undefined);

    this.loggerProvider = new LoggerProvider({ resource });
    this.loggerProvider.addLogRecordProcessor(new BatchLogRecordProcessor(logExporter));
    otelLogs.setGlobalLoggerProvider(this.loggerProvider);

    this.sdk = new NodeSDK({
      resource,
      traceExporter,
      metricReader: new PeriodicExportingMetricReader({ exporter: metricExporter }),
      logRecordProcessor: new BatchLogRecordProcessor(logExporter),
      instrumentations: [],
    });

    await this.sdk.start();
    this.started = true;
  }

  async shutdown(): Promise<void> {
    if (!this.started || !this.sdk) return;
    await this.sdk.shutdown().catch(() => {});
    this.loggerProvider?.shutdown().catch(() => {});
    this.started = false;
  }

  startActiveSpan<T>(
    name: string,
    attrs: Attributes,
    fn: (span: import("@opentelemetry/api").Span) => Promise<T>
  ): Promise<T> {
    const tracer = trace.getTracer("gateway");
    return tracer.startActiveSpan(
      name,
      { attributes: attrs },
      context.active(),
      async (span) => {
        try {
          const result = await fn(span);
          span.setAttributes(attrs);
          span.end();
          return result;
        } catch (err) {
          span.recordException(err as Error);
          span.setStatus({ code: 2 });
          span.end();
          throw err;
        }
      }
    );
  }

  recordToolCall(durationMs: number, success: boolean, code?: string): void {
    this.toolCallHistogram.record(durationMs, {
      success,
      ...(code ? { code } : {}),
    });
    this.toolCallCounter.add(1, {
      success,
      ...(code ? { code } : {}),
    });
  }

  log(eventName: string, attributes: Attributes): void {
    const logger = otelLogs.getLogger("gateway");
    logger.emit({
      body: eventName,
      attributes,
    });
  }
}
