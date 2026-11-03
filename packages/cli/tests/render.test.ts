import { assert, describe, it } from "@effect/vitest";
import { Currency, MinorUnits, Money } from "@sfpy-cli/core/payments";
import * as Render from "../src/render.ts";

const money = (currency: string, amount: number) =>
  Render.money(
    new Money({ currency: Currency.make(currency), amount: MinorUnits.make(amount) }),
  ).replace(/\s/g, " ");

describe("Render.money", () => {
  it("reads minor units as hundredths, including for PKR", () => {
    assert.strictEqual(money("PKR", 250000), "PKR 2,500.00");
    assert.strictEqual(money("USD", 1999), "USD 19.99");
  });
});
