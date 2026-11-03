import { Effect, Schema } from "effect";
import type { HttpApiClient } from "effect/http-api";
import { HttpApiEndpoint, HttpApiGroup } from "effect/http-api";
import {
  Count,
  dataEnvelope,
  listOrNull,
  MerchantSecret,
  omittable,
  PageRequest,
  wireCodec,
  toSafepayError,
} from "./http.ts";
import { Currency, Money } from "./payments.ts";

export const PlanToken = Schema.String.pipe(
  Schema.check(Schema.isStartingWith("plan_")),
  Schema.brand("PlanToken"),
);
export type PlanToken = typeof PlanToken.Type;

export const PlanInterval = Schema.Literals(["DAY", "WEEK", "MONTH", "YEAR"]);
export type PlanInterval = typeof PlanInterval.Type;

export class Plan extends Schema.Class<Plan>("sfpy/Plan")({
  token: PlanToken,
  name: Schema.String,
  product: Schema.String,
  amount: Money,
  interval: PlanInterval,
  intervalCount: Schema.Int,
  trialDays: Schema.Int,
  active: Schema.Boolean,
  createdAt: Schema.DateTimeUtcFromString,
}) {}

export class PlanPage extends Schema.Class<PlanPage>("sfpy/PlanPage")({
  count: Schema.Int,
  plans: Schema.Array(Plan),
}) {}

export const NewPlan = Schema.Struct({
  name: Schema.String,
  product: Schema.String,
  amount: Money,
  interval: PlanInterval,
  intervalCount: Schema.Int.pipe(Schema.check(Schema.isGreaterThan(0))),
  trialDays: Schema.optional(Schema.Int),
});
export type NewPlan = typeof NewPlan.Type;

export const PlanUpdate = Schema.Struct({
  name: omittable(Schema.String),
  product: omittable(Schema.String),
  trialDays: omittable(Schema.Int),
  active: omittable(Schema.Boolean),
});
export type PlanUpdate = typeof PlanUpdate.Type;

const PlanWire = wireCodec(
  Schema.Struct({
    token: Schema.String,
    name: Schema.String,
    product: Schema.String,
    amount: Schema.String,
    currency: Schema.String,
    interval: PlanInterval,
    interval_count: Schema.Number,
    trial_period_days: Schema.Number,
    active: Schema.Boolean,
    created_at: Schema.String,
  }),
  Plan,
  {
    decode: (plan) => ({
      token: plan.token,
      name: plan.name,
      product: plan.product,
      amount: { currency: plan.currency, amount: Number(plan.amount) },
      interval: plan.interval,
      intervalCount: plan.interval_count,
      trialDays: plan.trial_period_days,
      active: plan.active,
      createdAt: plan.created_at,
    }),
    encode: (plan) => ({
      token: plan.token,
      name: plan.name,
      product: plan.product,
      amount: String(plan.amount.amount),
      currency: plan.amount.currency,
      interval: plan.interval,
      interval_count: plan.intervalCount,
      trial_period_days: plan.trialDays,
      active: plan.active,
      created_at: plan.createdAt,
    }),
  },
);

const PlanPageWire = Schema.Struct({ count: Count, plans: listOrNull(PlanWire) });

const params = { plan: PlanToken };

export class PlansApi extends HttpApiGroup.make("plans")
  .add(
    HttpApiEndpoint.post("create", "/client/plans/v1/", {
      payload: Schema.Struct({
        name: Schema.String,
        product: Schema.String,
        amount: Schema.String,
        currency: Currency,
        interval: PlanInterval,
        interval_count: Schema.Int,
        trial_period_days: omittable(Schema.Int),
        type: Schema.Literal("RECURRING"),
        active: Schema.Boolean,
      }),
      success: dataEnvelope(Schema.Struct({ plan_id: PlanToken })),
    }),
    HttpApiEndpoint.get("list", "/client/plans/v1/search", {
      query: PageRequest,
      success: dataEnvelope(PlanPageWire.pipe(Schema.decodeTo(PlanPage))),
    }),
    HttpApiEndpoint.get("get", "/client/plans/v1/:plan/", {
      params,
      success: dataEnvelope(Schema.Struct({ plan: PlanWire.pipe(Schema.decodeTo(Plan)) })),
    }),
    HttpApiEndpoint.put("update", "/client/plans/v1/:plan/", {
      params,
      payload: PlanUpdate.pipe(Schema.encodeKeys({ trialDays: "trial_period_days" })),
      success: Schema.Unknown,
    }),
    HttpApiEndpoint.delete("archive", "/client/plans/v1/:plan/", {
      params,
      success: Schema.Unknown,
    }),
  )
  .middleware(MerchantSecret) {}

export const make = (client: HttpApiClient.Client.Group<typeof PlansApi, never, never>) => {
  const read = (plan: PlanToken) =>
    client.get({ params: { plan } }).pipe(Effect.map((result) => result.plan));

  return {
    create: Effect.fn("Safepay.plans.create")(function* (plan: NewPlan) {
      const { plan_id } = yield* client.create({
        payload: {
          name: plan.name,
          product: plan.product,
          amount: String(plan.amount.amount),
          currency: plan.amount.currency,
          interval: plan.interval,
          interval_count: plan.intervalCount,
          trial_period_days: plan.trialDays,
          type: "RECURRING",
          active: true,
        },
      });
      return yield* read(plan_id);
    }, toSafepayError),

    list: Effect.fn("Safepay.plans.list")(function* (page: PageRequest) {
      return yield* client.list({ query: page });
    }, toSafepayError),

    get: Effect.fn("Safepay.plans.get")(function* (plan: PlanToken) {
      return yield* read(plan);
    }, toSafepayError),

    update: Effect.fn("Safepay.plans.update")(function* (plan: PlanToken, update: PlanUpdate) {
      yield* client.update({ params: { plan }, payload: update });
      return yield* read(plan);
    }, toSafepayError),

    archive: Effect.fn("Safepay.plans.archive")(function* (plan: PlanToken) {
      yield* client.archive({ params: { plan } });
    }, toSafepayError),
  };
};

export type Plans = ReturnType<typeof make>;
