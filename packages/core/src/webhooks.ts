import { Effect, Redacted, Schema } from "effect";
import { CliError } from "effect/cli";
import { Mac } from "effect/crypto";
import { Hex } from "effect/encoding";
import type { HttpApiClient } from "effect/http-api";
import { HttpApiEndpoint, HttpApiGroup } from "effect/http-api";
import { dataEnvelope, MerchantSecret, toSafepayError } from "./http.ts";

export class InvalidSignature extends Schema.TaggedError<InvalidSignature>()("InvalidSignature", {
  message: Schema.String,
}) {
  override get [CliError.userMessage]() {
    return this.message;
  }
}

export const WebhookEvent = Schema.Literals([
  "payment.succeeded",
  "payment.failed",
  "payment.refunded",
  "authorization.reversed",
  "void.succeeded",
  "subscription.created",
  "subscription.canceled",
  "subscription.ended",
  "subscription.paused",
  "subscription.resumed",
  "subscription.payment.succeeded",
]);
export type WebhookEvent = typeof WebhookEvent.Type;

export const signatureHeader = "X-SFPY-SIGNATURE";

const keyFor = (secret: Redacted.Redacted<string>) =>
  Mac.key(Mac.hmacSha512, new TextEncoder().encode(Redacted.value(secret)));

export const sign = Effect.fn("Webhook.sign")(function* (options: {
  readonly secret: Redacted.Redacted<string>;
  readonly payload: Uint8Array;
}) {
  const mac = yield* Mac.Mac;
  return Hex.encode(yield* mac.sign(yield* keyFor(options.secret), options.payload));
});

export const verify = Effect.fn("Webhook.verify")(function* (options: {
  readonly secret: Redacted.Redacted<string>;
  readonly signature: string;
  readonly payload: Uint8Array;
}) {
  const mac = yield* Mac.Mac;
  const tag = yield* Effect.fromResult(Hex.decode(options.signature.trim())).pipe(
    Effect.mapError(() => new InvalidSignature({ message: "Signature is not a hex digest" })),
  );
  if (!(yield* mac.verify(yield* keyFor(options.secret), tag, options.payload))) {
    return yield* new InvalidSignature({ message: "Signature does not match the payload" });
  }
});

export class WebhooksApi extends HttpApiGroup.make("webhooks")
  .add(
    HttpApiEndpoint.post("test", "/client/hooks/v2/test", {
      payload: Schema.Struct({
        event: WebhookEvent,
        identifier: Schema.optionalKey(Schema.String),
      }),
      success: dataEnvelope(Schema.Struct({ is_success: Schema.Boolean })),
    }),
  )
  .middleware(MerchantSecret) {}

export const make = (client: HttpApiClient.Client.Group<typeof WebhooksApi, never, never>) => ({
  test: Effect.fn("Safepay.webhooks.test")(function* (event: WebhookEvent) {
    const { is_success } = yield* client.test({ payload: { event } });
    return is_success;
  }, toSafepayError),
});

export type Webhooks = ReturnType<typeof make>;
