import { trace, metrics, context, propagation, SpanStatusCode, type AttributeValue } from "@opentelemetry/api";
import type { ToolCallOutcome } from "./types.js";
import { Resource } from "@opentelemetry/resources";
import { SemanticResourceAttributes } from "@opentelemetry/semantic-conventions";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { OTLPMetricExporter } from "@opentelemetry/exporter-metrics-otlp-http";
import {
  MeterProvider,
  PeriodicExportingMetricReader,
} from "@opentelemetry/sdk-metrics";
import {
  BatchSpanProcessor,
  NodeTracerProvider,
} from "@opentelemetry/sdk-trace-node";

export interface TelemetryOptions {
  endpoint?: string;
  serviceName?: string;
  resourceAttributes?: Record<string, string>;
  disabled?: boolean;
}

type Attributes = Record<string, AttributeValue>;

export class Telemetry {
  private tracerProvider: NodeTracerProvider | null = null;
  private meterProvider: MeterProvider | null = null;
  private started = false;
  private toolCallHistogram: ReturnType<
    ReturnType<typeof metrics.getMeter>["createHistogram"]
  > | null = null;
  private toolCallCounter: ReturnType<
    ReturnType<typeof metrics.getMeter>["createCounter"]
  > | null = null;

  async start(options: TelemetryOptions): Promise<void> {
    if (this.started) return;
    if (options.disabled) return;
    if (!options.endpoint) return;

    const resource = new Resource({
      [SemanticResourceAttributes.SERVICE_NAME]: options.serviceName ?? "journal-gateway",
      ...options.resourceAttributes,
    });

    const traceExporter = new OTLPTraceExporter({ url: options.endpoint + "/v1/traces" });
    const metricExporter = new OTLPMetricExporter({ url: options.endpoint + "/v1/metrics" });

    this.tracerProvider = new NodeTracerProvider({ resource });
    this.tracerProvider.addSpanProcessor(new BatchSpanProcessor(traceExporter));
    this.tracerProvider.register();

    this.meterProvider = new MeterProvider({ resource });
    this.meterProvider.addMetricReader(
      new PeriodicExportingMetricReader({ exporter: metricExporter })
    );
    metrics.setGlobalMeterProvider(this.meterProvider);

    const meter = metrics.getMeter("gateway");
    this.toolCallHistogram = meter.createHistogram("gateway.tool_call.duration", {
      description: "Tool call duration in milliseconds",
      unit: "ms",
    });
    this.toolCallCounter = meter.createCounter("gateway.tool_call.count", {
      description: "Count of tool calls by outcome",
    });
    this.started = true;
  }

  async shutdown(): Promise<void> {
    if (!this.started) return;
    await this.tracerProvider?.shutdown().catch(() => {});
    await this.meterProvider?.shutdown().catch(() => {});
    this.started = false;
  }

  startActiveSpan<T>(
    name: string,
    attrs: Attributes,
    fn: (span: import("@opentelemetry/api").Span) => Promise<T>,
    traceparent?: string,
    tracestate?: string,
  ): Promise<T> {
    const tracer = trace.getTracer("gateway");

    // Use remote parent context when a W3C traceparent is provided,
    // otherwise fall back to the current active context.
    let parentCtx = context.active();
    if (traceparent) {
      const carrier: Record<string, string> = { traceparent };
      if (tracestate) carrier.tracestate = tracestate;
      parentCtx = propagation.extract(parentCtx, carrier);
    }

    return new Promise<T>((resolve, reject) => {
      tracer.startActiveSpan(
        name,
        { attributes: attrs },
        parentCtx,
        async (span) => {
          try {
            const result = await fn(span);
            span.end();
            resolve(result);
          } catch (err) {
            span.recordException(err as Error);
            span.setStatus({ code: SpanStatusCode.ERROR });
            span.end();
            reject(err);
          }
        }
      );
    });
  }

  /**
   * Trace a tool call, setting span attributes based on the outcome.
   * Keeps all OpenTelemetry span manipulation inside this class so
   * callers never need to import OTel types.
   */
  async traceToolCall(
    attrs: { integrationId: string; toolName: string; requestId: string },
    fn: () => Promise<ToolCallOutcome>,
    traceparent?: string,
    tracestate?: string,
  ): Promise<ToolCallOutcome> {
    return this.startActiveSpan(
      "gateway.tool_call",
      attrs,
      async (span) => {
        const outcome = await fn();
        switch (outcome.kind) {
          case "success":
            span.setAttribute("gateway.tool_call.is_error", false);
            break;
          case "tool_error":
            span.setStatus({ code: SpanStatusCode.ERROR, message: "Tool returned error" });
            span.setAttribute("gateway.tool_call.is_error", true);
            span.setAttribute("gateway.tool_call.error_message", outcome.error);
            break;
          case "exception":
            span.setStatus({ code: SpanStatusCode.ERROR, message: outcome.error });
            span.setAttribute("gateway.tool_call.is_error", true);
            span.setAttribute("gateway.tool_call.error_code", outcome.code);
            span.setAttribute("gateway.tool_call.error_message", outcome.error);
            break;
        }
        return outcome;
      },
      traceparent,
      tracestate,
    );
  }

  recordToolCall(durationMs: number, success: boolean, code?: string): void {
    if (!this.toolCallHistogram || !this.toolCallCounter) return;
    this.toolCallHistogram.record(durationMs, {
      success,
      ...(code ? { code } : {}),
    });
    this.toolCallCounter.add(1, {
      success,
      ...(code ? { code } : {}),
    });
  }

  isEnabled(): boolean {
    return this.started;
  }
}
