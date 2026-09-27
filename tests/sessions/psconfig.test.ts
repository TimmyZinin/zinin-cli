import { test, expect } from "bun:test";
import { parsePsConfig } from "../../src/sessions/psconfig";

test("K3-3: newaCmd array parses from config", () => {
  const cfg = parsePsConfig(JSON.stringify({ newaCmd: ["ssh", "newa", "/opt/bun", "/opt/zinin/src/repl.ts", "ps", "--sources", "newa", "--json"] }));
  expect(cfg.newaCmd).toEqual(["ssh", "newa", "/opt/bun", "/opt/zinin/src/repl.ts", "ps", "--sources", "newa", "--json"]);
});
test("K3-3: empty or malformed config falls back to null", () => {
  expect(parsePsConfig(null)).toEqual({ newaCmd: null });
  expect(parsePsConfig("")).toEqual({ newaCmd: null });
  expect(parsePsConfig("{oops")).toEqual({ newaCmd: null });
  expect(parsePsConfig('{"newaCmd": "ssh newa"}')).toEqual({ newaCmd: null });
  expect(parsePsConfig('{"newaCmd": []}')).toEqual({ newaCmd: null });
  expect(parsePsConfig('{"newaCmd": ["ssh", 42]}')).toEqual({ newaCmd: null });
  expect(parsePsConfig('{"other": true}')).toEqual({ newaCmd: null });
});
