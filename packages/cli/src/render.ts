import { Console, DateTime, Effect, Schema } from "effect";
import type { Customer, CustomerPage, PaymentMethod } from "@sfpy-cli/core/customers";
import { type Link, LinkState } from "@sfpy-cli/core/links";
import type { Plan, PlanPage } from "@sfpy-cli/core/plans";
import type { Subscription, SubscriptionPage } from "@sfpy-cli/core/subscriptions";
import type { Transaction, TransactionPage } from "@sfpy-cli/core/transactions";
import type { Checkout, Money, PaymentPage, Tracker, TrackerState } from "@sfpy-cli/core/payments";
import { root } from "./root.ts";

export const print = <A, I>(schema: Schema.Codec<A, I>, text: (value: A) => string) =>
  Effect.fnUntraced(function* (value: A) {
    const { json } = yield* root;
    yield* Console.log(
      json ? JSON.stringify(yield* Schema.encodeEffect(schema)(value), null, 2) : text(value),
    );
  });

// Safepay counts every currency in hundredths. Intl can't be asked for the
// decimals, since CLDR gives PKR none.
export const money = ({ currency, amount }: Money) =>
  new Intl.NumberFormat("en", {
    style: "currency",
    currency,
    currencyDisplay: "code",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount / 100);

export const state = (state: TrackerState) =>
  state.replace("TRACKER_", "").replace("_", " ").toLowerCase();

export const date = (date: DateTime.Utc) => DateTime.formatIso(date).slice(0, 16).replace("T", " ");

export const field = (label: string, value: string) => `  ${label.padEnd(10)}${value}`;

export const tracker = (tracker: Tracker) =>
  [
    `${tracker.token}  ${state(tracker.state)}`,
    field("amount", money(tracker.amount)),
    field("mode", `${tracker.mode} via ${tracker.intent}`),
    ...(tracker.customer === undefined ? [] : [field("customer", tracker.customer)]),
  ].join("\n");

export const checkout = (checkout: Checkout) =>
  [tracker(checkout.tracker), field("checkout", checkout.url.href)].join("\n");

export const table = (rows: ReadonlyArray<ReadonlyArray<string>>) => {
  const widths = rows.reduce<ReadonlyArray<number>>(
    (widths, row) => row.map((cell, i) => Math.max(widths[i] ?? 0, cell.length)),
    [],
  );
  return rows.map((row) =>
    row
      .map((cell, i) => cell.padEnd(widths[i] ?? 0))
      .join("  ")
      .trimEnd(),
  );
};

export const paymentPage = (page: PaymentPage) =>
  [
    ...table(
      page.payments.map((payment) => [
        payment.token,
        state(payment.state),
        `${payment.currency} ${payment.displayAmount}`,
        date(payment.createdAt),
        payment.customerEmail ?? "",
      ]),
    ),
    `${page.payments.length} of ${page.count} payments`,
  ].join("\n");

export const customer = (customer: Customer) =>
  [
    `${customer.token}  ${customer.firstName} ${customer.lastName}${customer.isGuest ? "  guest" : ""}`,
    field("email", customer.email),
    ...(customer.phone === undefined ? [] : [field("phone", customer.phone)]),
    ...(customer.country === undefined ? [] : [field("country", customer.country)]),
    field("created", date(customer.createdAt)),
  ].join("\n");

export const customerPage = (page: CustomerPage) =>
  [
    ...table(
      page.customers.map((customer) => [
        customer.token,
        `${customer.firstName} ${customer.lastName}`,
        customer.email,
        date(customer.createdAt),
      ]),
    ),
    `${page.customers.length} of ${page.count} customers`,
  ].join("\n");

export const paymentMethods = (methods: ReadonlyArray<PaymentMethod>) =>
  methods.length === 0
    ? "No saved cards"
    : table(
        methods.map((method) => [
          method.token,
          method.lastFour === undefined ? "" : `•••• ${method.lastFour}`,
          method.expiry ?? "",
        ]),
      ).join("\n");

export const link = (link: Link) =>
  [
    `${link.id}  ${LinkState.match(link.state, {
      Paid: () => "paid",
      Expired: () => "expired",
      Open: () => link.status.toLowerCase(),
    })}`,
    field("amount", money(link.amount)),
    ...(link.note === undefined ? [] : [field("note", link.note)]),
    ...(link.state._tag === "Paid" ? [field("payment", link.state.tracker)] : []),
    ...(link.url === undefined ? [] : [field("link", link.url.href)]),
  ].join("\n");

const every = (plan: Plan) => {
  const interval = plan.interval.toLowerCase();
  const period = plan.intervalCount === 1 ? interval : `${plan.intervalCount} ${interval}s`;
  return `${money(plan.amount)} every ${period}`;
};

export const plan = (plan: Plan) =>
  [
    `${plan.token}  ${plan.name || plan.product}${plan.active ? "" : "  closed"}`,
    field("price", every(plan)),
    field("product", plan.product),
    ...(plan.trialDays === 0 ? [] : [field("trial", `${plan.trialDays} days`)]),
    field("created", date(plan.createdAt)),
  ].join("\n");

export const planPage = (page: PlanPage) =>
  [
    ...table(page.plans.map((plan) => [plan.token, plan.name || plan.product, every(plan)])),
    `${page.plans.length} of ${page.count} plans`,
  ].join("\n");

export const subscription = (subscription: Subscription) =>
  [
    `${subscription.token}  ${subscription.status.toLowerCase()}`,
    field("plan", subscription.plan),
    field("amount", money(subscription.amount)),
    ...(subscription.periodEnd === undefined
      ? []
      : [field(subscription.cancelAtPeriodEnd ? "ends" : "renews", date(subscription.periodEnd))]),
  ].join("\n");

export const subscriptionPage = (page: SubscriptionPage) =>
  [
    ...table(
      page.subscriptions.map((subscription) => [
        subscription.token,
        subscription.status.toLowerCase(),
        money(subscription.amount),
        subscription.plan,
      ]),
    ),
    `${page.subscriptions.length} of ${page.count} subscriptions`,
  ].join("\n");

export const transaction = (transaction: Transaction) =>
  [
    `${transaction.token}  ${transaction.kind.toLowerCase()} ${transaction.status.toLowerCase()}`,
    field("amount", money(transaction.amount)),
    ...(transaction.subscription === undefined ? [] : [field("for", transaction.subscription)]),
    field("created", date(transaction.createdAt)),
  ].join("\n");

export const transactionPage = (page: TransactionPage) =>
  [
    ...table(
      page.transactions.map((transaction) => [
        transaction.token,
        `${transaction.kind.toLowerCase()} ${transaction.status.toLowerCase()}`,
        money(transaction.amount),
        date(transaction.createdAt),
      ]),
    ),
    `${page.transactions.length} of ${page.count} transactions`,
  ].join("\n");
