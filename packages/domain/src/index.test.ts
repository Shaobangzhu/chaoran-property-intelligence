import { describe, expect, it } from "vitest";

import { domainPackageName } from "./index.js";

describe("domain package", () => {
  it("is wired into the TypeScript and Vitest workspace", () => {
    expect(domainPackageName).toBe("@chaoran-property-intelligence/domain");
  });
});
