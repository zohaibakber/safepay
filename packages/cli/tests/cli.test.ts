import { assert, describe, it } from "@effect/vitest";
import { ConfigProvider, Console, Effect, FileSystem, Layer, Path, Stdio, Terminal } from "effect";
import { Command } from "effect/cli";
import { HttpClient, HttpClientResponse } from "effect/http";
import { ChildProcessSpawner } from "effect/process";
import packageJson from "../package.json" with { type: "json" };
import { cli } from "../src/cli.ts";

interface Sent {
  readonly method: string;
  readonly url: URL;
  readonly body: unknown;
}

const runAgainstFakeSafepay = (args: ReadonlyArray<string>, reply: unknown = {}) => {
  const sent: Array<Sent> = [];
  const printed: Array<string> = [];
  const http = HttpClient.make((request, url) =>
    Effect.sync(() => {
      sent.push({
        method: request.method,
        url,
        body:
          request.body._tag === "Uint8Array"
            ? JSON.parse(new TextDecoder().decode(request.body.body))
            : undefined,
      });
      return HttpClientResponse.fromWeb(request, Response.json(reply));
    }),
  );
  return Command.runWith(cli, { version: packageJson.version })(args).pipe(
    Effect.exit,
    Effect.map((exit) => ({ exit, sent, printed })),
    Effect.provideService(Console.Console, {
      ...globalThis.console,
      log: (...line: ReadonlyArray<unknown>) => {
        printed.push(line.join(" "));
      },
    }),
    Effect.provide(
      Layer.mergeAll(
        FileSystem.layerNoop({}),
        Path.layer,
        Stdio.layerTest({}),
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
        Layer.succeed(
          ChildProcessSpawner.ChildProcessSpawner,
          ChildProcessSpawner.make(() => Effect.die("unused")),
        ),
        Layer.succeed(HttpClient.HttpClient, http),
        ConfigProvider.layer(
          ConfigProvider.fromUnknown({ SAFEPAY_API_KEY: "sec_api", SAFEPAY_SECRET_KEY: "secret" }),
        ),
      ),
    ),
  );
};

describe("sfpy", () => {
  it.effect("without a subcommand asks for help", () =>
    Effect.gen(function* () {
      const { exit } = yield* runAgainstFakeSafepay([]);
      assert.isTrue(exit._tag === "Failure" && JSON.stringify(exit.cause).includes("ShowHelp"));
    }),
  );

  it.effect("payments list turns flags into reporter filters and prints the domain JSON", () =>
    Effect.gen(function* () {
      const { exit, sent, printed } = yield* runAgainstFakeSafepay(
        ["--json", "payments", "list", "--state", "partial-refund", "--email", "ali@example.com"],
        { data: { count: 0, list: null } },
      );

      assert.strictEqual(exit._tag, "Success");
      assert.deepStrictEqual(Object.fromEntries(sent[0]?.url.searchParams ?? []), {
        page: "1",
        limit: "20",
        direction: "DESC",
        "states[0]": "TRACKER_PARTIAL_REFUND",
        customer_email: "ali@example.com",
      });
      assert.deepStrictEqual(JSON.parse(printed.join("\n")), { count: 0, payments: [] });
    }),
  );

  it.effect("customers update sends only the flags given", () =>
    Effect.gen(function* () {
      const { sent } = yield* runAgainstFakeSafepay([
        "customers",
        "update",
        "cus_1",
        "--phone",
        "+923001234567",
      ]);

      assert.deepStrictEqual(
        sent.map(({ method, url, body }) => ({ method, path: url.pathname, body })),
        [
          {
            method: "PUT",
            path: "/user/customers/v1/cus_1",
            body: { phone_number: "+923001234567" },
          },
        ],
      );
    }),
  );

  it.effect("plans create rejects --every 0 before calling Safepay", () =>
    Effect.gen(function* () {
      const { exit, sent } = yield* runAgainstFakeSafepay([
        "plans",
        "create",
        "--name",
        "Pro",
        "--product",
        "Pro tier",
        "--amount",
        "250000",
        "--every",
        "0",
      ]);

      assert.strictEqual(exit._tag, "Failure");
      assert.deepStrictEqual(sent, []);
    }),
  );
});
