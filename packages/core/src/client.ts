import { Config, Context, Effect, Layer, Redacted, Schema } from "effect";
import { CliError } from "effect/cli";
import { FetchHttpClient, HttpClient, HttpClientRequest, type HttpMethod } from "effect/http";
import { HttpApi, HttpApiClient, HttpApiMiddleware } from "effect/http-api";
import { apiUrl, type Environment } from "./environment.ts";
import type { SafepayError } from "./error.ts";
import { MerchantSecret, toSafepayError } from "./http.ts";
import * as Customers from "./customers.ts";
import * as Links from "./links.ts";
import * as Payments from "./payments.ts";
import * as Plans from "./plans.ts";
import * as Subscriptions from "./subscriptions.ts";
import * as Transactions from "./transactions.ts";
import * as Webhooks from "./webhooks.ts";

export class SafepayApi extends HttpApi.make("safepay").add(
  Payments.PaymentsApi,
  Customers.CustomersApi,
  Links.LinksApi,
  Plans.PlansApi,
  Subscriptions.SubscriptionsApi,
  Transactions.TransactionsApi,
  Webhooks.WebhooksApi,
) {}

export class MissingCredentials extends Schema.TaggedError<MissingCredentials>()(
  "MissingCredentials",
  { message: Schema.String },
) {
  override get [CliError.userMessage]() {
    return this.message;
  }
}

const credentials = Config.all({
  apiKey: Config.Redacted("SAFEPAY_API_KEY"),
  secretKey: Config.Redacted("SAFEPAY_SECRET_KEY"),
}).pipe(
  Effect.mapError(
    () =>
      new MissingCredentials({
        message:
          "Set SAFEPAY_API_KEY and SAFEPAY_SECRET_KEY. Both are in the Developer section of the Safepay dashboard.",
      }),
  ),
);

export class Safepay extends Context.Service<
  Safepay,
  {
    readonly environment: Environment;
    readonly payments: Payments.Payments;
    readonly customers: Customers.Customers;
    readonly links: Links.Links;
    readonly plans: Plans.Plans;
    readonly subscriptions: Subscriptions.Subscriptions;
    readonly transactions: Transactions.Transactions;
    readonly webhooks: Webhooks.Webhooks;
    request(
      method: HttpMethod.HttpMethod,
      path: string,
      body?: unknown,
    ): Effect.Effect<unknown, SafepayError>;
  }
>()("sfpy/Safepay") {
  static readonly layerNoDeps = (environment: Environment) =>
    Layer.effect(
      Safepay,
      Effect.gen(function* () {
        const { apiKey, secretKey } = yield* credentials;
        const client = yield* HttpApiClient.make(SafepayApi, { baseUrl: apiUrl[environment] }).pipe(
          Effect.provide(
            HttpApiMiddleware.layerClient(MerchantSecret, ({ next, request }) =>
              next(
                HttpClientRequest.setHeader(
                  request,
                  MerchantSecret.security.secret.key,
                  Redacted.value(secretKey),
                ),
              ),
            ),
          ),
        );
        const http = (yield* HttpClient.HttpClient).pipe(
          HttpClient.filterStatusOk,
          HttpClient.mapRequest((request) =>
            request.pipe(
              HttpClientRequest.prependUrl(apiUrl[environment]),
              HttpClientRequest.setHeader(
                MerchantSecret.security.secret.key,
                Redacted.value(secretKey),
              ),
            ),
          ),
        );

        const request = Effect.fn("Safepay.request")(function* (
          method: HttpMethod.HttpMethod,
          path: string,
          body?: unknown,
        ) {
          const request = HttpClientRequest.make(method)(path);
          const response = yield* http.execute(
            body === undefined ? request : yield* HttpClientRequest.bodyJson(request, body),
          );
          const text = yield* response.text;
          return yield* Effect.try(() => JSON.parse(text) as unknown).pipe(
            Effect.orElseSucceed(() => text),
          );
        }, toSafepayError);

        return Safepay.of({
          environment,
          payments: Payments.make(client.payments, { environment, apiKey }),
          customers: Customers.make(client.customers),
          links: Links.make(client.links),
          plans: Plans.make(client.plans),
          subscriptions: Subscriptions.make(client.subscriptions),
          transactions: Transactions.make(client.transactions),
          webhooks: Webhooks.make(client.webhooks),
          request,
        });
      }),
    );

  static readonly layer = (environment: Environment) =>
    Safepay.layerNoDeps(environment).pipe(Layer.provide(FetchHttpClient.layer));
}
