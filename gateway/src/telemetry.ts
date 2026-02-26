import { trace, metrics, context } from "@opentelemetry/api";
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
}

type Attributes = Record<string, string | number | boolean | null | undefined>;

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
  private toolCallCounter = metrics.getMeter("gateway").createCounter("gateway.tool_call.count", {
    description: "Count of tool calls by outcome",
  });

  async start(options: TelemetryOptions): Promise<void> {
    if (this.started) return;
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
