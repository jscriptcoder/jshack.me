/**
 * HTTP status mapping for signed-request verification failures.
 *
 * Auth-class failures (bad signature / skew / replay) are 401; structural
 * failures (envelope/payload shape) are 400. Shared by every endpoint handler
 * that verifies a signed envelope so the mapping can't drift between them.
 */

import type { VerifyFailureReason } from './verify';

export const STATUS_BY_VERIFY_REASON: Record<VerifyFailureReason, number> = {
  envelope_invalid: 400,
  payload_malformed: 400,
  payload_invalid: 400,
  signature_invalid: 401,
  timestamp_skew: 401,
  replay: 401,
};
