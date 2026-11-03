import { Effect } from "effect";
import { Argument, Command } from "effect/cli";
import { Safepay } from "@sfpy-cli/core/client";
import { Transaction, TransactionPage, TransactionToken } from "@sfpy-cli/core/transactions";
import { paging } from "./flags.ts";
import * as Render from "./render.ts";
import { SafepayFromFlags } from "./root.ts";

const transaction = Argument.String("transaction").pipe(
  Argument.withSchema(TransactionToken),
  Argument.withDescription("Transaction token, e.g. txn_17553398-..."),
);

const printTransaction = Render.print(Transaction, Render.transaction);

const list = Command.make(
  "list",
  paging,
  Effect.fn(function* (page) {
    const safepay = yield* Safepay;
    const found = yield* safepay.transactions.list(page);
    yield* Render.print(TransactionPage, Render.transactionPage)(found);
  }),
).pipe(Command.withDescription("List subscription charges and refunds"), Command.withAlias("ls"));

const get = Command.make(
  "get",
  { transaction },
  Effect.fn(function* ({ transaction }) {
    const safepay = yield* Safepay;
    yield* printTransaction(yield* safepay.transactions.get(transaction));
  }),
).pipe(Command.withDescription("Show a transaction"));

const refund = Command.make(
  "refund",
  { transaction },
  Effect.fn(function* ({ transaction }) {
    const safepay = yield* Safepay;
    yield* printTransaction(yield* safepay.transactions.refund(transaction));
  }),
).pipe(Command.withDescription("Refund a subscription charge in full"));

export const transactions = Command.make("transactions").pipe(
  Command.withDescription("Subscription charges and refunds"),
  Command.withSubcommands([list, get, refund]),
  Command.provide(SafepayFromFlags),
);
