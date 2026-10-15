import { describe, expect, it } from "vitest";

import { safeCallbackUrl, withCallbackUrl } from "./callback-url";

describe("safeCallbackUrl", () => {
  it.each(["/", "/invite/abc123", "/invite/abc123?x=1"])("keeps %j", (value) => {
    expect(safeCallbackUrl(value)).toBe(value);
  });

  it.each<[string, unknown]>([
    ["undefined", undefined],
    ["null", null],
    ["an empty string", ""],
    ["an array (the param appeared twice)", ["/invite/a", "/invite/b"]],
    ["a non-string value", 42],
    ["a path without a leading slash", "invite/abc"],
    ["a protocol-relative URL", "//evil.com"],
    ["three leading slashes", "///evil.com"],
    ["a slash then a backslash", "/\\evil.com"],
    ["two backslashes", "\\\\evil.com"],
    ["an absolute https URL", "https://evil.com"],
    ["an absolute URL on our own origin", "http://localhost:3000/"],
    ["a javascript: URL", "javascript:alert(1)"],
    ["a tab after the first slash", "/\t/evil.com"],
    ["a newline after the first slash", "/\n/evil.com"],
    ["a carriage return", "/invite\r/abc"],
    ["a NUL character", "/invite/\u0000abc"],
    ["DEL", "/invite/\u007fabc"],
    ["a C1 control character", "/invite/\u0085abc"],
    ["a space", "/invite/abc def"],
    ["leading whitespace", " /invite/abc"],
    ["a non-breaking space", "/invite/ abc"],
  ])("rejects %s", (_label, value) => {
    expect(safeCallbackUrl(value)).toBe("/");
  });
});

describe("withCallbackUrl", () => {
  it("appends a safe callbackUrl, encoded", () => {
    expect(withCallbackUrl("/signup", "/invite/abc123")).toBe(
      "/signup?callbackUrl=%2Finvite%2Fabc123",
    );
  });

  it("leaves the path alone for a missing, unsafe or root callbackUrl", () => {
    expect(withCallbackUrl("/signup", undefined)).toBe("/signup");
    expect(withCallbackUrl("/signup", "//evil.com")).toBe("/signup");
    expect(withCallbackUrl("/signup", "/")).toBe("/signup");
  });
});
