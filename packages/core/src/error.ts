import { Schema } from "effect";
import { CliError } from "effect/cli";

export class RequestRejected extends Schema.TaggedError<RequestRejected>()("RequestRejected", {
  message: Schema.String,
}) {}

export class Unauthorized extends Schema.TaggedError<Unauthorized>()("Unauthorized", {
  message: Schema.String,
}) {}

export class NotFound extends Schema.TaggedError<NotFound>()("NotFound", {
  message: Schema.String,
}) {}

export class ServerFailure extends Schema.TaggedError<ServerFailure>()("ServerFailure", {
  message: Schema.String,
}) {}

export class Unexpected extends Schema.TaggedError<Unexpected>()("Unexpected", {
  message: Schema.String,
  cause: Schema.Defect(),
}) {}

export const SafepayErrorReason = Schema.Union([
  RequestRejected,
  Unauthorized,
  NotFound,
  ServerFailure,
  Unexpected,
]);
export type SafepayErrorReason = typeof SafepayErrorReason.Type;

export class SafepayError extends Schema.TaggedError<SafepayError>()("SafepayError", {
  reason: SafepayErrorReason,
}) {
  override get message() {
    return `${this.reason._tag}: ${this.reason.message}`;
  }
  override get [CliError.userMessage]() {
    return this.message;
  }
}
