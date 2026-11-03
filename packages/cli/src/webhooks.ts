import { Config, Console, Effect, FileSystem, Layer, Option, Schema, Stdio, Stream } from "effect";
import { Command, Flag } from "effect/cli";
import { Mac, SecureRandom } from "effect/crypto";
import { HttpClient, HttpClientRequest } from "effect/http";
import { Safepay } from "@sfpy-cli/core/client";
import * as Webhook from "@sfpy-cli/core/webhooks";
import { SafepayFromFlags } from "./root.ts";

const MacLive = Mac.layerWebCrypto.pipe(Layer.provide(SecureRandom.layerWebCrypto));

const secret = Flag.Redacted("secret").pipe(
  Flag.withDescription("Webhook secret. Falls back to SAFEPAY_WEBHOOK_SECRET"),
  Flag.withFallbackConfig(Config.Redacted("SAFEPAY_WEBHOOK_SECRET")),
);

const event = Flag.Literals("event", Webhook.WebhookEvent.literals).pipe(
  Flag.withDescription("Event type"),
  Flag.withDefault("payment.succeeded"),
);

const readStdin = Effect.flatMap(Stdio.Stdio, (stdio) => Stream.mkUint8Array(stdio.stdin));

const verify = Command.make(
  "verify",
  {
    secret,
    signature: Flag.String("signature").pipe(Flag.withDescription("The X-SFPY-SIGNATURE header")),
    payload: Flag.File("payload", { mustExist: true }).pipe(
      Flag.withDescription("File holding the raw request body. Reads stdin when omitted"),
      Flag.optional,
    ),
  },
  Effect.fn(function* ({ secret, signature, payload }) {
    const fs = yield* FileSystem.FileSystem;
    const bytes = yield* Option.match(payload, { onNone: () => readStdin, onSome: fs.readFile });
    yield* Webhook.verify({ secret, signature, payload: bytes });
    yield* Console.log("Signature is valid");
  }),
).pipe(
  Command.withDescription("Check that a webhook body was signed by Safepay"),
  Command.withExamples([
    {
      command: "sfpy webhooks verify --signature $SIG --payload body.json",
      description: "Verify a captured delivery",
    },
  ]),
  Command.provide(MacLive),
);

const send = Command.make(
  "send",
  {
    secret,
    event,
    to: Flag.String("to").pipe(
      Flag.withSchema(Schema.URLFromString),
      Flag.withDescription("Your webhook handler, e.g. http://localhost:3000/webhooks/safepay"),
    ),
    data: Flag.FileParse("data").pipe(
      Flag.withDescription("JSON file to send as the event's data. Defaults to {}"),
      Flag.withDefault({}),
    ),
  },
  Effect.fn(function* ({ secret, event, to, data }) {
    const body = new TextEncoder().encode(
      JSON.stringify({
        token: `evt_${crypto.randomUUID()}`,
        type: event,
        created_at: Math.floor(Date.now() / 1000),
        data,
      }),
    );
    const signature = yield* Webhook.sign({ secret, payload: body });
    const response = yield* HttpClient.execute(
      HttpClientRequest.post(to).pipe(
        HttpClientRequest.setHeader(Webhook.signatureHeader, signature),
        HttpClientRequest.bodyUint8Array(body, "application/json"),
      ),
    );
    yield* Console.log(`${event} -> ${to.href}  ${response.status}`);
  }),
).pipe(
  Command.withDescription("Sign a fake event and post it to your local webhook handler"),
  Command.withExamples([
    {
      command: "sfpy webhooks send --event payment.succeeded --to http://localhost:3000/hook",
      description: "Exercise your handler, signature check included",
    },
  ]),
  Command.provide(MacLive),
);

const test = Command.make(
  "test",
  { event },
  Effect.fn(function* ({ event }) {
    const safepay = yield* Safepay;
    const delivered = yield* safepay.webhooks.test(event);
    yield* Console.log(
      delivered
        ? `Safepay sent a test ${event} to the endpoints in your dashboard`
        : `Safepay did not send the test ${event}`,
    );
  }),
).pipe(
  Command.withDescription("Ask Safepay to deliver a test event to your dashboard endpoints"),
  Command.provide(SafepayFromFlags),
);

export const webhooks = Command.make("webhooks").pipe(
  Command.withDescription("Verify, send, and trigger webhook deliveries"),
  Command.withSubcommands([verify, send, test]),
);
