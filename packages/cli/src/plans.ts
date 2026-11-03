import { Console, Effect } from "effect";
import { Argument, Command, Flag } from "effect/cli";
import { Safepay } from "@sfpy-cli/core/client";
import { Money } from "@sfpy-cli/core/payments";
import { NewPlan, Plan, PlanInterval, PlanPage, PlanToken } from "@sfpy-cli/core/plans";
import { amount, currency, optional, paging } from "./flags.ts";
import * as Render from "./render.ts";
import { SafepayFromFlags } from "./root.ts";

const plan = Argument.String("plan").pipe(
  Argument.withSchema(PlanToken),
  Argument.withDescription("Plan token, e.g. plan_d4869a78-..."),
);

const printPlan = Render.print(Plan, Render.plan);

const create = Command.make(
  "create",
  {
    name: Flag.String("name").pipe(Flag.withDescription("Shown to subscribers")),
    product: Flag.String("product").pipe(Flag.withDescription("What the plan sells")),
    amount: amount.pipe(Flag.withDescription("Price per interval in minor units")),
    currency,
    interval: Flag.Literals("interval", PlanInterval.literals).pipe(
      Flag.withDescription("How often to bill"),
      Flag.withDefault("MONTH"),
    ),
    intervalCount: Flag.Int("every").pipe(
      Flag.withSchema(NewPlan.fields.intervalCount),
      Flag.withDescription("Bill every N intervals"),
      Flag.withDefault(1),
    ),
    trialDays: optional(Flag.Int("trial-days")),
  },
  Effect.fn(function* ({ amount, currency, ...plan }) {
    const safepay = yield* Safepay;
    yield* printPlan(
      yield* safepay.plans.create({ ...plan, amount: new Money({ currency, amount }) }),
    );
  }),
).pipe(
  Command.withDescription("Create a recurring plan"),
  Command.withExamples([
    {
      command: 'sfpy plans create --name Pro --product "Pro tier" --amount 250000',
      description: "PKR 2,500.00 a month",
    },
  ]),
);

const list = Command.make(
  "list",
  paging,
  Effect.fn(function* (page) {
    const safepay = yield* Safepay;
    yield* Render.print(PlanPage, Render.planPage)(yield* safepay.plans.list(page));
  }),
).pipe(Command.withDescription("List plans"), Command.withAlias("ls"));

const get = Command.make(
  "get",
  { plan },
  Effect.fn(function* ({ plan }) {
    const safepay = yield* Safepay;
    yield* printPlan(yield* safepay.plans.get(plan));
  }),
).pipe(Command.withDescription("Show a plan"));

const update = Command.make(
  "update",
  {
    plan,
    name: optional(Flag.String("name")),
    product: optional(Flag.String("product")),
    trialDays: optional(Flag.Int("trial-days")),
    active: optional(
      Flag.Boolean("active").pipe(
        Flag.withDescription("Whether new customers can subscribe. --no-active closes the plan"),
      ),
    ),
  },
  Effect.fn(function* ({ plan, ...update }) {
    const safepay = yield* Safepay;
    yield* printPlan(yield* safepay.plans.update(plan, update));
  }),
).pipe(Command.withDescription("Change a plan. Existing subscriptions keep their price"));

const archive = Command.make(
  "archive",
  { plan },
  Effect.fn(function* ({ plan }) {
    const safepay = yield* Safepay;
    yield* safepay.plans.archive(plan);
    yield* Console.log(`Archived ${plan}`);
  }),
).pipe(Command.withDescription("Archive a plan for good. Existing subscribers are unaffected"));

export const plans = Command.make("plans").pipe(
  Command.withDescription("Manage subscription plans"),
  Command.withSubcommands([create, list, get, update, archive]),
  Command.provide(SafepayFromFlags),
);
