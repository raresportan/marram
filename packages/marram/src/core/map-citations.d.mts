export function featureOf(line: string): string | undefined;
export function statusOf(line: string): { mark: "✅" | "❌"; text: string } | undefined;
export function mapLines(markdown: string): string[];
export function mapCitations(markdown: string): { feature: string; citation: string }[];
