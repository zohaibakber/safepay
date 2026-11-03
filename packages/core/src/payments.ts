import { DateTime, Effect, Redacted, Schema } from "effect";
import type { HttpApiClient } from "effect/http-api";
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema } from "effect/http-api";
import { checkoutUrl, Environment } from "./environment.ts";
import {
  dataEnvelope,
  listOrNull,
  MerchantSecret,
  omittable,
  PageRequest,
  wireCodec,
  Seconds,
  toSafepayError,
} from "./http.ts";

export const TrackerToken = Schema.String.pipe(
  Schema.check(Schema.isStartingWith("track_")),
  Schema.brand("TrackerToken"),
);
export type TrackerToken = typeof TrackerToken.Type;

export const PayerToken = Schema.String.pipe(
  Schema.check(
    Schema.isPattern(/^(cus|guest)_/, { message: "Expected a cus_ or guest_ customer token" }),
  ),
  Schema.brand("PayerToken"),
);
export type PayerToken = typeof PayerToken.Type;

export const AuthorizationToken = Schema.String.pipe(
  Schema.check(Schema.isStartingWith("auth_")),
  Schema.brand("AuthorizationToken"),
);
export type AuthorizationToken = typeof AuthorizationToken.Type;

export const Currency = Schema.String.pipe(
  Schema.check(Schema.isPattern(/^[A-Z]{3}$/, { message: "Expected an ISO 4217 code like PKR" })),
  Schema.brand("Currency"),
);
export type Currency = typeof Currency.Type;

export const MinorUnits = Schema.Int.pipe(
  Schema.check(Schema.isGreaterThan(0)),
  Schema.brand("MinorUnits"),
);
export type MinorUnits = typeof MinorUnits.Type;

export class Money extends Schema.Class<Money>("sfpy/Payment/Money")({
  currency: Currency,
  amount: MinorUnits,
}) {}

export const TrackerState = Schema.Literals([
  "TRACKER_STARTED",
  "TRACKER_AUTHORIZED",
  "TRACKER_ENROLLED",
  "TRACKER_ENDED",
  "TRACKER_CANCELLED",
  "TRACKER_EXPIRED",
  "TRACKER_REFUNDED",
  "TRACKER_PARTIAL_REFUND",
  "TRACKER_DISPUTED",
  "TRACKER_REVERSED",
  "TRACKER_VOIDED",
]);
export type TrackerState = typeof TrackerState.Type;

export const VoidKind = Schema.Literals(["VOID_CAPTURE", "VOID_PAYMENT", "VOID_REFUND"]);
export type VoidKind = typeof VoidKind.Type;

export const Metadata = Schema.Record(Schema.String, Schema.Unknown);

export class Tracker extends Schema.Class<Tracker>("sfpy/Payment/Tracker")({
  token: TrackerToken,
  state: TrackerState,
  mode: Schema.String,
  intent: Schema.String,
  environment: Environment,
  customer: Schema.optional(PayerToken),
  amount: Money,
  metadata: Schema.optional(Metadata),
}) {}

export class Checkout extends Schema.Class<Checkout>("sfpy/Payment/Checkout")({
  tracker: Tracker,
  url: Schema.URLFromString,
}) {}

export class PaymentSummary extends Schema.Class<PaymentSummary>("sfpy/Payment/PaymentSummary")({
  token: TrackerToken,
  state: TrackerState,
  mode: Schema.String,
  currency: Currency,
  displayAmount: Schema.String,
  createdAt: Schema.DateTimeUtcFromString,
  customerEmail: Schema.optional(Schema.String),
}) {}

export class PaymentPage extends Schema.Class<PaymentPage>("sfpy/Payment/PaymentPage")({
  count: Schema.Int,
  payments: Schema.Array(PaymentSummary),
}) {}

export const PaymentSearch = Schema.Struct({
  ...PageRequest.fields,
  states: Schema.optional(Schema.Array(TrackerState)),
  customerEmail: Schema.optional(Schema.String),
  since: Schema.optional(Schema.DateTimeUtcFromString),
  until: Schema.optional(Schema.DateTimeUtcFromString),
});
export type PaymentSearch = typeof PaymentSearch.Type;

export const MetadataUpdate = Schema.Struct({
  orderId: omittable(Schema.String),
  source: omittable(Schema.String),
});
export type MetadataUpdate = typeof MetadataUpdate.Type;

const TrackerWire = wireCodec(
  Schema.Struct({
    token: Schema.String,
    state: TrackerState,
    mode: Schema.String,
    intent: Schema.String,
    environment: Environment,
    customer: Schema.optional(Schema.String),
    purchase_totals: Schema.Struct({
      base_amount: Schema.Struct({ currency: Schema.String, amount: Schema.Number }),
    }),
    metadata: Schema.optional(Metadata),
  }),
  Tracker,
  {
    decode: ({ purchase_totals, ...tracker }) => ({
      ...tracker,
      amount: purchase_totals.base_amount,
    }),
    encode: ({ amount, ...tracker }) => ({ ...tracker, purchase_totals: { base_amount: amount } }),
  },
);

const TrackerResult = dataEnvelope(
  Schema.Struct({ tracker: TrackerWire.pipe(Schema.decodeTo(Tracker)) }),
);

const PaymentSummaryWire = wireCodec(
  Schema.Struct({
    token: Schema.String,
    state: TrackerState,
    mode: Schema.String,
    currency: Schema.String,
    display_amount: Schema.String,
    created_at: Seconds,
    customer: Schema.optional(Schema.Struct({ email: Schema.optional(Schema.String) })),
  }),
  PaymentSummary,
  {
    decode: ({ display_amount, created_at, customer, ...summary }) => ({
      ...summary,
      displayAmount: display_amount,
      createdAt: created_at,
      customerEmail: customer?.email,
    }),
    encode: ({ displayAmount, createdAt, customerEmail, ...summary }) => ({
      ...summary,
      display_amount: displayAmount,
      created_at: createdAt,
      customer: { email: customerEmail },
    }),
  },
);

const PaymentPageWire = Schema.Struct({
  count: Schema.Number,
  payments: listOrNull(PaymentSummaryWire),
}).pipe(Schema.encodeKeys({ payments: "list" }));

const isoToSeconds = (iso: string) => String(DateTime.toEpochSeconds(DateTime.makeUnsafe(iso)));
const secondsToIso = (seconds: string) =>
  DateTime.formatIso(DateTime.fromEpochSeconds(Number(seconds)));

const PaymentSearchQuery = wireCodec(Schema.Record(Schema.String, Schema.String), PaymentSearch, {
  decode: (query) => ({
    page: Number(query["page"]),
    limit: Number(query["limit"]),
    states: Object.entries(query)
      .filter(([key]) => key.startsWith("states["))
      .map(([, state]) => state as TrackerState),
    customerEmail: query["customer_email"],
    since: query["start_at"] === undefined ? undefined : secondsToIso(query["start_at"]),
    until: query["end_at"] === undefined ? undefined : secondsToIso(query["end_at"]),
  }),
  encode: ({ page, limit, states = [], customerEmail, since, until }) =>
    Object.fromEntries(
      [
        ["page", String(page)],
        ["limit", String(limit)],
        ["direction", "DESC"],
        ...states.map((state, index) => [`states[${index}]`, state]),
        ["customer_email", customerEmail],
        ["start_at", since === undefined ? undefined : isoToSeconds(since)],
        ["end_at", until === undefined ? undefined : isoToSeconds(until)],
      ].filter((entry): entry is [string, string] => entry[1] !== undefined),
    ),
}).pipe(Schema.decodeTo(PaymentSearch));

// Paths are absolute because HttpApi prefixes drop trailing slashes.
export class PaymentsApi extends HttpApiGroup.make("payments").add(
  HttpApiEndpoint.post("setup", "/order/payments/v3/", {
    payload: Schema.Struct({
      merchant_api_key: Schema.String,
      intent: Schema.Literal("CYBERSOURCE"),
      mode: Schema.Literal("payment"),
      currency: Currency,
      amount: MinorUnits,
    }),
    success: TrackerResult.pipe(HttpApiSchema.status(201)),
  }),
  HttpApiEndpoint.post("token", "/client/passport/v1/token", {
    success: dataEnvelope(Schema.RedactedFromValue(Schema.String)),
  }).middleware(MerchantSecret),
  HttpApiEndpoint.get("status", "/order/payments/v3/:tracker/status", {
    params: { tracker: TrackerToken },
    success: TrackerResult,
  }).middleware(MerchantSecret),
  HttpApiEndpoint.get("list", "/reporter/api/v2/payments", {
    query: PaymentSearchQuery,
    success: dataEnvelope(PaymentPageWire.pipe(Schema.decodeTo(PaymentPage))),
  }).middleware(MerchantSecret),
  HttpApiEndpoint.post("refund", "/order/payments/v3/:tracker/refund", {
    params: { tracker: TrackerToken },
    payload: Schema.Struct({ currency: Currency, amount: MinorUnits }),
    success: TrackerResult,
  }).middleware(MerchantSecret),
  HttpApiEndpoint.post("void", "/order/payments/v3/:tracker/void", {
    params: { tracker: TrackerToken },
    payload: Schema.Struct({ kind: VoidKind }),
    success: TrackerResult,
  }).middleware(MerchantSecret),
  HttpApiEndpoint.post("reverse", "/order/payments/v3/:tracker/reversal", {
    params: { tracker: TrackerToken },
    payload: Schema.Struct({ authorization: AuthorizationToken }),
    success: TrackerResult,
  }).middleware(MerchantSecret),
  HttpApiEndpoint.post("metadata", "/order/payments/v3/:tracker/metadata", {
    params: { tracker: TrackerToken },
    payload: Schema.Struct({
      data: MetadataUpdate.pipe(Schema.encodeKeys({ orderId: "order_id" })),
    }),
    success: TrackerResult.pipe(HttpApiSchema.status(201)),
  }).middleware(MerchantSecret),
) {}

export interface CheckoutOptions {
  readonly amount: Money;
  readonly orderId?: string | undefined;
  readonly redirectUrl?: URL | undefined;
  readonly cancelUrl?: URL | undefined;
}

export const make = (
  client: HttpApiClient.Client.Group<typeof PaymentsApi, never, never>,
  options: {
    readonly environment: Environment;
    readonly apiKey: Redacted.Redacted<string>;
  },
) => ({
  createCheckout: Effect.fn("Safepay.payments.createCheckout")(function* ({
    amount,
    orderId,
    redirectUrl,
    cancelUrl,
  }: CheckoutOptions) {
    const { tracker } = yield* client.setup({
      payload: {
        merchant_api_key: Redacted.value(options.apiKey),
        intent: "CYBERSOURCE",
        mode: "payment",
        currency: amount.currency,
        amount: amount.amount,
      },
    });
    const token = yield* client.token();
    const url = new URL(checkoutUrl[options.environment]);
    for (const [key, value] of [
      ["environment", options.environment],
      ["tracker", tracker.token],
      ["tbt", Redacted.value(token)],
      ["source", "hosted"],
      ["order_id", orderId],
      ["redirect_url", redirectUrl?.href],
      ["cancel_url", cancelUrl?.href],
    ] as const) {
      if (value !== undefined) url.searchParams.set(key, value);
    }
    return new Checkout({ tracker, url });
  }, toSafepayError),

  get: Effect.fn("Safepay.payments.get")(function* (tracker: TrackerToken) {
    yield* Effect.annotateCurrentSpan({ tracker });
    const result = yield* client.status({ params: { tracker } });
    return result.tracker;
  }, toSafepayError),

  list: Effect.fn("Safepay.payments.list")(function* (search: PaymentSearch) {
    return yield* client.list({ query: search });
  }, toSafepayError),

  refund: Effect.fn("Safepay.payments.refund")(function* (tracker: TrackerToken, amount: Money) {
    yield* Effect.annotateCurrentSpan({ tracker });
    const result = yield* client.refund({
      params: { tracker },
      payload: { currency: amount.currency, amount: amount.amount },
    });
    return result.tracker;
  }, toSafepayError),

  void: Effect.fn("Safepay.payments.void")(function* (tracker: TrackerToken, kind: VoidKind) {
    yield* Effect.annotateCurrentSpan({ tracker });
    const result = yield* client.void({ params: { tracker }, payload: { kind } });
    return result.tracker;
  }, toSafepayError),

  reverse: Effect.fn("Safepay.payments.reverse")(function* (
    tracker: TrackerToken,
    authorization: AuthorizationToken,
  ) {
    yield* Effect.annotateCurrentSpan({ tracker });
    const result = yield* client.reverse({ params: { tracker }, payload: { authorization } });
    return result.tracker;
  }, toSafepayError),

  updateMetadata: Effect.fn("Safepay.payments.updateMetadata")(function* (
    tracker: TrackerToken,
    data: MetadataUpdate,
  ) {
    yield* Effect.annotateCurrentSpan({ tracker });
    const result = yield* client.metadata({ params: { tracker }, payload: { data } });
    return result.tracker;
  }, toSafepayError),
});

export type Payments = ReturnType<typeof make>;
