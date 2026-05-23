import { describe, expect, it, afterEach } from "vitest";
import { shouldRequireApiDeployFromEnv } from "../src/runtime/api-deploy-policy.js";

describe("api deploy policy", () => {
  const saved = {
    require: process.env.DEXTER_REQUIRE_API_DEPLOY,
    url: process.env.DEXTER_COOLIFY_API_URL,
    token: process.env.DEXTER_COOLIFY_TOKEN,
  };

  afterEach(() => {
    if (saved.require) {
      process.env.DEXTER_REQUIRE_API_DEPLOY = saved.require;
    } else {
      delete process.env.DEXTER_REQUIRE_API_DEPLOY;
    }
    if (saved.url) {
      process.env.DEXTER_COOLIFY_API_URL = saved.url;
    } else {
      delete process.env.DEXTER_COOLIFY_API_URL;
    }
    if (saved.token) {
      process.env.DEXTER_COOLIFY_TOKEN = saved.token;
    } else {
      delete process.env.DEXTER_COOLIFY_TOKEN;
    }
  });

  it("requires API deploy when bridge env is configured", () => {
    delete process.env.DEXTER_REQUIRE_API_DEPLOY;
    process.env.DEXTER_COOLIFY_API_URL = "http://127.0.0.1:9876";
    process.env.DEXTER_COOLIFY_TOKEN = "token";
    expect(shouldRequireApiDeployFromEnv()).toBe(true);
  });

  it("honors explicit false override", () => {
    process.env.DEXTER_REQUIRE_API_DEPLOY = "false";
    process.env.DEXTER_COOLIFY_API_URL = "http://127.0.0.1:9876";
    process.env.DEXTER_COOLIFY_TOKEN = "token";
    expect(shouldRequireApiDeployFromEnv()).toBe(false);
  });
});
