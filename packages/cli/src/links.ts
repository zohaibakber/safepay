import { Effect } from "effect";
import { Argument, Command, Flag } from "effect/cli";
import { Link, LinkToken } from "@sfpy-cli/core/links";
import { Safepay } from "@sfpy-cli/core/client";
import { Money } from "@sfpy-cli/core/payments";
import { amount, currency, optional } from "./flags.ts";
import * as Render from "./render.ts";
import { SafepayFromFlags } from "./root.ts";

const printLink = Render.print(Link, Render.link);

const create = Command.make(
  "create",
  {
    amount,
    currency,
    note: optional(
      Flag.String("note").pipe(Flag.withDescription("What the payment is for, shown to the payer")),
    ),
  },
  Effect.fn(function* ({ amount, currency, note }) {
    const safepay = yield* Safepay;
    const link = yield* safepay.links.create({
      amount: new Money({ currency, amount }),
      note,
    });
    yield* printLink(link);
  }),
).pipe(
  Command.withDescription("Create a payment link to share by WhatsApp or email"),
  Command.withExamples([
    {
      command: 'sfpy links create --amount 150000 --note "Invoice 42"',
      description: "Ask for PKR 1,500.00",
    },
  ]),
);

const get = Command.make(
  "get",
  {
    link: Argument.String("link").pipe(
      Argument.withSchema(LinkToken),
      Argument.withDescription("Link token, e.g. link_951878fb-..."),
    ),
  },
  Effect.fn(function* ({ link }) {
    const safepay = yield* Safepay;
    yield* printLink(yield* safepay.links.get(link));
  }),
).pipe(Command.withDescription("Show a payment link and whether it was paid"));

export const links = Command.make("links").pipe(
  Command.withDescription("Create and check payment links (Quick Links)"),
  Command.withSubcommands([create, get]),
  Command.provide(SafepayFromFlags),
);
