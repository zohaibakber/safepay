import { Effect } from "effect";
import { Argument, Command, Flag } from "effect/cli";
import { Safepay } from "@sfpy-cli/core/client";
import {
  PauseBehavior,
  Subscription,
  SubscriptionPage,
  SubscriptionToken,
} from "@sfpy-cli/core/subscriptions";
import { paging } from "./flags.ts";
import * as Render from "./render.ts";
import { SafepayFromFlags } from "./root.ts";

const subscription = Argument.String("subscription").pipe(
  Argument.withSchema(SubscriptionToken),
  Argument.withDescription("Subscription token, e.g. sub_c841ea40-..."),
);

const printSubscription = Render.print(Subscription, Render.subscription);

const list = Command.make(
  "list",
  paging,
  Effect.fn(function* (page) {
    const safepay = yield* Safepay;
    const found = yield* safepay.subscriptions.list(page);
    yield* Render.print(SubscriptionPage, Render.subscriptionPage)(found);
  }),
).pipe(Command.withDescription("List subscriptions"), Command.withAlias("ls"));

const get = Command.make(
  "get",
  { subscription },
  Effect.fn(function* ({ subscription }) {
    const safepay = yield* Safepay;
    yield* printSubscription(yield* safepay.subscriptions.get(subscription));
  }),
).pipe(Command.withDescription("Show a subscription"));

const pause = Command.make(
  "pause",
  {
    subscription,
    behavior: Flag.Literals("collection", PauseBehavior.literals).pipe(
      Flag.withDescription(
        "KEEP_AS_READY collects later, MARK_VOID gives the period free, MARK_AS_UNCOLLECTABLE writes it off",
      ),
      Flag.withDefault("KEEP_AS_READY"),
    ),
  },
  Effect.fn(function* ({ subscription, behavior }) {
    const safepay = yield* Safepay;
    yield* printSubscription(yield* safepay.subscriptions.pause(subscription, behavior));
  }),
).pipe(Command.withDescription("Pause payment collection"));

const resume = Command.make(
  "resume",
  { subscription },
  Effect.fn(function* ({ subscription }) {
    const safepay = yield* Safepay;
    yield* printSubscription(yield* safepay.subscriptions.resume(subscription));
  }),
).pipe(Command.withDescription("Resume a paused subscription"));

const cancel = Command.make(
  "cancel",
  { subscription },
  Effect.fn(function* ({ subscription }) {
    const safepay = yield* Safepay;
    yield* printSubscription(yield* safepay.subscriptions.cancel(subscription));
  }),
).pipe(Command.withDescription("Cancel a subscription now. This can't be undone"));

export const subscriptions = Command.make("subscriptions").pipe(
  Command.withDescription("Inspect, pause, resume, and cancel subscriptions"),
  Command.withSubcommands([list, get, pause, resume, cancel]),
  Command.provide(SafepayFromFlags),
);
