import assert from "node:assert/strict";
import test from "node:test";
import { canTransitionIncident } from "../src/discipline-rules";

test("les incidents suivent un circuit signalement, décision, notification, clôture", () => {
  assert.equal(canTransitionIncident("SIGNALE", "DECIDE"), true);
  assert.equal(canTransitionIncident("DECIDE", "NOTIFIE"), true);
  assert.equal(canTransitionIncident("NOTIFIE", "CLOTURE"), true);
  assert.equal(canTransitionIncident("SIGNALE", "NOTIFIE"), false);
  assert.equal(canTransitionIncident("CLOTURE", "DECIDE"), false);
});
