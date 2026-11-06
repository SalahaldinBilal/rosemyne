import { TemplateVariable } from "../../constants/templateVariables";

export type TemplateSegment = { text: string, kind: "text" | "variable" | "bad" };

function isValidToken(body: string, variables: readonly TemplateVariable[]): boolean {
  const [name, argument, ...rest] = body.split(":");
  const variable = variables.find(entry => entry.name === name);
  if (!variable || rest.length > 0) return false;
  if (argument === undefined) return true;
  if (!variable.argument || !/^\d+$/.test(argument)) return false;
  const value = Number(argument);
  return value >= variable.argument.min && value <= variable.argument.max;
}

export function tokenizeTemplate(value: string, variables: readonly TemplateVariable[]): TemplateSegment[] {
  const segments: TemplateSegment[] = [];
  let rest = value;

  while (rest.length > 0) {
    const start = rest.indexOf("${");
    if (start < 0) {
      segments.push({ text: rest, kind: "text" });
      break;
    }

    if (start > 0) segments.push({ text: rest.slice(0, start), kind: "text" });

    const close = rest.indexOf("}", start + 2);
    if (close < 0) {
      segments.push({ text: rest.slice(start), kind: "bad" });
      break;
    }

    const token = rest.slice(start, close + 1);
    segments.push({ text: token, kind: isValidToken(token.slice(2, -1), variables) ? "variable" : "bad" });
    rest = rest.slice(close + 1);
  }

  return segments;
}

export function hasBadTokens(value: string, variables: readonly TemplateVariable[]): boolean {
  return tokenizeTemplate(value, variables).some(segment => segment.kind === "bad");
}

// The partly typed variable right before the caret, if the caret sits inside one.
export function variableQueryAt(value: string, caret: number): { start: number, query: string } | null {
  const before = value.slice(0, caret);
  const dollar = before.lastIndexOf("$");
  if (dollar < 0) return null;

  const typed = before.slice(dollar + 1);
  if (typed.includes("}")) return null;

  const query = typed.startsWith("{") ? typed.slice(1) : typed;
  if (!/^[A-Za-z]*$/.test(query)) return null;
  return { start: dollar, query };
}
