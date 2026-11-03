import { env } from "cloudflare:workers";
import { Config, ConfigProvider, Effect, Layer } from "effect";
import { HttpRouter, HttpServer } from "effect/http";
import { Safepay } from "@sfpy-cli/core/client";
import { Environment } from "@sfpy-cli/core/environment";
import * as Mcp from "@sfpy-cli/mcp/server";

const App = Layer.unwrap(
  Effect.gen(function* () {
    const environment = yield* Config.schema(Environment, "SAFEPAY_ENVIRONMENT");
    const allowWrites = yield* Config.Boolean("SAFEPAY_ALLOW_WRITES").pipe(
      Config.withDefault(false),
    );
    const token = yield* Config.Redacted("SAFEPAY_MCP_TOKEN");
    return Mcp.layerHttp({ allowWrites, token }).pipe(
      Layer.provide([Safepay.layer(environment), HttpServer.layerServices]),
    );
  }),
).pipe(Layer.provide(ConfigProvider.layer(ConfigProvider.fromUnknown(env))));

const app = HttpRouter.toWebHandler(App, { disableLogger: true });

export default {
  fetch: (request: Request) => app.handler(request),
};
