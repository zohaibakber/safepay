import * as Cloudflare from "@alchemy.run/cloudflare";
import * as Alchemy from "alchemy";
import * as Config from "effect/Config";
import * as Effect from "effect/Effect";

export const Worker = Cloudflare.Worker("SafepayMcp", {
  main: "./src/worker.ts",
  env: {
    SAFEPAY_API_KEY: Config.Redacted("SAFEPAY_API_KEY"),
    SAFEPAY_SECRET_KEY: Config.Redacted("SAFEPAY_SECRET_KEY"),
    SAFEPAY_MCP_TOKEN: Config.Redacted("SAFEPAY_MCP_TOKEN"),
    SAFEPAY_ENVIRONMENT: Config.String("SAFEPAY_ENVIRONMENT"),
    SAFEPAY_ALLOW_WRITES: Config.String("SAFEPAY_ALLOW_WRITES").pipe(Config.withDefault("false")),
  },
});

export default Alchemy.Stack(
  "SafepayMcp",
  {
    providers: Cloudflare.providers(),
    state: Cloudflare.state(),
  },
  Effect.gen(function* () {
    const worker = yield* Worker;
    return { url: worker.url };
  }),
);
