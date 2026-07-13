import assert from "node:assert/strict";
import test from "node:test";

import { redactDiagnostic } from "../src/redaction.js";

test("secret fieldと長いidentifierを伏せる", () => {
  assert.deepEqual(
    redactDiagnostic({
      authorization: "Bearer secret",
      nested: {
        conduitToken: "secret",
        conversation: "12345678901234567890123456789012",
        status: 200,
      },
    }),
    {
      authorization: "[redacted]",
      nested: {
        conduitToken: "[redacted]",
        conversation: "[redacted]",
        status: 200,
      },
    },
  );
});
