# sfpy

`sfpy` is the command-line tool for the [Safepay](https://apidocs.getsafepay.com/) merchant API. `sfpy-mcp` is the MCP server. Both live in this repo and call `@sfpy-cli/core`. Built with Effect and Vite+.

## Configure

Set your merchant keys from the Developer section of the Safepay dashboard:

```bash
export SAFEPAY_API_KEY=sec_...        # public API key
export SAFEPAY_SECRET_KEY=...         # secret key
export SAFEPAY_ENVIRONMENT=sandbox    # or production, development. --env overrides it
export SAFEPAY_WEBHOOK_SECRET=...     # only for sfpy webhooks verify and send
```

Amounts are integers in the currency's minor units: `--amount 50000` is PKR 500.00. Commands that print a payment, customer, link, plan, subscription, or transaction take `--json` for machine-readable output.

## Commands

### Payments

```bash
sfpy payments create --amount 50000 --order-id A-1 --open   # opens hosted checkout
sfpy payments get track_...
sfpy payments list --state refunded --email ali@example.com --since 2026-11-01
sfpy payments refund track_... --amount 10000
sfpy payments void track_... --kind VOID_CAPTURE
sfpy payments reverse track_... --authorization auth_...
sfpy payments metadata track_... --order-id A-1 --source shopify
```

### Customers

```bash
sfpy customers create --first-name Ali --last-name Khan --email ali@example.com \
  --phone +923331234567 --country PK
sfpy customers list
sfpy customers get cus_...
sfpy customers update cus_... --phone +923001234567
sfpy customers delete cus_...
sfpy customers cards cus_...                 # saved cards
sfpy customers delete-card cus_... pm_...
```

### Quick Links

```bash
sfpy links create --amount 250000 --note "Invoice 42"   # prints a shareable payment URL
sfpy links get link_...
```

### Subscriptions

```bash
sfpy plans create --name Pro --product "Pro tier" --amount 250000 --interval MONTH
sfpy plans list
sfpy plans update plan_... --no-active        # stop new sign-ups
sfpy plans archive plan_...
sfpy subscriptions list
sfpy subscriptions pause sub_... --collection KEEP_AS_READY
sfpy subscriptions resume sub_...
sfpy subscriptions cancel sub_...
sfpy transactions list
sfpy transactions refund txn_...
```

### Webhooks

```bash
sfpy webhooks verify --signature "$SIG" --payload body.json
sfpy webhooks send --to http://localhost:3000/webhooks/safepay --event payment.succeeded
sfpy webhooks test --event payment.succeeded   # Safepay delivers to your dashboard endpoints
```

`send` signs a test event with your webhook secret and posts it to a local handler, the same way Safepay does.

### Any other endpoint

```bash
sfpy api GET '/client/plans/v1/search?limit=5'
sfpy api POST /some/path --data '{"key":"value"}'
```

`sfpy api` sends your secret key and prints the JSON response.

## MCP server

`sfpy-mcp` reads the same `SAFEPAY_API_KEY`, `SAFEPAY_SECRET_KEY`, and `SAFEPAY_ENVIRONMENT` variables. `--env` overrides the environment.

```bash
claude mcp add safepay -- sfpy-mcp
claude mcp add safepay -- sfpy-mcp --allow-writes
```

The default server can look up payments, customers, saved cards, Quick Links, plans, subscriptions, and transactions. It can also create checkouts and Quick Links, which move no money until someone pays.

`--allow-writes` adds `refund_payment`, `void_payment`, `reverse_payment`, `cancel_subscription`, and `refund_transaction`. These are marked destructive, so MCP clients ask before calling them.

### Remote server on Cloudflare Workers

`packages/worker` serves the same tools over Streamable HTTP at `/mcp`, deployed with [Alchemy](https://alchemy.run). Every request must send `Authorization: Bearer $SAFEPAY_MCP_TOKEN`. Others get a 401.

```bash
cd packages/worker
bunx alchemy profile edit --add Cloudflare   # once, signs in to Cloudflare
export SAFEPAY_MCP_TOKEN=$(openssl rand -hex 32)
SAFEPAY_ENVIRONMENT=sandbox bun run deploy  # prints the Worker URL
```

The deploy reads `SAFEPAY_API_KEY`, `SAFEPAY_SECRET_KEY`, `SAFEPAY_MCP_TOKEN`, and `SAFEPAY_ENVIRONMENT` from the environment or `.env`, and uploads the keys and the token as Worker secrets. Set `SAFEPAY_ALLOW_WRITES=true` to expose the tools that move money. Use `--stage` to keep sandbox and production apart, and `bun run destroy` to remove the Worker.

```bash
claude mcp add --transport http safepay https://<worker-url>/mcp \
  --header "Authorization: Bearer $SAFEPAY_MCP_TOKEN"
```

## Packages

- `@sfpy-cli/core` is the Effect client for the Safepay merchant API, plus webhook signing.
- `sfpy` is the CLI. Its build bundles the client.
- `@sfpy-cli/mcp` registers Safepay tools on an Effect MCP server. `sfpy-mcp` is its executable.
- `@sfpy-cli/worker` deploys that same server to Cloudflare Workers with Alchemy.

## Development

```bash
vp install
vp run dev -- payments --help
vp run ready   # check, test, build
```

The build writes `packages/cli/dist/sfpy` and `packages/mcp/dist/sfpy-mcp`, one executable each for the machine that compiled it. Those files include the Bun runtime.
