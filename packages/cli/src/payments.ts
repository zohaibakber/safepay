import { Console, Effect, Schema } from "effect";
import { Argument, Command, Flag } from "effect/cli";
import { ChildProcess, ChildProcessSpawner } from "effect/process";
import {
  Checkout,
  AuthorizationToken,
  Money,
  PaymentPage,
  Tracker,
  TrackerState,
  TrackerToken,
  VoidKind,
} from "@sfpy-cli/core/payments";
import { Safepay } from "@sfpy-cli/core/client";
import { amount, currency, optional, paging } from "./flags.ts";
import * as Render from "./render.ts";
import { SafepayFromFlags } from "./root.ts";

const tracker = Argument.String("tracker").pipe(
  Argument.withSchema(TrackerToken),
  Argument.withDescription("Tracker token, e.g. track_70fdbb06-..."),
);

const stateFlagValue = (state: TrackerState) =>
  state.replace("TRACKER_", "").replaceAll("_", "-").toLowerCase();

const printTracker = Render.print(Tracker, Render.tracker);

const openInBrowser = Effect.fn("openInBrowser")(function* (url: URL) {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const opener =
    process.platform === "darwin" ? "open" : process.platform === "win32" ? "explorer" : "xdg-open";
  yield* spawner.exitCode(ChildProcess.make(opener, [url.href]));
});

const create = Command.make(
  "create",
  {
    amount,
    currency,
    orderId: optional(
      Flag.String("order-id").pipe(
        Flag.withDescription("Your order ID, shown on the checkout and in reports"),
      ),
    ),
    redirectUrl: optional(
      Flag.String("redirect-url").pipe(
        Flag.withSchema(Schema.URLFromString),
        Flag.withDescription("Where Safepay sends the shopper after paying"),
      ),
    ),
    cancelUrl: optional(
      Flag.String("cancel-url").pipe(
        Flag.withSchema(Schema.URLFromString),
        Flag.withDescription("Where Safepay sends the shopper after cancelling"),
      ),
    ),
    open: Flag.Boolean("open").pipe(
      Flag.withDescription("Open the checkout in a browser"),
      Flag.withDefault(false),
    ),
  },
  Effect.fn(function* ({ amount, currency, orderId, redirectUrl, cancelUrl, open }) {
    const safepay = yield* Safepay;
    const checkout = yield* safepay.payments.createCheckout({
      amount: new Money({ currency, amount }),
      orderId,
      redirectUrl,
      cancelUrl,
    });
    yield* Render.print(Checkout, Render.checkout)(checkout);
    if (open) {
      yield* openInBrowser(checkout.url).pipe(
        Effect.catch(() =>
          Console.error("Could not open a browser. Open the checkout link above."),
        ),
      );
    }
  }),
).pipe(
  Command.withDescription("Create a payment and print its hosted checkout link"),
  Command.withExamples([
    {
      command: "sfpy payments create --amount 50000 --open",
      description: "Charge PKR 500.00 and open the checkout",
    },
  ]),
);

const get = Command.make(
  "get",
  { tracker },
  Effect.fn(function* ({ tracker }) {
    const safepay = yield* Safepay;
    yield* printTracker(yield* safepay.payments.get(tracker));
  }),
).pipe(Command.withDescription("Show a payment"));

const list = Command.make(
  "list",
  {
    ...paging,
    states: Flag.ChoiceWithValue(
      "state",
      TrackerState.literals.map((state) => [stateFlagValue(state), state] as const),
    ).pipe(Flag.withDescription("Only payments in this state. Repeat for more"), Flag.atLeast(0)),
    customerEmail: optional(
      Flag.String("email").pipe(Flag.withDescription("Only payments by this customer email")),
    ),
    since: optional(
      Flag.String("since").pipe(
        Flag.withSchema(Schema.DateTimeUtcFromString),
        Flag.withDescription("Only payments created on or after this date, e.g. 2026-11-01"),
      ),
    ),
    until: optional(
      Flag.String("until").pipe(
        Flag.withSchema(Schema.DateTimeUtcFromString),
        Flag.withDescription("Only payments created before this date"),
      ),
    ),
  },
  Effect.fn(function* (search) {
    const safepay = yield* Safepay;
    const found = yield* safepay.payments.list(search);
    yield* Render.print(PaymentPage, Render.paymentPage)(found);
  }),
).pipe(
  Command.withDescription("List payments newest first, optionally filtered"),
  Command.withAlias("ls"),
  Command.withExamples([
    {
      command: "sfpy payments list --state refunded --state partial-refund --since 2026-11-01",
      description: "Refunds since November 1",
    },
  ]),
);

const refund = Command.make(
  "refund",
  { tracker, amount, currency },
  Effect.fn(function* ({ tracker, amount, currency }) {
    const safepay = yield* Safepay;
    yield* printTracker(yield* safepay.payments.refund(tracker, new Money({ currency, amount })));
  }),
).pipe(Command.withDescription("Refund all or part of a payment"));

const voidPayment = Command.make(
  "void",
  {
    tracker,
    kind: Flag.Literals("kind", VoidKind.literals).pipe(
      Flag.withDescription("What to void"),
      Flag.withDefault("VOID_CAPTURE"),
    ),
  },
  Effect.fn(function* ({ tracker, kind }) {
    const safepay = yield* Safepay;
    yield* printTracker(yield* safepay.payments.void(tracker, kind));
  }),
).pipe(Command.withDescription("Void a capture or payment before settlement"));

const reverse = Command.make(
  "reverse",
  {
    tracker,
    authorization: Flag.String("authorization").pipe(
      Flag.withSchema(AuthorizationToken),
      Flag.withDescription("The auth_ token, from the payment's page in the dashboard"),
    ),
  },
  Effect.fn(function* ({ tracker, authorization }) {
    const safepay = yield* Safepay;
    yield* printTracker(yield* safepay.payments.reverse(tracker, authorization));
  }),
).pipe(Command.withDescription("Reverse a card authorization"));

const metadata = Command.make(
  "metadata",
  {
    tracker,
    orderId: optional(
      Flag.String("order-id").pipe(Flag.withDescription("Your order ID, for reconciliation")),
    ),
    source: optional(
      Flag.String("source").pipe(
        Flag.withDescription("Where the payment came from, e.g. shopify or custom"),
      ),
    ),
  },
  Effect.fn(function* ({ tracker, ...metadata }) {
    const safepay = yield* Safepay;
    const updated = yield* safepay.payments.updateMetadata(tracker, metadata);
    yield* printTracker(updated);
  }),
).pipe(Command.withDescription("Attach an order ID or source to a payment"));

export const payments = Command.make("payments").pipe(
  Command.withDescription("Create, find, and settle payments"),
  Command.withSubcommands([create, get, list, refund, voidPayment, reverse, metadata]),
  Command.provide(SafepayFromFlags),
);
