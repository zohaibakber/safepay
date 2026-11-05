import { assert, describe, it } from "@effect/vitest";
import { Console, Effect, FileSystem, Layer, Path, Stdio, Terminal } from "effect";
import { Command } from "effect/cli";
import { HttpClient } from "effect/http";
import { ChildProcessSpawner } from "effect/process";
import packageJson from "../package.json" with { type: "json" };
import { cli } from "../src/cli.ts";

describe("sfpy-mcp", () => {
  it.effect("help names the binary and the writes flag", () =>
    Effect.gen(function* () {
      const printed: Array<string> = [];
      const exit = yield* Command.runWith(cli, { version: packageJson.version })(["--help"]).pipe(
        Effect.exit,
        Effect.provideService(Console.Console, {
          ...globalThis.console,
          log: (...line: ReadonlyArray<unknown>) => {
            printed.push(line.join(" "));
          },
        }),
      );
      const help = printed.join("\n");
      assert.strictEqual(exit._tag, "Success");
      assert.isTrue(help.includes("sfpy-mcp"));
      assert.isTrue(help.includes("--allow-writes"));
    }).pipe(
      Effect.provide(
        Layer.mergeAll(
          FileSystem.layerNoop({}),
          Path.layer,
          Stdio.layerTest({}),
          Layer.succeed(
            ChildProcessSpawner.ChildProcessSpawner,
            ChildProcessSpawner.make(() => Effect.die("unused")),
          ),
          Layer.succeed(
            HttpClient.HttpClient,
            HttpClient.make(() => Effect.die("unused")),
          ),
          Layer.succeed(
            Terminal.Terminal,
            Terminal.make({
              columns: Effect.succeed(80),
              rows: Effect.succeed(24),
              size: Effect.die("unused"),
              readInput: Effect.die("unused"),
              readLine: Effect.die("unused"),
              display: () => Effect.void,
            }),
          ),
        ),
      ),
    ),
  );
});
