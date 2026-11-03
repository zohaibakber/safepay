import { assert, describe, it } from "@effect/vitest";
import { ConfigProvider, Effect, Layer } from "effect";
import { HttpClient, HttpClientResponse, type HttpClientRequest } from "effect/http";
import { Safepay } from "../src/client.ts";
import { CountryCode, CustomerToken } from "../src/customers.ts";
import type { SafepayError } from "../src/error.ts";
import { LinkToken } from "../src/links.ts";
import { Currency, MinorUnits, Money, TrackerToken } from "../src/payments.ts";
import { PlanToken } from "../src/plans.ts";
import { SubscriptionToken } from "../src/subscriptions.ts";

const tracker = TrackerToken.make("track_70fdbb06-bbf7-44e1-b50a-672d9f1d8b26");

const trackerBody = (state: string, customer?: string) => ({
  data: {
    tracker: {
      token: tracker,
      client: "sec_edeade52-46aa-483b-b87d-009d3ce41554",
      environment: "sandbox",
      state,
      intent: "CYBERSOURCE",
      mode: "payment",
      next_actions: { CYBERSOURCE: { kind: "NOOP" } },
      purchase_totals: {
        quote_amount: { currency: "PKR", amount: 600000 },
        base_amount: { currency: "PKR", amount: 600000 },
        conversion_rate: { base_currency: "PKR", quote_currency: "PKR", rate: 1 },
      },
      metadata: {},
      ...(customer === undefined ? {} : { customer }),
    },
  },
  status: { errors: [], message: "success" },
});

interface Sent {
  readonly method: string;
  readonly url: string;
  readonly secret: string | undefined;
  readonly body: unknown;
}

type Route = (
  request: HttpClientRequest.HttpClientRequest,
) => readonly [status: number, body: unknown];

const withRoutes = <A, E>(routes: Route, effect: Effect.Effect<A, E, Safepay>) => {
  const sent: Array<Sent> = [];
  const client = HttpClient.make((request, url) =>
    Effect.sync(() => {
      sent.push({
        method: request.method,
        url: url.toString(),
        secret: request.headers["x-sfpy-merchant-secret"],
        body:
          request.body._tag === "Uint8Array"
            ? JSON.parse(new TextDecoder().decode(request.body.body))
            : undefined,
      });
      const [status, body] = routes(request);
      return HttpClientResponse.fromWeb(request, Response.json(body, { status }));
    }),
  );
  return effect.pipe(
    Effect.map((result) => ({ result, sent })),
    Effect.provide(
      Safepay.layerNoDeps("sandbox").pipe(
        Layer.provide([
          Layer.succeed(HttpClient.HttpClient, client),
          ConfigProvider.layer(
            ConfigProvider.fromUnknown({
              SAFEPAY_API_KEY: "sec_api",
              SAFEPAY_SECRET_KEY: "secret",
            }),
          ),
        ]),
      ),
    ),
  );
};

const pkr = (amount: number) =>
  new Money({ currency: Currency.make("PKR"), amount: MinorUnits.make(amount) });

const customer = CustomerToken.make("cus_e927d58d-3796-4f36-a209-384906d712ea");
const customerBody = {
  token: customer,
  email: "hzaidi@getsafepay.com",
  first_name: "Hassan",
  last_name: "Zaidi",
  phone_number: "+923001234567",
  country: "PK",
  is_guest: false,
  created_at: { seconds: 1697986036 },
};

const link = LinkToken.make("link_4c2a8f1e");

const plan = PlanToken.make("plan_d4869a78-0a2c-4e1b-9f3d-2c6b8e1f7a90");
const planBody = {
  token: plan,
  name: "Pro",
  product: "Pro tier",
  amount: "250000",
  currency: "PKR",
  interval: "MONTH",
  interval_count: 1,
  trial_period_days: 0,
  active: true,
  created_at: "2026-11-03T10:00:00Z",
};

const subscription = SubscriptionToken.make("sub_c841ea40-5b7d-4f2e-8a1c-9d3e6f0b2a71");
const subscriptionBody = {
  token: subscription,
  plan_id: plan,
  status: "ACTIVE",
  price_amount: "250000",
  price_currency: "PKR",
  cancel_at_period_end: false,
  created_at: "2026-11-03T10:00:00Z",
};

describe("Safepay", () => {
  it.effect("payments.get authenticates with the merchant secret and decodes the tracker", () =>
    Effect.gen(function* () {
      const { result, sent } = yield* withRoutes(
        () => [200, trackerBody("TRACKER_ENDED", "guest_3b2e4c1a-7f6d-4e2b-9a8c-1d5f6e7a8b9c")],
        Safepay.use((safepay) => safepay.payments.get(tracker)),
      );

      assert.deepStrictEqual(sent, [
        {
          method: "GET",
          url: `https://sandbox.api.getsafepay.com/order/payments/v3/${tracker}/status`,
          secret: "secret",
          body: undefined,
        },
      ]);
      assert.strictEqual(result.state, "TRACKER_ENDED");
      assert.strictEqual(result.customer, "guest_3b2e4c1a-7f6d-4e2b-9a8c-1d5f6e7a8b9c");
      assert.deepStrictEqual(result.amount, pkr(600000));
    }),
  );

  it.effect(
    "payments.createCheckout sets up a tracker, mints a time-based token, and builds the hosted URL",
    () =>
      Effect.gen(function* () {
        const { result, sent } = yield* withRoutes(
          (request) =>
            request.url.endsWith("/token")
              ? [200, { data: "tbt-token" }]
              : [201, trackerBody("TRACKER_STARTED")],
          Safepay.use((safepay) =>
            safepay.payments.createCheckout({
              amount: pkr(600000),
              orderId: "order-42",
              redirectUrl: new URL("https://shop.test/done"),
            }),
          ),
        );

        assert.deepStrictEqual(
          sent.map(({ method, url, secret }) => ({ method, url, secret })),
          [
            {
              method: "POST",
              url: "https://sandbox.api.getsafepay.com/order/payments/v3/",
              secret: undefined,
            },
            {
              method: "POST",
              url: "https://sandbox.api.getsafepay.com/client/passport/v1/token",
              secret: "secret",
            },
          ],
        );
        assert.deepStrictEqual(sent[0]?.body, {
          merchant_api_key: "sec_api",
          intent: "CYBERSOURCE",
          mode: "payment",
          currency: "PKR",
          amount: 600000,
        });
        assert.strictEqual(
          result.url.origin + result.url.pathname,
          "https://sandbox.api.getsafepay.com/embedded/",
        );
        assert.deepStrictEqual(Object.fromEntries(result.url.searchParams), {
          environment: "sandbox",
          tracker,
          tbt: "tbt-token",
          source: "hosted",
          order_id: "order-42",
          redirect_url: "https://shop.test/done",
        });
      }),
  );

  it.effect("payments.list sends indexed state filters and decodes the reporter page", () =>
    Effect.gen(function* () {
      const { result, sent } = yield* withRoutes(
        () => [
          200,
          {
            ok: true,
            data: {
              count: 798,
              list: [
                {
                  token: tracker,
                  environment: "sandbox",
                  customer: { token: "cus_f2cd94a0", email: "alex@example.com" },
                  state: "TRACKER_ENDED",
                  intent: "CYBERSOURCE",
                  mode: "payment",
                  currency: "PKR",
                  display_amount: "5.00",
                  created_at: { seconds: 1778858838 },
                },
              ],
            },
          },
        ],
        Safepay.use((safepay) =>
          safepay.payments.list({
            page: 2,
            limit: 5,
            states: ["TRACKER_ENDED", "TRACKER_REFUNDED"],
            customerEmail: "alex@example.com",
          }),
        ),
      );

      const url = new URL(sent[0]?.url ?? "");
      assert.strictEqual(
        url.origin + url.pathname,
        "https://sandbox.api.getsafepay.com/reporter/api/v2/payments",
      );
      assert.deepStrictEqual(Object.fromEntries(url.searchParams), {
        page: "2",
        limit: "5",
        direction: "DESC",
        "states[0]": "TRACKER_ENDED",
        "states[1]": "TRACKER_REFUNDED",
        customer_email: "alex@example.com",
      });
      assert.strictEqual(result.count, 798);
      assert.strictEqual(result.payments[0]?.customerEmail, "alex@example.com");
      assert.strictEqual(result.payments[0]?.createdAt.epochMilliseconds, 1778858838000);
    }),
  );

  it.effect.each([
    [
      400,
      "RequestRejected",
      "cannot refund tracker in state TRACKER_REFUNDED",
      {
        data: null,
        status: { errors: ["cannot refund tracker in state TRACKER_REFUNDED"], message: "fail" },
      },
    ],
    [
      401,
      "Unauthorized",
      "missing jwt token",
      { code: "error.unauthorized_access", message: "missing jwt token" },
    ],
    [403, "Unauthorized", "HTTP 403", ""],
    [
      404,
      "NotFound",
      "tracker not found; try again",
      { data: null, status: { errors: ["tracker not found", "try again"], message: "fail" } },
    ],
    [404, "NotFound", "subscription not found", { error: "subscription not found" }],
    [409, "RequestRejected", "conflict", { message: "conflict" }],
    [422, "RequestRejected", "amount is required", { message: "amount is required" }],
    [429, "RequestRejected", "slow down", { message: "slow down" }],
    [500, "ServerFailure", "boom", { message: "boom" }],
    [502, "ServerFailure", "HTTP 502", "<html>bad gateway</html>"],
    [503, "ServerFailure", "maintenance", { message: "maintenance" }],
  ] as const)(
    "a %i response fails with %s from typed and raw calls alike",
    ([status, reason, message, body]) =>
      Effect.gen(function* () {
        const failure = <A>(
          call: (safepay: Safepay["Service"]) => Effect.Effect<A, SafepayError>,
        ) =>
          withRoutes(() => [status, body], Safepay.use(call)).pipe(
            Effect.catchTag("MissingCredentials", Effect.die),
            Effect.flip,
            Effect.map(({ reason }) => [reason._tag, reason.message]),
          );

        assert.deepStrictEqual(
          yield* failure((safepay) => safepay.payments.refund(tracker, pkr(100))),
          [reason, message],
        );
        assert.deepStrictEqual(
          yield* failure((safepay) =>
            safepay.request("POST", `/order/payments/v3/${tracker}/refund`, {}),
          ),
          [reason, message],
        );
      }),
  );

  it.effect("a success body Safepay changed shape on fails as Unexpected", () =>
    Effect.gen(function* () {
      const error = yield* Effect.flip(
        withRoutes(
          () => [200, { data: { tracker: { token: tracker } } }],
          Safepay.use((safepay) => safepay.payments.get(tracker)),
        ).pipe(Effect.catchTag("MissingCredentials", Effect.die)),
      );

      assert.strictEqual(error.reason._tag, "Unexpected");
    }),
  );

  it.effect("request fails as Unexpected on a body JSON cannot encode, without sending it", () =>
    Effect.gen(function* () {
      const routed: Array<unknown> = [];
      const error = yield* Effect.flip(
        withRoutes(
          (request) => {
            routed.push(request);
            return [200, {}];
          },
          Safepay.use((safepay) => safepay.request("POST", "/anything", { amount: 1n })),
        ).pipe(Effect.catchTag("MissingCredentials", Effect.die)),
      );

      assert.strictEqual(error.reason._tag, "Unexpected");
      assert.deepStrictEqual(routed, []);
    }),
  );

  it.effect("payments.updateMetadata renames orderId and leaves out unset fields", () =>
    Effect.gen(function* () {
      const { sent } = yield* withRoutes(
        () => [201, trackerBody("TRACKER_STARTED")],
        Safepay.use((safepay) => safepay.payments.updateMetadata(tracker, { orderId: "A-1" })),
      );

      assert.deepStrictEqual(sent[0]?.body, { data: { order_id: "A-1" } });
    }),
  );

  it.effect("customers.create sends snake_case fields and decodes the 201 response", () =>
    Effect.gen(function* () {
      const { result, sent } = yield* withRoutes(
        () => [
          201,
          {
            data: {
              token: "cus_e927d58d-3796-4f36-a209-384906d712ea",
              email: "hzaidi@getsafepay.com",
              first_name: "Hassan",
              last_name: "Zaidi",
              phone_number: "+923331234567",
              country: "PK",
              is_guest: true,
              is_deleted: false,
              created_at: { seconds: 1697986036, nanos: 25310172 },
            },
            status: { errors: [], message: "success" },
          },
        ],
        Safepay.use((safepay) =>
          safepay.customers.create({
            firstName: "Hassan",
            lastName: "Zaidi",
            email: "hzaidi@getsafepay.com",
            phone: "+923331234567",
            country: CountryCode.make("PK"),
          }),
        ),
      );

      assert.deepStrictEqual(sent, [
        {
          method: "POST",
          url: "https://sandbox.api.getsafepay.com/user/customers/v1/",
          secret: "secret",
          body: {
            first_name: "Hassan",
            last_name: "Zaidi",
            email: "hzaidi@getsafepay.com",
            phone_number: "+923331234567",
            country: "PK",
          },
        },
      ]);
      assert.strictEqual(result.token, "cus_e927d58d-3796-4f36-a209-384906d712ea");
      assert.strictEqual(result.createdAt.epochMilliseconds, 1697986036000);
    }),
  );

  it.effect("customers.update sends only the fields that change", () =>
    Effect.gen(function* () {
      const { sent } = yield* withRoutes(
        () => [200, { data: customerBody }],
        Safepay.use((safepay) =>
          safepay.customers.update(customer, { phone: "+923001234567", email: undefined }),
        ),
      );

      assert.deepStrictEqual(sent[0]?.body, { phone_number: "+923001234567" });
    }),
  );

  it.effect("customers.paymentMethods reads a null wallet as no cards", () =>
    Effect.gen(function* () {
      const { result } = yield* withRoutes(
        () => [200, { data: { wallet: null } }],
        Safepay.use((safepay) => safepay.customers.paymentMethods(customer)),
      );

      assert.deepStrictEqual(result, []);
    }),
  );

  it.effect("links.get takes the tracker of the paid payment and drops an empty note", () =>
    Effect.gen(function* () {
      const { result } = yield* withRoutes(
        () => [
          200,
          {
            data: {
              link: {
                id: link,
                number: "QL-7",
                status: "ACTIVE",
                note: "",
                total: 250000,
                currency: "PKR",
                is_expired: false,
                created_at: "2026-11-03T10:00:00Z",
                metadata: [{ recipient_view_url: "https://sandbox.getsafepay.com/link/x" }],
                payment: [
                  { sp_tracker: "track_unpaid", is_paid: false },
                  { sp_tracker: tracker, is_paid: true },
                ],
              },
            },
          },
        ],
        Safepay.use((safepay) => safepay.links.get(link)),
      );

      assert.deepStrictEqual(result.state, { _tag: "Paid", tracker });
      assert.strictEqual(result.note, undefined);
      assert.strictEqual(result.url?.href, "https://sandbox.getsafepay.com/link/x");
      assert.deepStrictEqual(result.amount, pkr(250000));
    }),
  );

  it.effect("links.get reads an unpaid link past its expiry as Expired", () =>
    Effect.gen(function* () {
      const { result } = yield* withRoutes(
        () => [
          200,
          {
            data: {
              link: {
                id: link,
                number: "QL-7",
                status: "ACTIVE",
                note: "",
                total: 250000,
                currency: "PKR",
                is_expired: true,
                created_at: "2026-11-03T10:00:00Z",
                metadata: null,
                payment: [{ sp_tracker: tracker, is_paid: false }],
              },
            },
          },
        ],
        Safepay.use((safepay) => safepay.links.get(link)),
      );

      assert.deepStrictEqual(result.state, { _tag: "Expired" });
    }),
  );

  it.effect("plans.list reads string counts and a null list", () =>
    Effect.gen(function* () {
      const { result, sent } = yield* withRoutes(
        () => [200, { data: { count: "0", plans: null } }],
        Safepay.use((safepay) => safepay.plans.list({ page: 1, limit: 30 })),
      );

      assert.strictEqual(
        sent[0]?.url,
        "https://sandbox.api.getsafepay.com/client/plans/v1/search?page=1&limit=30",
      );
      assert.strictEqual(result.count, 0);
      assert.deepStrictEqual(result.plans, []);
    }),
  );

  it.effect("plans.create reads the new plan back, since Safepay answers with its ID", () =>
    Effect.gen(function* () {
      const { result, sent } = yield* withRoutes(
        (request) =>
          request.method === "POST"
            ? [200, { data: { plan_id: plan } }]
            : [200, { data: { plan: planBody } }],
        Safepay.use((safepay) =>
          safepay.plans.create({
            name: "Pro",
            product: "Pro tier",
            amount: pkr(250000),
            interval: "MONTH",
            intervalCount: 1,
          }),
        ),
      );

      assert.deepStrictEqual(
        sent.map(({ method, url, body }) => ({ method, url, body })),
        [
          {
            method: "POST",
            url: "https://sandbox.api.getsafepay.com/client/plans/v1/",
            body: {
              name: "Pro",
              product: "Pro tier",
              amount: "250000",
              currency: "PKR",
              interval: "MONTH",
              interval_count: 1,
              type: "RECURRING",
              active: true,
            },
          },
          {
            method: "GET",
            url: `https://sandbox.api.getsafepay.com/client/plans/v1/${plan}/`,
            body: undefined,
          },
        ],
      );
      assert.strictEqual(result.token, plan);
      assert.deepStrictEqual(result.amount, pkr(250000));
    }),
  );

  it.effect("subscriptions.resume keeps the billing cycle and reads the subscription back", () =>
    Effect.gen(function* () {
      const { result, sent } = yield* withRoutes(
        (request) =>
          request.method === "PUT"
            ? [200, { data: { request_id: "req_1" } }]
            : [200, { data: { subscription: subscriptionBody } }],
        Safepay.use((safepay) => safepay.subscriptions.resume(subscription)),
      );

      assert.deepStrictEqual(
        sent.map(({ method, url, body }) => ({ method, url, body })),
        [
          {
            method: "PUT",
            url: `https://sandbox.api.getsafepay.com/client/subscriptions/v1/${subscription}/resumption`,
            body: { billing_cycle_anchor: "unchanged" },
          },
          {
            method: "GET",
            url: `https://sandbox.api.getsafepay.com/client/subscriptions/v1/${subscription}`,
            body: undefined,
          },
        ],
      );
      assert.strictEqual(result.status, "ACTIVE");
      assert.strictEqual(result.plan, plan);
    }),
  );
});
