import { createHmac } from "node:crypto";
import { assert, layer } from "@effect/vitest";
import { Effect, Layer, Redacted } from "effect";
import { Mac, SecureRandom } from "effect/crypto";
import { sign, verify } from "../src/webhooks.ts";

const secret = Redacted.make("whsec_test");
const payload = new TextEncoder().encode(
  '{"type":"payment.succeeded","data":{"tracker":"track_1"}}',
);
const signature = createHmac("sha512", "whsec_test").update(payload).digest("hex");

layer(Mac.layerWebCrypto.pipe(Layer.provide(SecureRandom.layerWebCrypto)))("verify", (it) => {
  it.effect("signs with the same HMAC-SHA512 hex digest Safepay sends", () =>
    Effect.gen(function* () {
      assert.strictEqual(yield* sign({ secret, payload }), signature);
    }),
  );

  it.effect("accepts the HMAC-SHA512 hex digest of the raw body", () =>
    verify({ secret, signature, payload }),
  );

  it.effect.each([
    [
      "a tampered body",
      signature,
      new TextEncoder().encode('{"type":"payment.succeeded"}'),
      "does not match",
    ],
    [
      "a different secret's digest",
      createHmac("sha512", "other").update(payload).digest("hex"),
      payload,
      "does not match",
    ],
    ["a non-hex signature", "not-hex!", payload, "not a hex digest"],
  ] as const)("rejects %s", ([, signature, body, message]) =>
    Effect.gen(function* () {
      const error = yield* Effect.flip(verify({ secret, signature, payload: body }));
      assert.include(error.message, message);
    }),
  );
});
