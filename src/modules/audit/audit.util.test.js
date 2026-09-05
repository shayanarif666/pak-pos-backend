import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { redactAuditPayload } from "../../shared/utils/audit.util.js"

describe("redactAuditPayload", () => {
  it("strips password and PIN from nested objects", () => {
    const redacted = redactAuditPayload({
      email: "a@b.c",
      password: "secret12",
      pin: "1111",
      nested: { access_token: "abc", name: "Ali" },
    })
    assert.equal(redacted.email, "a@b.c")
    assert.equal(redacted.password, "[redacted]")
    assert.equal(redacted.pin, "[redacted]")
    assert.equal(redacted.nested.access_token, "[redacted]")
    assert.equal(redacted.nested.name, "Ali")
  })
})
