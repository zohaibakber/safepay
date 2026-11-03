import { Console, Effect, Option, Schema } from "effect";
import { Argument, Command, Flag } from "effect/cli";
import { Safepay } from "@sfpy-cli/core/client";
import { SafepayFromFlags } from "./root.ts";

export const api = Command.make(
  "api",
  {
    method: Argument.Literals("method", ["GET", "POST", "PUT", "PATCH", "DELETE"]).pipe(
      Argument.withDescription("HTTP method"),
    ),
    path: Argument.String("path").pipe(
      Argument.withDescription("Path on the Safepay API, e.g. /client/plans/v1/search"),
    ),
    data: Flag.String("data").pipe(
      Flag.withAlias("d"),
      Flag.withSchema(Schema.fromJsonString(Schema.Unknown)),
      Flag.withDescription("JSON request body"),
      Flag.optional,
    ),
  },
  Effect.fn(function* ({ method, path, data }) {
    const safepay = yield* Safepay;
    const body = yield* safepay.request(method, path, Option.getOrUndefined(data));
    yield* Console.log(typeof body === "string" ? body : JSON.stringify(body, null, 2));
  }),
).pipe(
  Command.withDescription("Call any Safepay endpoint with your secret key"),
  Command.withExamples([
    {
      command: "sfpy api GET '/client/plans/v1/search?limit=5'",
      description: "Anything without its own command",
    },
  ]),
  Command.provide(SafepayFromFlags),
);
