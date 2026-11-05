import { Config, Effect, Layer, Logger } from "effect";
import { Command, Flag } from "effect/cli";
import { Safepay } from "@sfpy-cli/core/client";
import { Environment } from "@sfpy-cli/core/environment";
import * as Mcp from "./server.ts";

export const cli = Command.make(
  "sfpy-mcp",
  {
    environment: Flag.Literals("env", Environment.literals).pipe(
      Flag.withDescription("Safepay environment. Falls back to SAFEPAY_ENVIRONMENT, then sandbox"),
      Flag.withFallbackConfig(Config.schema(Environment, "SAFEPAY_ENVIRONMENT")),
      Flag.withDefault("sandbox"),
    ),
    allowWrites: Flag.Boolean("allow-writes").pipe(
      Flag.withDescription("Expose tools that refund, void, reverse, or cancel. These move money"),
      Flag.withDefault(false),
    ),
  },
  ({ allowWrites, environment }) =>
    Layer.launch(Mcp.layerStdio({ allowWrites })).pipe(
      Effect.provide(Safepay.layerNoDeps(environment)),
      Effect.provideService(Logger.LogToStderr, true),
    ),
).pipe(
  Command.withDescription("Safepay MCP server over stdio"),
  Command.withExamples([
    {
      command: "claude mcp add safepay -- sfpy-mcp",
      description: "Add the read-only server to Claude Code",
    },
    {
      command: "claude mcp add safepay -- sfpy-mcp --allow-writes",
      description: "Also expose refund, void, reverse, and cancel",
    },
  ]),
);
