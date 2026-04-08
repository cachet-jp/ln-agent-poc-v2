import { describe, expect, it } from "vitest";
import { jsonResponse, errorResponse, withErrorHandler } from "./tool-helpers";

describe("jsonResponse", () => {
  it("returns correct MCP response structure with JSON.stringify(data, null, 2)", () => {
    const data = { foo: "bar" };
    const result = jsonResponse(data);
    expect(result).toEqual({
      content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
    });
  });

  it("handles plain objects", () => {
    const result = jsonResponse({ a: 1, b: "two" });
    expect(result.content[0].text).toBe('{\n  "a": 1,\n  "b": "two"\n}');
  });

  it("handles arrays", () => {
    const result = jsonResponse([1, 2, 3]);
    expect(result.content[0].text).toBe("[\n  1,\n  2,\n  3\n]");
  });

  it("handles null", () => {
    const result = jsonResponse(null);
    expect(result.content[0].text).toBe("null");
  });

  it("handles undefined", () => {
    const result = jsonResponse(undefined);
    expect(result.content[0].text).toBeUndefined();
  });

  it("handles numbers", () => {
    const result = jsonResponse(42);
    expect(result.content[0].text).toBe("42");
  });

  it("handles strings", () => {
    const result = jsonResponse("hello");
    expect(result.content[0].text).toBe('"hello"');
  });

  it("serializes nested objects properly", () => {
    const data = { a: { b: { c: [1, { d: true }] } } };
    const result = jsonResponse(data);
    expect(result.content[0].text).toBe(JSON.stringify(data, null, 2));
    expect(JSON.parse(result.content[0].text)).toEqual(data);
  });
});

describe("errorResponse", () => {
  it("returns correct structure with isError: true", () => {
    const result = errorResponse("something went wrong");
    expect(result).toEqual({
      content: [{ type: "text", text: "something went wrong" }],
      isError: true,
    });
  });

  it("text content matches the provided message", () => {
    const msg = "detailed error: connection refused";
    const result = errorResponse(msg);
    expect(result.content).toHaveLength(1);
    expect(result.content[0].type).toBe("text");
    expect(result.content[0].text).toBe(msg);
    expect(result.isError).toBe(true);
  });
});

describe("withErrorHandler", () => {
  it("returns jsonResponse of handler result on success", async () => {
    const data = { success: true, count: 5 };
    const result = await withErrorHandler(async () => data);
    expect(result).toEqual(jsonResponse(data));
    expect(result.isError).toBeUndefined();
  });

  it("returns errorResponse with error message on Error throw", async () => {
    const result = await withErrorHandler(async () => {
      throw new Error("connection timeout");
    });
    expect(result).toEqual(errorResponse("Error: connection timeout"));
    expect(result.isError).toBe(true);
  });

  it("handles non-Error throws (string)", async () => {
    const result = await withErrorHandler(async () => {
      throw "raw string error";
    });
    // (err as Error).message is undefined for non-Error throws
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toBe("Error: undefined");
  });

  it("handles non-Error throws (undefined)", async () => {
    const result = await withErrorHandler(async () => {
      throw undefined;
    });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toBe("Error: undefined");
  });
});
