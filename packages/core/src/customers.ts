import { Effect, Schema } from "effect";
import type { HttpApiClient } from "effect/http-api";
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema } from "effect/http-api";
import {
  dataEnvelope,
  listOrNull,
  MerchantSecret,
  omittable,
  PageRequest,
  wireCodec,
  Seconds,
  toSafepayError,
} from "./http.ts";

export const CustomerToken = Schema.String.pipe(
  Schema.check(Schema.isStartingWith("cus_")),
  Schema.brand("CustomerToken"),
);
export type CustomerToken = typeof CustomerToken.Type;

export const PaymentMethodToken = Schema.String.pipe(
  Schema.check(Schema.isStartingWith("pm_")),
  Schema.brand("PaymentMethodToken"),
);
export type PaymentMethodToken = typeof PaymentMethodToken.Type;

export const CountryCode = Schema.String.pipe(
  Schema.check(Schema.isPattern(/^[A-Z]{2}$/, { message: "Expected an ISO 3166 code like PK" })),
  Schema.brand("CountryCode"),
);
export type CountryCode = typeof CountryCode.Type;

export class Customer extends Schema.Class<Customer>("sfpy/Customer")({
  token: CustomerToken,
  email: Schema.String,
  firstName: Schema.String,
  lastName: Schema.String,
  phone: Schema.optional(Schema.String),
  country: Schema.optional(Schema.String),
  isGuest: Schema.Boolean,
  createdAt: Schema.DateTimeUtcFromString,
}) {}

export class CustomerPage extends Schema.Class<CustomerPage>("sfpy/CustomerPage")({
  count: Schema.Int,
  customers: Schema.Array(Customer),
}) {}

export class PaymentMethod extends Schema.Class<PaymentMethod>("sfpy/PaymentMethod")({
  token: PaymentMethodToken,
  bin: Schema.optional(Schema.String),
  lastFour: Schema.optional(Schema.String),
  expiry: Schema.optional(Schema.String),
  createdAt: Schema.DateTimeUtcFromString,
}) {}

export const NewCustomer = Schema.Struct({
  firstName: Schema.String,
  lastName: Schema.String,
  email: Schema.String,
  phone: Schema.String,
  country: CountryCode,
});
export type NewCustomer = typeof NewCustomer.Type;

export const CustomerUpdate = Schema.Struct({
  firstName: omittable(Schema.String),
  lastName: omittable(Schema.String),
  email: omittable(Schema.String),
  phone: omittable(Schema.String),
  country: omittable(CountryCode),
});
export type CustomerUpdate = typeof CustomerUpdate.Type;

const customerKeys = {
  firstName: "first_name",
  lastName: "last_name",
  phone: "phone_number",
} as const;

const CustomerWire = Schema.Struct({
  token: Schema.String,
  email: Schema.String,
  firstName: Schema.String,
  lastName: Schema.String,
  phone: Schema.optional(Schema.String),
  country: Schema.optional(Schema.String),
  isGuest: Schema.Boolean,
  createdAt: Seconds,
}).pipe(Schema.encodeKeys({ ...customerKeys, isGuest: "is_guest", createdAt: "created_at" }));

const PaymentMethodWire = wireCodec(
  Schema.Struct({
    token: Schema.String,
    created_at: Seconds,
    cybersource: Schema.optional(
      Schema.Struct({
        bin: Schema.String,
        last_four: Schema.String,
        expiry_month: Schema.String,
        expiry_year: Schema.String,
      }),
    ),
  }),
  PaymentMethod,
  {
    decode: ({ token, created_at, cybersource }) => ({
      token,
      createdAt: created_at,
      bin: cybersource?.bin,
      lastFour: cybersource?.last_four,
      expiry:
        cybersource === undefined
          ? undefined
          : `${cybersource.expiry_month}/${cybersource.expiry_year}`,
    }),
    encode: ({ token, createdAt, bin, lastFour, expiry }) => {
      const [expiry_month = "", expiry_year = ""] = expiry?.split("/") ?? [];
      return {
        token,
        created_at: createdAt,
        cybersource:
          bin === undefined || lastFour === undefined
            ? undefined
            : { bin, last_four: lastFour, expiry_month, expiry_year },
      };
    },
  },
);

const CustomerResult = dataEnvelope(CustomerWire.pipe(Schema.decodeTo(Customer)));
const Deleted = dataEnvelope(Schema.Struct({ deleted: Schema.Boolean }));

const params = { customer: CustomerToken };

export class CustomersApi extends HttpApiGroup.make("customers")
  .add(
    HttpApiEndpoint.post("create", "/user/customers/v1/", {
      payload: NewCustomer.pipe(Schema.encodeKeys(customerKeys)),
      success: CustomerResult.pipe(HttpApiSchema.status(201)),
    }),
    HttpApiEndpoint.get("list", "/user/customers/v1/", {
      query: PageRequest,
      success: dataEnvelope(
        Schema.Struct({ count: Schema.Number, customers: listOrNull(CustomerWire) }).pipe(
          Schema.decodeTo(CustomerPage),
        ),
      ),
    }),
    HttpApiEndpoint.get("get", "/user/customers/v1/:customer", {
      params,
      success: CustomerResult,
    }),
    HttpApiEndpoint.put("update", "/user/customers/v1/:customer", {
      params,
      payload: CustomerUpdate.pipe(Schema.encodeKeys(customerKeys)),
      success: CustomerResult,
    }),
    HttpApiEndpoint.delete("delete", "/user/customers/v1/:customer", {
      params,
      success: Deleted,
    }),
    HttpApiEndpoint.get("paymentMethods", "/user/customers/v1/:customer/wallet/", {
      params,
      success: dataEnvelope(
        Schema.Struct({
          wallet: listOrNull(PaymentMethodWire.pipe(Schema.decodeTo(PaymentMethod))),
        }),
      ),
    }),
    HttpApiEndpoint.delete("deletePaymentMethod", "/user/customers/v1/:customer/wallet/:method", {
      params: { customer: CustomerToken, method: PaymentMethodToken },
      success: Deleted,
    }),
  )
  .middleware(MerchantSecret) {}

export const make = (client: HttpApiClient.Client.Group<typeof CustomersApi, never, never>) => ({
  create: Effect.fn("Safepay.customers.create")(function* (customer: NewCustomer) {
    return yield* client.create({ payload: customer });
  }, toSafepayError),

  list: Effect.fn("Safepay.customers.list")(function* (page: PageRequest) {
    return yield* client.list({ query: page });
  }, toSafepayError),

  get: Effect.fn("Safepay.customers.get")(function* (customer: CustomerToken) {
    return yield* client.get({ params: { customer } });
  }, toSafepayError),

  update: Effect.fn("Safepay.customers.update")(function* (
    customer: CustomerToken,
    update: CustomerUpdate,
  ) {
    return yield* client.update({ params: { customer }, payload: update });
  }, toSafepayError),

  delete: Effect.fn("Safepay.customers.delete")(function* (customer: CustomerToken) {
    yield* client.delete({ params: { customer } });
  }, toSafepayError),

  paymentMethods: Effect.fn("Safepay.customers.paymentMethods")(function* (
    customer: CustomerToken,
  ) {
    const { wallet } = yield* client.paymentMethods({ params: { customer } });
    return wallet;
  }, toSafepayError),

  deletePaymentMethod: Effect.fn("Safepay.customers.deletePaymentMethod")(function* (
    customer: CustomerToken,
    method: PaymentMethodToken,
  ) {
    yield* client.deletePaymentMethod({ params: { customer, method } });
  }, toSafepayError),
});

export type Customers = ReturnType<typeof make>;
