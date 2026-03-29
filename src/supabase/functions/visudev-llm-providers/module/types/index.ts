import type { ErrorDetailsEntry } from "../internal/exceptions/index.ts";

export interface ErrorResponse {
  success: false;
  error: {
    code: string;
    message: string;
    details?: ErrorDetailsEntry[];
  };
}
