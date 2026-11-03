import { assert, describe, it } from "@effect/vitest";
import { DateTime, Effect, Layer, Redacted } from "effect";
import { McpClient, McpProtocol, McpTest } from "effect/ai";
import {
  HttpClient,
  HttpClientRequest,
  HttpClientResponse,
  HttpRouter,
  HttpServer,
} from "effect/http";
import { Safepay } from "@sfpy-cli/core/client";
import { PaymentMethod, PaymentMethodToken } from "@sfpy-cli/core/customers";
import { NotFound, SafepayError } from "@sfpy-cli/core/error";
import { Link, LinkToken, type NewLink } from "@sfpy-cli/core/links";
import {
  Currency,
  MinorUnits,
  Money,
  type PaymentSearch,
  PaymentPage,
} from "@sfpy-cli/core/payments";
import { PlanToken } from "@sfpy-cli/core/plans";
import { Subscription } from "@sfpy-cli/core/subscriptions";
import * as Mcp from "../src/server.ts";

const unused = Effect.die("not called by this test");

const stubOrDie = <A extends object>(overrides: Partial<A> = {}): A =>
  new Proxy(overrides, {
    get: (target, key) => target[key as keyof A] ?? (() => unused),
  }) as A;

type Service = Safepay["Service"];

type Namespaces = Omit<Service, "environment" | "request">;

const safepay = (overrides: { readonly [K in keyof Namespaces]?: Partial<Namespaces[K]> } = {}) =>
  Layer.succeed(
    Safepay,
    Safepay.of({
      environment: "sandbox",
      payments: stubOrDie(overrides.payments),
      customers: stubOrDie(overrides.customers),
      links: stubOrDie(overrides.links),
      plans: stubOrDie(overrides.plans),
      subscriptions: stubOrDie(overrides.subscriptions),
      transactions: stubOrDie(overrides.transactions),
      webhooks: stubOrDie(overrides.webhooks),
      request: () => unused,
    }),
  );

const client = (options: Mcp.Options, service: Layer.Layer<Safepay>) =>
  McpTest.makeClient(Mcp.tools(options), { protocols: [McpProtocol.v2026_07_28] }).pipe(
    Effect.provide(service),
  );

const createdAt = DateTime.makeUnsafe("2026-11-03T10:00:00Z");

describe("Mcp server", () => {
  it.effect("offers the tools that move money only when writes are allowed", () =>
    Effect.gen(function* () {
      const listed = Effect.fn(function* (allowWrites: boolean) {
        const { tools } = yield* (yield* client({ allowWrites }, safepay())).listTools();
        return tools;
      });
      const reads = yield* listed(false);
      const all = yield* listed(true);
      const destructive = (tools: typeof all) =>
        tools
          .filter(({ annotations }) => annotations?.destructiveHint !== false)
          .map(({ name }) => name);

      assert.deepStrictEqual(destructive(reads), []);
      assert.sameMembers(destructive(all), [
        "refund_payment",
        "void_payment",
        "reverse_payment",
        "cancel_subscription",
        "refund_transaction",
      ]);
      assert.sameMembers(
        all.map(({ name }) => name),
        [...reads.map(({ name }) => name), ...destructive(all)],
      );
    }),
  );

  it.effect("list_payments asks for the first page of 20 when the model passes nothing", () =>
    Effect.gen(function* () {
      const pages: Array<PaymentSearch> = [];
      const mcp = yield* client(
        { allowWrites: false },
        safepay({
          payments: {
            list: (page) =>
              Effect.sync(() => {
                pages.push(page);
                return new PaymentPage({ count: 0, payments: [] });
              }),
          },
        }),
      );

      const result = yield* mcp.callTool({ name: "list_payments", arguments: {} });

      assert.deepStrictEqual(
        pages.map(({ page, limit }) => ({ page, limit })),
        [{ page: 1, limit: 20 }],
      );
      assert.notStrictEqual(result.isError, true);
      assert.deepStrictEqual(result.structuredContent, { count: 0, payments: [] });
    }),
  );

  it.effect("create_payment_link charges PKR unless the model names a currency", () =>
    Effect.gen(function* () {
      const created: Array<NewLink> = [];
      const mcp = yield* client(
        { allowWrites: false },
        safepay({
          links: {
            create: (link) =>
              Effect.sync(() => {
                created.push(link);
                return new Link({
                  id: LinkToken.make("link_1"),
                  number: "QL-1",
                  status: "ACTIVE",
                  state: { _tag: "Open" },
                  amount: link.amount,
                  createdAt,
                });
              }),
          },
        }),
      );

      const result = yield* mcp.callTool({
        name: "create_payment_link",
        arguments: { amount: 50000, note: "Invoice 42" },
      });

      assert.notStrictEqual(result.isError, true);
      assert.deepStrictEqual(created, [
        {
          amount: new Money({ currency: Currency.make("PKR"), amount: MinorUnits.make(50000) }),
          note: "Invoice 42",
        },
      ]);
    }),
  );

  it.effect("list_customer_cards returns the cards under a cards key", () =>
    Effect.gen(function* () {
      const mcp = yield* client(
        { allowWrites: false },
        safepay({
          customers: {
            paymentMethods: () =>
              Effect.succeed([
                new PaymentMethod({
                  token: PaymentMethodToken.make("pm_1"),
                  lastFour: "4242",
                  createdAt,
                }),
              ]),
          },
        }),
      );

      const result = yield* mcp.callTool({
        name: "list_customer_cards",
        arguments: { customer: "cus_1" },
      });

      assert.deepStrictEqual(result.structuredContent, {
        cards: [{ token: "pm_1", lastFour: "4242", createdAt: "2026-11-03T10:00:00.000Z" }],
      });
    }),
  );

  it.effect("returns a Safepay failure to the model as a tool error", () =>
    Effect.gen(function* () {
      const mcp = yield* client(
        { allowWrites: false },
        safepay({
          payments: {
            get: () =>
              Effect.fail(
                new SafepayError({ reason: new NotFound({ message: "tracker not found" }) }),
              ),
          },
        }),
      );

      const result = yield* mcp.callTool({
        name: "get_payment",
        arguments: { tracker: "track_missing" },
      });

      assert.strictEqual(result.isError, true);
      assert.include(JSON.stringify(result.content), "tracker not found");
    }),
  );

  it.effect("cancel_subscription cancels through the subscriptions service", () =>
    Effect.gen(function* () {
      const cancelled: Array<string> = [];
      const mcp = yield* client(
        { allowWrites: true },
        safepay({
          subscriptions: {
            cancel: (subscription) =>
              Effect.sync(() => {
                cancelled.push(subscription);
                return new Subscription({
                  token: subscription,
                  plan: PlanToken.make("plan_1"),
                  status: "CANCELED",
                  amount: new Money({
                    currency: Currency.make("PKR"),
                    amount: MinorUnits.make(250000),
                  }),
                  cancelAtPeriodEnd: false,
                  createdAt,
                });
              }),
          },
        }),
      );

      const result = yield* mcp.callTool({
        name: "cancel_subscription",
        arguments: { subscription: "sub_1" },
      });

      assert.notStrictEqual(result.isError, true);
      assert.deepStrictEqual(cancelled, ["sub_1"]);
    }),
  );

  describe("over HTTP", () => {
    const served = (service: Layer.Layer<Safepay>) =>
      Effect.acquireRelease(
        Effect.sync(() =>
          HttpRouter.toWebHandler(
            Mcp.layerHttp({ allowWrites: false, token: Redacted.make("mcp-token") }).pipe(
              Layer.provide([service, HttpServer.layerServices]),
            ),
            { disableLogger: true },
          ),
        ),
        ({ dispose }) => Effect.promise(dispose),
      );

    const clientOf = (handler: (request: Request) => Promise<Response>) =>
      HttpClient.make((request) =>
        HttpClientRequest.toWeb(request).pipe(
          Effect.flatMap((web) => Effect.promise(() => handler(web))),
          Effect.map((response) => HttpClientResponse.fromWeb(request, response)),
          Effect.orDie,
        ),
      );

    it.effect("rejects a request without the bearer token", () =>
      Effect.gen(function* () {
        const { handler } = yield* served(safepay());
        const response = yield* Effect.promise(() =>
          handler(
            new Request("http://worker/mcp", {
              method: "POST",
              headers: { authorization: "Bearer wrong", "content-type": "application/json" },
              body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
            }),
          ),
        );

        assert.strictEqual(response.status, 401);
      }),
    );

    it.effect("serves tool calls to a client holding the token", () =>
      Effect.gen(function* () {
        const { handler } = yield* served(
          safepay({
            payments: { list: () => Effect.succeed(new PaymentPage({ count: 0, payments: [] })) },
          }),
        );
        const result = yield* Effect.gen(function* () {
          const mcp = yield* McpClient.McpClient;
          const tools = yield* mcp.listTools();
          const tool = tools.find(({ name }) => name === "list_payments");
          assert.isDefined(tool);
          return yield* mcp.callTool({ tool, arguments: {} });
        }).pipe(
          Effect.provide(
            McpClient.layerHttp({
              name: "test",
              version: "0.0.0",
              protocol: McpProtocol.v2026_07_28,
              url: "http://worker/mcp",
              headers: { authorization: "Bearer mcp-token" },
            }).pipe(Layer.provide(Layer.succeed(HttpClient.HttpClient, clientOf(handler)))),
          ),
        );

        assert.deepStrictEqual(result.structuredContent, { count: 0, payments: [] });
      }),
    );
  });
});
