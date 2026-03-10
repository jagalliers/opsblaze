import { describe, it, expect } from "vitest";
import { EventEmitter } from "events";
import type { IncomingMessage, ClientRequest, RequestOptions } from "http";
import { checkSplunk, checkClaude } from "../health.js";
import type { Requester } from "../health.js";

function makeReq(): ClientRequest {
  const req = new EventEmitter() as ClientRequest;
  req.end = () => req;
  req.destroy = () => req;
  return req;
}

function fakeRequester(statusCode: number): Requester {
  return (_opts: RequestOptions, cb: (res: IncomingMessage) => void) => {
    const resp = new EventEmitter() as IncomingMessage;
    resp.statusCode = statusCode;
    resp.resume = () => resp;
    cb(resp);
    return makeReq();
  };
}

function errorRequester(errorMessage: string): Requester {
  return (_opts: RequestOptions, _cb: (res: IncomingMessage) => void) => {
    const req = makeReq();
    setTimeout(() => req.emit("error", new Error(errorMessage)), 0);
    return req;
  };
}

function timeoutRequester(): Requester {
  return (_opts: RequestOptions, _cb: (res: IncomingMessage) => void) => {
    const req = makeReq();
    setTimeout(() => req.emit("timeout"), 0);
    return req;
  };
}

const splunkBase = { host: "splunk.test", port: 8089, scheme: "https", verifySsl: false };

describe("checkSplunk", () => {
  it("returns error with 'not configured' when host is missing", async () => {
    const result = await checkSplunk({ ...splunkBase, host: undefined });
    expect(result).toEqual({ status: "error", message: "not configured" });
  });

  it("returns ok for 2xx status codes", async () => {
    const result = await checkSplunk({ ...splunkBase, _requester: fakeRequester(200) });
    expect(result).toEqual({ status: "ok" });
  });

  it("returns ok for 204", async () => {
    const result = await checkSplunk({ ...splunkBase, _requester: fakeRequester(204) });
    expect(result).toEqual({ status: "ok" });
  });

  it("returns degraded with 'auth failed' for 401", async () => {
    const result = await checkSplunk({ ...splunkBase, _requester: fakeRequester(401) });
    expect(result).toEqual({ status: "degraded", message: "auth failed" });
  });

  it("returns degraded with 'auth failed' for 403", async () => {
    const result = await checkSplunk({ ...splunkBase, _requester: fakeRequester(403) });
    expect(result).toEqual({ status: "degraded", message: "auth failed" });
  });

  it("returns error with HTTP code for 500", async () => {
    const result = await checkSplunk({ ...splunkBase, _requester: fakeRequester(500) });
    expect(result).toEqual({ status: "error", message: "HTTP 500" });
  });

  it("returns error with HTTP code for 503", async () => {
    const result = await checkSplunk({ ...splunkBase, _requester: fakeRequester(503) });
    expect(result).toEqual({ status: "error", message: "HTTP 503" });
  });

  it("returns degraded for other status codes like 404", async () => {
    const result = await checkSplunk({ ...splunkBase, _requester: fakeRequester(404) });
    expect(result).toEqual({ status: "degraded", message: "HTTP 404" });
  });

  it("returns error with 'unreachable' on connection error", async () => {
    const result = await checkSplunk({
      ...splunkBase,
      _requester: errorRequester("ECONNREFUSED"),
    });
    expect(result).toEqual({ status: "error", message: "unreachable" });
  });

  it("returns error with 'timeout' on timeout", async () => {
    const result = await checkSplunk({ ...splunkBase, _requester: timeoutRequester() });
    expect(result).toEqual({ status: "error", message: "timeout" });
  });

  it("sends Bearer auth header when token is set", async () => {
    let capturedOpts: RequestOptions | undefined;
    const capturing: Requester = (opts, cb) => {
      capturedOpts = opts;
      return fakeRequester(200)(opts, cb);
    };
    await checkSplunk({ ...splunkBase, token: "my-token", _requester: capturing });
    expect(capturedOpts?.headers).toEqual({ Authorization: "Bearer my-token" });
  });

  it("sends Basic auth header when username/password is set", async () => {
    let capturedOpts: RequestOptions | undefined;
    const capturing: Requester = (opts, cb) => {
      capturedOpts = opts;
      return fakeRequester(200)(opts, cb);
    };
    await checkSplunk({
      ...splunkBase,
      username: "admin",
      password: "secret",
      _requester: capturing,
    });
    const expected = `Basic ${Buffer.from("admin:secret").toString("base64")}`;
    expect(capturedOpts?.headers).toEqual({ Authorization: expected });
  });

  it("prefers token over username/password when both are set", async () => {
    let capturedOpts: RequestOptions | undefined;
    const capturing: Requester = (opts, cb) => {
      capturedOpts = opts;
      return fakeRequester(200)(opts, cb);
    };
    await checkSplunk({
      ...splunkBase,
      token: "my-token",
      username: "admin",
      password: "secret",
      _requester: capturing,
    });
    expect(capturedOpts?.headers).toEqual({ Authorization: "Bearer my-token" });
  });

  it("sends no auth header when no credentials are provided", async () => {
    let capturedOpts: RequestOptions | undefined;
    const capturing: Requester = (opts, cb) => {
      capturedOpts = opts;
      return fakeRequester(200)(opts, cb);
    };
    await checkSplunk({ ...splunkBase, _requester: capturing });
    expect(capturedOpts?.headers).toBeUndefined();
  });
});

describe("checkClaude", () => {
  it("returns ok for 200 from Anthropic API", async () => {
    const result = await checkClaude({ apiKey: "sk-test", _requester: fakeRequester(200) });
    expect(result).toEqual({ status: "ok" });
  });

  it("returns error with 'invalid API key' for 401", async () => {
    const result = await checkClaude({ apiKey: "sk-bad", _requester: fakeRequester(401) });
    expect(result).toEqual({ status: "error", message: "invalid API key" });
  });

  it("returns degraded with 'rate limited' for 429", async () => {
    const result = await checkClaude({ apiKey: "sk-test", _requester: fakeRequester(429) });
    expect(result).toEqual({ status: "degraded", message: "rate limited" });
  });

  it("returns degraded with HTTP code for other status codes", async () => {
    const result = await checkClaude({ apiKey: "sk-test", _requester: fakeRequester(500) });
    expect(result).toEqual({ status: "degraded", message: "HTTP 500" });
  });

  it("returns error with 'unreachable' on network error", async () => {
    const result = await checkClaude({
      apiKey: "sk-test",
      _requester: errorRequester("ENOTFOUND"),
    });
    expect(result).toEqual({ status: "error", message: "unreachable" });
  });

  it("returns error with 'unreachable' on timeout", async () => {
    const result = await checkClaude({ apiKey: "sk-test", _requester: timeoutRequester() });
    expect(result).toEqual({ status: "error", message: "unreachable" });
  });

  it("returns ok with 'OAuth' when CLI succeeds and no API key", async () => {
    const mockExec = (() =>
      Promise.resolve({
        stdout: "1.0.0",
        stderr: "",
      })) as unknown as typeof import("../health.js").checkClaude extends (opts: infer O) => unknown
      ? NonNullable<(O & { _execFile?: unknown })["_execFile"]>
      : never;
    const result = await checkClaude({ apiKey: undefined, _execFile: mockExec });
    expect(result).toEqual({ status: "ok", message: "OAuth" });
  });

  it("returns error with 'CLI not found' when CLI fails and no API key", async () => {
    const mockExec = (() =>
      Promise.reject(
        new Error("ENOENT")
      )) as unknown as typeof import("../health.js").checkClaude extends (opts: infer O) => unknown
      ? NonNullable<(O & { _execFile?: unknown })["_execFile"]>
      : never;
    const result = await checkClaude({ apiKey: undefined, _execFile: mockExec });
    expect(result).toEqual({ status: "error", message: "CLI not found" });
  });
});

describe("overall status derivation", () => {
  it("both ok yields overall ok", async () => {
    const splunk = await checkSplunk({ ...splunkBase, _requester: fakeRequester(200) });
    const claude = await checkClaude({ apiKey: "sk-test", _requester: fakeRequester(200) });
    const checks = { splunk, claude };
    const overall = Object.values(checks).every((c) => c.status === "ok")
      ? "ok"
      : Object.values(checks).some((c) => c.status === "error")
        ? "error"
        : "degraded";
    expect(overall).toBe("ok");
  });

  it("one error yields overall error", async () => {
    const splunk = await checkSplunk({ ...splunkBase, _requester: fakeRequester(200) });
    const claude = await checkClaude({ apiKey: "sk-bad", _requester: fakeRequester(401) });
    const checks = { splunk, claude };
    const overall = Object.values(checks).every((c) => c.status === "ok")
      ? "ok"
      : Object.values(checks).some((c) => c.status === "error")
        ? "error"
        : "degraded";
    expect(overall).toBe("error");
  });

  it("one degraded (no errors) yields overall degraded", async () => {
    const splunk = await checkSplunk({ ...splunkBase, _requester: fakeRequester(401) });
    const claude = await checkClaude({ apiKey: "sk-test", _requester: fakeRequester(200) });
    const checks = { splunk, claude };
    const overall = Object.values(checks).every((c) => c.status === "ok")
      ? "ok"
      : Object.values(checks).some((c) => c.status === "error")
        ? "error"
        : "degraded";
    expect(overall).toBe("degraded");
  });
});
