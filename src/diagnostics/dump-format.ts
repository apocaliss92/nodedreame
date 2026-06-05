import { z } from 'zod';

/**
 * The SHARED diagnostic-dump format (spec §7). `nodedreame` and `nodewitt` fill
 * the SAME shape so dumps are diffable. {@link DeviceDump} is the public output
 * type; {@link DeviceDumpSchema} validates a built dump before export.
 *
 * `library` is a union for the shared format; this library always emits
 * `'nodedreame'`. The schema is the single source of truth — {@link DeviceDump}
 * is `z.infer` of it, so the runtime validator and the public type never drift.
 */

/** A raw MIoT property value as it appears in a dump (always JSON-scalar). */
export type DumpScalar = string | number | boolean;

const DumpScalarSchema = z.union([z.string(), z.number(), z.boolean()]);

const PropertyObservationSchema = z.object({
  values: z.array(DumpScalarSchema),
  unmapped: z.array(DumpScalarSchema),
  enum: z.string().optional(),
  count: z.number(),
  firstSeen: z.number(),
  lastSeen: z.number(),
});

const EventObservationSchema = z.object({
  at: z.number(),
  type: z.string(),
  data: z.unknown().optional(),
});

const RawFrameSchema = z.object({
  at: z.number(),
  source: z.string(),
  payload: z.unknown(),
});

const CommandSchema = z.object({
  name: z.string(),
  siid: z.number().optional(),
  aiid: z.number().optional(),
});

const SensorSchema = z.object({
  model: z.string(),
  channel: z.number().optional(),
});

export const DeviceDumpSchema = z.object({
  schemaVersion: z.literal(1),
  library: z.union([z.literal('nodedreame'), z.literal('nodewitt')]),
  libraryVersion: z.string(),
  device: z.object({
    model: z.string(),
    firmware: z.string().optional(),
    region: z.string().optional(),
    type: z.string().optional(),
  }),
  observations: z.object({
    properties: z.record(z.string(), PropertyObservationSchema),
    events: z.array(EventObservationSchema),
    rawFrames: z.array(RawFrameSchema).optional(),
  }),
  catalog: z.object({
    commands: z.array(CommandSchema).optional(),
    capabilities: z.record(z.string(), z.unknown()).optional(),
    sensors: z.array(SensorSchema).optional(),
  }),
  meta: z.object({
    startedAt: z.number(),
    durationMs: z.number(),
    generatedAt: z.number(),
  }),
});

/** Public shared dump type — inferred from the schema so the two never drift. */
export type DeviceDump = z.infer<typeof DeviceDumpSchema>;
