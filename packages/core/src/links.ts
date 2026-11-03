import { Effect, Schema } from "effect";
import type { HttpApiClient } from "effect/http-api";
import { HttpApiEndpoint, HttpApiGroup } from "effect/http-api";
import { dataEnvelope, MerchantSecret, omittable, wireCodec, toSafepayError } from "./http.ts";
import { Currency, MinorUnits, Money, TrackerToken } from "./payments.ts";

export const LinkToken = Schema.String.pipe(
  Schema.check(Schema.isStartingWith("link_")),
  Schema.brand("LinkToken"),
);
export type LinkToken = typeof LinkToken.Type;

export const LinkState = Schema.TaggedUnion({
  Paid: { tracker: TrackerToken },
  Expired: {},
  Open: {},
});
export type LinkState = typeof LinkState.Type;

export class Link extends Schema.Class<Link>("sfpy/Link")({
  id: LinkToken,
  number: Schema.String,
  status: Schema.String,
  state: LinkState,
  amount: Money,
  note: Schema.optional(Schema.String),
  url: Schema.optional(Schema.URLFromString),
  createdAt: Schema.DateTimeUtcFromString,
}) {}

export interface NewLink {
  readonly amount: Money;
  readonly note?: string | undefined;
}

const LinkWire = wireCodec(
  Schema.Struct({
    id: Schema.String,
    number: Schema.String,
    status: Schema.String,
    note: Schema.String,
    total: Schema.Number,
    currency: Schema.String,
    is_expired: Schema.Boolean,
    created_at: Schema.String,
    metadata: Schema.NullOr(Schema.Array(Schema.Struct({ recipient_view_url: Schema.String }))),
    payment: Schema.NullOr(
      Schema.Array(Schema.Struct({ sp_tracker: Schema.String, is_paid: Schema.Boolean })),
    ),
  }),
  Link,
  {
    decode: (link) => {
      const paid = link.payment?.find((payment) => payment.is_paid);
      return {
        id: link.id,
        number: link.number,
        status: link.status,
        state:
          paid !== undefined
            ? { _tag: "Paid" as const, tracker: paid.sp_tracker }
            : link.is_expired
              ? { _tag: "Expired" as const }
              : { _tag: "Open" as const },
        amount: { currency: link.currency, amount: link.total },
        note: link.note === "" ? undefined : link.note,
        url: link.metadata?.[0]?.recipient_view_url,
        createdAt: link.created_at,
      };
    },
    encode: (link) => ({
      id: link.id,
      number: link.number,
      status: link.status,
      note: link.note ?? "",
      total: link.amount.amount,
      currency: link.amount.currency,
      is_expired: link.state._tag === "Expired",
      created_at: link.createdAt,
      metadata: link.url === undefined ? null : [{ recipient_view_url: link.url }],
      payment:
        link.state._tag === "Paid" ? [{ sp_tracker: link.state.tracker, is_paid: true }] : null,
    }),
  },
);

const LinkResult = LinkWire.pipe(Schema.decodeTo(Link));

export class LinksApi extends HttpApiGroup.make("links")
  .add(
    HttpApiEndpoint.post("create", "/invoice/quick-links/v2/", {
      payload: Schema.Struct({
        amount: MinorUnits,
        currency: Currency,
        note: omittable(Schema.String),
        workflow: Schema.Literal("MANUAL"),
      }),
      success: dataEnvelope(LinkResult),
    }),
    HttpApiEndpoint.get("get", "/invoice/quick-links/v2/:link", {
      params: { link: LinkToken },
      success: dataEnvelope(Schema.Struct({ link: LinkResult })),
    }),
  )
  .middleware(MerchantSecret) {}

export const make = (client: HttpApiClient.Client.Group<typeof LinksApi, never, never>) => ({
  create: Effect.fn("Safepay.links.create")(function* ({ amount, note }: NewLink) {
    return yield* client.create({
      payload: { amount: amount.amount, currency: amount.currency, note, workflow: "MANUAL" },
    });
  }, toSafepayError),

  get: Effect.fn("Safepay.links.get")(function* (link: LinkToken) {
    const result = yield* client.get({ params: { link } });
    return result.link;
  }, toSafepayError),
});

export type Links = ReturnType<typeof make>;
