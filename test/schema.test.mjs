import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { checkSchemaText, strictSubsetFindings } from "../scripts/lib/schema.mjs";
import { REPO_ROOT } from "./fixture-repo.mjs";

const text = readFileSync(join(REPO_ROOT, "schema", "answer.schema.json"), "utf8");
const schema = () => JSON.parse(text);
const ids = () => schema().properties.principles.items.enum;
const pretty = (value) => JSON.stringify(value, null, 2);

test("the published schema compiles strictly and stays in the strict subset", () => {
  assert.deepEqual(checkSchemaText(text, "answer.schema.json", ids()), []);
});

test("minLength fails the strict-subset walk at its line", () => {
  const changed = schema();
  changed.properties.reading.minLength = 1;
  const findings = checkSchemaText(pretty(changed), "s.json", ids());
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
  assert.match(checkSchemaText(pretty(changed), "s.json", ids())[0].reason, /ajv/);
});

test("a principles enum that differs from the skill's ids fails both ways", () => {
  const findings = checkSchemaText(text, "s.json", [...ids().slice(1), "new-principle"]);
  assert.deepEqual(findings.map((finding) => finding.reason.replace(/^.*: /, "").split(" ").at(-1)), ["new-principle", ids()[0]]);
});
