import { z } from "zod";
import type { JsonObjectSchema, JsonPropertySchema } from "../../packages/contracts/src/mcp.ts";

function propertyToZod(prop: JsonPropertySchema): z.ZodTypeAny {
  if (Array.isArray(prop.type)) {
    return propertyToZod({ ...prop, type: "string" }).nullable();
  }
  switch (prop.type) {
    case "string": {
      if (prop.enum && prop.enum.length > 0) {
        const [head, ...rest] = prop.enum;
        return z.enum([head, ...rest]);
      }
      const field = z.string();
      return prop.minLength != null ? field.min(prop.minLength) : field;
    }
    case "number":
      return z.number().finite();
    case "integer":
      return z.number().int();
    case "boolean":
      return z.boolean();
    case "object":
      return z.record(z.string(), z.unknown());
    case "array":
      return z.array(z.unknown());
    default:
      return z.unknown();
  }
}

export function jsonSchemaToZod(schema: JsonObjectSchema): z.ZodObject<z.ZodRawShape> {
  const shape: Record<string, z.ZodTypeAny> = {};
  for (const [key, prop] of Object.entries(schema.properties)) {
    let field = propertyToZod(prop);
    if (!schema.required.includes(key)) {
      field = field.optional();
    }
    shape[key] = field;
  }
  return z.object(shape).strict();
}
