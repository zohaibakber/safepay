import { Option } from "effect";
import { Flag } from "effect/cli";
import { PageRequest } from "@sfpy-cli/core/http";
import { Currency, MinorUnits } from "@sfpy-cli/core/payments";

export const optional = <A>(flag: Flag.Flag<A>) =>
  flag.pipe(Flag.optional, Flag.map(Option.getOrUndefined));

export const amount = Flag.Int("amount").pipe(
  Flag.withSchema(MinorUnits),
  Flag.withDescription("Amount in minor units, e.g. 50000 is PKR 500.00"),
);

export const currency = Flag.String("currency").pipe(
  Flag.withSchema(Currency),
  Flag.withDescription("ISO 4217 currency code"),
  Flag.withDefault(Currency.make("PKR")),
);

export const paging = {
  page: Flag.Int("page").pipe(
    Flag.withSchema(PageRequest.fields.page),
    Flag.withDescription("Page number, starting at 1"),
    Flag.withDefault(1),
  ),
  limit: Flag.Int("limit").pipe(
    Flag.withSchema(PageRequest.fields.limit),
    Flag.withDescription("Results per page, up to 30"),
    Flag.withDefault(20),
  ),
};
