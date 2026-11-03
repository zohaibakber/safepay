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
import { SubscriptionToken } from "./subscriptions.ts";

export const TransactionToken = Schema.String.pipe(
  Schema.check(Schema.isStartingWith("txn_")),
  Schema.brand("TransactionToken"),
);
export type TransactionToken = typeof TransactionToken.Type;

export class Transaction extends Schema.Class<Transaction>("sfpy/Transaction")({
  token: TransactionToken,
  subscription: Schema.optional(SubscriptionToken),
  kind: Schema.String,
  status: Schema.String,
  amount: Money,
  chargeAt: Schema.optional(Schema.DateTimeUtcFromString),
  createdAt: Schema.DateTimeUtcFromString,
}) {}

export class TransactionPage extends Schema.Class<TransactionPage>("sfpy/TransactionPage")({
  count: Schema.Int,
  transactions: Schema.Array(Transaction),
}) {}

const TransactionWire = wireCodec(
  Schema.Struct({
    token: Schema.String,
    subscription_id: Schema.optional(Schema.String),
    transaction_type: Schema.String,
    status: Schema.String,
    amount: Schema.String,
    currency: Schema.String,
    charge_at: Schema.optional(Schema.String),
    created_at: Schema.String,
  }),
  Transaction,
  {
    decode: (transaction) => ({
      token: transaction.token,
      subscription: transaction.subscription_id === "" ? undefined : transaction.subscription_id,
      kind: transaction.transaction_type,
      status: transaction.status,
      amount: { currency: transaction.currency, amount: Number(transaction.amount) },
      chargeAt: transaction.charge_at,
      createdAt: transaction.created_at,
    }),
    encode: (transaction) => ({
      token: transaction.token,
      subscription_id: transaction.subscription,
      transaction_type: transaction.kind,
      status: transaction.status,
      amount: String(transaction.amount.amount),
      currency: transaction.amount.currency,
      charge_at: transaction.chargeAt,
      created_at: transaction.createdAt,
    }),
  },
);

const TransactionResult = dataEnvelope(
  Schema.Struct({ transaction: TransactionWire.pipe(Schema.decodeTo(Transaction)) }),
);

const TransactionPageWire = Schema.Struct({
  count: Count,
  transactions: listOrNull(TransactionWire),
});

const params = { transaction: TransactionToken };

export class TransactionsApi extends HttpApiGroup.make("transactions")
  .add(
    HttpApiEndpoint.get("list", "/client/transactions/v1/search", {
      query: PageRequest,
      success: dataEnvelope(TransactionPageWire.pipe(Schema.decodeTo(TransactionPage))),
    }),
    HttpApiEndpoint.get("get", "/client/transactions/v1/:transaction", {
      params,
      success: TransactionResult,
    }),
    HttpApiEndpoint.post("refund", "/client/transactions/v1/:transaction/refund", {
      params,
      success: TransactionResult,
    }),
  )
  .middleware(MerchantSecret) {}

export const make = (client: HttpApiClient.Client.Group<typeof TransactionsApi, never, never>) => ({
  list: Effect.fn("Safepay.transactions.list")(function* (page: PageRequest) {
    return yield* client.list({ query: page });
  }, toSafepayError),

  get: Effect.fn("Safepay.transactions.get")(function* (transaction: TransactionToken) {
    const result = yield* client.get({ params: { transaction } });
    return result.transaction;
  }, toSafepayError),

  refund: Effect.fn("Safepay.transactions.refund")(function* (transaction: TransactionToken) {
    const result = yield* client.refund({ params: { transaction } });
    return result.transaction;
  }, toSafepayError),
});

export type Transactions = ReturnType<typeof make>;
