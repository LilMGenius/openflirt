import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { checkSchemaText, strictSubsetFindings } from "../scripts/lib/schema.mjs";
import { REPO_ROOT } from "./fixture-repo.mjs";

const text = readFileSync(join(REPO_ROOT, "schema", "answer.schema.json"), "utf8");
const schema = () => JSON.parse(text);
const ids = () => schema().properties.principles.items.enum;
const videos = () => schema().properties.citations.items.properties.video.enum;
const pretty = (value) => JSON.stringify(value, null, 2);
const check = (body) => checkSchemaText(body, "s.json", ids(), videos());

test("the published schema compiles strictly and stays in the strict subset", () => {
  assert.deepEqual(checkSchemaText(text, "answer.schema.json", ids(), videos()), []);
});

test("minLength fails the strict-subset walk at its line", () => {
  const changed = schema();
  changed.properties.reading.minLength = 1;
  const findings = check(pretty(changed));
  assert.equal(findings.length, 1);
  assert.match(findings[0].reason, /^\/properties\/reading\/minLength/);
  assert.equal(pretty(changed).split("\n")[findings[0].line - 1].trim(), '"minLength": 1');
});

test("a nested object without additionalProperties: false fails", () => {
  const changed = schema();
  delete changed.properties.citations.items.additionalProperties;
  assert.deepEqual(strictSubsetFindings(changed).map((finding) => finding.pointer), ["/properties/citations/items"]);
});

test("an optional property left out of required fails", () => {
  const changed = schema();
  changed.required = changed.required.filter((key) => key !== "message");
  assert.match(strictSubsetFindings(changed)[0].reason, /missing message/);
});

test("anyOf at the root fails", () => {
  assert.equal(strictSubsetFindings({ ...schema(), anyOf: [{ required: ["verdict"] }] }).length, 1);
});

test("a keyword ajv strict mode does not know fails compilation", () => {
  const changed = schema();
  changed.properties.answer.format_hint = "korean";
  assert.match(check(pretty(changed))[0].reason, /ajv/);
});

test("a principles enum that differs from the skill's ids fails both ways", () => {
  const findings = checkSchemaText(text, "s.json", [...ids().slice(1), "new-principle"], videos());
  assert.deepEqual(findings.map((finding) => finding.reason.replace(/^.*: /, "").split(" ").at(-1)), ["new-principle", ids()[0]]);
});

test("a citation video enum that differs from the lecture registry fails both ways", () => {
  const findings = checkSchemaText(text, "s.json", ids(), ["SecondVideo", ...videos().slice(1)]);
  assert.deepEqual(findings.map((finding) => finding.reason.replace(/^.*: /, "").split(" ").at(-1)), ["SecondVideo", videos()[0]]);
  assert.ok(findings.every((finding) => finding.reason.startsWith("/properties/citations/items/properties/video/enum")));
});

test("a principles enum that repeats an id fails, and draft-07 rejects it for claude too", () => {
  const changed = schema();
  changed.properties.principles.items.enum = [...ids(), ids()[0]];
  const findings = check(pretty(changed));
  assert.equal(findings.length, 2);
  assert.match(findings[0].reason, /^ajv draft-07, which claude --json-schema validates with, rejects the schema the runner sends claude: schema is invalid: data\/properties\/principles\/items\/enum must NOT have duplicate items/);
  assert.match(findings[1].reason, new RegExp("enum repeats " + ids()[0] + "$"));
});

test("text that is not JSON fails on line 1 without compiling", () => {
  const findings = check("{");
  assert.deepEqual(findings.map((finding) => [finding.line, finding.reason.startsWith("invalid JSON: ")]), [[1, true]]);
});

test("a keyword draft-07 does not know fails the schema the runner sends claude", () => {
  const changed = schema();
  changed.unevaluatedProperties = false;
  const findings = check(pretty(changed));
  assert.equal(findings.length, 1);
  assert.match(findings[0].reason, /^ajv draft-07, which claude --json-schema validates with, rejects the schema the runner sends claude: strict mode: unknown keyword: "unevaluatedProperties"$/);
});
