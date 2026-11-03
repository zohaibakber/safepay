import { Effect, Schema } from "effect";
import type { HttpApiClient } from "effect/http-api";
import { HttpApiEndpoint, HttpApiGroup } from "effect/http-api";
import {
  Count,
  dataEnvelope,
  listOrNull,
  MerchantSecret,
  PageRequest,
  wireCodec,
  toSafepayError,
} from "./http.ts";
import { Money } from "./payments.ts";
import { PlanToken } from "./plans.ts";

export const SubscriptionToken = Schema.String.pipe(
  Schema.check(Schema.isStartingWith("sub_")),
  Schema.brand("SubscriptionToken"),
);
export type SubscriptionToken = typeof SubscriptionToken.Type;

export const PauseBehavior = Schema.Literals([
  "KEEP_AS_READY",
  "MARK_VOID",
  "MARK_AS_UNCOLLECTABLE",
]);
export type PauseBehavior = typeof PauseBehavior.Type;

export class Subscription extends Schema.Class<Subscription>("sfpy/Subscription")({
  token: SubscriptionToken,
  plan: PlanToken,
  status: Schema.String,
  amount: Money,
  periodEnd: Schema.optional(Schema.DateTimeUtcFromString),
  cancelAtPeriodEnd: Schema.Boolean,
  createdAt: Schema.DateTimeUtcFromString,
}) {}

export class SubscriptionPage extends Schema.Class<SubscriptionPage>("sfpy/SubscriptionPage")({
  count: Schema.Int,
  subscriptions: Schema.Array(Subscription),
}) {}

const SubscriptionWire = wireCodec(
  Schema.Struct({
    token: Schema.String,
    plan_id: Schema.String,
    status: Schema.String,
    price_amount: Schema.String,
    price_currency: Schema.String,
    current_period_end_date: Schema.optional(Schema.String),
    cancel_at_period_end: Schema.Boolean,
    created_at: Schema.String,
  }),
  Subscription,
  {
    decode: (subscription) => ({
      token: subscription.token,
      plan: subscription.plan_id,
      status: subscription.status,
      amount: {
        currency: subscription.price_currency,
        amount: Number(subscription.price_amount),
      },
      periodEnd: subscription.current_period_end_date,
      cancelAtPeriodEnd: subscription.cancel_at_period_end,
      createdAt: subscription.created_at,
    }),
    encode: (subscription) => ({
      token: subscription.token,
      plan_id: subscription.plan,
      status: subscription.status,
      price_amount: String(subscription.amount.amount),
      price_currency: subscription.amount.currency,
      current_period_end_date: subscription.periodEnd,
      cancel_at_period_end: subscription.cancelAtPeriodEnd,
      created_at: subscription.createdAt,
    }),
  },
);

const SubscriptionResult = dataEnvelope(
  Schema.Struct({ subscription: SubscriptionWire.pipe(Schema.decodeTo(Subscription)) }),
);

const SubscriptionPageWire = Schema.Struct({
  count: Count,
  subscriptions: listOrNull(SubscriptionWire),
});

const params = { subscription: SubscriptionToken };

export class SubscriptionsApi extends HttpApiGroup.make("subscriptions")
  .add(
    HttpApiEndpoint.get("list", "/client/subscriptions/v1/search", {
      query: PageRequest,
      success: dataEnvelope(SubscriptionPageWire.pipe(Schema.decodeTo(SubscriptionPage))),
    }),
    HttpApiEndpoint.get("get", "/client/subscriptions/v1/:subscription", {
      params,
      success: SubscriptionResult,
    }),
    HttpApiEndpoint.put("update", "/client/subscriptions/v1/:subscription", {
      params,
      payload: Schema.Struct({
        pause_collection: Schema.Struct({ payment_collection_behavior: PauseBehavior }),
      }),
      success: SubscriptionResult,
    }),
    HttpApiEndpoint.put("resume", "/client/subscriptions/v1/:subscription/resumption", {
      params,
      payload: Schema.Struct({ billing_cycle_anchor: Schema.Literals(["now", "unchanged"]) }),
      success: Schema.Unknown,
    }),
    HttpApiEndpoint.post("cancel", "/client/subscriptions/v1/:subscription/cancel", {
      params,
      payload: Schema.Struct({}),
      success: SubscriptionResult,
    }),
  )
  .middleware(MerchantSecret) {}

export const make = (client: HttpApiClient.Client.Group<typeof SubscriptionsApi, never, never>) => {
  const read = (subscription: SubscriptionToken) =>
    client.get({ params: { subscription } }).pipe(Effect.map((result) => result.subscription));

  return {
    list: Effect.fn("Safepay.subscriptions.list")(function* (page: PageRequest) {
      return yield* client.list({ query: page });
    }, toSafepayError),

    get: Effect.fn("Safepay.subscriptions.get")(function* (subscription: SubscriptionToken) {
      return yield* read(subscription);
    }, toSafepayError),

    pause: Effect.fn("Safepay.subscriptions.pause")(function* (
      subscription: SubscriptionToken,
      behavior: PauseBehavior,
    ) {
      const result = yield* client.update({
        params: { subscription },
        payload: { pause_collection: { payment_collection_behavior: behavior } },
      });
      return result.subscription;
    }, toSafepayError),

    resume: Effect.fn("Safepay.subscriptions.resume")(function* (subscription: SubscriptionToken) {
      yield* client.resume({
        params: { subscription },
        payload: { billing_cycle_anchor: "unchanged" },
      });
      return yield* read(subscription);
    }, toSafepayError),

    cancel: Effect.fn("Safepay.subscriptions.cancel")(function* (subscription: SubscriptionToken) {
      const result = yield* client.cancel({ params: { subscription }, payload: {} });
      return result.subscription;
    }, toSafepayError),
  };
};

export type Subscriptions = ReturnType<typeof make>;
