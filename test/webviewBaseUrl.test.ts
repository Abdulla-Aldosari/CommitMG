// Tests for the custom base URL check that warns before an API key travels
// over plain http to another machine.

import assert from "node:assert/strict";
import { describe, it } from "mocha";
import { classifyBaseUrl } from "../src/webview/baseUrl";

describe("classifyBaseUrl", () => {
  it("treats https as secure", () => {
    assert.equal(classifyBaseUrl("https://api.example.com/v1"), "secure");
    assert.equal(classifyBaseUrl("  https://10.0.0.5:8443/v1  "), "secure");
  });

  it("allows plain http to this machine", () => {
    for (const url of [
      "http://localhost:11434/v1",
      "http://127.0.0.1:1234/v1",
      "http://127.8.9.10/v1",
      "http://[::1]:8080/v1",
      "http://ollama.localhost/v1",
      "HTTP://LOCALHOST/v1",
    ]) {
      assert.equal(classifyBaseUrl(url), "local", url);
    }
  });

  it("flags plain http to any other host", () => {
    for (const url of ["http://api.example.com/v1", "http://192.168.1.20:11434/v1", "http://localhost.example.com/v1", "http://127.0.0.1.example.com/v1"]) {
      assert.equal(classifyBaseUrl(url), "insecure", url);
    }
  });

  it("separates an empty value from an unusable one", () => {
    assert.equal(classifyBaseUrl("   "), "empty");
    assert.equal(classifyBaseUrl("api.example.com/v1"), "invalid");
    assert.equal(classifyBaseUrl("ftp://api.example.com"), "invalid");
    assert.equal(classifyBaseUrl("javascript:alert(1)"), "invalid");
  });
});
