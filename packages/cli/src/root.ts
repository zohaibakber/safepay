import { Config, Effect, Layer } from "effect";
import { Command, Flag } from "effect/cli";
import { Environment } from "@sfpy-cli/core/environment";
import { Safepay } from "@sfpy-cli/core/client";

export const root = Command.make("sfpy").pipe(
  Command.withSharedFlags({
    environment: Flag.Literals("env", Environment.literals).pipe(
      Flag.withDescription("Safepay environment. Falls back to SAFEPAY_ENVIRONMENT, then sandbox"),
      Flag.withFallbackConfig(Config.schema(Environment, "SAFEPAY_ENVIRONMENT")),
      Flag.withDefault("sandbox"),
    ),
    json: Flag.Boolean("json").pipe(
      Flag.withDescription("Print JSON instead of text"),
      Flag.withDefault(false),
    ),
  }),
  Command.withDescription("Safepay payments from the terminal"),
);

export const SafepayFromFlags = Layer.unwrap(
  Effect.map(root, ({ environment }) => Safepay.layerNoDeps(environment)),
);
