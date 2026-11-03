import {
  DateTime,
  Effect,
  Option,
  Predicate,
  Schema,
  SchemaGetter,
  SchemaTransformation,
} from "effect";
import type { HttpBody, HttpClientError } from "effect/http";
import { HttpApiMiddleware, HttpApiSecurity } from "effect/http-api";
import {
  NotFound,
  RequestRejected,
  SafepayError,
  type SafepayErrorReason,
  ServerFailure,
  Unauthorized,
  Unexpected,
} from "./error.ts";

export const wireCodec = <Wire extends Schema.Top, Domain extends Schema.Top>(
  wire: Wire,
  domain: Domain,
  transformation: {
    readonly decode: (wire: Wire["Type"]) => Domain["Encoded"];
    readonly encode: (domain: Domain["Encoded"]) => Wire["Type"];
  },
) =>
  wire.pipe(
    Schema.decodeTo(Schema.toEncoded(domain), SchemaTransformation.transform(transformation)),
  );

export const dataEnvelope = <A, I, RD, RE>(data: Schema.Codec<A, I, RD, RE>) =>
  Schema.Struct({ data }).pipe(
    Schema.decodeTo(
      Schema.toType(data),
      SchemaTransformation.transform({
        decode: (envelope) => envelope.data,
        encode: (data) => ({ data }),
      }),
    ),
  );

export const Seconds = Schema.Struct({ seconds: Schema.Number }).pipe(
  Schema.decodeTo(
    Schema.String,
    SchemaTransformation.transform({
      decode: ({ seconds }) => DateTime.formatIso(DateTime.fromEpochSeconds(seconds)),
      encode: (iso) => ({ seconds: DateTime.toEpochSeconds(DateTime.makeUnsafe(iso)) }),
    }),
  ),
);

// An input field the caller may leave undefined. HttpApi encodes undefined as
// null, which Safepay reads as a value, so encoding drops the key instead.
export const omittable = <S extends Schema.Top>(schema: S) =>
  Schema.optionalKey(schema).pipe(
    Schema.decodeTo(Schema.optional(Schema.toType(schema)), {
      decode: SchemaGetter.passthrough(),
      encode: SchemaGetter.transformOptional(Option.filter(Predicate.isNotUndefined)),
    }),
  );

export const listOrNull = <S extends Schema.Top>(item: S) =>
  Schema.NullOr(Schema.Array(item)).pipe(
    Schema.decodeTo(
      Schema.Array(Schema.toType(item)),
      SchemaTransformation.transform({
        decode: (list) => list ?? [],
        encode: (list) => list,
      }),
    ),
  );

// Billing endpoints send counts as strings, the rest as numbers.
export const Count = Schema.Union([Schema.Number, Schema.NumberFromString]);

export const PageRequest = Schema.Struct({
  page: Schema.Int.pipe(Schema.check(Schema.isGreaterThan(0))),
  limit: Schema.Int.pipe(Schema.check(Schema.isBetween({ minimum: 1, maximum: 30 }))),
});
export type PageRequest = typeof PageRequest.Type;

const ErrorBody = Schema.Union([
  Schema.Struct({ status: Schema.Struct({ errors: Schema.Array(Schema.String) }) }),
  Schema.Struct({ message: Schema.String }),
  Schema.Struct({ error: Schema.String }),
]);

const messageOf = (body: typeof ErrorBody.Type) =>
  "status" in body ? body.status.errors.join("; ") : "message" in body ? body.message : body.error;

const reasonFor = (status: number, body: unknown): SafepayErrorReason => {
  const message = Option.match(Schema.decodeUnknownOption(ErrorBody)(body), {
    onNone: () => `HTTP ${status}`,
    onSome: messageOf,
  });
  if (status === 401 || status === 403) return new Unauthorized({ message });
  if (status === 404) return new NotFound({ message });
  if (status >= 500) return new ServerFailure({ message });
  return new RequestRejected({ message });
};

const failedWith = (error: HttpClientError.HttpClientError) => {
  const response = error.response;
  if (response === undefined || response.status < 400) {
    return Effect.fail(new Unexpected({ message: error.message, cause: error }));
  }
  return response.json.pipe(
    Effect.orElseSucceed(() => undefined),
    Effect.flatMap((body) => Effect.fail(reasonFor(response.status, body))),
  );
};

export class MerchantSecret extends HttpApiMiddleware.Service<MerchantSecret>()(
  "sfpy/SafepayApi/MerchantSecret",
  {
    requiredForClient: true,
    security: {
      secret: HttpApiSecurity.apiKey({ key: "X-SFPY-MERCHANT-SECRET", in: "header" }),
    },
  },
) {}

export const toSafepayError = <A, R>(
  effect: Effect.Effect<
    A,
    HttpClientError.HttpClientError | HttpBody.HttpBodyError | Schema.SchemaError,
    R
  >,
) =>
  effect.pipe(
    Effect.catchTag("HttpClientError", failedWith),
    Effect.catchTag(["HttpBodyError", "SchemaError"], (cause) =>
      Effect.fail(new Unexpected({ message: cause.message, cause })),
    ),
    Effect.mapError((reason) => new SafepayError({ reason })),
  );
