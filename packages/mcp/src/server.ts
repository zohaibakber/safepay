import { Context, Effect, Layer, Redacted, Schema } from "effect";
import { Mac, SecureRandom } from "effect/crypto";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/http";
import { McpProtocol, McpServer, Tool, Toolkit } from "effect/ai";
import packageJson from "../package.json" with { type: "json" };
import { Safepay } from "@sfpy-cli/core/client";
import { CustomerPage, CustomerToken, Customer, PaymentMethod } from "@sfpy-cli/core/customers";
import { SafepayError } from "@sfpy-cli/core/error";
import { Link, LinkToken } from "@sfpy-cli/core/links";
import { PageRequest } from "@sfpy-cli/core/http";
import {
  AuthorizationToken,
  Checkout,
  Currency,
  MinorUnits,
  Money,
  PaymentPage,
  Tracker,
  TrackerState,
  TrackerToken,
  VoidKind,
} from "@sfpy-cli/core/payments";
import { Plan, PlanPage, PlanToken } from "@sfpy-cli/core/plans";
import { Subscription, SubscriptionPage, SubscriptionToken } from "@sfpy-cli/core/subscriptions";
import { Transaction, TransactionPage, TransactionToken } from "@sfpy-cli/core/transactions";

const tracker = TrackerToken.annotate({
  description: "Tracker token of the payment, e.g. track_70fdbb06-...",
});
const customer = CustomerToken.annotate({ description: "Customer token, e.g. cus_ce2b07d5-..." });
const link = LinkToken.annotate({ description: "Quick Link token, e.g. link_4c2a8f1e-..." });
const plan = PlanToken.annotate({ description: "Plan token, e.g. plan_d4869a78-..." });
const subscription = SubscriptionToken.annotate({
  description: "Subscription token, e.g. sub_c841ea40-...",
});
const transaction = TransactionToken.annotate({
  description: "Subscription transaction token, e.g. txn_17553398-...",
});
const amount = MinorUnits.annotate({ description: "Amount in minor units: 50000 is PKR 500.00" });
const currency = Currency.annotate({ description: "ISO 4217 currency code, usually PKR" });

const paging = {
  page: PageRequest.fields.page.pipe(Schema.withDecodingDefault(Effect.succeed(1))),
  limit: PageRequest.fields.limit.pipe(Schema.withDecodingDefault(Effect.succeed(20))),
};

const safepayTool = <
  const Name extends string,
  Parameters extends Schema.Constraint,
  Success extends Schema.Constraint,
>(
  name: Name,
  options: {
    readonly description: string;
    readonly parameters: Parameters;
    readonly success: Success;
  },
) => Tool.make(name, { ...options, failure: SafepayError, failureMode: "return" });

const lookup = Context.make(Tool.Readonly, true).pipe(
  Context.add(Tool.Destructive, false),
  Context.add(Tool.Idempotent, true),
);

const doesNotMoveMoney = Context.make(Tool.Destructive, false);

const GetPayment = safepayTool("get_payment", {
  description: "Look up one payment: its state, amount, mode, and customer",
  parameters: Schema.Struct({ tracker }),
  success: Tracker,
})
  .annotate(Tool.Title, "Get payment")
  .annotateMerge(lookup);

const ListPayments = safepayTool("list_payments", {
  description:
    "List payments newest first, one page at a time, optionally filtered by state or customer email",
  parameters: Schema.Struct({
    ...paging,
    states: Schema.optional(
      Schema.Array(TrackerState).annotate({ description: "Only payments in these states" }),
    ),
    customer_email: Schema.optional(
      Schema.String.annotate({ description: "Only payments by this customer email" }),
    ),
  }),
  success: PaymentPage,
})
  .annotate(Tool.Title, "List payments")
  .annotateMerge(lookup);

const CreateCheckout = safepayTool("create_checkout", {
  description:
    "Create a payment session and return its hosted checkout URL. No money moves until a shopper pays at that URL.",
  parameters: Schema.Struct({
    amount,
    currency: currency.pipe(Schema.withDecodingDefault(Effect.succeed("PKR"))),
    order_id: Schema.optional(
      Schema.String.annotate({ description: "The merchant's own order ID" }),
    ),
  }),
  success: Checkout,
})
  .annotate(Tool.Title, "Create checkout link")
  .annotateMerge(doesNotMoveMoney);

const CreatePaymentLink = safepayTool("create_payment_link", {
  description:
    "Create a Quick Link: a shareable page where anyone can pay a fixed amount. No money moves until someone pays.",
  parameters: Schema.Struct({
    amount,
    currency: currency.pipe(Schema.withDecodingDefault(Effect.succeed("PKR"))),
    note: Schema.optional(
      Schema.String.annotate({ description: "Shown to the payer, e.g. what the payment is for" }),
    ),
  }),
  success: Link,
})
  .annotate(Tool.Title, "Create payment link")
  .annotateMerge(doesNotMoveMoney);

const GetPaymentLink = safepayTool("get_payment_link", {
  description: "Look up a Quick Link: its amount, URL, and whether it has been paid",
  parameters: Schema.Struct({ link }),
  success: Link,
})
  .annotate(Tool.Title, "Get payment link")
  .annotateMerge(lookup);

const ListCustomers = safepayTool("list_customers", {
  description: "List saved customers, one page at a time",
  parameters: Schema.Struct(paging),
  success: CustomerPage,
})
  .annotate(Tool.Title, "List customers")
  .annotateMerge(lookup);

const GetCustomer = safepayTool("get_customer", {
  description: "Look up one customer's name, email, phone, and country",
  parameters: Schema.Struct({ customer }),
  success: Customer,
})
  .annotate(Tool.Title, "Get customer")
  .annotateMerge(lookup);

const ListCustomerCards = safepayTool("list_customer_cards", {
  description: "List the cards a customer has saved for future payments",
  parameters: Schema.Struct({ customer }),
  success: Schema.Struct({ cards: Schema.Array(PaymentMethod) }),
})
  .annotate(Tool.Title, "List saved cards")
  .annotateMerge(lookup);

const ListPlans = safepayTool("list_plans", {
  description: "List subscription plans, one page at a time",
  parameters: Schema.Struct(paging),
  success: PlanPage,
})
  .annotate(Tool.Title, "List plans")
  .annotateMerge(lookup);

const GetPlan = safepayTool("get_plan", {
  description: "Look up a subscription plan: its price, billing interval, and trial",
  parameters: Schema.Struct({ plan }),
  success: Plan,
})
  .annotate(Tool.Title, "Get plan")
  .annotateMerge(lookup);

const ListSubscriptions = safepayTool("list_subscriptions", {
  description: "List subscriptions across all plans, one page at a time",
  parameters: Schema.Struct(paging),
  success: SubscriptionPage,
})
  .annotate(Tool.Title, "List subscriptions")
  .annotateMerge(lookup);

const GetSubscription = safepayTool("get_subscription", {
  description: "Look up a subscription: its plan, status, and current period",
  parameters: Schema.Struct({ subscription }),
  success: Subscription,
})
  .annotate(Tool.Title, "Get subscription")
  .annotateMerge(lookup);

const ListTransactions = safepayTool("list_transactions", {
  description: "List subscription charges and refunds, one page at a time",
  parameters: Schema.Struct(paging),
  success: TransactionPage,
})
  .annotate(Tool.Title, "List transactions")
  .annotateMerge(lookup);

const GetTransaction = safepayTool("get_transaction", {
  description: "Look up one subscription charge or refund",
  parameters: Schema.Struct({ transaction }),
  success: Transaction,
})
  .annotate(Tool.Title, "Get transaction")
  .annotateMerge(lookup);

const RefundPayment = safepayTool("refund_payment", {
  description:
    "Refund all or part of a completed payment. Card refunds are possible up to 90 days after payment.",
  parameters: Schema.Struct({ tracker, amount, currency }),
  success: Tracker,
})
  .annotate(Tool.Title, "Refund payment")
  .annotate(Tool.Destructive, true);

const VoidPayment = safepayTool("void_payment", {
  description: "Void a capture or payment before it settles",
  parameters: Schema.Struct({ tracker, kind: VoidKind }),
  success: Tracker,
})
  .annotate(Tool.Title, "Void payment")
  .annotate(Tool.Destructive, true);

const ReversePayment = safepayTool("reverse_payment", {
  description: "Release the hold on an authorized payment that was never captured",
  parameters: Schema.Struct({
    tracker,
    authorization: AuthorizationToken.annotate({
      description: "Authorization token of the hold, e.g. auth_9f1c...",
    }),
  }),
  success: Tracker,
})
  .annotate(Tool.Title, "Reverse authorization")
  .annotate(Tool.Destructive, true);

const CancelSubscription = safepayTool("cancel_subscription", {
  description: "Cancel a subscription now. The customer is not billed again. This can't be undone.",
  parameters: Schema.Struct({ subscription }),
  success: Subscription,
})
  .annotate(Tool.Title, "Cancel subscription")
  .annotate(Tool.Destructive, true);

const RefundTransaction = safepayTool("refund_transaction", {
  description: "Refund a subscription charge in full",
  parameters: Schema.Struct({ transaction }),
  success: Transaction,
})
  .annotate(Tool.Title, "Refund subscription charge")
  .annotate(Tool.Destructive, true);

const DefaultTools = Toolkit.make(
  GetPayment,
  ListPayments,
  CreateCheckout,
  CreatePaymentLink,
  GetPaymentLink,
  ListCustomers,
  GetCustomer,
  ListCustomerCards,
  ListPlans,
  GetPlan,
  ListSubscriptions,
  GetSubscription,
  ListTransactions,
  GetTransaction,
);
const MoneyMovingTools = Toolkit.make(
  RefundPayment,
  VoidPayment,
  ReversePayment,
  CancelSubscription,
  RefundTransaction,
);

const DefaultToolsLayer = DefaultTools.toLayer(
  Effect.gen(function* () {
    const { payments, links, customers, plans, subscriptions, transactions } = yield* Safepay;
    return DefaultTools.of({
      get_payment: ({ tracker }) => payments.get(tracker),
      list_payments: ({ customer_email, ...search }) =>
        payments.list({ ...search, customerEmail: customer_email }),
      create_checkout: ({ amount, currency, order_id }) =>
        payments.createCheckout({
          amount: new Money({ currency, amount }),
          orderId: order_id,
        }),
      create_payment_link: ({ amount, currency, note }) =>
        links.create({ amount: new Money({ currency, amount }), note }),
      get_payment_link: ({ link }) => links.get(link),
      list_customers: (page) => customers.list(page),
      get_customer: ({ customer }) => customers.get(customer),
      list_customer_cards: ({ customer }) =>
        customers.paymentMethods(customer).pipe(Effect.map((cards) => ({ cards }))),
      list_plans: (page) => plans.list(page),
      get_plan: ({ plan }) => plans.get(plan),
      list_subscriptions: (page) => subscriptions.list(page),
      get_subscription: ({ subscription }) => subscriptions.get(subscription),
      list_transactions: (page) => transactions.list(page),
      get_transaction: ({ transaction }) => transactions.get(transaction),
    });
  }),
);

const MoneyMovingToolsLayer = MoneyMovingTools.toLayer(
  Effect.gen(function* () {
    const { payments, subscriptions, transactions } = yield* Safepay;
    return MoneyMovingTools.of({
      refund_payment: ({ tracker, amount, currency }) =>
        payments.refund(tracker, new Money({ currency, amount })),
      void_payment: ({ tracker, kind }) => payments.void(tracker, kind),
      reverse_payment: ({ tracker, authorization }) => payments.reverse(tracker, authorization),
      cancel_subscription: ({ subscription }) => subscriptions.cancel(subscription),
      refund_transaction: ({ transaction }) => transactions.refund(transaction),
    });
  }),
);

export interface Options {
  readonly allowWrites: boolean;
}

const DefaultRegistrations = McpServer.toolkit(DefaultTools).pipe(Layer.provide(DefaultToolsLayer));
const MoneyMovingRegistrations = McpServer.toolkit(MoneyMovingTools).pipe(
  Layer.provide(MoneyMovingToolsLayer),
);

export const tools = (options: Options) =>
  options.allowWrites
    ? Layer.mergeAll(DefaultRegistrations, MoneyMovingRegistrations)
    : DefaultRegistrations;

const serverOptions = (options: Options, enableWrites: string) =>
  Effect.gen(function* () {
    const { environment } = yield* Safepay;
    return {
      name: "safepay",
      version: packageJson.version,
      instructions: [
        `Tools act on the Safepay ${environment} environment.`,
        "Amounts are integers in the currency's minor units: 50000 PKR is Rs 500.00.",
        "Payments are identified by tracker tokens that start with track_.",
        options.allowWrites
          ? "Refunds, voids, reversals, and cancellations can't be undone. Confirm the token and amount with the user before calling them."
          : `Tools that refund, void, reverse, or cancel are disabled. ${enableWrites}`,
      ].join(" "),
      protocols: [McpProtocol.v2026_07_28] as const,
      registrations: tools(options),
    };
  });

export const layerStdio = (options: Options) =>
  Layer.unwrap(
    serverOptions(options, "Restart the server with --allow-writes to enable them.").pipe(
      Effect.map(McpServer.layerStdio),
    ),
  );

const bytes = (text: string) => new TextEncoder().encode(text);

const bearerAuth = (token: Redacted.Redacted<string>) =>
  Layer.unwrap(
    Effect.gen(function* () {
      const mac = yield* Mac.Mac;
      const expected = bytes(`Bearer ${Redacted.value(token)}`);
      const key = yield* Mac.key(Mac.hmacSha256, expected);
      const tag = yield* mac.sign(key, expected);
      return HttpRouter.middleware(
        (httpEffect) =>
          Effect.gen(function* () {
            const request = yield* HttpServerRequest.HttpServerRequest;
            const presented = bytes(request.headers["authorization"] ?? "");
            if (!(yield* mac.verify(key, tag, presented).pipe(Effect.orDie))) {
              return HttpServerResponse.empty({
                status: 401,
                headers: { "www-authenticate": "Bearer" },
              });
            }
            return yield* httpEffect;
          }),
        { global: true },
      );
    }).pipe(Effect.orDie),
  ).pipe(Layer.provide(Mac.layerWebCrypto), Layer.provide(SecureRandom.layerWebCrypto));

export interface HttpOptions extends Options {
  readonly token: Redacted.Redacted<string>;
}

export const layerHttp = (options: HttpOptions) =>
  Layer.mergeAll(
    Layer.unwrap(
      serverOptions(options, "Redeploy with SAFEPAY_ALLOW_WRITES=true to enable them.").pipe(
        Effect.map((server) => McpServer.layerHttpRequestScoped({ ...server, path: "/mcp" })),
      ),
    ),
    bearerAuth(options.token),
  );
