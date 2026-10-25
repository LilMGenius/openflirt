// Answer schema check: it must compile under ajv's strict draft 2020-12 mode, stay inside the
// OpenAI Structured Outputs strict subset that "codex exec --output-schema" accepts, and list
// exactly the skill's principle ids in its principles enum. The copy the runner sends to
// "claude --json-schema" must also compile under ajv's default draft-07 class, which is what
// Claude Code validates with: its rejection of this file named the missing 2020-12 meta-schema.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import Ajv from "ajv";
import Ajv2020 from "ajv/dist/2020.js";
import { claudeSchemaJson } from "./cli.mjs";

export const SCHEMA_FILE = "schema/answer.schema.json";
const FORBIDDEN = ["minLength", "maxLength", "allOf", "not", "if", "then", "else", "dependentRequired", "dependentSchemas"];
const ROOT_FORBIDDEN = ["oneOf", "anyOf"];
const SCHEMA_MAPS = ["properties", "$defs", "definitions"];
const SCHEMA_LISTS = ["anyOf", "prefixItems"];
const isMapping = (value) => typeof value === "object" && value !== null && !Array.isArray(value);
const escapePointer = (key) => key.replace(/~/g, "~0").replace(/\//g, "~1");

// Union types such as ["string", "null"] are how the strict subset spells an optional value.
export const createAjv = () => new Ajv2020({ strict: true, allErrors: true, allowUnionTypes: true });
const createDraft7Ajv = () => new Ajv({ strict: true, allErrors: true, allowUnionTypes: true });

function* subschemas(node, pointer) {
  for (const key of SCHEMA_MAPS) {
    if (isMapping(node[key])) for (const [name, sub] of Object.entries(node[key])) yield [sub, pointer + "/" + key + "/" + escapePointer(name)];
  }
  for (const key of SCHEMA_LISTS) {
    if (Array.isArray(node[key])) for (const [index, sub] of node[key].entries()) yield [sub, pointer + "/" + key + "/" + index];
  }
  if (node.items !== undefined) yield [node.items, pointer + "/items"];
}

const isObjectSchema = (node) => node.type === "object" || (Array.isArray(node.type) && node.type.includes("object")) || isMapping(node.properties);

export function strictSubsetFindings(schema) {
  const findings = [];
  if (!isMapping(schema) || schema.type !== "object") findings.push({ pointer: "", reason: 'root schema must have type "object"' });
  if (isMapping(schema)) {
    for (const key of ROOT_FORBIDDEN) if (Object.hasOwn(schema, key)) findings.push({ pointer: "/" + key, reason: key + " is not allowed at the root" });
  }
  const visit = (node, pointer) => {
    if (!isMapping(node)) {
      findings.push({ pointer, reason: "subschema must be an object" });
      return;
    }
    for (const key of FORBIDDEN) if (Object.hasOwn(node, key)) findings.push({ pointer: pointer + "/" + key, reason: key + " is outside the Structured Outputs strict subset" });
    if (isObjectSchema(node)) {
      if (node.additionalProperties !== false) findings.push({ pointer, reason: "object schema must set additionalProperties: false" });
      const keys = Object.keys(isMapping(node.properties) ? node.properties : {});
      const required = Array.isArray(node.required) ? node.required : [];
      const missing = keys.filter((key) => !required.includes(key));
      const extra = required.filter((key) => !keys.includes(key));
      if (missing.length > 0) findings.push({ pointer, reason: "required must list every property; missing " + missing.join(", ") });
      if (extra.length > 0) findings.push({ pointer, reason: "required names properties that do not exist: " + extra.join(", ") });
    }
    for (const [sub, subPointer] of subschemas(node, pointer)) visit(sub, subPointer);
  };
  visit(schema, "");
  return findings;
}

export function principleEnumFindings(schema, ids) {
  const pointer = "/properties/principles/items/enum";
  const values = schema?.properties?.principles?.items?.enum;
  if (!Array.isArray(values)) return [{ pointer, reason: "principles.items.enum must be an array of principle ids" }];
  const findings = [];
  const duplicates = values.filter((value, index) => values.indexOf(value) !== index);
  const missing = ids.filter((id) => !values.includes(id));
  const extra = values.filter((value) => !ids.includes(value));
  if (duplicates.length > 0) findings.push({ pointer, reason: "enum repeats " + duplicates.join(", ") });
  if (missing.length > 0) findings.push({ pointer, reason: "enum lacks principle ids " + missing.join(", ") });
  if (extra.length > 0) findings.push({ pointer, reason: "enum holds ids that are not principles: " + extra.join(", ") });
  return findings;
}

// Line of a JSON pointer in pretty-printed JSON: find each key in turn after the previous one.
export function lineOfPointer(text, pointer) {
  let at = 0;
  for (const segment of pointer.split("/").slice(1)) {
    const key = segment.replace(/~1/g, "/").replace(/~0/g, "~");
    const next = /^\d+$/.test(key) ? at : text.indexOf(JSON.stringify(key) + ":", at);
    if (next === -1) break;
    at = next;
  }
  return text.slice(0, at).split("\n").length;
}

export function checkSchemaText(text, file, ids) {
  let schema;
  try {
    schema = JSON.parse(text);
  } catch (error) {
    if (error instanceof SyntaxError) return [{ file, line: 1, reason: "invalid JSON: " + error.message }];
    throw error;
  }
  const compileFindings = (create, value, label) => {
    try {
      create().compile(value);
      return [];
    } catch (error) {
      if (!(error instanceof Error)) throw error;
      return [{ file, line: 1, reason: label + ": " + error.message }];
    }
  };
  const findings = compileFindings(createAjv, schema, "ajv (draft 2020-12, strict) rejects the schema");
  if (findings.length === 0) findings.push(...compileFindings(createDraft7Ajv, JSON.parse(claudeSchemaJson(schema)), "ajv draft-07, which claude --json-schema validates with, rejects the schema the runner sends claude"));
  const located = [...strictSubsetFindings(schema), ...principleEnumFindings(schema, ids)];
  return [...findings, ...located.map(({ pointer, reason }) => ({ file, line: lineOfPointer(text, pointer), reason: (pointer === "" ? "#" : pointer) + ": " + reason }))];
}

export const checkSchema = (root, ids) => checkSchemaText(readFileSync(join(root, SCHEMA_FILE), "utf8"), SCHEMA_FILE, ids);

export function loadAnswerValidator(root) {
  return createAjv().compile(JSON.parse(readFileSync(join(root, SCHEMA_FILE), "utf8")));
}
