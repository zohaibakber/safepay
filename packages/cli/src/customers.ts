import { Console, Effect, Schema } from "effect";
import { Argument, Command, Flag } from "effect/cli";
import {
  CountryCode,
  Customer,
  CustomerPage,
  CustomerToken,
  PaymentMethod,
  PaymentMethodToken,
} from "@sfpy-cli/core/customers";
import { Safepay } from "@sfpy-cli/core/client";
import { optional, paging } from "./flags.ts";
import * as Render from "./render.ts";
import { SafepayFromFlags } from "./root.ts";

const customer = Argument.String("customer").pipe(
  Argument.withSchema(CustomerToken),
  Argument.withDescription("Customer token, e.g. cus_2fc20245-..."),
);

const printCustomer = Render.print(Customer, Render.customer);

const details = {
  firstName: Flag.String("first-name"),
  lastName: Flag.String("last-name"),
  email: Flag.String("email"),
  phone: Flag.String("phone").pipe(Flag.withDescription("With country code, e.g. +923331234567")),
  country: Flag.String("country").pipe(
    Flag.withSchema(CountryCode),
    Flag.withDescription("ISO 3166 country code, e.g. PK"),
  ),
};

const create = Command.make(
  "create",
  details,
  Effect.fn(function* (customer) {
    const safepay = yield* Safepay;
    yield* printCustomer(yield* safepay.customers.create(customer));
  }),
).pipe(Command.withDescription("Create a customer"));

const list = Command.make(
  "list",
  paging,
  Effect.fn(function* (page) {
    const safepay = yield* Safepay;
    yield* Render.print(CustomerPage, Render.customerPage)(yield* safepay.customers.list(page));
  }),
).pipe(Command.withDescription("List customers"), Command.withAlias("ls"));

const get = Command.make(
  "get",
  { customer },
  Effect.fn(function* ({ customer }) {
    const safepay = yield* Safepay;
    yield* printCustomer(yield* safepay.customers.get(customer));
  }),
).pipe(Command.withDescription("Show a customer"));

const update = Command.make(
  "update",
  {
    customer,
    firstName: optional(details.firstName),
    lastName: optional(details.lastName),
    email: optional(details.email),
    phone: optional(details.phone),
    country: optional(details.country),
  },
  Effect.fn(function* ({ customer, ...update }) {
    const safepay = yield* Safepay;
    const updated = yield* safepay.customers.update(customer, update);
    yield* printCustomer(updated);
  }),
).pipe(Command.withDescription("Change a customer's details"));

const remove = Command.make(
  "delete",
  { customer },
  Effect.fn(function* ({ customer }) {
    const safepay = yield* Safepay;
    yield* safepay.customers.delete(customer);
    yield* Console.log(`Deleted ${customer}`);
  }),
).pipe(Command.withDescription("Delete a customer"));

const cards = Command.make(
  "cards",
  { customer },
  Effect.fn(function* ({ customer }) {
    const safepay = yield* Safepay;
    const methods = yield* safepay.customers.paymentMethods(customer);
    yield* Render.print(Schema.Array(PaymentMethod), Render.paymentMethods)(methods);
  }),
).pipe(Command.withDescription("List a customer's saved cards"));

const removeCard = Command.make(
  "delete-card",
  {
    customer,
    method: Argument.String("card").pipe(
      Argument.withSchema(PaymentMethodToken),
      Argument.withDescription("Saved card token, e.g. pm_bea00774-..."),
    ),
  },
  Effect.fn(function* ({ customer, method }) {
    const safepay = yield* Safepay;
    yield* safepay.customers.deletePaymentMethod(customer, method);
    yield* Console.log(`Deleted ${method}`);
  }),
).pipe(Command.withDescription("Remove a saved card"));

export const customers = Command.make("customers").pipe(
  Command.withDescription("Manage customers and their saved cards"),
  Command.withSubcommands([create, list, get, update, remove, cards, removeCard]),
  Command.provide(SafepayFromFlags),
);
