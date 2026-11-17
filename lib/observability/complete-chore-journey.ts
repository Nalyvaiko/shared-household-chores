import { metrics, type Counter, type Histogram, type Span } from "@opentelemetry/api";

import { logger } from "@/lib/observability/logger";
import { scrubAttributes, type CompletionOutcome } from "@/lib/observability/privacy";
import {
  isNextControlFlow,
  markSpanError,
  SERVICE_NAME,
  setSpanAttributes,
  tracer,
} from "@/lib/observability/telemetry";

// Telemetry for the key journey, "complete a chore": one `chores.complete`
// span per Complete click (lib/chore/complete.ts adds the lock, read, write
// and roll-over child spans), the metrics below, and journey logs that carry
// the span's trace_id. Nothing here records titles, names, emails or user
// and household ids.

type Instruments = {
  completions: Counter;
  duration: Histogram;
  rollovers: Counter;
};

let instruments: Instruments | undefined;

/** Created on first use, after `instrumentation.ts` has installed the provider. */
function getInstruments(): Instruments {
  if (!instruments) {
    const meter = metrics.getMeter(SERVICE_NAME);
    instruments = {
      completions: meter.createCounter("chores.completions", {
        description: "Complete attempts, by outcome",
        unit: "{attempt}",
      }),
      duration: meter.createHistogram("chores.complete.duration", {
        description: "Time to answer a Complete attempt, by outcome",
        unit: "ms",
        advice: { explicitBucketBoundaries: [5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000] },
      }),
      rollovers: meter.createCounter("chores.rollovers", {
        description: "Next occurrences created by completing a recurring chore",
        unit: "{chore}",
      }),
    };
  }
  return instruments;
}

/** The outcome of an attempt, as the action sees it. */
export type JourneyOutcome =
  | { kind: Exclude<CompletionOutcome, "completed" | "error"> }
  | { kind: "completed"; chore: { recurrence: string } };

export type CompleteChoreJourney = {
  /** The posted chore id is known (null when it cannot be a chore's). */
  attempted(choreId: string | null): void;
  /** Records the outcome on the span, the metrics and the log. */
  finished(outcome: JourneyOutcome): void;
};

/**
 * Runs the Complete action inside the `chores.complete` span. A thrown error
 * (other than a Next.js redirect) is recorded as outcome `error` and rethrown.
 */
export function traceCompleteChore<T>(
  action: (journey: CompleteChoreJourney) => Promise<T>,
): Promise<T> {
  return tracer().startActiveSpan("chores.complete", async (span: Span) => {
    const started = performance.now();
    let done = false;

    function record(outcome: CompletionOutcome, recurrence?: string) {
      done = true;
      const rolledOver =
        outcome === "completed" && recurrence !== undefined && recurrence !== "none";
      const durationMs = performance.now() - started;
      setSpanAttributes(span, {
        "chore.outcome": outcome,
        "chore.recurrence": recurrence,
        "chore.rolled_over": rolledOver,
      });
      const { completions, duration, rollovers } = getInstruments();
      completions.add(1, scrubAttributes({ "chore.outcome": outcome }));
      duration.record(durationMs, scrubAttributes({ "chore.outcome": outcome }));

      const fields = {
        "chore.outcome": outcome,
        "chore.recurrence": recurrence,
        duration_ms: Math.round(durationMs),
      };
      if (outcome === "completed") {
        logger.info("chore.complete.succeeded", "Chore completed", fields);
      } else if (outcome === "error") {
        logger.error("chore.complete.failed", "Chore completion failed", fields);
      } else {
        logger.info("chore.complete.refused", "Chore completion refused", fields);
      }
      if (rolledOver) {
        rollovers.add(1, scrubAttributes({ "chore.recurrence": recurrence }));
        logger.info("chore.rollover.created", "Next occurrence created", {
          "chore.recurrence": recurrence,
        });
      }
    }

    const journey: CompleteChoreJourney = {
      attempted(choreId) {
        if (choreId) setSpanAttributes(span, { "chore.id": choreId });
        logger.info("chore.complete.attempted", "Chore completion attempted", {
          "chore.id": choreId ?? undefined,
        });
      },
      finished(outcome) {
        record(outcome.kind, outcome.kind === "completed" ? outcome.chore.recurrence : undefined);
      },
    };

    try {
      return await action(journey);
    } catch (error) {
      if (!isNextControlFlow(error)) {
        markSpanError(span, error);
        if (!done) record("error");
      }
      throw error;
    } finally {
      span.end();
    }
  });
}
