import { Schema } from "effect";

export const Environment = Schema.Literals(["sandbox", "production", "development"]);
export type Environment = typeof Environment.Type;

export const apiUrl: Record<Environment, string> = {
  sandbox: "https://sandbox.api.getsafepay.com",
  production: "https://api.getsafepay.com",
  development: "https://dev.api.getsafepay.com",
};

export const checkoutUrl: Record<Environment, string> = {
  sandbox: "https://sandbox.api.getsafepay.com/embedded/",
  production: "https://getsafepay.com/embedded/",
  development: "https://dev.api.getsafepay.com/embedded/",
};
