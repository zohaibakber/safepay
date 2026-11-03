import { Command } from "effect/cli";
import { api } from "./api.ts";
import { customers } from "./customers.ts";
import { links } from "./links.ts";
import { mcp } from "./mcp.ts";
import { payments } from "./payments.ts";
import { plans } from "./plans.ts";
import { subscriptions } from "./subscriptions.ts";
import { transactions } from "./transactions.ts";
import { root } from "./root.ts";
import { webhooks } from "./webhooks.ts";

export const cli = root.pipe(
  Command.withSubcommands([
    payments,
    customers,
    links,
    plans,
    subscriptions,
    transactions,
    webhooks,
    api,
    mcp,
  ]),
);
