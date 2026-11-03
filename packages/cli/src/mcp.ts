import { Effect, Layer, Logger } from "effect";
import { Command, Flag } from "effect/cli";
import * as Mcp from "@sfpy-cli/mcp/server";
import { SafepayFromFlags } from "./root.ts";

export const mcp = Command.make(
  "mcp",
  {
    allowWrites: Flag.Boolean("allow-writes").pipe(
      Flag.withDescription("Expose tools that refund, void, reverse, or cancel. These move money"),
      Flag.withDefault(false),
    ),
  },
  ({ allowWrites }) =>
    Layer.launch(Mcp.layerStdio({ allowWrites })).pipe(
      Effect.provideService(Logger.LogToStderr, true),
    ),
).pipe(
  Command.withDescription("Run a Model Context Protocol server over stdio"),
  Command.withExamples([
    {
      command: "claude mcp add safepay -- sfpy mcp",
      description: "Add the read-only server to Claude Code",
    },
  ]),
  Command.provide(SafepayFromFlags),
);
